# Change Log

All notable changes to the "cppls" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

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
