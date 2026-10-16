/**
 * VS Code specific refinement of the server's semantic tokens.
 *
 * ## Why the client touches this at all
 *
 * Semantic tokens do not *add* colour, they **override** it: a token sent for a range replaces whatever the
 * TextMate grammar would have drawn there. That is the right trade for a name whose meaning only an analysis
 * knows — `size` is a field, `Widget` is a class — and the wrong one for a range whose meaning TextMate already
 * knows better. The server cannot tell the two apart, because "better" is a property of *this* editor, this
 * grammar and this theme. So the client refines.
 *
 * ## The two mechanisms, and which question each answers
 *
 * * **`semanticTokenScopes`** (`package.json`) — "draw this server's `decorator` as `keyword.other.documentation`".
 *   This is how a Doxygen command gets a colour of its own, and it is the reason a command is its own token type
 *   on the server rather than being folded into `keyword`. **No code is involved**, and it is the part that fixes
 *   a type drawn as something it is not.
 * * **this module** — anything that needs the document, the language, or a decision only an editor can make.
 *
 * ## What the client may not do
 *
 * The legend belongs to the server: a token's type is a number indexing the list the server advertised in
 * `initialize`. A client that invents a number sends one the server's list does not have. So this module only ever
 * **reuses** a type the legend already holds, and a remap naming something absent is refused rather than applied.
 *
 * ## What this module does not do
 *
 * It does not re-implement the server. A command's extent, whether a comment is documentation, and which names are
 * declared are decisions the analysis already made — see `crates/cpp_ls/src/handlers/semantic_token`, whose Doxygen
 * pass exists for exactly that reason. A second implementation here would be a second answer, and the first time
 * the two disagreed the user would see it as flicker.
 */

/**
 * The document surface this module needs.
 *
 * Narrowed to one method rather than taking `vscode.TextDocument`, so the refinement is a **pure function** and can
 * be tested in a plain Node.js process — which is how the rest of this extension's logic is tested.
 */
export interface RefinableDocument {
	languageId: string;
	/** The document's text, or a slice of it. */
	getText(range?: unknown): string;
}

/** A tool's own name for a token type, by legend index. */
export type LegendNames = ReadonlyArray<string | undefined>;

/**
 * How one of the server's types should be drawn instead.
 *
 * The value is a **type already in the legend** — see this module's note on not inventing numbers. `null` means
 * "send nothing for these", which hands the range back to the TextMate grammar.
 */
export type TypeRemap = Readonly<Record<string, string | null>>;

/**
 * **The server's legend, in the order it advertises** — `TypeKind::ALL` in
 * `crates/cpp_ls/src/handlers/semantic_token/builder.rs`, and the two must not drift.
 *
 * Held here because the language client does not expose the server's `initialize` result to a middleware in a form
 * that can be read before the first answer, and a refinement cannot wait for one. The risk of drift is real and
 * bounded: a wrong name only means a remap matches nothing, so the token keeps the server's own type — a colour
 * that is merely unrefined, never a wrong one. `verifyLegend` is the check that turns that into a report.
 */
export const SERVER_LEGEND: LegendNames = [
	'namespace',
	'type',
	'class',
	'enum',
	'typeParameter',
	'parameter',
	'variable',
	'property',
	'enumMember',
	'function',
	'method',
	'macro',
	'keyword',
	'modifier',
	'operator',
	'decorator',
];

/**
 * **The refinement the VS Code extension applies.**
 *
 * Empty, and that is the honest state of it rather than an oversight: the corrections this extension needs are
 * *scope* corrections, and those belong in `semanticTokenScopes` where no code is involved and a theme author can
 * see them. A table is kept because the next correction may not be one — anything needing the document's text or
 * its language has to be applied here — and because an entry is a judgement about an editor, which is easier to
 * revisit written down in one place with its reason beside it.
 */
export const VSCODE_REMAP: TypeRemap = {};

/** A token, decoded: absolute positions in the document. */
export interface DecodedToken {
	line: number;
	/** 0-based, counted in **UTF-16 code units**. */
	character: number;
	/** In UTF-16 code units. */
	length: number;
	/** The index into the server's legend. */
	tokenType: number;
	modifiers: number;
}

/**
 * **The protocol's delta walk, undone.**
 *
 * The server sends five numbers per token of which the first two are relative — to the previous token on the same
 * line, and to the line's start on a new one — so a refinement that wants to reason about a token must rebuild
 * absolute positions first. Doing that once here, rather than inside each rule, is what lets a rule be written
 * against positions instead of arithmetic.
 */
export function decodeSemanticTokens(data: readonly number[]): DecodedToken[] {
	const tokens: DecodedToken[] = [];
	let line = 0;
	let character = 0;

	for (let at = 0; at + 4 < data.length; at += 5) {
		const deltaLine = data[at];
		const deltaStart = data[at + 1];

		if (deltaLine === 0) {
			character += deltaStart;
		} else {
			line += deltaLine;
			character = deltaStart;
		}

		tokens.push({
			line,
			character,
			length: data[at + 2],
			tokenType: data[at + 3],
			modifiers: data[at + 4],
		});
	}

	return tokens;
}

/**
 * **Back into the walk**, which is the half that must not go wrong: a client rebuilds absolute positions from these
 * deltas alone, so one token out of order shifts *every token after it*.
 *
 * The input is sorted by position and reduced to one token per start offset — the same two invariants the server's
 * own builder enforces (`builder.rs`), re-established here because a refinement is free to produce tokens the
 * server did not.
 */
export function encodeSemanticTokens(tokens: readonly DecodedToken[]): number[] {
	const ordered = [...tokens].sort((left, right) => left.line - right.line || left.character - right.character);

	const data: number[] = [];
	let line = 0;
	let character = 0;
	let previous: DecodedToken | undefined;

	for (const token of ordered) {
		if (token.length === 0) {
			continue;
		}

		// **One token per start offset**, because two tokens beginning together is an overlap by construction. The
		// first wins, which is the rule the server's builder uses and for the same reason.
		if (previous && previous.line === token.line && previous.character === token.character) {
			continue;
		}

		const deltaLine = token.line - line;
		const deltaStart = deltaLine === 0 ? token.character - character : token.character;
		data.push(deltaLine, deltaStart, token.length, token.tokenType, token.modifiers);

		line = token.line;
		character = token.character;
		previous = token;
	}

	return data;
}

/**
 * **The refinement**: the server's token stream, with the client's own corrections applied.
 *
 * A pure function of the legend, the data and the language, so it is testable without an editor and the extension's
 * only job is to hand it what VS Code gave it.
 */
export function refineSemanticTokens(
	data: readonly number[],
	legend: LegendNames = SERVER_LEGEND,
	remap: TypeRemap = VSCODE_REMAP,
): number[] {
	if (data.length === 0 || Object.keys(remap).length === 0) {
		return [...data];
	}

	const refined = decodeSemanticTokens(data).map((token) => {
		const name = legend[token.tokenType];
		if (name === undefined) {
			return token;
		}

		const replacement = remap[name];
		if (replacement === undefined) {
			return token;
		}
		if (replacement === null) {
			// Dropped: a zero length is how this module says "send nothing", and the encoder filters those.
			return { ...token, length: 0 };
		}

		const replacementType = legend.indexOf(replacement);
		if (replacementType < 0) {
			// The target is not in this server's legend, so its number would mean nothing at the other end. Leaving
			// the token alone is the honest failure: the range keeps the colour the server gave it.
			return token;
		}

		return { ...token, tokenType: replacementType };
	});

	return encodeSemanticTokens(refined);
}

/**
 * **Does the legend this module assumes match the one a server actually sent?**
 *
 * The answer is a report rather than a correction, because there is nothing safe to correct *to*: the names are
 * only used to look up a remap, and a name that does not match means the remap does not apply. So a mismatch costs
 * an unrefined colour and never a wrong one — and this exists so that cost is visible in the log rather than
 * discovered as "the colours look a bit off".
 */
export function verifyLegend(advertised: readonly string[]): string | undefined {
	if (advertised.length !== SERVER_LEGEND.length) {
		return `the server advertises ${advertised.length} token type(s) and this client knows ${SERVER_LEGEND.length}`;
	}
	for (let at = 0; at < advertised.length; at++) {
		if (advertised[at] !== SERVER_LEGEND[at]) {
			return `token type ${at} is \`${advertised[at]}\` and this client calls it \`${SERVER_LEGEND[at]}\``;
		}
	}
	return undefined;
}
