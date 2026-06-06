import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBwrapArgs, findBwrap, testBwrap } from "../src/bwrap.js";
import type { BwrapConfig } from "../src/types.js";

describe("buildBwrapArgs", () => {
	let cwd: string;
	let extraDir: string;

	before(async () => {
		cwd = await mkdtemp(join(tmpdir(), "bwrap-cwd-"));
		extraDir = await mkdtemp(join(tmpdir(), "bwrap-extra-"));
	});

	after(async () => {
		// cleanup is optional; os will reclaim temp dirs
	});

	function makeConfig(overrides: Partial<BwrapConfig> = {}): BwrapConfig {
		return {
			enabled: true,
			internet: "allow",
			extraReadPaths: [],
			extraWritePaths: [],
			promptOnFailure: true,
			writeTools: { write: "path", edit: "path" },
			timeout: 600,
			...overrides,
		};
	}

	it("includes mandatory args in correct order", () => {
		const config = makeConfig();
		const args = buildBwrapArgs(config, cwd, "echo hello");

		assert.ok(args.includes("--die-with-parent"));
		assert.ok(args.includes("--chdir"));
		assert.ok(args.includes(cwd));
		assert.ok(args.includes("--ro-bind"));
		assert.ok(args.includes("/"));
		assert.ok(args.includes("--dev"));
		assert.ok(args.includes("/dev"));
		assert.ok(args.includes("--proc"));
		assert.ok(args.includes("/proc"));
		assert.ok(args.includes("--bind"));
		assert.ok(args.includes("/tmp"));
	});

	it("places ro-bind / / before dev and proc", () => {
		const config = makeConfig();
		const args = buildBwrapArgs(config, cwd, "echo hello");

		const roBindIndex = args.indexOf("--ro-bind");
		const devIndex = args.indexOf("--dev");
		const procIndex = args.indexOf("--proc");
		assert.ok(roBindIndex < devIndex, "ro-bind should come before dev");
		assert.ok(roBindIndex < procIndex, "ro-bind should come before proc");
	});

	it("binds cwd read-write", () => {
		const config = makeConfig();
		const args = buildBwrapArgs(config, cwd, "echo hello");

		const bindIndex = args.indexOf("--bind");
		assert.notEqual(bindIndex, -1);
		assert.equal(args[bindIndex + 1], cwd);
		assert.equal(args[bindIndex + 2], cwd);
	});

	it("appends shell and command at the end", () => {
		const config = makeConfig();
		const args = buildBwrapArgs(config, cwd, "echo hello");

		const last = args[args.length - 1];
		assert.equal(last, "echo hello");
		const secondLast = args[args.length - 2];
		assert.equal(secondLast, "-c");
	});

	it("includes --unshare-net when internet is blocked", () => {
		const allowConfig = makeConfig({ internet: "allow" });
		const blockConfig = makeConfig({ internet: "block" });

		const allowArgs = buildBwrapArgs(allowConfig, cwd, "echo hello");
		const blockArgs = buildBwrapArgs(blockConfig, cwd, "echo hello");

		assert.equal(allowArgs.includes("--unshare-net"), false);
		assert.equal(blockArgs.includes("--unshare-net"), true);
	});

	it("includes extra read paths that exist", () => {
		const config = makeConfig({ extraReadPaths: [extraDir, "/nonexistent/path"] });
		const args = buildBwrapArgs(config, cwd, "echo hello");

		assert.ok(args.includes("--ro-bind"));
		const roBindIndices = args
			.map((arg, i) => (arg === "--ro-bind" ? i : -1))
			.filter((i) => i !== -1);

		// Should have at least one extra ro-bind for extraDir
		const extraDirBound = roBindIndices.some((i) => args[i + 1] === extraDir);
		assert.ok(extraDirBound, "existing extra read path should be bound");

		// Should NOT have /nonexistent/path
		const nonexistentBound = args.includes("/nonexistent/path");
		assert.equal(nonexistentBound, false);
	});

	it("includes extra write paths that exist", () => {
		const config = makeConfig({ extraWritePaths: [extraDir] });
		const args = buildBwrapArgs(config, cwd, "echo hello");

		// The first --bind is for cwd; subsequent --binds are for extra writes
		const bindIndices = args
			.map((arg, i) => (arg === "--bind" ? i : -1))
			.filter((i) => i !== -1);

		assert.ok(bindIndices.length >= 2, "should have at least cwd + extra write bind");
		const extraBound = bindIndices.some((i) => args[i + 1] === extraDir);
		assert.ok(extraBound, "existing extra write path should be bound");
	});

	it("uses custom shell path when provided", () => {
		const config = makeConfig({ shellPath: "/bin/bash" });
		const args = buildBwrapArgs(config, cwd, "echo hello");

		// Find the shell in args (should be before -c and command)
		const shellIndex = args.indexOf("/bin/bash");
		assert.notEqual(shellIndex, -1, "custom shell path should appear in args");
		assert.equal(args[shellIndex + 1], "-c");
		assert.equal(args[shellIndex + 2], "echo hello");
	});
});

describe("testBwrap", () => {
	it("returns true when bwrap works", () => {
		const bwrapPath = findBwrap();
		if (!bwrapPath) {
			// Skip if bwrap not installed
			return;
		}
		assert.equal(testBwrap(bwrapPath), true);
	});

	it("returns false for a nonexistent binary", () => {
		assert.equal(testBwrap("/nonexistent/bwrap"), false);
	});
});
