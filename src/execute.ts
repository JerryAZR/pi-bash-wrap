import { looksLikeSandboxFailure, truncateCommandForDisplay } from "./utils.js";
import type { BwrapConfig } from "./types.js";

export interface ToolExecuteContext {
	hasUI: boolean;
	ui: {
		confirm: (title: string, message: string) => Promise<boolean>;
	};
}

export type ExecuteFn = (
	toolCallId: string,
	params: { command: string; timeout?: number },
	signal: AbortSignal | undefined,
	onUpdate: ((...args: any[]) => void) | undefined,
	ctx: any,
) => Promise<any>;

/**
 * Execute a bash command with bubblewrap sandboxing and fallback handling.
 *
 * If `params.unsandboxed` is true, runs via `localExecute` (outside sandbox)
 * after optionally prompting the user.
 *
 * Otherwise runs via `sandboxedExecute`, and if it fails with a sandbox-specific
 * error, prompts the user to retry without the sandbox.
 */
export async function executeWithFallback(
	toolCallId: string,
	params: { command: string; timeout?: number; unsandboxed?: boolean },
	signal: AbortSignal | undefined,
	onUpdate: ((...args: any[]) => void) | undefined,
	ctx: any,
	config: BwrapConfig,
	sandboxedExecute: ExecuteFn,
	localExecute: ExecuteFn,
): Promise<any> {
	// Explicit opt-out: agent requested unsandboxed execution
	if (params.unsandboxed) {
		if (config.promptOnFailure && ctx.hasUI) {
			const truncatedCmd = truncateCommandForDisplay(params.command);
			const ok = await ctx.ui.confirm(
				"Run outside sandbox",
				`The agent wants to run this command outside the sandbox:\n\n$ ${truncatedCmd}\n\nAllow?`,
			);
			if (!ok) {
				throw new Error("User denied unsandboxed execution");
			}
		}
		return localExecute(toolCallId, params, signal, onUpdate, ctx);
	}

	// Normal sandboxed path
	try {
		return await sandboxedExecute(toolCallId, params, signal, onUpdate, ctx);
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

		const truncatedCmd = truncateCommandForDisplay(params.command);
		const retry = await ctx.ui.confirm(
			"Sandbox failure",
			`Command failed inside sandbox.\n\n$ ${truncatedCmd}\n\n${errMsg.slice(0, 200)}\n\nRetry without sandbox?`,
		);

		if (retry) {
			return localExecute(toolCallId, params, signal, onUpdate, ctx);
		}

		throw err;
	}
}
