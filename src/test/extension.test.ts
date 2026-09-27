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
	const EXTENSION_ID = 'cppls.cppls';

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

	test('claims C and C++ documents', async () => {
		const engine = vscode.extensions.getExtension(EXTENSION_ID);
		const languages = engine?.packageJSON?.contributes?.languages ?? [];
		const ids = languages.map((language: { id: string }) => language.id).sort();
		assert.deepStrictEqual(ids, ['c', 'cpp']);
	});

	test('the dev server port check command runs without throwing', async () => {
		await vscode.commands.executeCommand('cppls.checkDevServer');
	});
});
