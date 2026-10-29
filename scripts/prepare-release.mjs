#!/usr/bin/env node
/**
 * **Bumps the extension and the server it ships, for one release.**
 *
 *     node scripts/prepare-release.mjs 0.1.2            # same server as before
 *     node scripts/prepare-release.mjs 0.1.2 0.1.0      # and a different server
 *
 * It writes two values and nothing else:
 *
 *     package.json          `version` — the extension's version
 *     scripts/config.json   `serverVersion` — the cpp_ls release to download
 *
 * **The files are edited as text, not re-serialised.** `JSON.stringify` would
 * rewrite every array in `package.json` (its contribution points are written
 * with short arrays on one line) and turn a one-line release bump into a
 * hundreds-of-lines diff that nobody can review.
 *
 * **It does not commit, tag or publish.** The steps a person runs are printed at
 * the end, and the last of them (`git push --tags`) is what makes CI build the
 * `.vsix` files and attach them to the GitHub release. Uploading to the
 * Marketplace stays a deliberate act — see the README.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const CONFIG_PATH = path.join(ROOT, 'scripts', 'config.json');

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(1);
}

/** `1.2.3`, optionally with a pre-release (`1.2.3-beta.1`); nothing else. */
function isVersion(value) {
	return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

/** Replaces one JSON string value in place and checks the file still parses. */
function replaceValue(text, pattern, value, file) {
	if (!pattern.test(text)) {
		fail(`could not find the value to replace in ${file}`);
	}
	const updated = text.replace(pattern, (_, before, after) => `${before}${value}${after}`);
	JSON.parse(updated);
	return updated;
}

function main() {
	const [, , version, serverVersion] = process.argv;
	if (!version) {
		fail('usage: node scripts/prepare-release.mjs <version> [<server-version>]');
	}
	if (!isVersion(version)) {
		fail(`"${version}" is not a version (expected 0.1.2)`);
	}
	if (serverVersion !== undefined && !isVersion(serverVersion)) {
		fail(`"${serverVersion}" is not a server version (expected 0.1.2)`);
	}

	const packageText = fs.readFileSync(PACKAGE_PATH, 'utf8');
	const previous = JSON.parse(packageText).version;
	// The top-level `version` is the only line indented by two spaces; every other one is nested deeper.
	const updatedPackage = replaceValue(
		packageText,
		/^(\s{2}"version":\s*")[^"]*(")/m,
		version,
		'package.json',
	);
	fs.writeFileSync(PACKAGE_PATH, updatedPackage);

	const configText = fs.readFileSync(CONFIG_PATH, 'utf8');
	const previousServer = JSON.parse(configText).serverVersion;
	if (serverVersion !== undefined) {
		fs.writeFileSync(
			CONFIG_PATH,
			replaceValue(configText, /("serverVersion"\s*:\s*")[^"]*(")/, serverVersion, 'scripts/config.json'),
		);
	}

	console.log(`extension: ${previous} -> ${version}`);
	console.log(
		serverVersion === undefined
			? `server:    ${previousServer} (unchanged)`
			: `server:    ${previousServer} -> ${serverVersion}`,
	);
	console.log(`
Next:

  git add package.json scripts/config.json
  git commit -m "release: ${version}"
  git tag ${version}
  git push origin main --tags

The tag is what makes CI build the per-platform .vsix files and attach them to
the GitHub release (as a draft, which you publish). The Marketplace is a
separate, manual step:

  npx vsce publish --packagePath cppls-<target>.vsix
`);
}

main();
