//! **The manifest's semantic-token contributions, checked against the shape VS Code documents.**
//!
//! Written because the first attempt put `semanticTokenScopes` at the **top level** of `package.json`, where VS Code
//! ignores it silently: the server's `formatSpecifier` tokens arrived (the scope inspector named the type), the
//! editor had no scope to style them with, and the text kept its string colour. Nothing failed, nothing warned.
//!
//! The shape is checked against the documented contribution points and against rust-analyzer's own manifest, which
//! declares its custom types and maps `formatSpecifier` to `punctuation.section.embedded.rust`:
//!
//! ```text
//! contributes.semanticTokenTypes   [{ id, description }]
//! contributes.semanticTokenScopes  [{ language, scopes: { <tokenType>: [<scope>] } }]
//! ```

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const problems = [];
const note = (message) => problems.push(message);

const tokenTypes = ['formatSpecifier', 'formatArgument', 'formatConversion', 'formatEscape'];
const languages = ['c', 'cpp', 'cuda-cpp'];

// **The top-level key is the mistake this script exists for.** VS Code reads the contribution point only under
// `contributes`, and a top-level copy is not an error to anyone: JSON is valid, `vsce package` succeeds.
if ('semanticTokenScopes' in manifest || 'semanticTokenTypes' in manifest) {
    note('semanticTokenScopes/semanticTokenTypes must not sit at the top level: they are contribution points read from `contributes`');
}

const contributes = manifest.contributes ?? {};
const declared = new Set((contributes.semanticTokenTypes ?? []).map((type) => type.id));
for (const type of tokenTypes) {
    if (!declared.has(type)) note(`contributes.semanticTokenTypes does not declare \`${type}\``);
}
for (const type of contributes.semanticTokenTypes ?? []) {
    if (typeof type.id !== 'string' || type.id.length === 0) note('a semanticTokenTypes entry has no id');
}

const scopes = contributes.semanticTokenScopes ?? [];
if (scopes.length === 0) note('contributes.semanticTokenScopes is empty: the custom types would have no theme scope');
for (const language of languages) {
    const entry = scopes.find((candidate) => candidate.language === language);
    if (!entry) {
        note(`contributes.semanticTokenScopes has no entry for \`${language}\``);
        continue;
    }
    for (const type of tokenTypes) {
        const mapped = entry.scopes?.[type];
        if (!Array.isArray(mapped) || mapped.length === 0) {
            note(`\`${language}\` maps no scope for \`${type}\``);
            continue;
        }
        for (const scope of mapped) {
            // A scope is a dot-separated name; a bare word still matches by prefix, but a typo usually shows as an
            // empty part (`constant..other`) or a space, so the shape is what is checked.
            if (typeof scope !== 'string' || scope.length === 0 || scope.includes(' ')) {
                note(`\`${language}\`/\`${type}\` has a malformed scope: ${JSON.stringify(scope)}`);
            }
        }
    }
}

// The grammars must still be contributed for the languages the server serves — a manifest that lost them would take
// the syntax colouring with it, which is the other half of what a reader sees.
const grammarLanguages = new Set((contributes.grammars ?? []).map((grammar) => grammar.language));
for (const language of languages) {
    if (!grammarLanguages.has(language)) note(`contributes.grammars has no grammar for \`${language}\``);
}

if (problems.length > 0) {
    for (const problem of problems) console.error(`problem ${problem}`);
    process.exit(1);
}
console.log(`ok    ${tokenTypes.length} custom types declared, ${languages.length} languages mapped, ${grammarLanguages.size} grammars`);