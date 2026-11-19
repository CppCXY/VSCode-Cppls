/**
 * The parts of `textDocument/inactiveRegions` that are pure — no `vscode`, so they can be tested in a plain Node
 * process against the compiled output (`npm run test:unit`).
 *
 * The notification is clangd's extension, and the shape is the one the server sends:
 *
 * ```text
 * textDocument/inactiveRegions
 *   { textDocument: { uri, version? }, regions: Range[] }
 * ```
 *
 * `version` is optional in the protocol — clangd's own `OptionalVersionedTextDocumentIdentifier` — and it is the
 * half this module exists for: a notification that describes older text must be dropped, or an edit that landed in
 * between paints a region of the wrong lines (`sourcekit-lsp#2222` is the report that made the field worth having).
 */

/** One end of a range, in the protocol's line/character units. */
export interface LspPosition {
	line: number;
	character: number;
}

/** One LSP range. */
export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

/** The params of the notification, as far as this client reads them. */
export interface InactiveRegionsParams {
	textDocument: { uri: string; version?: number };
	regions: LspRange[];
}

/** The method, in one place: the server's constant and the client's listener cannot drift apart. */
export const INACTIVE_REGIONS_METHOD = 'textDocument/inactiveRegions';

/** Is this notification about the text the client currently has? */
export function describes_the_text(
	params: InactiveRegionsParams,
	documentVersion: number | undefined,
): boolean {
	const described = params.textDocument?.version;
	// **No version is "no claim", not "stale".** Older servers did not send one, and dropping those would turn a
	// missing field into a missing feature.
	if (described === undefined || documentVersion === undefined) {
		return true;
	}
	return described >= documentVersion;
}

/**
 * The ranges, with the ones a client cannot draw dropped.
 *
 * A malformed range is a defect on the server's side; drawing it at line 0 would put a grey band over the top of the
 * file, which reads as a wrong answer rather than as a missing one.
 */
export function drawable_ranges(params: InactiveRegionsParams): LspRange[] {
	const regions = params.regions;
	if (!Array.isArray(regions)) {
		return [];
	}
	return regions.filter((range) => {
		if (!range || !range.start || !range.end) {
			return false;
		}
		const numbers = [range.start.line, range.start.character, range.end.line, range.end.character];
		if (!numbers.every((value) => Number.isInteger(value) && value >= 0)) {
			return false;
		}
		// An end before its start is a range the editor cannot represent.
		return (
			range.end.line > range.start.line ||
			(range.end.line === range.start.line && range.end.character >= range.start.character)
		);
	});
}

/** Did the server answer "nothing here is inactive" (which is also how it clears a document)? */
export function clears(params: InactiveRegionsParams): boolean {
	return drawable_ranges(params).length === 0;
}
