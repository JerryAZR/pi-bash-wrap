import { spawn } from "node:child_process";

export function waitForChild(proc: ReturnType<typeof spawn>): Promise<number | null> {
	return new Promise((res, rej) => {
		let settled = false;

		const cleanup = () => {
			proc.removeListener("error", onErr);
			proc.removeListener("exit", onExit);
			proc.removeListener("close", onClose);
		};

		const finish = (code: number | null) => {
			if (settled) return;
			settled = true;
			cleanup();
			proc.stdout?.destroy();
			proc.stderr?.destroy();
			res(code);
		};

		const onErr = (err: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			rej(err);
		};

		const onExit = (code: number | null) => {
			// Give stdio a brief grace period, then force-resolve.
			setTimeout(() => finish(code), 100);
		};

		const onClose = (code: number | null) => finish(code);

		proc.once("error", onErr);
		proc.once("exit", onExit);
		proc.once("close", onClose);
	});
}

export function killProcessTree(pid: number): void {
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			/* already dead */
		}
	}
}
