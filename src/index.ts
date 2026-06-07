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
	looksLikeContainerCommand,
	truncateCommandForDisplay,
} from "./utils.js";
import { tmpdir } from "node:os";

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();
	let active = false;
	let userToggled = false;

	pi.registerFlag("no-bwrap", {
		description: "Disable bubblewrap sandboxing for bash commands",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("bwrap", {
		description: "Toggle bubblewrap sandbox protection (/bwrap, /bwrap on, /bwrap off)",
		handler: async (args, ctx) => {
			if (process.platform !== "linux") {
				ctx.ui.notify(`bwrap: unsupported on ${process.platform}`, "warning");
				return;
			}

			const bwrapPath = findBwrap();
			if (!bwrapPath) {
				const pm = detectPackageManager();
				ctx.ui.notify(`bwrap: missing. Install with: ${getBwrapInstallHint(pm)}`, "warning");
				return;
			}

			if (!testBwrap(bwrapPath)) {
				ctx.ui.notify("bwrap: incompatible (user namespaces blocked)", "warning");
				return;
			}

			const config = await loadConfig(ctx.cwd);
			const arg = args.trim().split(/\s+/)[0];

			if (arg === "on") { active = true; userToggled = true; }
			else if (arg === "off") { active = false; userToggled = true; }
			else { active = !active; userToggled = true; }

			const netText = config.internet === "allow" ? "bwrap: protection on 🛜" : "bwrap: protection on";
			if (active) {
				ctx.ui.setStatus("bwrap", ctx.ui.theme.fg("accent", netText));
				ctx.ui.notify(`bwrap-bash: ${netText}`, "info");
			} else {
				ctx.ui.setStatus("bwrap", ctx.ui.theme.fg("muted", "bwrap: off"));
				ctx.ui.notify("bwrap-bash: protection off", "info");
			}
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
				// When sandbox is toggled off, run everything locally without prompting
				if (!active) return;

				const input = event.input as Record<string, unknown>;
				const commandStr = String(input.command ?? "");

				// Auto-detect likely container commands if agent didn't request unsandboxed
				const explicitlyUnsandboxed = input.unsandboxed === true;
				const autoDetected = !explicitlyUnsandboxed && looksLikeContainerCommand(commandStr);
				const needsPrompt = explicitlyUnsandboxed || autoDetected;

				if (needsPrompt) {
					if (!config.promptOnFailure || !toolCtx.hasUI) {
						if (explicitlyUnsandboxed) {
							return { block: true, reason: "Unsandboxed bash execution blocked" };
						}
						// Auto-detected but no UI: proceed sandboxed and let it fail naturally
						return;
					}

					const truncatedCmd = truncateCommandForDisplay(commandStr);
					const title = autoDetected ? "Run container command outside sandbox?" : "Run outside sandbox";
					const message = autoDetected
						? `This looks like a container command that may fail inside the sandbox:\n\n$ ${truncatedCmd}\n\nRun outside sandbox?`
						: `The agent wants to run this command outside the sandbox:\n\n$ ${truncatedCmd}\n\nAllow?`;

					const ok = await toolCtx.ui.confirm(title, message);
					if (!ok) {
						if (explicitlyUnsandboxed) {
							return { block: true, reason: "User denied unsandboxed execution" };
						}
						// Auto-detected but denied: proceed sandboxed (user chose to try anyway)
						return;
					}
					// Approved: route to unsandboxed execution
					input.unsandboxed = true;
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
				// If toggled off, run outside sandbox regardless of params
				if (!active) {
					return localDef.execute(toolCallId, params, signal, onUpdate, ctx);
				}
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

		if (!userToggled) active = true;
		const netText = config.internet === "allow" ? "bwrap: protection on 🛜" : "bwrap: protection on";
		ctx.ui.setStatus("bwrap", ctx.ui.theme.fg("accent", netText));
		ctx.ui.notify(`bwrap-bash: ${netText}`, "info");
	});
}
