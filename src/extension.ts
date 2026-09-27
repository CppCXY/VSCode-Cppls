/**
 * Entry point of the cppls VS Code extension.
 *
 * Activation starts a language client for C/C++ documents. Depending on the
 * environment it either spawns the bundled `server/cpp_ls` over stdio or, when
 * the `CPPLS_DEV` environment variable is set, connects to a development server
 * listening on TCP port 5009.
 */

import * as vscode from 'vscode';
import { State } from 'vscode-languageclient/node';

import { CpplsLanguageClient } from './client';
import {
	CONFIG_SECTION,
	ENV_DEV,
	ENV_DEV_PORT,
	ENV_SERVER_PATH,
	isDevModeEnabled,
	readDevEnvValue,
} from './config';
import { probeTcpPort } from './connection';
import { describePlanDetails, statusBarText } from './plan';
import { serverSearchPaths } from './serverPath';
import { readServerConfig, describeServerConfig } from './settings';

let outputChannel: vscode.LogOutputChannel | undefined;
let traceChannel: vscode.LogOutputChannel | undefined;
let client: CpplsLanguageClient | undefined;
let statusBar: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	outputChannel = vscode.window.createOutputChannel('cppls', { log: true });
	traceChannel = vscode.window.createOutputChannel('cppls (LSP trace)', { log: true });
	context.subscriptions.push(outputChannel, traceChannel);

	client = new CpplsLanguageClient(
		context.extensionPath,
		String(context.extension.packageJSON.version ?? '0.0.1'),
		outputChannel,
		traceChannel,
	);
	context.subscriptions.push(client);

	statusBar = vscode.window.createStatusBarItem('cppls.status', vscode.StatusBarAlignment.Right, 100);
	statusBar.name = 'Cpp Language Server';
	statusBar.command = 'cppls.showServerInfo';
	statusBar.show();
	context.subscriptions.push(statusBar);

	registerCommands(context);

	// Keep the status bar and the LSP trace level in sync with the settings.
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration(CONFIG_SECTION)) {
				return;
			}
			updateStatusBar();
			if (event.affectsConfiguration(`${CONFIG_SECTION}.trace.server`)) {
				void client?.applyTrace();
			}
		}),
	);

	logEnvironmentSummary(context);
	updateStatusBar();

	// Fire and forget: activation must not fail because the server is missing.
	void client.start().then(() => {
		// React to later state changes (crashes, restarts, reconnects).
		const languageClient = client?.languageClient;
		if (languageClient) {
			context.subscriptions.push(
				languageClient.onDidChangeState(() => updateStatusBar()),
			);
		}
		updateStatusBar();
	});
}

export function deactivate(): Thenable<void> | undefined {
	// `context.subscriptions` disposes the client, which stops the server.
	return undefined;
}

function registerCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('cppls.restartServer', async () => {
			if (!client) {
				return;
			}
			const ok = await client.restart();
			updateStatusBar();
			void vscode.window.setStatusBarMessage(
				ok ? 'cppls: language server restarted' : 'cppls: language server failed to start',
				5000,
			);
		}),

		vscode.commands.registerCommand('cppls.stopServer', async () => {
			await client?.stop();
			updateStatusBar();
			void vscode.window.showInformationMessage('cppls: language server stopped.');
		}),

		vscode.commands.registerCommand('cppls.showLogs', () => {
			outputChannel?.show(true);
		}),

		vscode.commands.registerCommand('cppls.showServerInfo', async () => {
			const config = readServerConfig();
			const details = describePlanDetails(isRunning() ? client?.currentPlan : undefined, isRunning(), {
				searched: serverSearchPaths(context.extensionPath, config.serverPath),
			});

			const picked = await vscode.window.showInformationMessage(
				details.replace(/\n/g, '  \n'),
				{ modal: true },
				'Show Logs',
				'Restart',
			);
			if (picked === 'Show Logs') {
				outputChannel?.show(true);
			} else if (picked === 'Restart') {
				await vscode.commands.executeCommand('cppls.restartServer');
			}
		}),

		vscode.commands.registerCommand('cppls.checkDevServer', async () => {
			const port = readServerConfig().devPort;
			const probe = await probeTcpPort(port, { timeoutMs: 1000 });
			if (probe.reachable) {
				void vscode.window.showInformationMessage(`cppls: a server is listening on 127.0.0.1:${port}.`);
			} else {
				void vscode.window.showWarningMessage(
					`cppls: nothing is listening on 127.0.0.1:${port} (${probe.reason ?? 'unknown reason'}).`,
				);
			}
		}),
	);
}

function isRunning(): boolean {
	return client?.state === State.Running;
}

function updateStatusBar(): void {
	if (!statusBar || !client) {
		return;
	}
	const running = isRunning();
	const plan = client.currentPlan;
	statusBar.text = statusBarText(plan, running);
	statusBar.tooltip = new vscode.MarkdownString(
		[
			'**Cpp Language Server**',
			'',
			describePlanDetails(plan, running, { searched: [] }).replace(/\n/g, '  \n'),
			'',
			'$(debug-restart) `cppls: Restart Language Server`',
		].join('\n'),
	);
}

function logEnvironmentSummary(context: vscode.ExtensionContext): void {
	const config = readServerConfig();
	const devEnabled = isDevModeEnabled();

	outputChannel?.info('cppls extension activated.');
	outputChannel?.info(
		devEnabled
			? `${ENV_DEV} is set (${readDevEnvValue() || '1'}) - the TCP development server is preferred.`
			: `${ENV_DEV} is not set - the bundled server will be spawned over stdio.`,
	);
	outputChannel?.info(
		`Configuration: launchMode=${config.launchMode}, port=${config.devPort} ` +
			`(${ENV_DEV_PORT} overrides it), connectTimeout=${config.connectTimeoutMs}ms, trace=${config.traceServer}.`,
	);
	outputChannel?.debug(`Resolved: ${describeServerConfig(config)}`);
	outputChannel?.debug(
		`Server lookup order: ${serverSearchPaths(context.extensionPath, config.serverPath).join(' | ')}`,
	);
	if (!config.serverPath && !process.env[ENV_SERVER_PATH]) {
		outputChannel?.debug('No explicit server path configured; falling back to the search order above.');
	}
}
