#!/usr/bin/env node
/**
 * **What a packaged `.vsix` actually contains** — checked after `vsce package`
 * and before an artifact is uploaded or a release is created.
 *
 * `vsce package` succeeds while shipping the wrong thing: a `.vscodeignore`
 * entry can drop the server binary, a stale `temp/` can add thirty megabytes of
 * archives, and the platform a package was built for lives in the
 * `extension.vsixmanifest` (`TargetPlatform="win32-x64"`), not in
 * `package.json` — so a build that forgot `--target` looks exactly like one
 * that did not.
 *
 * Usage:
 *
 *     node scripts/check-vsix.mjs cppls-win32-x64.vsix --target win32-x64
 *     node scripts/check-vsix.mjs cppls-linux-x64.vsix
 *
 * Exits 0 when the package is shaped correctly, 1 otherwise.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_DIR = path.join(ROOT, 'temp');

/** The extension's own manifest, for the version and the entry point. */
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** The smallest plausible language server, in bytes — a stub or a truncated download is caught. */
const SMALLEST_SERVER = 1024 * 1024;

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const options = { vsix: undefined, target: undefined };
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === '--target') {
			options.target = argv[++index];
		} else if (argv[index] === '--help' || argv[index] === '-h') {
			options.help = true;
		} else if (options.vsix === undefined) {
			options.vsix = argv[index];
		} else {
			fail(`unexpected argument: ${argv[index]}`);
		}
	}
	return options;
}

/** Unpacks the archive with the same tools `download-server.mjs` uses. */
function extract(archive, directory) {
	fs.mkdirSync(directory, { recursive: true });
	const zip = archive.endsWith('.zip') || archive.endsWith('.vsix');
	const [command, args] =
		zip && process.platform !== 'win32'
			? ['unzip', ['-q', '-o', archive, '-d', directory]]
			: ['tar', ['-xf', archive, '-C', directory]];
	const result = spawnSync(command, args, { stdio: 'inherit' });
	if (result.error) {
		fail(`could not run ${command}: ${result.error.message}`);
	}
	if (result.status !== 0) {
		fail(`${command} exited with ${result.status}`);
	}
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help || !options.vsix) {
		console.log('usage: node scripts/check-vsix.mjs <package.vsix> [--target <target>]');
		if (options.help) {
			return;
		}
		process.exit(1);
	}

	const vsix = path.resolve(ROOT, options.vsix);
	if (!fs.existsSync(vsix)) {
		fail(`${options.vsix} does not exist`);
	}

	const extracted = path.join(TEMP_DIR, `check-${path.basename(vsix, '.vsix')}`);
	fs.rmSync(extracted, { recursive: true, force: true });
	extract(vsix, extracted);

	const problems = [];
	const note = (message) => problems.push(message);

	// --- the manifest and the entry point -----------------------------------
	const packagedManifestPath = path.join(extracted, 'extension', 'package.json');
	if (!fs.existsSync(packagedManifestPath)) {
		note('extension/package.json is missing');
	} else {
		const packaged = JSON.parse(fs.readFileSync(packagedManifestPath, 'utf8'));
		if (packaged.version !== manifest.version) {
			note(`extension/package.json says ${packaged.version}, the repository says ${manifest.version}`);
		}
		const main = typeof packaged.main === 'string' ? packaged.main.replace(/^\.\//, '') : '';
		if (!main || !fs.existsSync(path.join(extracted, 'extension', main))) {
			note(`the manifest's entry point (${packaged.main ?? 'none'}) is not in the package`);
		}
	}

	// --- the platform the package is for ------------------------------------
	const vsixManifest = path.join(extracted, 'extension.vsixmanifest');
	if (!fs.existsSync(vsixManifest)) {
		note('extension.vsixmanifest is missing');
	} else if (options.target) {
		const text = fs.readFileSync(vsixManifest, 'utf8');
		// **This is where `vsce package --target` records the platform.** A build that omitted the flag produces a
		// package every editor will try to install, and the binary inside is right for exactly one of them.
		if (!text.includes(`TargetPlatform="${options.target}"`)) {
			note(`extension.vsixmanifest does not name TargetPlatform="${options.target}"`);
		}
	}

	// --- the language server ------------------------------------------------
	const windows = options.target ? options.target.startsWith('win32') : undefined;
	const serverNames = windows === undefined ? ['cpp_ls', 'cpp_ls.exe'] : [windows ? 'cpp_ls.exe' : 'cpp_ls'];
	const serverPath = serverNames
		.map((name) => path.join(extracted, 'extension', 'server', name))
		.find((candidate) => fs.existsSync(candidate));
	if (!serverPath) {
		note(`the package has no server/${serverNames.join(' or ')} — the extension would report a missing server`);
	} else {
		const size = fs.statSync(serverPath).size;
		if (size < SMALLEST_SERVER) {
			note(`server/${path.basename(serverPath)} is ${size} bytes, which is not a language server`);
		}
		if (process.platform !== 'win32' && !windows) {
			// A vsix is a zip: the mode survives `unzip` on Linux and macOS, and VS Code's installer is not required to
			// keep it — which is why `ensureExecutable` also runs at activation. Here it is a packaging check: a bundle
			// built from a checkout that lost the bit ships a binary that cannot start.
			const executable = (fs.statSync(serverPath).mode & 0o111) !== 0;
			if (!executable) {
				note(`server/${path.basename(serverPath)} has no executable bit`);
			}
		}
	}

	// --- nothing that belongs to development --------------------------------
	const packaged = fs
		.readdirSync(path.join(extracted, 'extension'), { withFileTypes: true })
		.map((entry) => entry.name);
	for (const unwanted of ['temp', 'src', 'node_modules', 'out']) {
		if (packaged.includes(unwanted)) {
			note(`the package contains ${unwanted}/, which is development only`);
		}
	}

	fs.rmSync(extracted, { recursive: true, force: true });

	if (problems.length > 0) {
		console.error(`\n${problems.length} problem(s) in ${path.basename(vsix)}:`);
		for (const problem of problems) {
			console.error(`  - ${problem}`);
		}
		process.exit(1);
	}

	console.log(
		`${path.basename(vsix)}: ${manifest.version}, ${options.target ?? 'no target'}, ` +
			`server ${path.basename(serverPath ?? 'missing')} (${Math.round(fs.statSync(vsix).size / (1024 * 1024))} MiB package)`,
	);
}

main();
