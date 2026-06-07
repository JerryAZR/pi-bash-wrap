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
 * If `params.unsandboxed` is true, runs via `localExecute` (outside sandbox).
 * Otherwise runs via `sandboxedExecute`.
 */
export async function executeWithFallback(
	toolCallId: string,
	params: { command: string; timeout?: number; unsandboxed?: boolean },
	signal: AbortSignal | undefined,
	onUpdate: ((...args: any[]) => void) | undefined,
	ctx: any,
	sandboxedExecute: ExecuteFn,
	localExecute: ExecuteFn,
): Promise<any> {
	if (params.unsandboxed) {
		return localExecute(toolCallId, params, signal, onUpdate, ctx);
	}
	return sandboxedExecute(toolCallId, params, signal, onUpdate, ctx);
}
