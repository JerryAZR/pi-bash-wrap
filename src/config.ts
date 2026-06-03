import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	BwrapConfig,
	CONFIG_FILENAME,
	GLOBAL_CONFIG_DIR,
	PROJECT_CONFIG_SUBDIR,
	DEFAULT_EXTRA_WRITE_PATHS,
} from "./types.js";

export async function loadConfig(cwd: string, globalConfigDir?: string): Promise<BwrapConfig> {
	const paths = [
		join(globalConfigDir ?? getAgentDir(), GLOBAL_CONFIG_DIR, CONFIG_FILENAME),
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
