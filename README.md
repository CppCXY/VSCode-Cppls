# cppls — C/C++ language support for VS Code

A VS Code extension that runs a **C++ language server** over the Language Server
Protocol (LSP). The extension is complete and transport agnostic; the server
binary plugs in at `server/cpp_ls`.

> **Status:** the client side is finished and tested. The C++ language server
> itself is a separate binary that is not built yet — see
> [`server/README.md`](server/README.md) for the contract it has to fulfil.

## How the server is reached

The extension supports two transports and picks between them at connect time, so
you can keep the extension host running while you restart the server by hand.

| Mode | When it is used | How it talks |
| --- | --- | --- |
| **bundled** | Default, and always when `CPPLS_DEV` is not set | Spawns `server/cpp_ls` (`.exe` on Windows) and speaks LSP over **stdio** |
| **tcp (development)** | `CPPLS_DEV` is set **and** something is listening on port 5009 | Connects to `127.0.0.1:5009` over **TCP** |

The choice is made by `cppls.server.launchMode`:

* `auto` (default) — use TCP while `CPPLS_DEV` is set and the port answers;
  otherwise spawn a local server. A forgotten `CPPLS_DEV` therefore never breaks
  a normal editing session: the client logs a warning and falls back to stdio.
* `tcp` — always use TCP. Use this when you want a hard failure instead of a
  silent fallback.
* `bundled` — always spawn the executable, even with `CPPLS_DEV` set.

```text
CPPLS_DEV=1  ─┬─►  probe 127.0.0.1:5009 ──► open ──► connect over TCP
              └─►  no listener ─────────► spawn server/cpp_ls over stdio

CPPLS_DEV unset ────────────────────────► spawn server/cpp_ls over stdio
```

## Environment variables

| Variable | Meaning |
| --- | --- |
| `CPPLS_DEV` | Any value except `0`, `false`, `off`, `no` enables development (TCP) mode. |
| `CPPLS_DEV_PORT` | Overrides the development TCP port (default `5009`). |
| `CPPLS_SERVER_PATH` | Absolute or extension relative path to the server executable. |

`CPPLS_DEV` is read from the environment of the **extension host**, which is the
process VS Code was started from — not from a shell inside the integrated
terminal.

## Commands

| Command | What it does |
| --- | --- |
| `cppls: Restart Language Server` | Stops and starts the client. Use it after restarting your development server. |
| `cppls: Stop Language Server` | Stops the client without restarting it. |
| `cppls: Show Server Info` | Shows the active transport, the executable or endpoint, and every path that was searched. |
| `cppls: Show Logs` | Opens the `cppls` output channel. |
| `cppls: Check Development Server Port` | Probes the configured TCP port and reports whether a server answers. |

The status bar shows the active mode: `$(radio-tower) cppls :5009` for TCP,
`$(server-process) cppls` for a spawned server.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `cppls.server.path` | `""` | Path to the `cpp_ls` executable. Relative paths resolve against the extension root. |
| `cppls.server.launchMode` | `auto` | `auto`, `tcp` or `bundled`. |
| `cppls.server.port` | `5009` | Development TCP port. |
| `cppls.server.connectTimeout` | `5000` | Milliseconds to wait for the TCP port before falling back. |
| `cppls.server.args` | `[]` | Extra arguments for the spawned server. |
| `cppls.trace.server` | `off` | `off`, `messages` or `verbose`; protocol dumps go to the `cppls (LSP trace)` channel. |
| `cppls.revealOutputChannelOnActivate` | `false` | Reveal the `cppls` channel when the server starts. |

## Getting started

```bash
npm install
npm run compile        # tsc → out/ (also used by the tests)
npm run package        # type check + esbuild → dist/extension.js (what VS Code loads)
```

Open the folder in VS Code and press <kbd>F5</kbd> (*Run Extension*) to launch an
extension host with the extension loaded.

Without a `server/cpp_ls` binary the extension still activates and its commands
work; the status bar shows `$(circle-slash) cppls` and the log explains exactly
which paths were searched.

### Developing the C++ server over TCP

Because the server is built and started outside this repository, TCP mode is the
comfortable way to work on it:

```bash
# 1. start your server (it must listen on 5009)
./server/cpp_ls --port 5009

# 2. start VS Code with CPPLS_DEV set, so the client prefers TCP
```

```powershell
$env:CPPLS_DEV = '1'; code .          # Windows PowerShell
```

```bash
CPPLS_DEV=1 code .                    # macOS / Linux
```

Or launch *Run Extension (TCP dev server)* from `.vscode/launch.json`, which sets
`CPPLS_DEV=1` for you. Restart the server as often as you like and run
`cppls: Restart Language Server` to reconnect — no window reload needed.

## Tests

```bash
npm run test:unit   # pure logic: config, settings, server lookup, TCP probe, plan rendering
npm test            # extension host tests: command registration + a real TCP handshake
npm run lint
```

The extension host tests do not depend on the C++ server: they start a miniature
LSP peer on a spare port to prove the client can complete a handshake and
exchange requests.

## Project layout

```text
src/
  extension.ts     activation, commands, status bar
  client.ts        LanguageClient wiring; chooses TCP or a spawned process
  settings.ts      reads the cppls.* settings (needs the vscode API)
  config.ts        env vars and port logic (no vscode import, unit tested)
  connection.ts    TCP connect/probe helpers (no vscode import, unit tested)
  serverPath.ts    locates server/cpp_ls (no vscode import, unit tested)
  plan.ts          the "how will we connect" decision, rendered for humans
  test/            extension host tests
server/
  cpp_ls[.exe]     the C++ server ← build output goes here (not committed)
  README.md        the server side of the contract
test/
  unit/            node:test unit tests
```

## Troubleshooting

* **"Unable to locate the cppls language server"** — build `server/cpp_ls`, or
  set `cppls.server.path`. `cppls: Show Server Info` lists every path that was
  searched.
* **The client keeps spawning a process although `CPPLS_DEV` is set** — nothing
  was listening on the port within `cppls.server.connectTimeout`. Run
  `cppls: Check Development Server Port`; the log states the reason.
* **The development server disconnects** — the client does not respawn it while
  `CPPLS_DEV` is set; start the server again and run
  `cppls: Restart Language Server`.
