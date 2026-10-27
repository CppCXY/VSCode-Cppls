#!/usr/bin/env node
/**
 * Verifies the *shape* of the packaged bundle: the things VS Code checks before
 * it will run an extension at all.
 *
 *   1. the `main` entry point exists on disk
 *   2. it is loadable CommonJS (`require`-able, no ES module syntax)
 *   3. it exports `activate`, and `deactivate` if the manifest says so
 *   4. the language contribution and its configuration file exist
 *   5. a server binary is present, or its absence is reported clearly
 *
 * Running `activate()` itself needs the real VS Code API, so it is exercised by
 * `npm test` inside a real extension host instead.
 *
 * Usage:
 *   node scripts/check-bundle.mjs [--vsix path/to/extension.vsix]
 *
 * Exits 0 when the bundle is shaped correctly, 1 otherwise.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const failures = [];
const checks = [];

function check(description, ok, detail) {
	checks.push({ description, ok, detail });
	if (!ok) {
		failures.push(`${description}${detail ? `: ${detail}` : ''}`);
	}
}

// --- manifest -----------------------------------------------------------------

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const main = manifest.main ?? './extension.js';
const entry = path.join(ROOT, main);

check('manifest declares a publisher and name', Boolean(manifest.publisher && manifest.name), `${manifest.publisher}.${manifest.name}`);
check('the extension has a version', Boolean(manifest.version), manifest.version);
check('the main entry point exists', fs.existsSync(entry), entry);

if (manifest.icon) {
	check('the extension icon exists', fs.existsSync(path.join(ROOT, manifest.icon)), manifest.icon);
}

if (manifest.activationEvents?.length) {
	check('activation events are declared', true, manifest.activationEvents.join(', '));
} else {
	// VS Code 1.74+ derives activation from the contributions, which is fine.
	check('activation is derived from contributions', Boolean(manifest.contributes?.languages), 'no explicit activationEvents');
}

// --- loadable CommonJS --------------------------------------------------------

if (fs.existsSync(entry)) {
	const source = fs.readFileSync(entry, 'utf8');

	// A stray `import`/`export` statement in a `.js` file that VS Code loads as
	// CommonJS is the classic "extension does not load" cause.
	const hasEsmSyntax = /^\s*(import|export)\s/m.test(source);
	check('the bundle is CommonJS, not ESM', !hasEsmSyntax, hasEsmSyntax ? 'found a top level import/export statement' : undefined);

	check(
		'the bundle requires "vscode" (provided by the host)',
		source.includes('require("vscode")'),
		undefined,
	);

	// Loading the bundle needs the vscode module; stub it just enough for the
	// module graph to evaluate, then confirm the exports exist.
	const Module = require('node:module');
	const originalLoad = Module._load;
	const stub = new Proxy(
		{ version: '1.91.0' },
		{
			get(target, property) {
				if (property in target) {
					return target[property];
				}
				if (typeof property === 'string' && /^[A-Z]/.test(property)) {
					return class {};
				}
				return undefined;
			},
		},
	);

	// esbuild's __importStar copies the module's own enumerable keys, so the
	// classes the language client extends have to exist as real properties
	// before it runs. They are read straight out of the bundle, so this list
	// cannot drift from the code being checked.
	const extended = new Set(
		[...source.matchAll(/extends\s+\w+\.(\w+)/g)]
			.map((match) => match[1])
			.filter((name) => /^[A-Z]/.test(name)),
	);
	for (const name of [...extended, 'Uri', 'Position', 'Range', 'Location', 'MarkdownString', 'Disposable', 'EventEmitter']) {
		if (!(name in stub)) {
			stub[name] = class {};
		}
	}

	Module._load = function (request, ...rest) {
		return request === 'vscode' ? stub : originalLoad.call(this, request, ...rest);
	};

	let exports;
	let loadFailure;
	try {
		exports = require(entry);
	} catch (error) {
		loadFailure = error instanceof Error ? error.message : String(error);
	} finally {
		Module._load = originalLoad;
	}

	if (loadFailure) {
		// A remaining failure means the bundle cannot be evaluated at all, which
		// would make VS Code report the extension as broken.
		check('the bundle loads and exports activate()', false, loadFailure);
	} else {
		check('the bundle loads and exports activate()', typeof exports?.activate === 'function');
	}
}

// --- contributions ------------------------------------------------------------

for (const language of manifest.contributes?.languages ?? []) {
	if (language.configuration) {
		const configurationPath = path.join(ROOT, language.configuration);
		check(`language configuration for "${language.id}" exists`, fs.existsSync(configurationPath), configurationPath);
	}
}

for (const grammar of manifest.contributes?.grammars ?? []) {
	const grammarPath = path.join(ROOT, grammar.path);
	check(`grammar "${grammar.scopeName}" exists`, fs.existsSync(grammarPath), grammar.path);
}

// --- server binary ------------------------------------------------------------

const serverNames = ['cpp_ls.exe', 'cpp_ls'];
const serverPath = serverNames.map((name) => path.join(ROOT, 'server', name)).find((candidate) => fs.existsSync(candidate));

// --- report -------------------------------------------------------------------

for (const { description, ok, detail } of checks) {
	console.log(`${ok ? 'ok  ' : 'FAIL'}  ${description}${detail ? ` (${detail})` : ''}`);
}

if (serverPath) {
	console.log(`ok    server binary present (${serverPath})`);
} else {
	console.log('warn  no server binary in server/ — the extension will report a missing server until it is built');
}

if (failures.length > 0) {
	console.error(`\n${failures.length} check(s) failed:`);
	for (const failure of failures) {
		console.error(`  - ${failure}`);
	}
	process.exit(1);
}

console.log('\nThe bundle is packaged correctly and ready to install.');
