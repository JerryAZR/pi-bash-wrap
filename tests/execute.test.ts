import { describe, it } from "node:test";
import assert from "node:assert";
import { executeWithFallback, type ExecuteFn } from "../src/execute.js";

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
			{},
			sandboxed,
			local,
		);

		assert.deepStrictEqual(result, { exitCode: 0 });
	});

	it("routes unsandboxed=true to local execute", async () => {
		const sandboxed = makeExecuteFn({ exitCode: 0 });
		const local = makeExecuteFn({ exitCode: 42 });

		const result = await executeWithFallback(
			"tc2",
			{ command: "podman version", unsandboxed: true },
			undefined,
			() => {},
			{},
			sandboxed,
			local,
		);

		assert.deepStrictEqual(result, { exitCode: 42 });
	});

	it("throws sandbox errors directly", async () => {
		const err = new Error("Read-only file system");
		const sandboxed = makeFailingExecuteFn(err);
		const local = makeExecuteFn({ exitCode: 0 });

		await assert.rejects(
			executeWithFallback(
				"tc3",
				{ command: "some command" },
				undefined,
				() => {},
				{},
				sandboxed,
				local,
			),
			/Read-only file system/,
		);
	});

	it("throws timeout errors directly", async () => {
		const err = new Error("Command timed out after 5 seconds");
		const sandboxed = makeFailingExecuteFn(err);
		const local = makeExecuteFn({ exitCode: 0 });

		await assert.rejects(
			executeWithFallback(
				"tc4",
				{ command: "some command" },
				undefined,
				() => {},
				{},
				sandboxed,
				local,
			),
			/Command timed out/,
		);
	});
});
