import { describe, it } from "node:test";
import assert from "node:assert";
import { executeWithFallback, type ExecuteFn, type ToolExecuteContext } from "../src/execute.js";
import type { BwrapConfig } from "../src/types.js";

function makeConfig(overrides: Partial<BwrapConfig> = {}): BwrapConfig {
	return {
		enabled: true,
		internet: "allow",
		extraReadPaths: [],
		extraWritePaths: [],
		promptOnFailure: true,
		writeTools: {},
		timeout: 600,
		...overrides,
	};
}

function makeCtx(overrides: Partial<ToolExecuteContext> = {}): ToolExecuteContext {
	return {
		hasUI: true,
		ui: {
			confirm: async () => true,
		},
		...overrides,
	};
}

function makeExecuteFn(result: unknown): ExecuteFn {
	return async () => result;
}

function makeFailingExecuteFn(error: Error): ExecuteFn {
	return async () => {
		throw error;
	};
}

describe("executeWithFallback", () => {
	it("runs sandboxed by default", async () => {
		const sandboxed = makeExecuteFn({ exitCode: 0 });
		const local = makeExecuteFn({ exitCode: 1 });

		const result = await executeWithFallback(
			"tc1",
			{ command: "echo hello" },
			undefined,
			() => {},
			makeCtx(),
			makeConfig(),
			sandboxed,
			local,
		);

		assert.deepStrictEqual(result, { exitCode: 0 });
	});

	it("unsandboxed=true runs local directly when promptOnFailure=false", async () => {
		const sandboxed = makeExecuteFn({ exitCode: 0 });
		const local = makeExecuteFn({ exitCode: 42 });

		const result = await executeWithFallback(
			"tc2",
			{ command: "podman version", unsandboxed: true },
			undefined,
			() => {},
			makeCtx(),
			makeConfig({ promptOnFailure: false }),
			sandboxed,
			local,
		);

		assert.deepStrictEqual(result, { exitCode: 42 });
	});

	it("unsandboxed=true prompts user when promptOnFailure=true", async () => {
		let promptCalled = false;
		const sandboxed = makeExecuteFn({ exitCode: 0 });
		const local = makeExecuteFn({ exitCode: 42 });
		const ctx = makeCtx({
			ui: {
				confirm: async (title: string, _message: string) => {
					promptCalled = true;
					assert.strictEqual(title, "Run outside sandbox");
					return true;
				},
			},
		});

		const result = await executeWithFallback(
			"tc3",
			{ command: "podman version", unsandboxed: true },
			undefined,
			() => {},
			ctx,
			makeConfig(),
			sandboxed,
			local,
		);

		assert.strictEqual(promptCalled, true);
		assert.deepStrictEqual(result, { exitCode: 42 });
	});

	it("unsandboxed=true throws when user denies", async () => {
		const sandboxed = makeExecuteFn({ exitCode: 0 });
		const local = makeExecuteFn({ exitCode: 42 });
		const ctx = makeCtx({
			ui: {
				confirm: async () => false,
			},
		});

		await assert.rejects(
			executeWithFallback(
				"tc4",
				{ command: "podman version", unsandboxed: true },
				undefined,
				() => {},
				ctx,
				makeConfig(),
				sandboxed,
				local,
			),
			/User denied unsandboxed execution/,
		);
	});

	it("throws sandbox errors directly without prompting", async () => {
		const err = new Error("Read-only file system");
		const sandboxed = makeFailingExecuteFn(err);
		const local = makeExecuteFn({ exitCode: 0 });
		let promptCalled = false;
		const ctx = makeCtx({
			ui: {
				confirm: async () => {
					promptCalled = true;
					return true;
				},
			},
		});

		await assert.rejects(
			executeWithFallback(
				"tc5",
				{ command: "some command" },
				undefined,
				() => {},
				ctx,
				makeConfig(),
				sandboxed,
				local,
			),
			/Read-only file system/,
		);
		assert.strictEqual(promptCalled, false);
	});

	it("throws timeout errors directly without prompting", async () => {
		const err = new Error("Command timed out after 5 seconds");
		const sandboxed = makeFailingExecuteFn(err);
		const local = makeExecuteFn({ exitCode: 0 });
		let promptCalled = false;
		const ctx = makeCtx({
			ui: {
				confirm: async () => {
					promptCalled = true;
					return true;
				},
			},
		});

		await assert.rejects(
			executeWithFallback(
				"tc6",
				{ command: "some command" },
				undefined,
				() => {},
				ctx,
				makeConfig(),
				sandboxed,
				local,
			),
			/Command timed out/,
		);
		assert.strictEqual(promptCalled, false);
	});
});
