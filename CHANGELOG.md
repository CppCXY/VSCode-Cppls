# Change Log

All notable changes to the "cppls" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Language

- The extension now ships its own TextMate grammars for `c`, `cpp` and
  `cuda-cpp`: forks of VS Code's MIT-licensed grammars, patched here. The
  patches cover CUDA `kernel<<<...>>>` launch blocks,
  `__launch_bounds__`/`__grid_constant__`/`__cluster_dims__`, C
  `__attribute__`/`__declspec`, and C23 `#embed`/`#elifdef`/`#elifndef`.
- `language-configuration.json` is our own: `#pragma region` / `#region`
  folding, Doxygen and block-comment continuation, preprocessor lines that do
  not inherit indentation, and colorized bracket pairs.
- Headers (`.h`) are C++ again: the extension no longer claims `.h` for C, and
  the language contributions mirror VS Code's file associations.
- `test:unit` tokenises the patched grammars with `vscode-textmate` and
  `vscode-oniguruma` (the tokenizer VS Code itself uses), so a patch that does
  not produce the expected scope fails the suite.

### Fixed

- Opening a `.cu`/`.cuh` document activates the extension again. VS Code derives
  `onLanguage:` events only from the languages an extension *contributes* (`c`,
  `cpp` here); `cuda-cpp` is contributed by VS Code's built-in cpp extension, so
  the client's document selector was never reached. `activationEvents` names both
  CUDA ids explicitly now.
- A `cppls.server.path` supplied by an untrusted workspace is ignored, which is
  what the `untrustedWorkspaces` capability already promised: the bundled server
  is used instead.
- The extension-host suite looked the extension up as `cppls.cppls`; the real id
  is `CppCXY.cppls`, so every assertion in it failed. The suite also covers CUDA
  activation now, and fails when the activation event is removed again.
- Deactivation waits for the language client to stop, so the server receives
  `shutdown`/`exit` instead of being killed with the extension host.

### Packaging

- `npm run vsix` builds the extension and produces `cppls.vsix`
  (`npm run install:local` also installs it), so the packaged artefact can never
  go stale again.
- `engines.vscode` is `^1.138.0`, matching the newest published
  `@types/vscode`. `vsce` refuses to package when the types are newer than the
  declared engine, which silently prevented any `.vsix` from being produced.
- The language client packages moved to `devDependencies`: `dist/extension.js`
  is a self-contained esbuild bundle, so declaring runtime dependencies that are
  absent from the VSIX was misleading.
- `.vscodeignore` now excludes the `.cppls/**` index summaries, logs and
  development tooling; the VSIX holds only the manifest, the bundle, the
  language configuration, the docs and `server/cpp_ls`.
- MIT `LICENSE` added.
- An extension icon (`icon.png`): a single vermilion `C` on near-black. The C is
  the standard core C, C++ and CUDA share; no dialect mark and no `++` decoration.
  Included in the VSIX.
- `npm run verify:bundle` checks the packaged entry point exists, is CommonJS,
  requires `vscode` from the host and actually loads and exports `activate()`.

### Added

- Language client for C and C++ documents, based on `vscode-languageclient` 10.
- Two transports, selected at connect time:
  - spawn `server/cpp_ls` (`.exe` on Windows) and speak LSP over stdio;
  - connect to `127.0.0.1:5009` over TCP when the `CPPLS_DEV` environment
    variable is set, with an automatic fallback to a spawned server when nothing
    is listening.
- Settings: `cppls.server.path`, `cppls.server.launchMode`, `cppls.server.port`,
  `cppls.server.connectTimeout`, `cppls.server.args`, `cppls.trace.server`,
  `cppls.revealOutputChannelOnActivate`.
- Environment variables: `CPPLS_DEV`, `CPPLS_DEV_PORT`, `CPPLS_SERVER_PATH`.
- Commands: restart, stop, show logs, show server info, check development port.
- Status bar indicator showing the active transport and port.
- Log output channel and a separate LSP trace channel.
- Language contribution for `c` and `cpp` (file extensions and language
  configuration for comments, brackets and indentation).
- Build pipeline: `tsc` for type checking and tests, `esbuild` for the shipped
  bundle.
- Tests: `node:test` unit tests, plus extension host tests that register the
  commands and complete a real LSP handshake over TCP against a miniature peer.
- `npm run verify:server` / `scripts/verify-server.mjs`: drives the real
  `server/cpp_ls` over stdio and TCP and reports contract violations, with exit
  code 2 when no binary is present so CI can skip.

### Removed

- The client-side semantic-token integration: the legend check
  (`src/semanticLegend.ts`, `verifyServerLegend`) and the
  `contributes.semanticTokenScopes` mappings. Semantic tokens are the server's
  answer and the editor's styling; the client no longer inspects or overrides
  them.

### Notes on the server contract

Verified against `cpp_ls 0.1.0`:

- `cpp_ls` with no arguments speaks LSP over stdio and completes the handshake,
  `shutdown` and `exit` cleanly.
- `cpp_ls -c tcp --port <n>` listens on TCP and completes the handshake.
- The server's own default port is 5007 while the extension defaults to 5009, so
  `--port 5009` (or a matching setting) is required.
- TCP mode serves a single client and exits when it disconnects; the extension
  probes the port before connecting, so a persistent listener would make the
  development workflow smoother.
- `textDocument/definition` currently answers `null`, and no diagnostics are
  published for a file with a missing include.
