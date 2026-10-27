#!/usr/bin/env node
/**
 * Contract checker for the cppls language server binary.
 *
 * Drives `server/cpp_ls` exactly the way the extension does and reports whether
 * it satisfies the contract the client relies on:
 *
 *   1. `cpp_ls` with no arguments speaks LSP over stdio and answers `initialize`
 *   2. it publishes `textDocument/publishDiagnostics` for an opened C++ file
 *      (this is what proves the extension will show problems in the editor)
 *   3. `cpp_ls -c tcp --port <n>` listens on that port and handshakes
 *   4. `shutdown` + `exit` end the session cleanly
 *
 * Usage:
 *   node scripts/verify-server.mjs                  # both transports
 *   node scripts/verify-server.mjs --stdio
 *   node scripts/verify-server.mjs --tcp --port 5009 --path path/to/cpp_ls
 *
 * Exits 0 when the server is compatible, 1 when it is not, 2 when the binary is
 * missing (so CI can skip instead of failing).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// A minimal LSP peer: frames messages, answers server initiated requests just
// like VS Code does, and records what the server sends.
// ---------------------------------------------------------------------------

class LspChannel {
	constructor(readable, writable, label) {
		this.readable = readable;
		this.writable = writable;
		this.label = label;
		this.buffer = Buffer.alloc(0);
		this.expected = null;
		this.nextId = 1;
		this.pending = new Map();
		this.notifications = [];
		this.waiters = [];
		this.trace = [];
		readable.on('data', (chunk) => this.append(chunk));
	}

	append(chunk) {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		for (;;) {
			if (this.expected === null) {
				const end = this.buffer.indexOf('\r\n\r\n');
				if (end < 0) {
					return;
				}
				const header = this.buffer.subarray(0, end).toString('ascii');
				const match = /content-length:\s*(\d+)/i.exec(header);
				if (!match) {
					this.trace.push(`unparsable header: ${header}`);
					this.buffer = this.buffer.subarray(end + 4);
					continue;
				}
				this.expected = Number.parseInt(match[1], 10);
				this.buffer = this.buffer.subarray(end + 4);
			}
			if (this.buffer.length < this.expected) {
				return;
			}
			const text = this.buffer.subarray(0, this.expected).toString('utf8');
			this.buffer = this.buffer.subarray(this.expected);
			this.expected = null;
			let message;
			try {
				message = JSON.parse(text);
			} catch (error) {
				this.trace.push(`invalid JSON: ${error.message}`);
				continue;
			}
			this.dispatch(message);
		}
	}

	dispatch(message) {
		// Server initiated request: answer like VS Code would.
		if (message.method !== undefined && message.id !== undefined) {
			this.trace.push(`request ${message.method}`);
			const result = message.method === 'workspace/configuration'
				? (message.params?.items ?? []).map(() => ({}))
				: null;
			this.send({ jsonrpc: '2.0', id: message.id, result });
			return;
		}
		if (message.method !== undefined) {
			this.notifications.push(message);
			if (message.method !== '$/progress') {
				this.trace.push(`notification ${message.method}`);
			}
			for (const waiter of [...this.waiters]) {
				if (waiter.predicate(message)) {
					this.waiters.splice(this.waiters.indexOf(waiter), 1);
					waiter.resolve(message);
				}
			}
			return;
		}

		const pending = this.pending.get(message.id);
		if (pending) {
			this.pending.delete(message.id);
			pending(message);
		}
	}

	send(message) {
		const payload = Buffer.from(JSON.stringify(message), 'utf8');
		this.writable.write(
			Buffer.concat([Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'ascii'), payload]),
		);
	}

	request(method, params, timeoutMs = 15000) {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${this.label}: no response to ${method} within ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(id, (message) => {
				clearTimeout(timer);
				if (message.error) {
					reject(new Error(`${this.label}: ${method} failed: ${message.error.message}`));
				} else {
					resolve(message.result);
				}
			});
			this.send({ jsonrpc: '2.0', id, method, params });
		});
	}

	notify(method, params) {
		this.send({ jsonrpc: '2.0', method, params });
	}

	waitFor(predicate, description, timeoutMs = 30000) {
		const existing = this.notifications.find(predicate);
		if (existing) {
			return Promise.resolve(existing);
		}
		return new Promise((resolve, reject) => {
			const waiter = { predicate, resolve };
			this.waiters.push(waiter);
			setTimeout(() => {
				const index = this.waiters.indexOf(waiter);
				if (index >= 0) {
					this.waiters.splice(index, 1);
					reject(new Error(`${this.label}: no ${description} within ${timeoutMs}ms`));
				}
			}, timeoutMs);
		});
	}
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'smoke.cpp');
const FIXTURE_URI = pathToFileURL(FIXTURE).href;

/** Collected non-fatal observations, printed at the end. */
const warnings = [];

function warn(message) {
	warnings.push(message);
	console.log(`  warning      : ${message}`);
}

/** Runs the shared part of the contract on an established channel. */
async function checkSession(channel, { expectDiagnostics }) {
	const initialize = await channel.request('initialize', {
		processId: process.pid,
		rootUri: pathToFileURL(ROOT).href,
		workspaceFolders: [{ uri: pathToFileURL(ROOT).href, name: 'vscode-cppls' }],
		capabilities: {
			workspace: { configuration: true, workspaceFolders: true },
			textDocument: {
				definition: { linkSupport: true },
				hover: { contentFormat: ['markdown', 'plaintext'] },
				publishDiagnostics: { relatedInformation: true },
				synchronization: { didSave: true, dynamicRegistration: true },
			},
			window: { workDoneProgress: true },
		},
		clientInfo: { name: 'Visual Studio Code', version: '1.139.1' },
	});

	if (!initialize || typeof initialize !== 'object') {
		throw new Error('initialize returned no result');
	}
	if (!initialize.capabilities || typeof initialize.capabilities !== 'object') {
		throw new Error('initialize returned no capabilities');
	}
	console.log(`  capabilities : ${Object.keys(initialize.capabilities).join(', ')}`);
	console.log(`  serverInfo   : ${JSON.stringify(initialize.serverInfo)}`);

	channel.notify('initialized', {});
	if (expectDiagnostics) {
		// **Diagnostics are pulled, not pushed.** The server deleted its `textDocument/publishDiagnostics` half
		// (`cpp_ls` commit `d5fd21e`): a client asks `textDocument/diagnostic` and gets a report, so a checker that
		// waited for a notification was waiting for a message this server no longer sends — and, since CI did not run
		// this script, nobody noticed. What a client needs is the report, so that is what is checked.
		const text = fs.readFileSync(FIXTURE, 'utf8');
		channel.notify('textDocument/didOpen', {
			textDocument: { uri: FIXTURE_URI, languageId: 'cpp', version: 1, text },
		});

		// The file is queued for reading by `didOpen`, and a report asked before the index has it answers "nothing
		// known yet" — which is not a failure, so ask until the answer arrives or the deadline passes.
		const deadline = Date.now() + 15000;
		let report;
		let lastError;
		while (Date.now() < deadline) {
			try {
				report = await channel.request('textDocument/diagnostic', {
					textDocument: { uri: FIXTURE_URI },
				});
				if (report?.items?.length > 0) {
					break;
				}
			} catch (error) {
				lastError = error;
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}

		if (lastError && !report) {
			warn(`the diagnostic request failed: ${lastError.message}`);
		} else if (!report || typeof report !== 'object') {
			warn('textDocument/diagnostic answered no report — an object with `items` is what a client requires');
		} else {
			const count = report.items?.length ?? 0;
			console.log(`  diagnostics  : ${count} for ${path.relative(ROOT, FIXTURE)}`);
			if (count === 0) {
				warn(
					'the report is empty for a file whose include does not exist — the editor will show no problems ' +
						'for it (a report that arrives before the file is read is legitimately empty)',
				);
			}
		}
	}

	await channel.request('shutdown', null);
	channel.notify('exit', null);
}

async function checkStdio(binary) {
	console.log('\nstdio (spawned without arguments, like the extension does)');
	const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
	let stderr = '';
	child.stderr.on('data', (chunk) => {
		stderr += chunk.toString();
	});

	const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
	const channel = new LspChannel(child.stdout, child.stdin, 'stdio');

	try {
		await checkSession(channel, { expectDiagnostics: true });
	} catch (error) {
		child.kill();
		throw new Error(`${error.message}${stderr ? `\nserver stderr:\n${stderr}` : ''}`);
	}

	const code = await Promise.race([
		exited,
		new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000)),
	]);
	if (code === 'timeout') {
		child.kill();
		throw new Error('the server did not exit after `exit` (kill it on stdin close)');
	}
	if (code !== 0) {
		throw new Error(`the server exited with code ${code} after a clean shutdown (expected 0)`);
	}
	console.log('  shutdown     : exit code 0');
}

async function checkTcp(binary, port) {
	console.log(`\ntcp (-c tcp --port ${port})`);
	const child = spawn(binary, ['-c', 'tcp', '--port', String(port)], {
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: true,
	});
	let stderr = '';
	child.stderr.on('data', (chunk) => {
		stderr += chunk.toString();
	});

	try {
		const socket = await new Promise((resolve, reject) => {
			const deadline = Date.now() + 15000;
			const attempt = () => {
				const candidate = net.connect({ host: '127.0.0.1', port });
				candidate.once('connect', () => resolve(candidate));
				candidate.once('error', (error) => {
					if (Date.now() > deadline) {
						reject(new Error(`nothing listened on 127.0.0.1:${port}: ${error.message}`));
						return;
					}
					setTimeout(attempt, 150);
				});
			};
			attempt();
		});

		const channel = new LspChannel(socket, socket, 'tcp');
		await checkSession(channel, { expectDiagnostics: false });
		socket.destroy();
	} catch (error) {
		child.kill();
		throw new Error(`${error.message}${stderr ? `\nserver stderr:\n${stderr}` : ''}`);
	} finally {
		child.kill();
	}
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function parseArgs(argv) {
	const options = { stdio: false, tcp: false, port: 5009, path: undefined };
	for (let i = 0; i < argv.length; i += 1) {
		switch (argv[i]) {
			case '--stdio':
				options.stdio = true;
				break;
			case '--tcp':
				options.tcp = true;
				break;
			case '--port':
				options.port = Number(argv[++i]);
				break;
			case '--path':
				options.path = argv[++i];
				break;
			case '--help':
			case '-h':
				options.help = true;
				break;
			default:
				throw new Error(`unknown argument: ${argv[i]}`);
		}
	}
	if (!options.stdio && !options.tcp) {
		options.stdio = true;
		options.tcp = true;
	}
	return options;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log('usage: node scripts/verify-server.mjs [--stdio] [--tcp] [--port <n>] [--path <binary>]');
		return 0;
	}

	const binary = options.path
		? path.resolve(options.path)
		: path.join(ROOT, 'server', process.platform === 'win32' ? 'cpp_ls.exe' : 'cpp_ls');

	if (!fs.existsSync(binary)) {
		console.log(`cpp_ls not found at ${binary} — nothing to verify (skipping).`);
		return 2;
	}

	console.log(`verifying ${binary}`);
	try {
		if (options.stdio) {
			await checkStdio(binary);
		}
		if (options.tcp) {
			await checkTcp(binary, options.port);
		}
	} catch (error) {
		console.error(`\nFAILED: ${error.message}`);
		return 1;
	}

	if (warnings.length > 0) {
		console.log(`\nThe server satisfies the transport contract, with ${warnings.length} warning(s):`);
		for (const warning of warnings) {
			console.log(`  - ${warning}`);
		}
		return 0;
	}

	console.log('\nThe server satisfies the contract the extension relies on.');
	return 0;
}

main()
	.then((code) => process.exit(code))
	.catch((error) => {
		console.error(`FAILED: ${error.message}`);
		process.exit(1);
	});