#!/usr/bin/env node
/**
 * **Puts the `cpp_ls` binary for one VS Code target into `server/`.**
 *
 * The extension ships the language server, so packaging it means fetching the
 * release asset for the target being packaged, extracting it, and placing the
 * executable where `src/serverPath.ts` looks for it:
 *
 *     server/cpp_ls          all platforms but Windows
 *     server/cpp_ls.exe      Windows
 *
 * The server's release attaches one asset per platform (`cpp_ls-win32-x64.zip`,
 * `cpp_ls-linux-x64-glibc.2.17.tar.gz`, …), named after the Rust target it was
 * built for; the table below is the one place that translation lives. The
 * `-glibc.2.17` builds are the ones a distribution-agnostic Linux user needs
 * (a binary built against the runner's glibc would not start on an older
 * distribution), which is why `linux-*` names them instead of the plain build.
 *
 * Usage:
 *
 *     node scripts/download-server.mjs --target win32-x64
 *     node scripts/download-server.mjs --target linux-x64 --version 0.1.2
 *     node scripts/download-server.mjs --target darwin-arm64 --tag 0.1.2
 *     node scripts/download-server.mjs --target win32-x64 --from temp/cpp_ls-win32-x64.zip
 *
 * `--from` skips the download and takes an archive from disk, which is how the
 * packaging pipeline is tested without a published release. `--version` and
 * `--tag` override `scripts/config.json`, so a one-off build can ship a
 * different server than the one pinned for the next release.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ASSETS, executableName } from './targets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'scripts', 'config.json');
const SERVER_DIR = path.join(ROOT, 'server');
const TEMP_DIR = path.join(ROOT, 'temp');

// The target table and the executable naming live in `targets.mjs`: the same list decides what a release ships and
// what `check-marketplace.mjs` expects to find there.

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(1);
}

/** A small parser rather than a dependency: the flags are six and they are documented above. */
function parseArgs(argv) {
	const options = { target: undefined, version: undefined, tag: undefined, from: undefined, keep: false };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		const value = () => {
			const next = argv[++index];
			if (next === undefined) {
				fail(`${argument} needs a value`);
			}
			return next;
		};
		switch (argument) {
			case '--target':
				options.target = value();
				break;
			case '--version':
				options.version = value();
				break;
			case '--tag':
				options.tag = value();
				break;
			case '--from':
				options.from = value();
				break;
			case '--keep':
				options.keep = true;
				break;
			case '--help':
			case '-h':
				options.help = true;
				break;
			default:
				fail(`unknown argument: ${argument}`);
		}
	}
	return options;
}

function readConfig() {
	const text = fs.readFileSync(CONFIG_PATH, 'utf8');
	return JSON.parse(text);
}

/**
 * **The tag a server version names.** The server repository tags releases with the version itself — `0.1.1`, not
 * `v0.1.1` — because that is the name its `releases/download/<tag>/<asset>` URLs are built from. `--tag` is taken
 * verbatim; a `v` passed to `--version` is not part of the version and is stripped, so `--version v0.1.1` still asks for
 * the tag that exists.
 */
function tagOf(options, config) {
	if (options.tag) {
		return options.tag;
	}
	const version = options.version ?? config.serverVersion;
	if (!version) {
		fail('no server version: set `serverVersion` in scripts/config.json or pass --version');
	}
	if (!/^v?\d+\.\d+\.\d+/.test(version)) {
		fail(`"${version}" is not a version (expected 0.1.1)`);
	}
	return version.replace(/^v/, '');
}

async function download(url, destination) {
	console.log(`downloading ${url}`);
	const response = await fetch(url, { redirect: 'follow' });
	if (!response.ok) {
		// **A 404 here is a wrong version or a missing platform**, and the message has to say which question to
		// re-open: the server builds eight assets, and this script's table names one of them.
		fail(
			`${url} answered ${response.status} ${response.statusText} — check \`serverVersion\` in ` +
				'scripts/config.json (and that the release attaches this platform)',
		);
	}
	if (!response.body) {
		fail(`${url} answered no body`);
	}
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	const bytes = Buffer.from(await response.arrayBuffer());
	fs.writeFileSync(destination, bytes);
	console.log(`  ${bytes.length} bytes -> ${path.relative(ROOT, destination)}`);
}

/**
 * Unpacks an archive into `directory`.
 *
 * `.zip` needs `unzip` on a POSIX system, while Windows ships a `tar` that reads
 * zips; `.tar.gz` is read by `tar` everywhere. The archives are the ones the
 * server's release produces, so there is no third shape to handle.
 */
function extract(archive, directory) {
	fs.mkdirSync(directory, { recursive: true });
	const zip = archive.endsWith('.zip');
	const [command, args] =
		zip && process.platform !== 'win32'
			? ['unzip', ['-q', '-o', archive, '-d', directory]]
			: ['tar', ['-xf', archive, '-C', directory]];
	const result = spawnSync(command, args, { stdio: 'inherit' });
	if (result.error) {
		fail(`could not run ${command} to extract ${path.basename(archive)}: ${result.error.message}`);
	}
	if (result.status !== 0) {
		fail(`${command} exited with ${result.status} while extracting ${path.basename(archive)}`);
	}
}

/** The first `cpp_ls` (or `cpp_ls.exe`) in the extracted tree, depth first. */
function findExecutable(directory) {
	const entries = fs.readdirSync(directory, { withFileTypes: true });
	// Files first, then directories: the archive puts the binary beside its
	// directory, and a name match in a `README` directory would be wrong.
	for (const entry of entries) {
		if (entry.isFile() && (entry.name === 'cpp_ls' || entry.name === 'cpp_ls.exe')) {
			return path.join(directory, entry.name);
		}
	}
	for (const entry of entries) {
		if (entry.isDirectory()) {
			const found = findExecutable(path.join(directory, entry.name));
			if (found) {
				return found;
			}
		}
	}
	return undefined;
}

/** Removes the binaries of a build before this one, so a wrong platform cannot stay behind. */
function clearServerBinaries() {
	for (const name of ['cpp_ls', 'cpp_ls.exe']) {
		fs.rmSync(path.join(SERVER_DIR, name), { force: true });
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log(
			'usage: node scripts/download-server.mjs --target <target> [--version <version>|--tag <tag>] [--from <archive>] [--keep]',
		);
		return;
	}

	if (!options.target) {
		fail(`--target is required (one of: ${Object.keys(ASSETS).join(', ')})`);
	}
	const asset = ASSETS[options.target];
	if (!asset) {
		fail(`no server asset for "${options.target}" (known: ${Object.keys(ASSETS).join(', ')})`);
	}

	const config = readConfig();
	const tag = tagOf(options, config);
	const archive = path.join(TEMP_DIR, asset);

	if (options.from) {
		const source = path.resolve(ROOT, options.from);
		if (!fs.existsSync(source)) {
			fail(`--from ${options.from} does not exist`);
		}
		fs.mkdirSync(TEMP_DIR, { recursive: true });
		fs.copyFileSync(source, archive);
		console.log(`using ${path.relative(ROOT, source)} as ${asset}`);
	} else {
		const url = `${config.serverRepo.replace(/\/$/, '')}/${tag}/${asset}`;
		await download(url, archive);
	}

	const extracted = path.join(TEMP_DIR, `extract-${options.target}`);
	fs.rmSync(extracted, { recursive: true, force: true });
	extract(archive, extracted);

	const found = findExecutable(extracted);
	if (!found) {
		fail(`${asset} contains no cpp_ls executable (looked in ${path.relative(ROOT, extracted)})`);
	}

	fs.mkdirSync(SERVER_DIR, { recursive: true });
	clearServerBinaries();
	const destination = path.join(SERVER_DIR, executableName(options.target));
	fs.copyFileSync(found, destination);
	if (!options.target.startsWith('win32')) {
		// **The mode is part of what is shipped.** A vsix is a zip and a zip can carry the executable bit, but a
		// checkout, a `copyFile`, and some archive tools do not — so it is set explicitly here as well as at
		// activation (`ensureExecutable` in `src/serverPath.ts`), which is the copy a read-only install still needs.
		fs.chmodSync(destination, 0o755);
	}

	if (!options.keep) {
		fs.rmSync(archive, { force: true });
		fs.rmSync(extracted, { recursive: true, force: true });
	}

	const size = fs.statSync(destination).size;
	console.log(
		`server/${executableName(options.target)} <- ${asset} (${tag}), ${Math.round(size / (1024 * 1024))} MiB`,
	);
	console.log(
		options.from
			? 'ready (archive given with --from)'
			: 'ready for `npx vsce package --target ' + options.target + '`',
	);
}

main().catch((error) => {
	console.error(`error: ${error.message}`);
	process.exit(1);
});
