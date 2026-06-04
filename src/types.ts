export const CONFIG_FILENAME = "bwrap.json";
export const GLOBAL_CONFIG_DIR = "";
export const PROJECT_CONFIG_SUBDIR = ".pi";

/** Default cache/config paths.  NO global-install targets. */
export const DEFAULT_EXTRA_WRITE_PATHS: readonly string[] = [
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

export const SANDBOX_FAILURE_PATTERNS = [
	/Read-only file system/i,
	/Permission denied/i,
	/EACCES/i,
	/EROFS/i,
];

export interface WriteToolMap {
	[toolName: string]: string; // value = parameter name containing the path
}

export interface BwrapConfig {
	enabled: boolean;
	internet: "allow" | "block";
	extraReadPaths: string[];
	extraWritePaths: string[];
	shellPath?: string;
	promptOnFailure: boolean;
	writeTools: WriteToolMap;
}
