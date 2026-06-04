/**
 * pi-bwrap-bash — sandbox pi bash commands with bubblewrap
 *
 * Replaces the built-in bash tool so LLM-invoked commands run inside bwrap.
 * User-initiated !commands are NOT sandboxed.
 *
 * Config files (JSON, merged, project takes precedence):
 *   - ~/.pi/agent/bwrap.json        (global)
 *   - <cwd>/.pi/bwrap.json          (project-local)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition, getShellConfig } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { findBwrap, testBwrap, createBwrapOps } from "./bwrap.js";
import {
	looksLikeSandboxFailure,
	truncateCommandForDisplay,
	detectPackageManager,
	getBwrapInstallHint,
	isPathOutsideCwd,
} from "./utils.js";

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();
	let active = false;

	pi.registerFlag("no-bwrap", {
		description: "Disable bubblewrap sandboxing for bash commands",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("bwrap", {
		description: "Show bubblewrap sandbox status",
		handler: async (_args, ctx) => {
			const lines: string[] = ["Bubblewrap Sandbox Status", ""];

			if (process.platform !== "linux") {
				lines.push(`Status: unsupported OS (${process.platform})`);
			} else {
				const bwrapPath = findBwrap();
				if (!bwrapPath) {
					lines.push("Status: bwrap not found");
					const pm = detectPackageManager();
					lines.push(`Install: ${getBwrapInstallHint(pm)}`);
				} else if (!testBwrap(bwrapPath)) {
					lines.push("Status: incompatible (user namespaces blocked)");
					lines.push(`Binary: ${bwrapPath}`);
				} else if (!active) {
					lines.push("Status: disabled");
				} else {
					lines.push("Status: active");
					lines.push(`Binary: ${bwrapPath}`);
				}
			}

			const config = await loadConfig(ctx.cwd);
			lines.push("");
			lines.push(`Enabled: ${config.enabled}`);
			lines.push(`Internet: ${config.internet}`);
			lines.push(`Prompt on failure: ${config.promptOnFailure}`);
			lines.push(`Extra read paths: ${config.extraReadPaths.join(", ") || "(none)"}`);
			lines.push(`Extra write paths: ${config.extraWritePaths.join(", ") || "(none)"}`);
			lines.push(`Write tools: ${Object.entries(config.writeTools).map(([k, v]) => `${k}(${v})`).join(", ") || "(none)"}`);

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const noBwrap = pi.getFlag("no-bwrap") as boolean;

		if (noBwrap) {
			active = false;
			ctx.ui.setStatus("bwrap", ctx.ui.theme.fg("muted", "bwrap: off"));
			ctx.ui.notify("bwrap-bash: disabled via --no-bwrap", "info");
			return;
		}

		const config = await loadConfig(ctx.cwd);

		if (!config.enabled) {
			active = false;
			ctx.ui.setStatus("bwrap", ctx.ui.theme.fg("muted", "bwrap: off"));
			ctx.ui.notify("bwrap-bash: disabled in config", "info");
			return;
		}

		if (process.platform !== "linux") {
			active = false;
			ctx.ui.setStatus("bwrap", ctx.ui.theme.fg("muted", "bwrap: unsupported"));
			ctx.ui.notify(`bwrap-bash: unsupported on ${process.platform}`, "warning");
			return;
		}

		const bwrapPath = findBwrap();

		if (!bwrapPath) {
			active = false;
			const pm = detectPackageManager();
			const hint = getBwrapInstallHint(pm);
			ctx.ui.setStatus("bwrap", ctx.ui.theme.fg("warning", "bwrap: missing"));
			ctx.ui.notify(`bwrap-bash: bubblewrap not found. Install with: ${hint}`, "warning");
			return;
		}

		if (!testBwrap(bwrapPath)) {
			active = false;
			ctx.ui.setStatus("bwrap", ctx.ui.theme.fg("warning", "bwrap: incompatible"));
			ctx.ui.notify("bwrap-bash: bubblewrap installed but user namespaces are blocked. Sandbox disabled.", "warning");
			return;
		}

		// Register write-tool gate
		pi.on("tool_call", async (event, toolCtx) => {
			const pathArgName = config.writeTools[event.toolName];
			if (!pathArgName) return;

			const targetPath = (event.input as Record<string, unknown>)[pathArgName] as string | undefined;
			if (!targetPath) return;

			if (!isPathOutsideCwd(targetPath, toolCtx.cwd)) return;

			if (!config.promptOnFailure || !toolCtx.hasUI) {
				return { block: true, reason: `Write outside working directory blocked: ${targetPath}` };
			}

			const ok = await toolCtx.ui.confirm(
				"Write outside cwd",
				`Tool "${event.toolName}" wants to write to:\n${targetPath}\n\nAllow?`
			);

			if (!ok) {
				return { block: true, reason: `Write outside working directory denied by user: ${targetPath}` };
			}
		});

		const bwrapOps = createBwrapOps(bwrapPath, config);
		const bwrapDef = createBashToolDefinition(ctx.cwd, {
			operations: bwrapOps,
			shellPath: config.shellPath,
		});
		const localDef = createBashToolDefinition(ctx.cwd, { shellPath: config.shellPath });

		pi.registerTool({
			...bwrapDef,
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				try {
					return await bwrapDef.execute(toolCallId, params, signal, onUpdate, ctx);
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					const isTimeout = errMsg.includes("Command timed out");
					const isAbort = errMsg.includes("Command aborted");
					const isSandboxFailure = !isTimeout && !isAbort && looksLikeSandboxFailure(errMsg);

					if (!isSandboxFailure || !config.promptOnFailure) {
						throw err;
					}

					if (!ctx.hasUI) {
						throw err;
					}

					const cmd = params.command as string;
					const truncatedCmd = truncateCommandForDisplay(cmd);
					const retry = await ctx.ui.confirm(
						"Sandbox failure",
						`Command failed inside sandbox.\n\n$ ${truncatedCmd}\n\n${errMsg.slice(0, 200)}\n\nRetry without sandbox?`
					);

					if (retry) {
						return localDef.execute(toolCallId, params, signal, onUpdate, ctx);
					}

					throw err;
				}
			},
		});

		active = true;
		const netText = config.internet === "allow" ? "bwrap: protection on 🛜" : "bwrap: protection on";
		ctx.ui.setStatus("bwrap", ctx.ui.theme.fg("accent", netText));
		ctx.ui.notify(`bwrap-bash: ${netText}`, "info");
	});
}
