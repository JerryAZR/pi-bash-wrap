import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { getShellConfig, type BashOperations } from "@earendil-works/pi-coding-agent";
import type { BwrapConfig } from "./types.js";
import { expandHome } from "./utils.js";
import { waitForChild, killProcessTree } from "./child-process.js";

export function findBwrap(): string | null {
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

/** Run a harmless bwrap command to verify namespace/mount support. */
export function testBwrap(bwrapPath: string): boolean {
	try {
		const r = spawnSync(bwrapPath, [
			"--die-with-parent",
			"--ro-bind", "/", "/",
			"echo", "bwrap-compat-test",
		], {
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "pipe"],
		});
		return r.status === 0;
	} catch {
		return false;
	}
}

export function buildBwrapArgs(
	config: BwrapConfig,
	cwd: string,
	command: string
): string[] {
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
		"--bind",
		"/tmp",
		"/tmp",
	];

	// Hide system-wide SSH config snippets that may have broken ownership
	// inside user namespaces (e.g., container environments where host root
	// appears as nobody, causing SSH to reject the config).
	if (existsSync("/etc/ssh/ssh_config.d")) {
		args.push("--tmpfs", "/etc/ssh/ssh_config.d");
	}

	for (const p of config.extraReadPaths) {
		const rp = resolve(expandHome(p));
		if (existsSync(rp)) args.push("--ro-bind", rp, rp);
	}

	for (const p of config.extraWritePaths) {
		const rp = resolve(expandHome(p));
		if (existsSync(rp)) args.push("--bind", rp, rp);
	}

	if (config.internet === "block") {
		args.push("--unshare-net");
	}

	const shellConfig = getShellConfig(config.shellPath);
	args.push(shellConfig.shell, ...shellConfig.args, command);

	return args;
}

export function createBwrapOps(bwrapPath: string, config: BwrapConfig): BashOperations {
	return {
		exec: async (command, cwd, { onData, signal, timeout, env }) => {
			if (!existsSync(cwd)) {
				throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
			}

			if (signal?.aborted) {
				throw new Error("aborted");
			}

			// Ensure extra write directories exist before building args
			for (const p of config.extraWritePaths) {
				const rp = resolve(expandHome(p));
				try {
					await mkdir(rp, { recursive: true });
				} catch {
					/* ignore */
				}
			}

			const args = buildBwrapArgs(config, cwd, command);

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
				const effectiveTimeout = timeout ?? config.timeout ?? 0;
				if (effectiveTimeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) killProcessTree(child.pid);
					}, effectiveTimeout * 1000);
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
					throw new Error(`timeout:${effectiveTimeout}`);
				}

				return { exitCode };
			} finally {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
			}
		},
	};
}
