// TextMate grammar tests.
//
// The grammars are forked from VS Code's built-in C/C++/CUDA grammars and
// patched here, so the patches are tokenised for real rather than inspected as
// JSON. `vscode-textmate` + `vscode-oniguruma` are the same tokenizer VS Code
// uses, which is why they are devDependencies.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GRAMMAR_FILES = new Map([
	['source.c', 'syntaxes/c.tmLanguage.json'],
	['source.cpp', 'syntaxes/cpp.tmLanguage.json'],
	['source.cpp.embedded.macro', 'syntaxes/cpp.embedded.macro.tmLanguage.json'],
	['source.cuda-cpp', 'syntaxes/cuda-cpp.tmLanguage.json'],
]);

const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));

const registry = new vsctm.Registry({
	onigLib: Promise.resolve({
		createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
		createOnigString: (value) => new oniguruma.OnigString(value),
	}),
	loadGrammar: async (scopeName) => {
		const relative = GRAMMAR_FILES.get(scopeName);
		if (!relative) {
			return null;
		}
		const file = path.join(ROOT, relative);
		return vsctm.parseRawGrammar(fs.readFileSync(file, 'utf8'), file);
	},
});

/** Scopes of the token that contains `text` on `line`. */
async function tokenScopes(scope, line, text) {
	const grammar = await registry.loadGrammar(scope);
	assert.ok(grammar, `${scope} loads`);
	const { tokens } = grammar.tokenizeLine(line, vsctm.INITIAL);
	const token = tokens.find((candidate) => line.slice(candidate.startIndex, candidate.endIndex).includes(text));
	assert.ok(token, `"${text}" is tokenised in ${scope}`);
	return token.scopes;
}

function hasScope(scopes, expected) {
	return scopes.some((scope) => scope === expected || scope.startsWith(`${expected}.`));
}

test('the forked grammars keep their upstream scope names', async () => {
	for (const [scope, relative] of GRAMMAR_FILES) {
		const raw = vsctm.parseRawGrammar(fs.readFileSync(path.join(ROOT, relative), 'utf8'), relative);
		assert.equal(raw.scopeName, scope, `${relative} keeps its scope name`);
		assert.ok(Array.isArray(raw.patterns) && raw.patterns.length > 0, `${relative} has patterns`);
	}
});

test('CUDA kernel launches are scoped as a launch block', async () => {
	const begin = await tokenScopes('source.cuda-cpp', 'kernel<<<grid, block>>>(args);', '<<<');
	assert.ok(hasScope(begin, 'meta.launch.cuda-cpp'), String(begin));
	assert.ok(hasScope(begin, 'punctuation.section.launch.begin'), String(begin));

	const end = await tokenScopes('source.cuda-cpp', 'kernel<<<grid, block>>>(args);', '>>>');
	assert.ok(hasScope(end, 'punctuation.section.launch.end'), String(end));
});

test('CUDA launch attributes are storage modifiers', async () => {
	const scopes = await tokenScopes('source.cuda-cpp', '__launch_bounds__(256) void kernel();', '__launch_bounds__');
	assert.ok(hasScope(scopes, 'storage.modifier.launch-bounds.cuda-cpp'), String(scopes));
});

test('CUDA execution space qualifiers keep their upstream scopes', async () => {
	const scopes = await tokenScopes('source.cuda-cpp', '__global__ void kernel();', '__global__');
	assert.ok(hasScope(scopes, 'storage.modifier'), String(scopes));
});

test('C attributes are scoped', async () => {
	const gnu = await tokenScopes('source.c', '__attribute__((unused)) int value;', '__attribute__');
	assert.ok(hasScope(gnu, 'storage.modifier.attribute.c'), String(gnu));

	const msvc = await tokenScopes('source.c', '__declspec(dllexport) int value;', '__declspec');
	assert.ok(hasScope(msvc, 'storage.modifier.declspec.c'), String(msvc));
});

test('#embed is a preprocessor directive in C, C++ and CUDA', async () => {
	for (const [scope, line] of [
		['source.c', '#embed "blob.bin"'],
		['source.cpp', '#embed <blob.bin>'],
		['source.cuda-cpp', '#embed "blob.bin"'],
	]) {
		const scopes = await tokenScopes(scope, line, 'embed');
		assert.ok(hasScope(scopes, 'keyword.control.directive.embed'), `${scope}: ${scopes}`);
	}
});

test('#elifdef is a conditional directive in C and CUDA', async () => {
	for (const scope of ['source.c', 'source.cuda-cpp']) {
		const scopes = await tokenScopes(scope, '#elifdef FOO', 'elifdef');
		assert.ok(hasScope(scopes, 'keyword.control.directive.conditional'), `${scope}: ${scopes}`);
	}
});

test('the inherited baseline still scopes ordinary C++', async () => {
	const keyword = await tokenScopes('source.cpp', 'constexpr int value = 1;', 'constexpr');
	assert.ok(hasScope(keyword, 'storage.modifier'), String(keyword));

	const type = await tokenScopes('source.cpp', 'class Widget final : public Base {};', 'class');
	assert.ok(hasScope(type, 'storage.type'), String(type));
});
