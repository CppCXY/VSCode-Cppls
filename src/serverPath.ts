/**
 * Locates the cppls language server executable.
 *
 * Resolution order (first existing file wins):
 *
 *  1. `cppls.server.path` setting
 *  2. `CPPLS_SERVER_PATH` environment variable
 *  3. `<extension>/server/cpp_ls` – the bundled, shipped binary
 *     (`cpp_ls.exe` on Windows)
 *
 * Only the file system is inspected here; nothing is spawned or executed, which
 * keeps this module free of `vscode` imports and therefore unit-testable.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Directory (relative to the extension root) that holds the server binary. */
export const SERVER_DIR = 'server';

/** Base name of the language server executable. */
export const SERVER_BASENAME = 'cpp_ls';

/** Where a resolved server came from. */
export type ServerSource = 'setting' | 'env' | 'bundled';

/** A resolved language server executable. */
export interface ResolvedServer {
	/** Absolute path of the executable to run. */
	command: string;
	/** How this server was located. */
	source: ServerSource;
}

/** Returns the platform specific executable name, e.g. `cpp_ls.exe` on Windows. */
export function serverExecutableName(platform: NodeJS.Platform = process.platform): string {
	return platform === 'win32' ? `${SERVER_BASENAME}.exe` : SERVER_BASENAME;
}

/** Returns `true` when `candidate` exists and is a regular file. */
export function isFile(candidate: string): boolean {
	try {
		return fs.statSync(candidate).isFile();
	} catch {
		return false;
	}
}

/**
 * Finds an explicit, user supplied server path.
 *
 * Relative paths are resolved against the extension root, so `server/cpp_ls`
 * works from settings. On Windows a missing extension is retried with `.exe`,
 * which makes `"cppls.server.path": "server/cpp_ls"` behave intuitively.
 */
function fromExplicitPath(
	explicit: string,
	extensionPath: string,
): string | undefined {
	const resolved = path.isAbsolute(explicit) ? explicit : path.resolve(extensionPath, explicit);
	if (isFile(resolved)) {
		return resolved;
	}
	if (process.platform === 'win32' && path.extname(resolved) === '') {
		const withExe = `${resolved}.exe`;
		if (isFile(withExe)) {
			return withExe;
		}
	}
	return undefined;
}

/**
 * Resolves the language server executable to launch.
 *
 * @param extensionPath Absolute path of the extension root (`context.extensionPath`).
 * @param configuredPath Value of the `cppls.server.path` setting, if set.
 * @param env Environment used for the `CPPLS_SERVER_PATH` lookup.
 * @returns The executable, or `undefined` when no server is installed.
 */
export function resolveServer(
	extensionPath: string,
	configuredPath?: string,
	env: NodeJS.ProcessEnv = process.env,
): ResolvedServer | undefined {
	const configured = configuredPath?.trim();
	if (configured) {
		const command = fromExplicitPath(configured, extensionPath);
		if (command) {
			return { command, source: 'setting' };
		}
	}

	const fromEnv = env.CPPLS_SERVER_PATH?.trim();
	if (fromEnv) {
		const command = fromExplicitPath(fromEnv, extensionPath);
		if (command) {
			return { command, source: 'env' };
		}
	}

	const bundled = path.join(extensionPath, SERVER_DIR, serverExecutableName());
	if (isFile(bundled)) {
		return { command: bundled, source: 'bundled' };
	}

	return undefined;
}

/** Every path that was considered, in the order they were tried. Used for diagnostics. */
export function serverSearchPaths(
	extensionPath: string,
	configuredPath?: string,
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();

	const add = (candidate: string | undefined): void => {
		if (!candidate) {
			return;
		}
		const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(extensionPath, candidate);
		if (!seen.has(resolved)) {
			seen.add(resolved);
			paths.push(resolved);
		}
	};

	add(configuredPath?.trim());
	add(env.CPPLS_SERVER_PATH?.trim());
	add(path.join(SERVER_DIR, serverExecutableName()));
	if (process.platform === 'win32') {
		add(path.join(SERVER_DIR, SERVER_BASENAME));
	}
	return paths;
}
