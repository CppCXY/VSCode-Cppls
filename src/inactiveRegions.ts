/**
 * Greying out the code this configuration does not compile.
 *
 * The server pushes clangd's `textDocument/inactiveRegions` — ranges of the file's own text, with the version they
 * describe. This module is the editor half and nothing more: turn the ranges into a decoration, apply it to every
 * visible editor of that document, and keep it honest.
 *
 * ```text
 * a notification arrives  ──▶  the ranges are kept per document URI  ──▶  every visible editor of it is decorated
 * an empty list           ──▶  the entry is forgotten                ──▶  the decorations are cleared
 * the server restarts     ──▶  everything is forgotten                ──▶  nothing stale survives a restart
 * ```
 *
 * The last line is the one a user notices: a notification is not an edit, so after `cppls.restartServer` nothing on
 * the client side knows the old ranges describe text the new server never read (`vscode-clangd#600`).
 */

import * as vscode from 'vscode';

import {
	INACTIVE_REGIONS_METHOD,
	InactiveRegionsParams,
	LspRange,
	describes_the_text,
	drawable_ranges,
} from './inactiveRegionsModel';

export { INACTIVE_REGIONS_METHOD };
export type { InactiveRegionsParams, LspRange };

/**
 * The decoration: the text at a lower opacity, no background.
 *
 * Opacity rather than a colour, because a colour is the theme's decision: the same grey that reads as "dead" on a
 * light theme disappears on a light one, and a fixed background fights every theme's selection colour. Lowering the
 * opacity composes with the semantic token colour underneath, so dead code still shows the shape of the code it was.
 */
export function createInactiveDecoration(): vscode.TextEditorDecorationType {
	return vscode.window.createTextEditorDecorationType({
		opacity: '0.55',
		// A notification replaces the ranges after every cook, so the decoration does not have to survive edits; this
		// is the behaviour that keeps a range from jumping to the next line while the text above it is typing.
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
	});
}

/** The decoration manager: one per extension, fed by the client's notification handler. */
export class InactiveRegions implements vscode.Disposable {
	private readonly decoration = createInactiveDecoration();
	private readonly byUri = new Map<string, LspRange[]>();

	/**
	 * Handle one notification.
	 *
	 * The version guard runs per editor, because a document can be visible in two editors with different versions
	 * only during a split — and the cost of asking is nothing.
	 */
	public handle(params: InactiveRegionsParams): void {
		const uri = params.textDocument?.uri;
		if (typeof uri !== 'string' || uri.length === 0) {
			return;
		}
		const ranges = drawable_ranges(params);
		if (ranges.length === 0) {
			this.byUri.delete(uri);
		} else {
			this.byUri.set(uri, ranges);
		}
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.toString() !== uri) {
				continue;
			}
			if (!describes_the_text(params, editor.document.version)) {
				continue;
			}
			editor.setDecorations(this.decoration, ranges.map(toRange));
		}
	}

	/** The document is closed: its decorations go with it, whether or not the server said so first. */
	public clear(uri: string): void {
		if (!this.byUri.delete(uri)) {
			return;
		}
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.toString() === uri) {
				editor.setDecorations(this.decoration, []);
			}
		}
	}

	/**
	 * Everything is forgotten — a restart, a stop, a configuration change that re-negotiates the capability.
	 *
	 * A restart is the case that matters: the new server has said nothing yet, so every range in the map describes
	 * text it has not read.
	 */
	public clearAll(): void {
		this.byUri.clear();
		for (const editor of vscode.window.visibleTextEditors) {
			editor.setDecorations(this.decoration, []);
		}
	}

	/**
	 * Decorate the editors that are visible now.
	 *
	 * Called when an editor becomes visible: decorations belong to an editor, so a document opened after its
	 * notification arrived would otherwise draw plain until the server cooked it again.
	 */
	public apply(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			const ranges = this.byUri.get(editor.document.uri.toString());
			if (ranges) {
				editor.setDecorations(this.decoration, ranges.map(toRange));
			}
		}
	}

	public dispose(): void {
		this.byUri.clear();
		this.decoration.dispose();
	}
}

/** One protocol range as VS Code draws it. */
function toRange(range: LspRange): vscode.Range {
	return new vscode.Range(
		new vscode.Position(range.start.line, range.start.character),
		new vscode.Position(range.end.line, range.end.character),
	);
}
