// Reading the extension's own JSONC files.
//
// `language-configuration.json` is read by VS Code with its JSONC scanner, so it may carry comments — and it does,
// because each rule's *why* is the part worth recording. `JSON.parse` does not accept them, and the file's values
// contain `//` themselves (`"lineComment": "//"`), so removing comments has to know what a string is.

import fs from 'node:fs';

/** `JSON.parse` for a file that may carry `//` and `/* *\/` comments and trailing commas. */
export function readJsonc(file) {
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
