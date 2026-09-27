/**
 * TCP connectivity helpers for development mode.
 *
 * In development the language server is started manually (or by a debugger)
 * and listens on a TCP port; the extension only has to connect to it. These
 * helpers are deliberately free of `vscode` imports so they can be unit tested
 * with plain Node.js.
 */

import * as net from 'net';

/** Established socket plus the LSP streams derived from it. */
export interface TcpConnection {
	socket: net.Socket;
	writer: NodeJS.WritableStream;
	reader: NodeJS.ReadableStream;
}

/** Result of a reachability probe. */
export interface ProbeResult {
	reachable: boolean;
	/** Human readable reason, always set when `reachable` is `false`. */
	reason?: string;
}

export interface ProbeOptions {
	/** Total budget in milliseconds. */
	timeoutMs?: number;
	/** Delay between attempts. */
	retryDelayMs?: number;
	/** Host to probe. */
	host?: string;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempts to open a TCP connection to `host:port`.
 *
 * Resolves with the connected socket, or rejects with the underlying error.
 * The socket is never left behind: it is destroyed on failure.
 */
export function tryConnect(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
	return new Promise<net.Socket>((resolve, reject) => {
		const socket = net.connect({ host, port });
		let settled = false;

		const finish = (fn: () => void): void => {
			if (settled) {
				return;
			}
			settled = true;
			socket.removeListener('connect', onConnect);
			socket.removeListener('error', onError);
			socket.setTimeout(0);
			fn();
		};

		const onConnect = (): void => finish(() => resolve(socket));
		const onError = (error: Error): void =>
			finish(() => {
				socket.destroy();
				reject(error);
			});

		socket.setTimeout(timeoutMs, () => {
			finish(() => {
				socket.destroy();
				reject(new Error(`timed out after ${timeoutMs}ms`));
			});
		});
		socket.once('connect', onConnect);
		socket.once('error', onError);
	});
}

/**
 * Probes `host:port` until the total budget is exhausted.
 *
 * A local port either accepts immediately or is refused at once, so a couple of
 * quick attempts are enough to tell "server is not up yet" apart from
 * "server is listening". This never opens the LSP session itself.
 */
export async function probeTcpPort(
	port: number,
	options: ProbeOptions = {},
): Promise<ProbeResult> {
	const host = options.host ?? '127.0.0.1';
	const timeoutMs = Math.max(50, options.timeoutMs ?? 1500);
	const retryDelayMs = Math.max(0, options.retryDelayMs ?? 120);
	const deadline = Date.now() + timeoutMs;

	let lastReason = 'no connection attempt was made';
	for (;;) {
		const remaining = deadline - Date.now();
		const attemptTimeout = Math.max(50, Math.min(500, remaining));
		try {
			const socket = await tryConnect(host, port, attemptTimeout);
			socket.destroy();
			return { reachable: true };
		} catch (error) {
			lastReason = error instanceof Error ? error.message : String(error);
		}
		if (Date.now() >= deadline) {
			return { reachable: false, reason: lastReason };
		}
		await delay(retryDelayMs);
	}
}

/**
 * Connects to a language server listening on `host:port`.
 *
 * `net.Socket` is a duplex stream, so it can be used directly as both the
 * reader and the writer of an LSP message connection.
 */
export function connectTcp(
	port: number,
	host = '127.0.0.1',
	timeoutMs = 5000,
): Promise<TcpConnection> {
	return tryConnect(host, port, timeoutMs).then((socket) => {
		socket.setNoDelay(true);
		return { socket, reader: socket, writer: socket };
	});
}
