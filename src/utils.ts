import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { homedir } from "node:os";

export function expandHome(p: string): string {
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	if (p === "~") return homedir();
	return p;
}

export function detectPackageManager(): "apt" | "dnf" | "pacman" | "zypper" | "apk" | null {
	if (existsSync("/usr/bin/apt-get") || existsSync("/usr/bin/apt")) return "apt";
	if (existsSync("/usr/bin/dnf")) return "dnf";
	if (existsSync("/usr/bin/yum")) return "dnf";
	if (existsSync("/usr/bin/pacman")) return "pacman";
	if (existsSync("/usr/bin/zypper")) return "zypper";
	if (existsSync("/sbin/apk")) return "apk";
	return null;
}

export function getBwrapInstallHint(pm: ReturnType<typeof detectPackageManager>): string {
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

/** Truncate a long command for display. Keep first 10 + last 5 lines if > 16 lines. */
export function truncateCommandForDisplay(cmd: string): string {
	const lines = cmd.split("\n");
	if (lines.length <= 16) return cmd;
	const head = lines.slice(0, 10);
	const tail = lines.slice(-5);
	return [...head, "  ...", ...tail].join("\n");
}

/** Check whether a target path lies outside cwd. */
export function isPathOutsideCwd(targetPath: string, cwd: string): boolean {
	const resolvedTarget = resolve(cwd, targetPath);
	const rel = relative(cwd, resolvedTarget);
	return rel.startsWith("..");
}

const CONTAINER_TOOLS = new Set(["docker", "podman", "buildah", "nerdctl"]);
const WRAPPER_COMMANDS = new Set(["sudo", "env", "exec", "nohup", "time"]);

/**
 * Conservative pre-flight check for commands that likely require unsandboxed access.
 * Only matches when the first real command token (after env vars and common wrappers)
 * is exactly docker, podman, buildah, or nerdctl. False negatives are acceptable.
 */
export function looksLikeContainerCommand(cmd: string): boolean {
	const trimmed = cmd.trim();
	if (!trimmed) return false;

	const tokens: string[] = [];
	let current = "";
	let inQuote: "'" | '"' | null = null;

	for (let i = 0; i < trimmed.length; i++) {
		const ch = trimmed[i];
		if (inQuote) {
			if (ch === inQuote) inQuote = null;
			else current += ch;
		} else if (ch === '"' || ch === "'") {
			inQuote = ch;
		} else if (/\s/.test(ch)) {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
		} else {
			current += ch;
		}
	}
	if (current.length > 0) tokens.push(current);

	for (const token of tokens) {
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
		if (WRAPPER_COMMANDS.has(token)) continue;
		const basename = token.replace(/\\/g, "/").split("/").pop() ?? token;
		return CONTAINER_TOOLS.has(basename);
	}
	return false;
}
