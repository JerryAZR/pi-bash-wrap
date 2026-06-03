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

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	getAgentDir,
	getShellConfig,
	type BashOperations,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_FILENAME = "bwrap.json";
const GLOBAL_CONFIG_DIR = "";
const PROJECT_CONFIG_SUBDIR = ".pi";

/** Default cache/config paths.  NO global-install targets. */
const DEFAULT_EXTRA_WRITE_PATHS: readonly string[] = [
	"~/.cache",
	"~/.config",
	"~/.npm",
	"~/.cargo/registry/cache",
	"~/.cargo/git",
	"~/.cargo/registry/src",
	"~/.rustup",
	"~/.m2/repository",
	"~/.gradle/caches",
	"~/.pip",
];

const SANDBOX_FAILURE_PATTERNS = [
	/Read-only file system/i,
	/Permission denied/i,
	/EACCES/i,
	/EROFS/i,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BwrapConfig {
	enabled: boolean;
	internet: "allow" | "block";
	extraReadPaths: string[];
	extraWritePaths: string[];
	shellPath?: string;
	promptOnFailure: boolean;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function expandHome(p: string): string {
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	if (p === "~") return homedir();
	return p;
}

async function loadConfig(cwd: string): Promise<BwrapConfig> {
	const paths = [
		join(getAgentDir(), GLOBAL_CONFIG_DIR, CONFIG_FILENAME),
		join(cwd, PROJECT_CONFIG_SUBDIR, CONFIG_FILENAME),
	];

	const merged: BwrapConfig = {
		enabled: true,
		internet: "allow",
		extraReadPaths: [],
		extraWritePaths: [...DEFAULT_EXTRA_WRITE_PATHS],
		promptOnFailure: true,
	};

	for (const p of paths) {
		if (!existsSync(p)) continue;
		try {
			const raw = await readFile(p, "utf-8");
			const parsed = JSON.parse(raw) as unknown as Partial<BwrapConfig>;

			if (parsed.enabled !== undefined) merged.enabled = parsed.enabled;
			if (parsed.internet !== undefined) merged.internet = parsed.internet;
			if (parsed.shellPath !== undefined) merged.shellPath = parsed.shellPath;
			if (parsed.promptOnFailure !== undefined) merged.promptOnFailure = parsed.promptOnFailure;
			if (parsed.extraReadPaths) merged.extraReadPaths = parsed.extraReadPaths;
			if (parsed.extraWritePaths) {
				merged.extraWritePaths = [...merged.extraWritePaths, ...parsed.extraWritePaths];
			}
		} catch {
			/* ignore malformed config */
		}
	}

	return merged;
}

// ---------------------------------------------------------------------------
// Bubblewrap discovery
// ---------------------------------------------------------------------------

function findBwrap(): string | null {
	if (process.platform !== "linux") return null;

	try {
		const r = spawnSync("which", ["bwrap"], { encoding: "utf-8", timeout: 5000 });
		if (r.status === 0 && r.stdout) {
			const first = r.stdout.trim().split(/\r?\n/)[0];
			if (first) return first;
		}
	} catch {
		/* ignore */
	}

	for (const candidate of ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"]) {
		if (existsSync(candidate)) return candidate;
	}

	return null;
}

function detectPackageManager(): "apt" | "dnf" | "pacman" | "zypper" | "apk" | null {
	if (existsSync("/usr/bin/apt-get") || existsSync("/usr/bin/apt")) return "apt";
	if (existsSync("/usr/bin/dnf")) return "dnf";
	if (existsSync("/usr/bin/yum")) return "dnf";
	if (existsSync("/usr/bin/pacman")) return "pacman";
	if (existsSync("/usr/bin/zypper")) return "zypper";
	if (existsSync("/sbin/apk")) return "apk";
	return null;
}

function getBwrapInstallHint(pm: ReturnType<typeof detectPackageManager>): string {
	switch (pm) {
		case "apt":
			return "sudo apt install bubblewrap";
		case "dnf":
			return "sudo dnf install bubblewrap";
		case "pacman":
			return "sudo pacman -S bubblewrap";
		case "zypper":
			return "sudo zypper install bubblewrap";
		case "apk":
			return "sudo apk add bubblewrap";
		default:
			return "Install bubblewrap via your package manager (package name is usually 'bubblewrap')";
	}
}

function looksLikeSandboxFailure(errorMessage: string): boolean {
	return SANDBOX_FAILURE_PATTERNS.some((p) => p.test(errorMessage));
}

/** Truncate a long command for display. Keep first 10 + last 5 lines if > 16 lines. */
function truncateCommandForDisplay(cmd: string): string {
	const lines = cmd.split("\n");
	if (lines.length <= 16) return cmd;
	const head = lines.slice(0, 10);
	const tail = lines.slice(-5);
	return [...head, "  ...", ...tail].join("\n");
}

// ---------------------------------------------------------------------------
// Child-process helpers (re-implemented; pi internals are not public API)
// ---------------------------------------------------------------------------

function waitForChild(proc: ReturnType<typeof spawn>): Promise<number | null> {
	return new Promise((res, rej) => {
		let settled = false;

		const cleanup = () => {
			proc.removeListener("error", onErr);
			proc.removeListener("exit", onExit);
			proc.removeListener("close", onClose);
		};

		const finish = (code: number | null) => {
			if (settled) return;
			settled = true;
			cleanup();
			proc.stdout?.destroy();
			proc.stderr?.destroy();
			res(code);
		};

		const onErr = (err: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			rej(err);
		};

		const onExit = (code: number | null) => {
			// Give stdio a brief grace period, then force-resolve.
			setTimeout(() => finish(code), 100);
		};

		const onClose = (code: number | null) => finish(code);

		proc.once("error", onErr);
		proc.once("exit", onExit);
		proc.once("close", onClose);
	});
}

function killProcessTree(pid: number): void {
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			/* already dead */
		}
	}
}

// ---------------------------------------------------------------------------
// Bwrap operations
// ---------------------------------------------------------------------------

function createBwrapOps(bwrapPath: string, config: BwrapConfig): BashOperations {
	return {
		exec: async (command, cwd, { onData, signal, timeout, env }) => {
			if (!existsSync(cwd)) {
				throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
			}

			if (signal?.aborted) {
				throw new Error("aborted");
			}

			const args: string[] = [
				"--die-with-parent",
				"--chdir",
				cwd,
				"--ro-bind",
				"/",
				"/",
				"--dev",
				"/dev",
				"--proc",
				"/proc",
				"--bind",
				cwd,
				cwd,
				"--tmpfs",
				"/tmp",
			];

			for (const p of config.extraReadPaths) {
				const rp = resolve(expandHome(p));
				if (existsSync(rp)) args.push("--ro-bind", rp, rp);
			}

			for (const p of config.extraWritePaths) {
				const rp = resolve(expandHome(p));
				try {
					await mkdir(rp, { recursive: true });
				} catch {
					/* ignore */
				}
				if (existsSync(rp)) args.push("--bind", rp, rp);
			}

			if (config.internet === "block") {
				args.push("--unshare-net");
			}

			const shellConfig = getShellConfig(config.shellPath);
			args.push(shellConfig.shell, ...shellConfig.args, command);

			const child = spawn(bwrapPath, args, {
				cwd,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
				env: env ?? process.env,
				windowsHide: true,
			});

			let timedOut = false;
			let timeoutHandle: NodeJS.Timeout | undefined;

			const onAbort = () => {
				if (child.pid) killProcessTree(child.pid);
			};

			try {
				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) killProcessTree(child.pid);
					}, timeout * 1000);
				}

				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);

				if (signal) {
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}

				const exitCode = await waitForChild(child);

				if (signal?.aborted) {
					throw new Error("aborted");
				}
				if (timedOut) {
					throw new Error(`timeout:${timeout}`);
				}

				return { exitCode };
			} finally {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

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
