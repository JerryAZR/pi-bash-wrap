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
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "./config.js";
import { findBwrap, testBwrap, createBwrapOps } from "./bwrap.js";
import { executeWithFallback } from "./execute.js";
import {
	detectPackageManager,
	getBwrapInstallHint,
	isPathOutsideCwd,
	truncateCommandForDisplay,
} from "./utils.js";
import { tmpdir } from "node:os";

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
			lines.push(`Timeout: ${config.timeout}s`);

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
		// Register tool-call gates
		pi.on("tool_call", async (event, toolCtx) => {
			// Gate unsandboxed bash requests
			if (event.toolName === "bash") {
				const input = event.input as Record<string, unknown>;
				if (input.unsandboxed === true) {
					if (!config.promptOnFailure || !toolCtx.hasUI) {
						return { block: true, reason: "Unsandboxed bash execution blocked" };
					}
					const truncatedCmd = truncateCommandForDisplay(String(input.command ?? ""));
					const ok = await toolCtx.ui.confirm(
						"Run outside sandbox",
						`The agent wants to run this command outside the sandbox:\n\n$ ${truncatedCmd}\n\nAllow?`,
					);
					if (!ok) {
						return { block: true, reason: "User denied unsandboxed execution" };
					}
				}
				return;
			}

			// Gate write/edit tools outside cwd
			const pathArgName = config.writeTools[event.toolName];
			if (!pathArgName) return;

			const targetPath = (event.input as Record<string, unknown>)[pathArgName] as string | undefined;
			if (!targetPath) return;

			// Allow writes to system temp directory
			if (!isPathOutsideCwd(targetPath, tmpdir())) return;

			if (!isPathOutsideCwd(targetPath, toolCtx.cwd)) return;

			if (!config.promptOnFailure || !toolCtx.hasUI) {
				return { block: true, reason: `Write outside working directory blocked: ${targetPath}` };
			}

			const ok = await toolCtx.ui.confirm(
				"Write outside cwd",
				`Tool "${event.toolName}" wants to write to:\n${targetPath}\n\nAllow?`,
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

		const extendedSchema = Type.Object({
			command: Type.String(),
			timeout: Type.Optional(Type.Number()),
			unsandboxed: Type.Optional(Type.Boolean({
				description:
					"If true, run this command outside the sandbox. " +
					"Use when you know the command requires unsandboxed access (e.g., podman, docker, buildah, nerdctl) " +
					"or when retrying a command that previously failed with sandbox errors like 'Read-only file system'. " +
					"Do NOT use for ordinary file operations, package installs, or build commands.",
				default: false,
			})),
		});

		pi.registerTool({
			...bwrapDef,
			parameters: extendedSchema,
			description:
				(bwrapDef.description ?? "") +
				"\n\nThis tool runs commands inside a sandbox by default. " +
				"Set `unsandboxed: true` when running container tools (podman, docker, buildah, nerdctl) " +
				"or when retrying a command that failed with sandbox errors like 'Read-only file system' or 'Permission denied'. " +
				"Do NOT use `unsandboxed` for ordinary commands.",
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				return executeWithFallback(
					toolCallId,
					params as { command: string; timeout?: number; unsandboxed?: boolean },
					signal,
					onUpdate,
					ctx,
					bwrapDef.execute.bind(bwrapDef),
					localDef.execute.bind(localDef),
				);
			},
		});

		active = true;
		const netText = config.internet === "allow" ? "bwrap: protection on 🛜" : "bwrap: protection on";
		ctx.ui.setStatus("bwrap", ctx.ui.theme.fg("accent", netText));
		ctx.ui.notify(`bwrap-bash: ${netText}`, "info");
	});
}
