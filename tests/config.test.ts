import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.js";
import { DEFAULT_EXTRA_WRITE_PATHS } from "../src/types.js";

describe("loadConfig", () => {
	let globalDir: string;
	let projectDir: string;

	before(async () => {
		globalDir = await mkdtemp(join(tmpdir(), "bwrap-global-"));
		projectDir = await mkdtemp(join(tmpdir(), "bwrap-project-"));
	});

	after(async () => {
		await rm(globalDir, { recursive: true, force: true });
		await rm(projectDir, { recursive: true, force: true });
	});

	it("returns defaults when no config files exist", async () => {
		// Use fresh temp dirs with no .pi subdir
		const freshProject = await mkdtemp(join(tmpdir(), "bwrap-fresh-"));
		const cfg = await loadConfig(freshProject, globalDir);
		await rm(freshProject, { recursive: true, force: true });

		assert.equal(cfg.enabled, true);
		assert.equal(cfg.internet, "allow");
		assert.equal(cfg.promptOnFailure, true);
		assert.equal(cfg.timeout, 600); // default
		assert.deepEqual(cfg.extraReadPaths, []);
		assert.deepEqual(cfg.extraWritePaths, [...DEFAULT_EXTRA_WRITE_PATHS]);
	});

	it("reads global config", async () => {
		await writeFile(
			join(globalDir, "bwrap.json"),
			JSON.stringify({ enabled: false, internet: "block" })
		);
		const cfg = await loadConfig(projectDir, globalDir);
		assert.equal(cfg.enabled, false);
		assert.equal(cfg.internet, "block");
		assert.equal(cfg.promptOnFailure, true); // default
	});

	it("project config overrides global", async () => {
		await writeFile(
			join(globalDir, "bwrap.json"),
			JSON.stringify({ enabled: false, internet: "block" })
		);
		await mkdir(join(projectDir, ".pi"), { recursive: true });
		await writeFile(
			join(projectDir, ".pi", "bwrap.json"),
			JSON.stringify({ enabled: true, internet: "allow", extraReadPaths: ["/tmp"] })
		);
		const cfg = await loadConfig(projectDir, globalDir);
		assert.equal(cfg.enabled, true);
		assert.equal(cfg.internet, "allow");
		assert.deepEqual(cfg.extraReadPaths, ["/tmp"]);
	});

	it("ignores malformed JSON", async () => {
		await writeFile(join(globalDir, "bwrap.json"), "not json");
		const cfg = await loadConfig(projectDir, globalDir);
		assert.equal(cfg.enabled, true); // falls back to defaults
	});

	it("merges extraWritePaths from both configs", async () => {
		await writeFile(
			join(globalDir, "bwrap.json"),
			JSON.stringify({ extraWritePaths: ["~/global"] })
		);
		await mkdir(join(projectDir, ".pi"), { recursive: true });
		await writeFile(
			join(projectDir, ".pi", "bwrap.json"),
			JSON.stringify({ extraWritePaths: ["~/project"] })
		);
		const cfg = await loadConfig(projectDir, globalDir);
		assert.ok(cfg.extraWritePaths.includes("~/.cache")); // default
		assert.ok(cfg.extraWritePaths.includes("~/global"));
		assert.ok(cfg.extraWritePaths.includes("~/project"));
	});

	it("reads all optional fields", async () => {
		await writeFile(
			join(globalDir, "bwrap.json"),
			JSON.stringify({
				enabled: false,
				internet: "block",
				extraReadPaths: ["/opt"],
				extraWritePaths: ["/var/tmp"],
				shellPath: "/bin/zsh",
				promptOnFailure: false,
				timeout: 120,
			})
		);
		const cfg = await loadConfig(projectDir, globalDir);
		assert.equal(cfg.enabled, false);
		assert.equal(cfg.internet, "block");
		assert.deepEqual(cfg.extraReadPaths, ["/opt"]);
		assert.ok(cfg.extraWritePaths.includes("/var/tmp"));
		assert.equal(cfg.shellPath, "/bin/zsh");
		assert.equal(cfg.promptOnFailure, false);
		assert.equal(cfg.timeout, 120);
	});

	it("has default writeTools", async () => {
		const freshProject = await mkdtemp(join(tmpdir(), "bwrap-fresh-"));
		const cfg = await loadConfig(freshProject, globalDir);
		await rm(freshProject, { recursive: true, force: true });

		assert.deepEqual(cfg.writeTools, { write: "path", edit: "path" });
	});

	it("merges writeTools from config", async () => {
		await writeFile(
			join(globalDir, "bwrap.json"),
			JSON.stringify({ writeTools: { write: "filepath", custom: "target" } })
		);
		const cfg = await loadConfig(projectDir, globalDir);
		assert.equal(cfg.writeTools.write, "filepath");
		assert.equal(cfg.writeTools.edit, "path"); // default preserved
		assert.equal(cfg.writeTools.custom, "target");
	});

	it("project writeTools override global", async () => {
		await writeFile(
			join(globalDir, "bwrap.json"),
			JSON.stringify({ writeTools: { write: "globalPath" } })
		);
		await mkdir(join(projectDir, ".pi"), { recursive: true });
		await writeFile(
			join(projectDir, ".pi", "bwrap.json"),
			JSON.stringify({ writeTools: { write: "projectPath" } })
		);
		const cfg = await loadConfig(projectDir, globalDir);
		assert.equal(cfg.writeTools.write, "projectPath");
		assert.equal(cfg.writeTools.edit, "path"); // default preserved
	});
});
