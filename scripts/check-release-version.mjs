#!/usr/bin/env node
/**
 * **The tag and the manifest have to agree**, before anything is packaged.
 *
 * `vsce publish` refuses a version that does not match the tag, but by then the
 * `.vsix` files are built and the GitHub release exists. This runs first on a
 * tag and stops the build with a message naming both numbers.
 *
 *     node scripts/check-release-version.mjs             # tag from GITHUB_REF_NAME
 *     node scripts/check-release-version.mjs --tag v0.1.2
 *
 * A leading `v` is tolerated on both sides, but the repository tags releases `0.1.2`
 * — the version itself, with no prefix — and that is what the comparison expects.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(1);
}

function main() {
	const argv = process.argv.slice(2);
	const index = argv.indexOf('--tag');
	const tag = index >= 0 ? argv[index + 1] : process.env.GITHUB_REF_NAME;

	if (!tag) {
		fail('no tag: pass --tag <tag> or set GITHUB_REF_NAME (this runs on a tag in CI)');
	}

	const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
	const strip = (value) => value.replace(/^v/, '');

	if (strip(tag) !== version) {
		fail(
			`the tag is ${tag} but package.json says ${version} — ` +
				'run `node scripts/prepare-release.mjs <version>`, commit that, and tag again',
		);
	}

	console.log(`tag ${tag} matches package.json ${version}`);
}

main();
