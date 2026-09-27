import * as assert from 'assert';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import { State } from 'vscode-languageclient/node';

import { CpplsLanguageClient } from '../client';
import { resolveServer, serverExecutableName, serverSearchPaths } from '../serverPath';
import { ServerConfig, readServerConfig } from '../settings';

/**
 * Verifies the client side of the extension inside a real extension host.
 *
 * The C++ server is not part of this repository yet, so the TCP transport is
 * exercised against a miniature LSP peer started by the test itself. That keeps
 * the client independent of the server implementation: whenever `server/cpp_ls`
 * appears, `cppls.server.path` simply points at it instead.
 */

const EXTENSION_ROOT = path.join(__dirname, '..', '..');
const PORT = 5137;

// ---------------------------------------------------------------------------
// A tiny LSP peer used only to prove that the client can talk to *something*.
// ---------------------------------------------------------------------------

class FakeLspServer {
	private readonly server: net.Server;
	private openSocket: net.Socket | undefined;
	public readonly requestLog: string[] = [];

	private constructor(server: net.Server) {
		this.server = server;
	}

	/** Starts listening on `port` and answers the LSP handshake. */
	public static async start(port = PORT): Promise<FakeLspServer> {
		const server = net.createServer();
		const fake = new FakeLspServer(server);

		server.on('connection', (socket) => fake.onConnection(socket));

		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(port, '127.0.0.1', () => resolve());
		});
		return fake;
	}

	public async stop(): Promise<void> {
		this.openSocket?.destroy();
		this.openSocket = undefined;
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
	}

	private onConnection(socket: net.Socket): void {
		this.openSocket = socket;
		let buffer = Buffer.alloc(0);
		let expected: number | null = null;

		socket.on('data', (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			for (;;) {
				if (expected === null) {
					const headerEnd = buffer.indexOf('\r\n\r\n');
					if (headerEnd < 0) {
						return;
					}
					const header = buffer.subarray(0, headerEnd).toString('ascii');
					const match = /content-length:\s*(\d+)/i.exec(header);
					assert.ok(match, 'the client must send Content-Length framed messages');
					expected = Number.parseInt(match[1], 10);
					buffer = buffer.subarray(headerEnd + 4);
				}
				if (buffer.length < expected) {
					return;
				}
				const message = JSON.parse(buffer.subarray(0, expected).toString('utf8'));
				buffer = buffer.subarray(expected);
				expected = null;
				this.reply(socket, message);
			}
		});
		socket.on('error', () => undefined);
	}

	private reply(socket: net.Socket, message: { id?: number; method?: string }): void {
		if (message.method) {
			this.requestLog.push(message.method);
		}

		const send = (payload: unknown): void => {
			const json = Buffer.from(JSON.stringify(payload), 'utf8');
			socket.write(Buffer.concat([Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii'), json]));
		};

		switch (message.method) {
			case 'initialize':
				send({
					jsonrpc: '2.0',
					id: message.id,
					result: {
						capabilities: { textDocumentSync: { openClose: true, change: 1 }, hoverProvider: true },
						serverInfo: { name: 'fake-lsp', version: '0.0.1' },
					},
				});
				break;
			case 'shutdown':
				send({ jsonrpc: '2.0', id: message.id, result: null });
				break;
			case 'fake/ping':
				send({ jsonrpc: '2.0', id: message.id, result: { transport: 'tcp' } });
				break;
			default:
				if (message.id !== undefined) {
					send({ jsonrpc: '2.0', id: message.id, result: null });
				}
				break;
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A fixed configuration for a test.
 *
 * The client takes its configuration as a function, so tests never have to
 * write to the user's settings — that would leak between test runs.
 */
function fixedConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
	return { ...readServerConfig(), launchMode: 'bundled', serverArgs: [], ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('cppls server lookup', () => {
	test('reports every path it searched, ending with the bundled binary', () => {
		const paths = serverSearchPaths(EXTENSION_ROOT, undefined);
		assert.ok(paths.length >= 1);
		const expected = path.join(EXTENSION_ROOT, 'server', serverExecutableName());
		assert.ok(paths.includes(expected), `expected ${expected} among: ${paths.join(', ')}`);
	});

	test('resolves the bundled binary when it exists', () => {
		// `server/cpp_ls` is not committed, so this documents the expected state
		// instead of failing the suite while the C++ server is being written.
		const resolved = resolveServer(EXTENSION_ROOT, undefined);
		if (resolved) {
			assert.ok(path.isAbsolute(resolved.command));
			assert.ok(['bundled', 'setting', 'env'].includes(resolved.source));
		} else {
			assert.strictEqual(
				resolveServer(EXTENSION_ROOT, path.join(EXTENSION_ROOT, 'nope', 'cpp_ls')),
				undefined,
				'without a binary and without configuration there is nothing to run',
			);
		}
	});
});

suite('cppls language client', () => {
	test('connects over TCP and completes the LSP handshake', async function () {
		this.timeout(60000);

		const fake = await FakeLspServer.start(PORT);
		const output = vscode.window.createOutputChannel('cppls test', { log: true });
		const client = new CpplsLanguageClient(
			EXTENSION_ROOT,
			'test',
			output,
			output,
			() => fixedConfig({ launchMode: 'tcp', devPort: PORT }),
		);

		try {
			const started = await client.start();
			assert.ok(started, 'the client should connect to the TCP server');
			assert.strictEqual(client.state, State.Running, 'the client should be running');

			const plan = client.currentPlan;
			assert.ok(plan, 'a launch plan should have been recorded');
			assert.strictEqual(plan.kind, 'tcp', 'the TCP transport should have been selected');
			assert.strictEqual(plan.kind === 'tcp' ? plan.port : 0, PORT);

			const ping = await client.languageClient?.sendRequest<{ transport: string }>('fake/ping', {});
			assert.deepStrictEqual(ping, { transport: 'tcp' });
			assert.ok(fake.requestLog.includes('initialize'), 'the handshake should have been sent');
		} finally {
			// Close the peer first so the client observes a finished session
			// while its output channel is still alive.
			await fake.stop();
			await client.stop();
			await new Promise((resolve) => setTimeout(resolve, 200));
			output.dispose();
		}
	});

	test('reports a missing server instead of failing the extension', async function () {
		this.timeout(30000);

		const output = vscode.window.createOutputChannel('cppls missing server test', { log: true });
		const client = new CpplsLanguageClient(
			EXTENSION_ROOT,
			'test',
			output,
			output,
			// A path that cannot exist, and a bundled binary that is not built.
			() => fixedConfig({ serverPath: path.join(EXTENSION_ROOT, 'does-not-exist', 'cpp_ls') }),
		);

		try {
			if (resolveServer(EXTENSION_ROOT, undefined) === undefined) {
				const started = await client.start();
				assert.strictEqual(started, false, 'a missing server must be reported, not thrown');
				assert.notStrictEqual(client.state, State.Running);
			}
		} finally {
			await client.stop();
			await new Promise((resolve) => setTimeout(resolve, 200));
			output.dispose();
		}
	});
});
