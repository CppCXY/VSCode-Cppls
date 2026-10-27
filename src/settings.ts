/**
 * Reads the cppls settings from VS Code and turns them into a `ServerConfig`.
 *
 * Kept apart from `src/config.ts` (pure environment logic) because this module
 * needs the `vscode` API and therefore cannot be unit tested outside VS Code.
 */

import * as vscode from 'vscode';
import type { DocumentSelector } from 'vscode-languageclient/node';

import {
	CONFIG_SECTION,
	ENV_DEV,
	LaunchMode,
	TraceLevel,
	isDevModeEnabled,
	normalizeLaunchMode,
	normalizeTrace,
	readDevEnvValue,
	resolveDevPort,
} from './config';

/** Everything the language client needs to know about the user's preferences. */
export interface ServerConfig {
	/** Requested transport. `auto` prefers TCP while `CPPLS_DEV` is set. */
	launchMode: LaunchMode;
	/** Explicit server executable configured by the user, if any. */
	serverPath: string | undefined;
	/** Additional arguments passed to the spawned server executable. */
	serverArgs: string[];
	/** TCP port used in development mode. */
	devPort: number;
	/** Milliseconds to wait for the TCP port before giving up. */
	connectTimeoutMs: number;
	/** Documents the client claims ownership of (protocol level document selector). */
	documentSelector: DocumentSelector;
	/** How much protocol traffic is traced. */
	traceServer: TraceLevel;
	/** Reveal the "cppls" output channel on activation. */
	revealOutputChannelOnActivate: boolean;
}

/** Documents handled by this extension. */
export const DOCUMENT_SELECTOR: DocumentSelector = [
	{ scheme: 'file', language: 'c' },
	{ scheme: 'file', language: 'cpp' },
	// **CUDA**, which is C++ plus a layer of its own: `nvcc` compiles the host half with the platform's own compiler
	// and adds the placement qualifiers (`__global__`) and the launch brackets (`k<<<g, b>>>(args)`). The server reads
	// those only when the project's toolchain is `nvcc` or `[compile.cuda]` says so, so claiming these documents costs a
	// C++ project nothing.
	//
	// **Two language ids, and the second one is the reported bug.** `cuda` is ours (the language this extension
	// contributes, with its own grammar and configuration). `cuda-cpp` is the id the **Microsoft C/C++ extension**
	// contributes for the same `.cu` files, and it wins the assignment whenever that extension is installed — which it
	// is on most machines that also have this one. A client that claimed only `cuda` was therefore never attached to
	// the document: no semantic tokens, no hover, and a reader seeing "most of the highlighting is missing" — the
	// keywords coloured by that extension's grammar, every name plain. clangd claims `cuda-cpp` for the same reason.
	{ scheme: 'file', language: 'cuda' },
	{ scheme: 'file', language: 'cuda-cpp' },
	{ scheme: 'untitled', language: 'c' },
	{ scheme: 'untitled', language: 'cpp' },
	{ scheme: 'untitled', language: 'cuda' },
	{ scheme: 'untitled', language: 'cuda-cpp' },
];

/** Reads the extension configuration, applying defaults and environment overrides. */
export function readServerConfig(scope?: vscode.ConfigurationScope): ServerConfig {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, scope ?? null);

	const serverPath = config.get<string>('server.path', '').trim();

	return {
		launchMode: normalizeLaunchMode(config.get<string>('server.launchMode', 'auto')),
		serverPath: serverPath.length > 0 ? serverPath : undefined,
		serverArgs: config.get<string[]>('server.args', []),
		devPort: resolveDevPort(config.get<number>('server.port')),
		connectTimeoutMs: Math.max(200, config.get<number>('server.connectTimeout', 5000)),
		documentSelector: DOCUMENT_SELECTOR,
		traceServer: normalizeTrace(config.get<string>('trace.server', 'off')),
		revealOutputChannelOnActivate: config.get<boolean>('revealOutputChannelOnActivate', false),
	};
}

/** Short human readable summary of the configuration, used by logs and the status bar. */
export function describeServerConfig(config: ServerConfig, env: NodeJS.ProcessEnv = process.env): string {
	const parts = [`mode=${config.launchMode}`];
	if (isDevModeEnabled(env)) {
		parts.push(`${ENV_DEV}=${readDevEnvValue(env) || '1'}`, `port=${config.devPort}`);
	}
	if (config.serverPath) {
		parts.push(`path=${config.serverPath}`);
	}
	return parts.join(', ');
}
