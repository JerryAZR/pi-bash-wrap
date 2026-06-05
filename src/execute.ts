import { truncateCommandForDisplay } from "./utils.js";
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
 * Execute a bash command with bubblewrap sandboxing.
 *
 * If `params.unsandboxed` is true, runs via `localExecute` (outside sandbox)
 * after optionally prompting the user. Otherwise runs via `sandboxedExecute`.
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
	return sandboxedExecute(toolCallId, params, signal, onUpdate, ctx);
}
