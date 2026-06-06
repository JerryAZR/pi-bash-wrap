/**
 * Simple async lock for serializing UI confirm prompts.
 *
 * The pi UI can only show one confirm modal at a time. If multiple
 * concurrent tool calls each try to confirm, only the last one wins
 * and earlier promises are abandoned (hang forever). This queue
 * ensures prompts are shown one at a time.
 */

let queue: Promise<void> = Promise.resolve();

export async function withUILock<T>(fn: () => Promise<T>): Promise<T> {
	const prev = queue;
	let release!: () => void;
	queue = new Promise<void>((res) => {
		release = res;
	});
	await prev;
	try {
		return await fn();
	} finally {
		release();
	}
}
