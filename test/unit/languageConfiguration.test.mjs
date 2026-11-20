// Language-configuration tests.
//
// The editor applies `onEnterRules` from `language-configuration.json` when Enter is pressed: a rule fires when
// `beforeText` matches the line's text before the cursor, `afterText` (when present) matches the text after it, and
// `previousLineText` (when present) matches the line above. These tests evaluate the rules the same way, so the
// behaviours an editor user notices are checked without starting an editor.
//
// The one that mattered: a `///` line continued *at the end of the line* — where the text after the cursor is empty —
// did not continue, because the rule also required `afterText` to be non-empty.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The configuration as JSON, with its comments removed.
 *
 * VS Code reads `language-configuration.json` with its own JSONC scanner, so comments are allowed in the file — and it
 * has some, because a rule's *why* is the part worth recording. `JSON.parse` does not, and the file's own values contain
 * `//` (`"lineComment": "//"`), so the removal has to know what a string is.
 */
function readJsonc(file) {
	const text = fs.readFileSync(file, 'utf8');
	let out = '';
	let inString = false;
	let escaped = false;
	for (let at = 0; at < text.length; at += 1) {
		const character = text[at];
		if (inString) {
			out += character;
			if (escaped) {
				escaped = false;
			} else if (character === '\\') {
				escaped = true;
			} else if (character === '"') {
				inString = false;
			}
			continue;
		}
		if (character === '"') {
			inString = true;
			out += character;
			continue;
		}
		if (character === '/' && text[at + 1] === '/') {
			while (at < text.length && text[at] !== '\n') {
				at += 1;
			}
			out += '\n';
			continue;
		}
		if (character === '/' && text[at + 1] === '*') {
			at += 2;
			while (at < text.length && !(text[at] === '*' && text[at + 1] === '/')) {
				at += 1;
			}
			at += 1;
			continue;
		}
		out += character;
	}
	return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const CONFIGURATION = readJsonc(path.join(ROOT, 'language-configuration.json'));

// The three language ids `package.json` points at this file.
const LANGUAGES = ['c', 'cpp', 'cuda-cpp'];

/**
 * The first `onEnterRules` entry that fires for a cursor at `character` of `line`, the way the editor tries them: in
 * order, first match wins.
 */
function ruleFor(line, character, previousLine = '') {
	const before = line.slice(0, character);
	const after = line.slice(character);
	return (CONFIGURATION.onEnterRules ?? []).find((rule) => {
		const matches = (pattern, text) => (pattern === undefined ? true : new RegExp(pattern).test(text));
		return matches(rule.beforeText, before) && matches(rule.afterText, after) && matches(rule.previousLineText, previousLine);
	});
}

/** What the editor would put on the new line: the indentation of the line above, then `appendText`. */
function continuedLine(line, character) {
	const rule = ruleFor(line, character);
	if (!rule) {
		return undefined;
	}
	const indent = /^\s*/.exec(line)[0];
	return `${indent}${rule.action?.appendText ?? ''}`;
}

test('package.json points all three languages at this configuration', () => {
	const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
	const configured = (manifest.contributes?.languages ?? [])
		.filter((language) => LANGUAGES.includes(language.id))
		.map((language) => language.configuration);
	assert.deepEqual(
		configured,
		LANGUAGES.map(() => './language-configuration.json'),
		'c, cpp and cuda-cpp all read the configuration tested here',
	);
});

test('a /// line continues with /// at the end of the line', () => {
	// The reported defect: type `/// Doc`, press Enter, get `/// ` on the next line — the cursor is at the line's end,
	// so the text after it is empty, and a rule that required `afterText` to match something never fired.
	assert.equal(continuedLine('/// Doc', '/// Doc'.length), '/// ');
	assert.equal(continuedLine('\t/// Doc', '\t/// Doc'.length), '\t/// ');
	assert.equal(continuedLine('    ///', '    ///'.length), '    /// ');
});

test('a //! line continues with //! at the end of the line', () => {
	assert.equal(continuedLine('//! Doc', '//! Doc'.length), '//! ');
	assert.equal(continuedLine('\t//! Doc', '\t//! Doc'.length), '\t//! ');
});

test('a trailing ///< documentation line keeps its marker', () => {
	assert.equal(continuedLine('int count; ///< how many', 'int count; ///< how many'.length), '///< ');
});

test('an ordinary comment line is not a documentation continuation', () => {
	// `// note` must stay an ordinary comment: no documentation marker is appended, so the new line is whatever the
	// editor's own indentation gives (`undefined` here means "no rule of ours fired").
	assert.equal(continuedLine('// note', '// note'.length) ?? '', '');
	assert.equal(continuedLine('int x = 1;', 'int x = 1;'.length) ?? '', '');
});

test('a /** block continues with " * " and closes on */', () => {
	// The block rule is the one that already worked (`/** */` — the cursor sits before ` */`), and it fires only when
	// the closing `*/` is after the cursor on the same line.
	const line = '/** */';
	const rule = ruleFor(line, 3);
	assert.ok(rule, 'the block rule fires inside `/** */`');
	assert.equal(rule.action.appendText, ' * ');
	assert.equal(rule.action.indent, 'indentOutdent');
});
