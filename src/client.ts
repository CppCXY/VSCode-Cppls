/**
 * Wiring of the `vscode-languageclient` to the cppls language server.
 *
 * The interesting part is that the *decision* between the two transports is
 * deferred until the client actually needs a connection. That is what makes the
 * `CPPLS_DEV` workflow pleasant: the extension host can already be running,
 * `cppls.server.launchMode` can be `auto`, and the client connects over TCP as
 * soon as a server is listening on port 5009 — no window reload required.
 */

import * as cp from 'child_process';
import * as vscode from 'vscode';
import {
	CloseAction,
	ErrorAction,
	LanguageClient,
	LanguageClientOptions,
	MessageTransports,
	RevealOutputChannelOn,
	ServerOptions,
	State,
	Trace,
	type CloseHandlerResult,
	type ErrorHandler,
	type ErrorHandlerResult,
} from 'vscode-languageclient/node';
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';

import { isDevModeEnabled } from './config';
import { connectTcp, probeTcpPort } from './connection';
import { LaunchPlan, SpawnPlan, TcpPlan, describePlan } from './plan';
import { ResolvedServer, ensureExecutable, resolveServer, serverSearchPaths } from './serverPath';
import { ServerConfig, readServerConfig } from './settings';

export { describePlan };
export type { LaunchPlan };

/** Rejects after `timeoutMs` so a half-open TCP peer cannot wedge activation. */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number, what: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${what} timed out after ${timeoutMs}ms`)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

/**
 * Chooses TCP or a spawned process.
 *
 * `auto` only prefers TCP while `CPPLS_DEV` is set, and only if the port
 * actually answers; otherwise it degrades to spawning a local server so that a
 * forgotten `CPPLS_DEV` cannot break a normal editing session.
 */
export async function resolveLaunchPlan(
	config: ServerConfig,
	extensionPath: string,
	channel: vscode.LogOutputChannel,
	env: NodeJS.ProcessEnv = process.env,
): Promise<LaunchPlan> {
	if (config.launchMode === 'tcp') {
		return { kind: 'tcp', host: '127.0.0.1', port: config.devPort };
	}

	if (config.launchMode === 'auto' && isDevModeEnabled(env)) {
		const probe = await probeTcpPort(config.devPort, { timeoutMs: config.connectTimeoutMs });
		if (probe.reachable) {
			return { kind: 'tcp', host: '127.0.0.1', port: config.devPort };
		}
		channel.warn(
			`CPPLS_DEV is set but nothing is listening on 127.0.0.1:${config.devPort} ` +
				`(${probe.reason ?? 'unknown reason'}); falling back to a local server process.`,
		);
		channel.info(
			`Start your server with "cpp_ls --port ${config.devPort}" to use the TCP transport.`,
		);
	}

	return {
		kind: 'spawn',
		server: requireServer(extensionPath, config, env),
		args: config.serverArgs,
	};
}

function requireServer(
	extensionPath: string,
	config: ServerConfig,
	env: NodeJS.ProcessEnv,
): ResolvedServer {
	const server = resolveServer(extensionPath, config.serverPath, env);
	if (server) {
		return server;
	}

	const searched = serverSearchPaths(extensionPath, config.serverPath, env)
		.map((candidate) => `  - ${candidate}`)
		.join('\n');
	throw new Error(
		`Unable to locate the cppls language server. Looked for:\n${searched}\n` +
			'Build it (see server/README.md) or point "cppls.server.path" at the executable.',
	);
}

/** Supplies the configuration the client should use. */
export type ConfigProvider = () => ServerConfig;

/**
 * Called with every server process right after it is spawned.
 *
 * Diagnostics only: the extension uses it to forward nothing, while tests tap
 * the server's stderr so a start-up failure can be reported with its reason.
 */
export type SpawnObserver = (child: cp.ChildProcess) => void;

/** Owns the `LanguageClient` instance, the spawned server processes and their lifecycle. */
export class CpplsLanguageClient implements vscode.Disposable {
	private client: LanguageClient | undefined;
	private lastPlan: LaunchPlan | undefined;
	private lastError: Error | undefined;
	private readonly children = new Set<cp.ChildProcess>();
	private readonly config: ConfigProvider;
	private stopped = false;

	public constructor(
		private readonly extensionPath: string,
		private readonly extensionVersion: string,
		private readonly channel: vscode.LogOutputChannel,
		/** Receives the LSP protocol dump; kept apart from the regular log. */
		private readonly traceChannel: vscode.LogOutputChannel,
		/**
		 * Reads the configuration. Defaults to the `cppls.*` settings; tests
		 * inject a fixed configuration so they never touch the user's settings.
		 */
		config?: ConfigProvider,
		/** Observes spawned server processes. Used by tests to capture stderr. */
		private readonly onSpawn?: SpawnObserver,
	) {
		this.config = config ?? (() => readServerConfig());
	}

	/** The plan used for the most recent connection attempt, for logs and the status bar. */
	public get currentPlan(): LaunchPlan | undefined {
		return this.lastPlan;
	}

	/** Why the most recent start attempt failed, if it did. */
	public get lastStartError(): Error | undefined {
		return this.lastError;
	}

	/** Current client state, or `State.Stopped` before the first start. */
	public get state(): State {
		return this.client?.state ?? State.Stopped;
	}

	/** The underlying client, once created. */
	public get languageClient(): LanguageClient | undefined {
		return this.client;
	}

	/** The spawned server processes, newest last. Exposed for diagnostics and tests. */
	public get spawnedProcesses(): readonly cp.ChildProcess[] {
		return [...this.children];
	}

	/** Creates the client if needed and starts it. Never throws. */
	public async start(): Promise<boolean> {
		this.stopped = false;
		try {
			this.client = this.client ?? this.createClient();
			// Trace level before starting: `setTrace` is safe on a stopped client
			// and is picked up when the connection is created.
			await this.applyTrace(this.client);
			await this.client.start();
			this.lastError = undefined;
			return true;
		} catch (error) {
			this.lastError = error instanceof Error ? error : new Error(String(error));
			this.reportStartFailure(error);
			return false;
		}
	}

	/** Applies the `cppls.trace.server` setting to the given client. */
	public async applyTrace(target: LanguageClient | undefined = this.client): Promise<void> {
		if (!target) {
			return;
		}
		const level = this.config().traceServer;
		await target.setTrace(level === 'verbose' ? Trace.Verbose : level === 'messages' ? Trace.Messages : Trace.Off);
	}

	/** Stops and starts the client, recreating it after a failed start. */
	public async restart(): Promise<boolean> {
		if (this.client && this.client.state === State.Running) {
			try {
				await this.client.restart();
				return true;
			} catch (error) {
				this.reportStartFailure(error);
				return false;
			}
		}
		await this.stop();
		return this.start();
	}

	/** Stops the client, kills spawned processes and waits for shutdown. */
	public async stop(): Promise<void> {
		this.stopped = true;
		const client = this.client;
		this.client = undefined;
		if (client && client.state !== State.Stopped) {
			try {
				await client.stop();
			} catch (error) {
				this.channel.warn(`Error while stopping the language client: ${toMessage(error)}`);
			}
		}
		this.killChildren();
	}

	public dispose(): void {
		void this.stop();
	}

	private reportStartFailure(error: unknown): void {
		const message = toMessage(error);
		this.channel.error(`Failed to start the cppls language server: ${message}`);
		void vscode.window
			.showErrorMessage(`cppls: failed to start the language server. ${message}`, 'Show Logs', 'Restart')
			.then((choice) => {
				if (choice === 'Show Logs') {
					this.channel.show(true);
				} else if (choice === 'Restart') {
					void this.restart();
				}
			});
	}

	private killChildren(): void {
		for (const child of this.children) {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill();
			}
		}
		this.children.clear();
	}

	private createClient(): LanguageClient {
		const initial = this.config();
		const serverOptions = this.createServerOptionsFactory();

		const clientOptions: LanguageClientOptions = {
			documentSelector: initial.documentSelector,
			outputChannel: this.channel,
			traceOutputChannel: this.traceChannel,
			revealOutputChannelOn: initial.revealOutputChannelOnActivate
				? RevealOutputChannelOn.Info
				: RevealOutputChannelOn.Never,
			markdown: { isTrusted: false, supportHtml: false, supportThemeIcons: false },
			initializationOptions: {
				// Lets the server tell whether it was launched by the extension or
				// started by hand during development.
				clientInfo: { name: 'vscode-cppls', version: this.extensionVersion },
			},
			errorHandler: this.createErrorHandler(),
			connectionOptions: { maxRestartCount: 3 },
		};

		return new LanguageClient('cppls', 'Cpp Language Server', serverOptions, clientOptions);
	}

	/**
	 * Builds the `ServerOptions` factory handed to the language client.
	 *
	 * It runs on every start *and* every restart, which is what lets the client
	 * pick up a development server that appeared (or disappeared) in the
	 * meantime.
	 */
	private createServerOptionsFactory(): ServerOptions {
		const factory = async (): Promise<MessageTransports> => {
			const config = this.config();
			const plan = await resolveLaunchPlan(config, this.extensionPath, this.channel);
			this.lastPlan = plan;
			this.channel.info(`Connecting to the language server via ${describePlan(plan)}`);

			return plan.kind === 'tcp'
				? this.createTcpTransports(plan, config)
				: this.createSpawnTransports(plan);
		};
		return factory as unknown as ServerOptions;
	}

	/**
	 * Opens the TCP connection.
	 *
	 * `net.Socket` is a duplex stream, so it doubles as the LSP reader and
	 * writer; the language client builds the JSON-RPC connection on top of it.
	 */
	private async createTcpTransports(plan: TcpPlan, config: ServerConfig): Promise<MessageTransports> {
		const connection = await withTimeout(
			connectTcp(plan.port, plan.host, config.connectTimeoutMs),
			config.connectTimeoutMs,
			`Connecting to ${plan.host}:${plan.port}`,
		);

		// Report socket level failures ourselves: the language client only sees
		// the message connection and would otherwise just say "read error".
		connection.socket.on('error', (error: Error) => {
			this.channel.error(`Socket error on ${plan.host}:${plan.port}: ${error.message}`);
		});
		connection.socket.on('close', () => {
			if (!this.stopped) {
				this.channel.warn(`Connection to ${plan.host}:${plan.port} closed.`);
			}
		});

		return {
			reader: new StreamMessageReader(connection.reader),
			writer: new StreamMessageWriter(connection.writer),
			// The development server outlives this client: never kill the socket
			// owner on shutdown, just close the message connection.
			detached: false,
		};
	}

	/** Spawns `server/cpp_ls` and adapts its stdio to the LSP message connection API. */
	private createSpawnTransports(plan: SpawnPlan): MessageTransports {
		const { server } = plan;
		// **The bit the installer may not have kept.** See `ensureExecutable`: a vsix is a zip, and a Linux package whose
		// server arrived without `+x` otherwise fails at `spawn` with `EACCES` — after every capability has been agreed.
		if (!ensureExecutable(server)) {
			this.channel.warn(
				`Could not mark "${server.command}" executable; starting it may fail with a permission error.`,
			);
		}
		const args = [...plan.args];
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
		this.channel.info(`Spawning "${server.command}" with args [${args.join(', ')}] (cwd: ${cwd})`);

		const child = cp.spawn(server.command, args, {
			cwd,
			env: process.env,
			stdio: ['pipe', 'pipe', 'pipe'],
			shell: false,
			windowsHide: true,
		});
		this.children.add(child);
		child.once('exit', () => this.children.delete(child));
		child.on('error', (error: Error) => {
			this.channel.error(`Failed to start "${server.command}": ${error.message}`);
		});
		child.stderr?.on('data', (chunk: Buffer | string) => {
			this.logServerStderr(chunk.toString());
		});
		this.onSpawn?.(child);

		if (!child.stdout || !child.stdin) {
			child.kill();
			throw new Error(`Could not open stdio pipes for "${server.command}"`);
		}

		return {
			reader: new StreamMessageReader(child.stdout),
			writer: new StreamMessageWriter(child.stdin),
			detached: false,
		};
	}

	private logServerStderr(text: string): void {
		for (const line of text.split(/\r?\n/)) {
			if (line.trim().length > 0) {
				this.channel.info(`[server] ${line}`);
			}
		}
	}

	private createErrorHandler(): ErrorHandler {
		return {
			error: (error: Error): ErrorHandlerResult => {
				this.channel.error(`Language server error: ${error.message}`);
				return { action: ErrorAction.Shutdown, handled: true };
			},
			closed: (): CloseHandlerResult => {
				if (isDevModeEnabled()) {
					// Development servers are restarted by hand; respawning a bundled
					// server underneath the developer would only be confusing.
					if (!this.stopped) {
						this.channel.warn(
							'The development server connection closed. Start it again and run ' +
								'"cppls: Restart Language Server".',
						);
					}
					return { action: CloseAction.DoNotRestart, handled: true };
				}
				return this.stopped ? { action: CloseAction.DoNotRestart } : { action: CloseAction.Restart };
			},
		};
	}
}

function toMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
