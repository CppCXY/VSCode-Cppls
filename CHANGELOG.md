# Change Log

All notable changes to the "cppls" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

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
