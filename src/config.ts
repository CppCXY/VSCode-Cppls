/**
 * Configuration and environment handling for the cppls language client.
 *
 * Two transports are supported:
 *
 *  - **bundled** – the client spawns `server/cpp_ls` (`.exe` on Windows) and
 *    talks to it over stdio. This is the shipping mode.
 *  - **tcp** – the client connects to an already running server on a TCP port
 *    (5009 by default). This is the development mode used when the `CPPLS_DEV`
 *    environment variable is present, so the server can be started, debugged
 *    and restarted by hand without reloading the extension host.
 *
 * The transport actually used is decided at connect time by
 * `cppls.server.launchMode`, the `CPPLS_DEV` environment variable and a TCP
 * reachability probe (see `src/client.ts`).
 *
 * This module holds the environment and port logic only and deliberately avoids
 * importing `vscode`, which keeps it unit testable. Reading the VS Code settings
 * lives in `src/settings.ts`.
 */

/** Setting namespace used by this extension. */
export const CONFIG_SECTION = 'cppls';

/** Default TCP port used in development mode. */
export const DEFAULT_DEV_PORT = 5009;

/** Environment variable that switches the client into development (TCP) mode. */
export const ENV_DEV = 'CPPLS_DEV';

/** Environment variable overriding the development TCP port. */
export const ENV_DEV_PORT = 'CPPLS_DEV_PORT';

/** Environment variable overriding the language server executable. */
export const ENV_SERVER_PATH = 'CPPLS_SERVER_PATH';

/** How the language server is reached. */
export type LaunchMode = 'auto' | 'tcp' | 'bundled';

/** How much LSP traffic is traced. */
export type TraceLevel = 'off' | 'messages' | 'verbose';

/**
 * Reads the raw value of the `CPPLS_DEV` environment variable.
 *
 * Any value other than the usual "off" spellings enables development mode, so
 * `CPPLS_DEV=1`, `CPPLS_DEV=true` and `CPPLS_DEV=yes` all work, as does an
 * empty-but-present variable.
 */
export function readDevEnvValue(env: NodeJS.ProcessEnv = process.env): string | undefined {
	return env[ENV_DEV];
}

/** Returns `true` when `CPPLS_DEV` asks for development (TCP) mode. */
export function isDevModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const raw = readDevEnvValue(env);
	if (raw === undefined) {
		return false;
	}
	const value = raw.trim().toLowerCase();
	return value !== '0' && value !== 'false' && value !== 'off' && value !== 'no';
}

/** Parses a TCP port, returning `undefined` when the value is not usable. */
export function parsePort(value: unknown): number | undefined {
	const port = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return undefined;
	}
	return port;
}

/**
 * Resolves the development TCP port.
 *
 * Precedence: `cppls.server.port` setting > `CPPLS_DEV_PORT` > 5009.
 */
export function resolveDevPort(configured?: unknown, env: NodeJS.ProcessEnv = process.env): number {
	return parsePort(configured) ?? parsePort(env[ENV_DEV_PORT]) ?? DEFAULT_DEV_PORT;
}

/** Normalises the `cppls.trace.server` setting. */
export function normalizeTrace(value: unknown): TraceLevel {
	return value === 'messages' || value === 'verbose' ? value : 'off';
}

/** Normalises the `cppls.server.launchMode` setting. */
export function normalizeLaunchMode(value: unknown): LaunchMode {
	return value === 'tcp' || value === 'bundled' ? value : 'auto';
}
