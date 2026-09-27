// A stand-in for the "vscode" module used by unit tests outside the extension
// host. Only the API surface that `src/settings.ts` touches is implemented.
//
// `test/unit/core.test.mjs` resolves the request "vscode" to this file through
// `module.registerHooks`, which lets the compiled extension modules be loaded
// in a plain Node.js process.

const state = {
	values: {},
	lastSection: undefined,
	lastScope: undefined,
};

module.exports = {
	workspace: {
		getConfiguration(section, scope) {
			state.lastSection = section;
			state.lastScope = scope ?? null;
			return {
				get(key, fallback) {
					const value = state.values[key];
					return value === undefined ? fallback : value;
				},
			};
		},
	},

	/** Test helpers (not part of the real VS Code API). */
	__setValues(values) {
		state.values = values;
	},

	__getCalls() {
		return { section: state.lastSection, scope: state.lastScope };
	},
};
