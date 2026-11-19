// Unit tests for the inactive-region model: the two decisions that do not need an editor.
//
// Run with `npm run test:unit` (which compiles `src/` to `out/` first). The module is deliberately free of
// `vscode`, so the version guard and the malformed-range filter can be tested in a plain Node.js process.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const model = require('../../out/inactiveRegionsModel.js');

const { INACTIVE_REGIONS_METHOD, describes_the_text, drawable_ranges, clears } = model;

/** A notification for `version`, with the given ranges. */
function notification(version, regions) {
	return { textDocument: { uri: 'file:///a.cpp', version }, regions };
}

const ONE_RANGE = [
	{ start: { line: 3, character: 0 }, end: { line: 6, character: 0 } },
];

test('the method is the one the server sends', () => {
	assert.equal(INACTIVE_REGIONS_METHOD, 'textDocument/inactiveRegions');
});

test('a notification for the current text is applied', () => {
	assert.equal(describes_the_text(notification(4, ONE_RANGE), 4), true);
});

test('a notification for older text is dropped', () => {
	// The edit that made the document version 5 landed after the server answered about 4; painting it would put the
	// grey on the wrong lines until the next cook.
	assert.equal(describes_the_text(notification(4, ONE_RANGE), 5), false);
});

test('a notification without a version is applied, because no claim is not a stale claim', () => {
	assert.equal(describes_the_text(notification(undefined, ONE_RANGE), 9), true);
	assert.equal(describes_the_text(notification(4, ONE_RANGE), undefined), true);
});

test('a well-formed range is drawable', () => {
	assert.deepEqual(drawable_ranges(notification(1, ONE_RANGE)), ONE_RANGE);
});

test('a malformed range is dropped rather than drawn at zero', () => {
	const ranges = [
		...ONE_RANGE,
		{ start: { line: -1, character: 0 }, end: { line: 2, character: 0 } },
		{ start: { line: 2, character: 0 }, end: { line: 1, character: 0 } },
		{ start: { line: 1.5, character: 0 }, end: { line: 2, character: 0 } },
		{},
		null,
	];
	assert.deepEqual(drawable_ranges(notification(1, ranges)), ONE_RANGE);
});

test('an empty list clears, which is how a document stops being grey', () => {
	assert.equal(clears(notification(1, [])), true);
	// And a list of nothing drawable is the same answer: there is nothing to paint.
	assert.equal(clears(notification(1, [{ start: null, end: null }])), true);
	assert.equal(clears(notification(1, ONE_RANGE)), false);
});

test('a missing regions array is treated as nothing to draw', () => {
	assert.deepEqual(drawable_ranges({ textDocument: { uri: 'file:///a.cpp' } }), []);
});
