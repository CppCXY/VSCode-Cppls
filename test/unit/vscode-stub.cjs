// A stand-in for the "vscode" module used by unit tests outside the extension
// host. Only the API surface that `src/settings.ts` touches is implemented.
//
// `test/unit/core.test.mjs` resolves the request "vscode" to this file through
// `module.registerHooks`, which lets the compiled extension modules be loaded
// in a plain Node.js process.

const state = {
	values: {},
	/** Values a `.vscode/settings.json` would contribute, i.e. the workspace scope. */
	workspaceValues: {},
	trusted: true,
	lastSection: undefined,
	lastScope: undefined,
};

function read(section, fallback) {
	if (Object.hasOwn(state.workspaceValues, section) && state.workspaceValues[section] !== undefined) {
		return state.workspaceValues[section];
	}
	const value = state.values[section];
	return value === undefined ? fallback : value;
}

module.exports = {
	workspace: {
		get isTrusted() {
			return state.trusted;
		},

		getConfiguration(section, scope) {
			state.lastSection = section;
			state.lastScope = scope ?? null;
			return {
				get: read,
				inspect(key) {
					return {
						key,
						defaultValue: undefined,
						globalValue: state.values[key],
						workspaceValue: state.workspaceValues[key],
						workspaceFolderValue: undefined,
					};
				},
			};
		},
	},

	/** Test helpers (not part of the real VS Code API). */
	__setValues(values) {
		state.values = values;
		state.workspaceValues = {};
	},

	__setWorkspaceValues(values) {
		state.workspaceValues = values;
	},

	__setTrusted(trusted) {
		state.trusted = trusted;
	},

	__getCalls() {
		return { section: state.lastSection, scope: state.lastScope };
	},
};
