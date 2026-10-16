/**
 * The server's semantic token legend, checked rather than rewritten.
 *
 * # Why this file is only a check
 *
 * It used to hold a `provideDocumentSemanticTokens` middleware — a pass that decoded the server's tokens, applied
 * `VSCODE_REMAP`, and encoded them again. **It is gone, and `VSCODE_REMAP` was empty the whole time it existed**,
 * so every keystroke paid for a full decode/encode cycle over the whole file to change nothing. The one correction
 * that was ever actually needed — `modifier` being `storage.modifier` in one grammar and `storage.type` in another
 * — is a *scope* mapping, and VS Code has a contribution point for exactly that: `semanticTokenScopes` in
 * `package.json`. It is applied by the editor, inside the code that draws the token anyway, and costs this
 * extension nothing.
 *
 * **So the rule is: a colour that is wrong is fixed in `contributes.semanticTokenScopes`, never in TypeScript.**
 * That contribution maps a token *type* to a TextMate scope without changing its number, which is why the legend
 * below and the scope keys in `package.json` have to agree — and why the check that they do is the only thing left
 * worth paying for at runtime.
 *
 * # What the check is for
 *
 * A legend is positional: token type 13 is whatever the server put thirteenth, and nothing in the protocol says
 * what it means. If the server renumbers its types and this list is not updated, the scopes in `package.json` stop
 * applying — a `modifier` pointed at by number 13's scope would be drawn with the wrong one — and the symptom is
 * "the colours look a bit off", which is not traceable to anything. So the mismatch is reported once per
 * connection.
 *
 * It is a checklist, not a source of truth: the server's `builder.rs` (`TypeKind::ALL`) is what the numbers mean,
 * and this is a copy of it that fails loudly when the copy goes stale.
 */
export const SERVER_LEGEND: readonly string[] = [
	'namespace',
	'type',
	'typeParameter',
	'enum',
	'enumMember',
	'class',
	'function',
	'method',
	'property',
	'variable',
	'parameter',
	'macro',
	'keyword',
	'operator',
	'modifier',
	'decorator',
];

/**
 * **Does the legend this extension assumes match the one a server actually sent?**
 *
 * `undefined` when they agree, which is the ordinary answer. The mismatch is returned as a sentence rather than
 * thrown: a stale copy costs a scope mapping, and refusing to start over that would cost the whole language server.
 */
export function verifyLegend(advertised: readonly string[]): string | undefined {
	if (advertised.length !== SERVER_LEGEND.length) {
		return `the server advertises ${advertised.length} token type(s) and this extension knows ${SERVER_LEGEND.length}`;
	}
	for (let at = 0; at < advertised.length; at++) {
		if (advertised[at] !== SERVER_LEGEND[at]) {
			return `token type ${at} is \`${advertised[at]}\` and this extension calls it \`${SERVER_LEGEND[at]}\``;
		}
	}
	return undefined;
}
