// Unit tests for the pure (vscode free) parts of the cppls extension.
//
// They run against the TypeScript output in `out/`, so `npm run test:unit`
// compiles first. Run with: npm run test:unit

import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The extension sources are CommonJS, so load the compiled output with require.
//
// `out/settings.js` imports "vscode", which only exists inside the extension
// host. A resolution hook maps that request onto a stub so the setting
// precedence can still be tested in a plain Node.js process.
const require = createRequire(import.meta.url);
const vscodeStubPath = fileURLToPath(new URL('./vscode-stub.cjs', import.meta.url));

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'vscode') {
			return { url: pathToFileURL(vscodeStubPath).href, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
});

const config = require('../../out/config.js');
const connection = require('../../out/connection.js');
const plan = require('../../out/plan.js');
const serverPath = require('../../out/serverPath.js');
const settings = require('../../out/settings.js');
const vscodeStub = require(vscodeStubPath);

const EXTENSION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Environment without any CPPLS_* variables. */
function cleanEnv(extra = {}) {
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (key.startsWith('CPPLS_')) {
			delete env[key];
		}
	}
	return { ...env, ...extra };
}

/** Starts a throwaway TCP listener and resolves with its port. */
function listenOnEphemeralPort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
	});
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

test('DEFAULT_DEV_PORT is 5009 as required by the CPPLS_DEV contract', () => {
	assert.equal(config.DEFAULT_DEV_PORT, 5009);
	assert.equal(config.ENV_DEV, 'CPPLS_DEV');
});

test('isDevModeEnabled honours common truthy and falsy spellings', () => {
	for (const value of ['1', 'true', 'TRUE', 'yes', 'on', 'anything', '']) {
		assert.equal(config.isDevModeEnabled({ CPPLS_DEV: value }), true, `CPPLS_DEV=${value} should enable dev mode`);
	}
	for (const value of ['0', 'false', 'FALSE', 'off', 'no', '  Off  ']) {
		assert.equal(config.isDevModeEnabled({ CPPLS_DEV: value }), false, `CPPLS_DEV=${value} should disable dev mode`);
	}
	assert.equal(config.isDevModeEnabled({}), false, 'an unset CPPLS_DEV disables dev mode');
});

test('parsePort accepts only usable TCP ports', () => {
	assert.equal(config.parsePort(5009), 5009);
	assert.equal(config.parsePort('5009'), 5009);
	assert.equal(config.parsePort(' 1234 '), 1234);
	for (const bad of [0, -1, 65536, 1.5, 'abc', '', null, undefined, NaN, {}]) {
		assert.equal(config.parsePort(bad), undefined, `parsePort(${String(bad)}) should be undefined`);
	}
});

test('resolveDevPort prefers the setting, then CPPLS_DEV_PORT, then 5009', () => {
	assert.equal(config.resolveDevPort(7000, cleanEnv({ CPPLS_DEV_PORT: '6000' })), 7000);
	assert.equal(config.resolveDevPort(undefined, cleanEnv({ CPPLS_DEV_PORT: '6000' })), 6000);
	assert.equal(config.resolveDevPort(undefined, cleanEnv()), 5009);
	// A broken setting falls through to the environment variable.
	assert.equal(config.resolveDevPort('nope', cleanEnv({ CPPLS_DEV_PORT: '6000' })), 6000);
});

// ---------------------------------------------------------------------------
// settings (against the vscode stub)
// ---------------------------------------------------------------------------

test('readServerConfig applies the documented defaults', () => {
	vscodeStub.__setValues({});
	const config = settings.readServerConfig();
	assert.equal(config.launchMode, 'auto');
	assert.equal(config.serverPath, undefined);
	assert.deepEqual(config.serverArgs, []);
	assert.equal(config.devPort, 5009);
	assert.equal(config.connectTimeoutMs, 5000);
	assert.equal(config.traceServer, 'off');
	assert.equal(config.revealOutputChannelOnActivate, false);
	assert.deepEqual(vscodeStub.__getCalls(), { section: 'cppls', scope: null });
	assert.deepEqual(config.documentSelector.filter((f) => f.language === 'cpp'), [
		{ scheme: 'file', language: 'cpp' },
		{ scheme: 'untitled', language: 'cpp' },
	]);
});

test('readServerConfig honours configured values', () => {
	vscodeStub.__setValues({
		'server.launchMode': 'tcp',
		'server.path': '  /opt/cppls/bin/cpp_ls  ',
		'server.args': ['--log=debug'],
		'server.port': 7000,
		'server.connectTimeout': 250,
		'trace.server': 'verbose',
		'revealOutputChannelOnActivate': true,
	});
	const config = settings.readServerConfig();
	assert.equal(config.launchMode, 'tcp');
	assert.equal(config.serverPath, '/opt/cppls/bin/cpp_ls', 'the path should be trimmed');
	assert.deepEqual(config.serverArgs, ['--log=debug']);
	assert.equal(config.devPort, 7000);
	assert.equal(config.connectTimeoutMs, 250);
	assert.equal(config.traceServer, 'verbose');
	assert.equal(config.revealOutputChannelOnActivate, true);
});

test('readServerConfig falls back to safe values for nonsense settings', () => {
	vscodeStub.__setValues({
		'server.launchMode': 'sideways',
		'server.path': '   ',
		'server.port': 99999,
		'server.connectTimeout': 10,
		'trace.server': 'shout',
	});
	const config = settings.readServerConfig();
	assert.equal(config.launchMode, 'auto');
	assert.equal(config.serverPath, undefined, 'a blank path means "use the default lookup"');
	assert.equal(config.devPort, 5009, 'an out of range port falls back to the default');
	assert.equal(config.connectTimeoutMs, 200, 'the timeout has a 200ms floor');
	assert.equal(config.traceServer, 'off');
});

test('describeServerConfig summarises the active mode', () => {
	const config = {
		launchMode: 'auto',
		serverPath: undefined,
		serverArgs: [],
		devPort: 5009,
		connectTimeoutMs: 5000,
		documentSelector: [],
		traceServer: 'off',
		revealOutputChannelOnActivate: false,
	};
	assert.equal(settings.describeServerConfig(config, cleanEnv()), 'mode=auto');
	assert.equal(
		settings.describeServerConfig({ ...config, serverPath: 'C:/x/cpp_ls' }, cleanEnv({ CPPLS_DEV: '1' })),
		'mode=auto, CPPLS_DEV=1, port=5009, path=C:/x/cpp_ls',
	);
});

// ---------------------------------------------------------------------------
// serverPath
// ---------------------------------------------------------------------------

/**
 * Creates a throwaway extension root laid out like a distribution:
 *
 *   <dir>/server/cpp_ls[.exe]     (only when `withBundledServer`)
 *
 * `server/cpp_ls` is not committed to this repository (the C++ server is built
 * separately), so the lookup logic is exercised against these fixtures.
 */
function makeExtensionRoot({ withBundledServer = false } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cppls-fixture-'));
	if (withBundledServer) {
		const target = path.join(root, 'server', serverPath.serverExecutableName());
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, '');
	}
	return root;
}

test('serverExecutableName adds .exe only on Windows', () => {
	assert.equal(serverPath.serverExecutableName('win32'), 'cpp_ls.exe');
	assert.equal(serverPath.serverExecutableName('linux'), 'cpp_ls');
	assert.equal(serverPath.serverExecutableName('darwin'), 'cpp_ls');
});

test('resolveServer finds the bundled binary', () => {
	const root = makeExtensionRoot({ withBundledServer: true });
	const resolved = serverPath.resolveServer(root, undefined, cleanEnv());
	assert.ok(resolved);
	assert.equal(resolved.source, 'bundled');
	assert.equal(resolved.command, path.join(root, 'server', serverPath.serverExecutableName()));
});

test('resolveServer returns undefined when the binary has not been built', () => {
	const root = makeExtensionRoot();
	assert.equal(serverPath.resolveServer(root, undefined, cleanEnv()), undefined);
});

test('a binary in server/ is found, and its absence is reported clearly', () => {
	// The repository may or may not have `server/cpp_ls` built; either way the
	// lookup must agree with what is on disk.
	const bundledPath = path.join(EXTENSION_ROOT, 'server', serverPath.serverExecutableName());
	const resolved = serverPath.resolveServer(EXTENSION_ROOT, undefined, cleanEnv());

	if (fs.existsSync(bundledPath)) {
		assert.ok(resolved, 'a binary on disk must resolve');
		assert.equal(resolved.source, 'bundled');
		assert.equal(resolved.command, bundledPath);
	} else {
		assert.equal(resolved, undefined, 'no binary and no configuration means nothing to run');
		assert.ok(
			serverPath.serverSearchPaths(EXTENSION_ROOT).includes(bundledPath),
			'the missing binary must still be listed in the search paths for the error message',
		);
	}
});

test('an explicit setting wins over the bundled binary', () => {
	const root = makeExtensionRoot({ withBundledServer: true });
	const configured = path.join(root, 'custom_ls');
	fs.writeFileSync(configured, '');
	const resolved = serverPath.resolveServer(root, configured, cleanEnv());
	assert.ok(resolved);
	assert.equal(resolved.source, 'setting');
	assert.equal(resolved.command, configured);
});

test('a relative setting path is resolved against the extension root', () => {
	const root = makeExtensionRoot({ withBundledServer: true });
	const resolved = serverPath.resolveServer(root, path.join('server', 'cpp_ls'), cleanEnv());
	assert.ok(resolved, 'a relative path must resolve like an absolute one');
	assert.equal(resolved.source, 'setting');
	assert.equal(resolved.command, path.join(root, 'server', serverPath.serverExecutableName()));
});

test('CPPLS_SERVER_PATH is used when no setting is configured', () => {
	const root = makeExtensionRoot({ withBundledServer: true });
	const configured = path.join(root, 'custom-cpp_ls');
	fs.writeFileSync(configured, '');
	const resolved = serverPath.resolveServer(root, undefined, cleanEnv({ CPPLS_SERVER_PATH: configured }));
	assert.ok(resolved);
	assert.equal(resolved.source, 'env');
	assert.equal(resolved.command, configured);
});

test('a non existing configured path falls through to the bundled binary', () => {
	const root = makeExtensionRoot({ withBundledServer: true });
	const resolved = serverPath.resolveServer(root, path.join(root, 'nope', 'cpp_ls'), cleanEnv());
	assert.ok(resolved);
	assert.equal(resolved.source, 'bundled');
});

test('serverSearchPaths documents the lookup order without duplicates', () => {
	const bundled = path.join(EXTENSION_ROOT, 'server', serverPath.serverExecutableName());
	const paths = serverPath.serverSearchPaths(
		EXTENSION_ROOT,
		'custom/cpp_ls',
		cleanEnv({ CPPLS_SERVER_PATH: 'other/cpp_ls' }),
	);
	assert.deepEqual(paths.slice(0, 2), [
		path.join(EXTENSION_ROOT, 'custom', 'cpp_ls'),
		path.join(EXTENSION_ROOT, 'other', 'cpp_ls'),
	]);
	assert.ok(paths.includes(bundled), 'the bundled binary must always be listed');
	assert.equal(new Set(paths).size, paths.length, 'no path should be listed twice');
});

test('an unset CPPLS_SERVER_PATH does not add a lookup path', () => {
	const paths = serverPath.serverSearchPaths(EXTENSION_ROOT, undefined, cleanEnv({ CPPLS_SERVER_PATH: '' }));
	const expected = [path.join(EXTENSION_ROOT, 'server', serverPath.serverExecutableName())];
	// Windows additionally tries the extension-less name for convenience.
	if (process.platform === 'win32') {
		expected.push(path.join(EXTENSION_ROOT, 'server', 'cpp_ls'));
	}
	assert.deepEqual(paths, expected);
});

// ---------------------------------------------------------------------------
// connection
// ---------------------------------------------------------------------------

test('probeTcpPort reports a listening port as reachable', async () => {
	const { server, port } = await listenOnEphemeralPort();
	try {
		const result = await connection.probeTcpPort(port, { timeoutMs: 1000 });
		assert.deepEqual(result, { reachable: true });
	} finally {
		server.close();
	}
});

test('probeTcpPort reports a closed port as unreachable with a reason', async () => {
	// Bind and immediately release a port so it is almost certainly free.
	const { server, port } = await listenOnEphemeralPort();
	await new Promise((resolve) => server.close(resolve));

	const result = await connection.probeTcpPort(port, { timeoutMs: 300, retryDelayMs: 50 });
	assert.equal(result.reachable, false);
	assert.equal(typeof result.reason, 'string');
	assert.ok(result.reason.length > 0);
});

test('connectTcp yields a duplex socket that can carry bytes both ways', async () => {
	const { server, port } = await listenOnEphemeralPort();
	server.on('connection', (socket) => socket.pipe(socket)); // echo
	try {
		const connectionInfo = await connection.connectTcp(port, '127.0.0.1', 1000);
		const echoed = await new Promise((resolve, reject) => {
			connectionInfo.socket.once('data', (chunk) => resolve(chunk.toString('utf8')));
			connectionInfo.socket.once('error', reject);
			connectionInfo.writer.write('ping');
		});
		assert.equal(echoed, 'ping');
		connectionInfo.socket.destroy();
	} finally {
		server.close();
	}
});

test('connectTcp surfaces a refused connection instead of hanging', async () => {
	const { server, port } = await listenOnEphemeralPort();
	await new Promise((resolve) => server.close(resolve));
	await assert.rejects(() => connection.connectTcp(port, '127.0.0.1', 1000));
});

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

const tcpPlan = { kind: 'tcp', host: '127.0.0.1', port: 5009 };
const spawnPlan = {
	kind: 'spawn',
	server: { command: 'C:/ext/server/cpp_ls.exe', source: 'bundled' },
	args: [],
};

test('describePlan renders both transports', () => {
	assert.equal(plan.describePlan(tcpPlan), 'tcp://127.0.0.1:5009 (development mode)');
	assert.equal(plan.describePlan(spawnPlan), 'C:/ext/server/cpp_ls.exe [bundled server/cpp_ls]');
	assert.equal(
		plan.describePlan({ ...spawnPlan, args: ['--log=debug'] }),
		'C:/ext/server/cpp_ls.exe --log=debug [bundled server/cpp_ls]',
	);
});

test('statusBarText shows the port for TCP and an icon for a spawned server', () => {
	assert.equal(plan.statusBarText(tcpPlan, true), '$(radio-tower) cppls :5009');
	assert.equal(plan.statusBarText(spawnPlan, true), '$(server-process) cppls');
	assert.equal(plan.statusBarText(undefined, false), '$(circle-slash) cppls');
	assert.equal(plan.statusBarText(undefined, true), '$(sync~spin) cppls');
});

test('describePlanDetails lists the search paths when no server was resolved', () => {
	const text = plan.describePlanDetails(undefined, false, { searched: ['a/cpp_ls', 'b/cpp_ls'] });
	assert.match(text, /not connected/);
	assert.match(text, /a\/cpp_ls/);
	assert.match(text, /b\/cpp_ls/);
});

test('describePlanDetails reports the endpoint of a TCP connection', () => {
	const text = plan.describePlanDetails(tcpPlan, true, { searched: [] });
	assert.match(text, /TCP \(development mode\)/);
	assert.match(text, /127\.0\.0\.1:5009/);
	assert.match(text, /connected/);
});
