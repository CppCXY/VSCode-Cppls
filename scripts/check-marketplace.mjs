#!/usr/bin/env node
/**
 * **Did every platform actually reach the Marketplace?**
 *
 * Publishing a platform-specific extension is one upload per target, and the Marketplace merges them into a single
 * listing whose "Works with" list is whatever arrived. A loop that publishes six of seven, or a person who uploads the
 * first `.vsix` from the release by hand, produces a listing that looks finished and installs on exactly one platform —
 * measured: `0.1.1` went up as `alpine-x64` alone, and the page said so while the other six packages sat in the
 * release.
 *
 * This asks the public gallery what it has for the version in `package.json` and compares that with [`PACKAGED`], the
 * set CI is supposed to publish. It retries, because a new version is not queryable the second it is uploaded:
 *
 *     node scripts/check-marketplace.mjs
 *     node scripts/check-marketplace.mjs --version 0.1.2 --attempts 10 --delay 20000
 *
 * A target that is missing is an error; an **unreachable** gallery is a warning, because "no answer" is not "nothing
 * published" and failing the job for it would be wrong.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PACKAGED } from './targets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GALLERY = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';

/** The manifest is the source of what was published: the job that calls this has just published that version. */
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const options = { version: manifest.version, attempts: 8, delay: 15_000 };
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
			case '--version':
				options.version = value();
				break;
			case '--attempts':
				options.attempts = Number(value());
				break;
			case '--delay':
				options.delay = Number(value());
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

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * The `targetPlatform` of every version record the gallery has for this extension.
 *
 * Returns `undefined` when the gallery could not be asked at all — a network or HTTP failure, as opposed to an answer
 * that lacks the targets.
 */
async function published_targets() {
	const body = {
		filters: [
			{
				criteria: [{ filterType: 7, value: `${manifest.publisher}.${manifest.name}` }],
				pageNumber: 1,
				pageSize: 1,
			},
		],
		assetTypes: [],
		// IncludeVersions | IncludeVersionProperties | IncludeInstallationTargets — the flags the gallery needs to send
		// `versions[]` with a `targetPlatform` on each record.
		flags: 0x1 | 0x10 | 0x40,
	};

	const response = await fetch(GALLERY, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json;api-version=7.2-preview.1',
		},
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		throw new Error(`the gallery answered ${response.status} ${response.statusText}`);
	}

	const answer = await response.json();
	const extension = answer?.results?.[0]?.extensions?.[0];
	if (!extension) {
		// Not an error: a version published seconds ago may not be indexed yet.
		return [];
	}
	return (extension.versions ?? []).map((version) => ({
		version: version.version,
		target: version.targetPlatform,
	}));
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log('usage: node scripts/check-marketplace.mjs [--version <version>] [--attempts <n>] [--delay <ms>]');
		return;
	}

	const expected = new Set(PACKAGED);
	let missing = [...expected];
	let answered = false;

	for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
		let records;
		try {
			records = await published_targets();
			answered = true;
		} catch (error) {
			console.warn(`attempt ${attempt}/${options.attempts}: ${error.message}`);
			records = undefined;
		}

		if (records) {
			const published = new Set(
				records.filter((record) => record.version === options.version).map((record) => record.target),
			);
			missing = [...expected].filter((target) => !published.has(target));
			if (missing.length === 0) {
				console.log(
					`${manifest.publisher}.${manifest.name} ${options.version}: all ${expected.size} platform(s) are ` +
						`published (${[...expected].join(', ')})`,
				);
				return;
			}
			console.log(`attempt ${attempt}/${options.attempts}: waiting for ${missing.join(', ')}`);
		}

		if (attempt < options.attempts) {
			await sleep(options.delay);
		}
	}

	// **An answer that lacks a target is a failure; no answer at all is not.** The second case is a network problem in
	// the job, and failing the release for it would send someone looking for a packaging bug that does not exist.
	if (!answered) {
		console.warn(`could not reach the Marketplace gallery; ${options.version} was not verified`);
		return;
	}

	console.error(
		`\nerror: ${manifest.publisher}.${manifest.name} ${options.version} is missing ${missing.length} platform(s) ` +
			`on the Marketplace:\n  ${missing.join('\n  ')}`,
	);
	console.error(
		'\nA platform-specific extension is published once per target. Publish the missing packages:\n  ' +
			missing.map((target) => `npx vsce publish --packagePath cppls-${target}.vsix`).join('\n  '),
	);
	process.exit(1);
}

main().catch((error) => {
	console.error(`error: ${error.message}`);
	process.exit(1);
});
