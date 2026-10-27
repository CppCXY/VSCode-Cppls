import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Integration tests running inside a real extension host.
 *
 * They deliberately avoid depending on which transport was chosen: the
 * extension is expected to activate and register its commands regardless of
 * whether a language server could be started in this environment.
 */
suite('cppls extension', () => {
	// `${publisher}.${name}` from package.json; VS Code matches the id case-insensitively. It was once written as
	// `cppls.cppls`, which silently made every lookup here return `undefined` and every assertion in this suite fail.
	const EXTENSION_ID = 'CppCXY.cppls';

	/**
	 * **The CUDA activation report, as a test.**
	 *
	 * VS Code derives `onLanguage:` activation events from the languages an extension *contributes* (`c` and `cpp`
	 * here), not from the languages its language client claims. `cuda-cpp` is contributed by VS Code's built-in cpp
	 * extension, so before `activationEvents` named it, opening a `.cu` file activated nothing at all: no server, no
	 * status bar, no diagnostics.
	 *
	 * This runs first, before anything below calls `activate()`.
	 */
	test('opening a CUDA document activates the extension', async function () {
		this.timeout(20000);

		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `${EXTENSION_ID} should be installed in the extension host`);

		// The manifest is the part that regressed, so state it even when a restored editor already activated us.
		const activationEvents: string[] = extension.packageJSON?.activationEvents ?? [];
		assert.ok(
			activationEvents.includes('onLanguage:cuda-cpp'),
			`the manifest must name cuda-cpp: ${JSON.stringify(activationEvents)}`,
		);

		if (extension.isActive) {
			return;
		}

		await vscode.workspace.openTextDocument({
			language: 'cuda-cpp',
			content: '__global__ void kernel() {}\n',
		});

		const deadline = Date.now() + 10000;
		while (!extension.isActive && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		assert.strictEqual(extension.isActive, true, 'opening a .cu document must activate the extension');
	});

	test('is discoverable and activates', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `${EXTENSION_ID} should be installed in the extension host`);

		await extension.activate();
		assert.strictEqual(extension.isActive, true);
	});

	test('registers its commands', async () => {
		const commands = await vscode.commands.getCommands(true);
		for (const command of [
			'cppls.restartServer',
			'cppls.stopServer',
			'cppls.showLogs',
			'cppls.showServerInfo',
			'cppls.checkDevServer',
		]) {
			assert.ok(commands.includes(command), `${command} should be registered`);
		}
	});

	test('contributes the cppls settings', () => {
		const configuration = vscode.workspace.getConfiguration('cppls');
		assert.strictEqual(configuration.get('server.launchMode'), 'auto');
		assert.strictEqual(configuration.get('server.port'), 5009);
		assert.strictEqual(configuration.get('trace.server'), 'off');
	});

	test('claims C, C++ and CUDA documents, with headers as C++', async () => {
		const engine = vscode.extensions.getExtension(EXTENSION_ID);
		const languages: { id: string; extensions?: string[]; configuration?: string }[] =
			engine?.packageJSON?.contributes?.languages ?? [];
		const ids = languages.map((language) => language.id).sort();
		assert.deepStrictEqual(ids, ['c', 'cpp', 'cuda-cpp']);

		const c = languages.find((language) => language.id === 'c');
		const cpp = languages.find((language) => language.id === 'cpp');
		assert.ok(c && cpp);
		assert.ok(!c.extensions?.includes('.h'), 'headers must not be claimed by C');
		assert.ok(cpp.extensions?.includes('.h'), 'headers are C++');
		for (const language of languages) {
			assert.strictEqual(language.configuration, './language-configuration.json');
		}
	});

	test('the dev server port check command runs without throwing', async () => {
		await vscode.commands.executeCommand('cppls.checkDevServer');
	});

	test('uses our language configuration for block-comment continuation', async function () {
		this.timeout(20000);

		// VS Code's built-in configuration only continues `//` comments. Ours
		// continues a block comment with ` * `, so this proves the contribution
		// is the one the editor actually applied.
		const document = await vscode.workspace.openTextDocument({ language: 'cpp', content: '/** */' });
		const editor = await vscode.window.showTextDocument(document);
		editor.selection = new vscode.Selection(0, 3, 0, 3);
		await vscode.commands.executeCommand('type', { text: '\n' });
		await new Promise((resolve) => setTimeout(resolve, 100));

		const lines = editor.document.getText().split(/\r?\n/);
		assert.ok(
			lines.some((line) => line.trimStart().startsWith('* ')),
			`expected a continued block comment, got: ${JSON.stringify(lines)}`,
		);
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});
});
