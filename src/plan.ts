/**
 * The "launch plan" describes how the client will reach the language server.
 *
 * This module is intentionally free of `vscode` imports: the plan types and
 * their pure rendering helpers are used by the client, by the status bar and by
 * the unit tests.
 */

import type { ResolvedServer, ServerSource } from './serverPath';

/** A TCP language server that is already running. */
export interface TcpPlan {
	kind: 'tcp';
	host: string;
	port: number;
}

/** A server process this extension spawns itself. */
export interface SpawnPlan {
	kind: 'spawn';
	server: ResolvedServer;
	args: string[];
}
/** The concrete way the language server will be reached. */
export type LaunchPlan = TcpPlan | SpawnPlan;

/** Renders a launch plan as a single line, e.g. for the output channel. */
export function describePlan(plan: LaunchPlan): string {
	if (plan.kind === 'tcp') {
		return `tcp://${plan.host}:${plan.port} (development mode)`;
	}
	const args = plan.args.length > 0 ? ` ${plan.args.join(' ')}` : '';
	return `${plan.server.command}${args} [${sourceLabel(plan.server.source)}]`;
}

/** Short label for the status bar. */
export function statusBarText(plan: LaunchPlan | undefined, running: boolean): string {
	if (!plan) {
		return running ? '$(sync~spin) cppls' : '$(circle-slash) cppls';
	}
	return plan.kind === 'tcp'
		? `$(radio-tower) cppls :${plan.port}`
		: '$(server-process) cppls';
}

/** Multi line summary used by the `cppls.showServerInfo` command. */
export function describePlanDetails(
	plan: LaunchPlan | undefined,
	running: boolean,
	fallback: { searched: string[] },
): string {
	if (!plan) {
		return ['Transport : (not connected)', '', 'Looked for the server at:', ...fallback.searched.map((p) => `  ${p}`)].join(
			'\n',
		);
	}

	if (plan.kind === 'tcp') {
		return [
			'Transport : TCP (development mode)',
			`Endpoint  : ${plan.host}:${plan.port}`,
			`State     : ${running ? 'connected' : 'not connected'}`,
		].join('\n');
	}

	return [
		'Transport : stdio (spawned process)',
		`Executable: ${plan.server.command}`,
		`Origin    : ${sourceLabel(plan.server.source)}`,
		`Arguments : ${plan.args.length > 0 ? plan.args.join(' ') : '(none)'}`,
		`State     : ${running ? 'running' : 'not running'}`,
	].join('\n');
}

/** Human readable origin of a resolved server executable. */
export function sourceLabel(source: ServerSource): string {
	switch (source) {
		case 'setting':
			return 'cppls.server.path setting';
		case 'env':
			return 'CPPLS_SERVER_PATH environment variable';
		default:
			return 'bundled server/cpp_ls';
	}
}
