# The cppls language server

This directory is where the C++ language server lives. The VS Code extension
(`vscode-cppls`) is only the client; everything below describes the contract the
server has to fulfil so the client can drive it.

```text
server/
  cpp_ls            ← the server binary. Build output goes here (not committed).
  cpp_ls.exe        ← the same on Windows
  README.md         ← this file
```

## 1. Command line contract

The client starts the server in one of two ways. Both must work.

| Invocation | When | Transport |
| --- | --- | --- |
| `cpp_ls` (with optional `cppls.server.args`) | Default, bundled mode | LSP frames on **stdin/stdout** |
| `cpp_ls --port 5009` | Convenient for manual testing | LSP frames on a **TCP connection** |

Rules the client relies on:

* **No arguments means stdio.** The client spawns the bare executable and speaks
  LSP on its stdin/stdout.
* **`--port <n>` (also accepted: `--socket <n>`) listens on TCP** on
  `127.0.0.1:<n>`. In development the client connects to the port instead of
  spawning a process, and it may connect more than once (after each restart).
* **stdout is reserved for the protocol.** Diagnostics, progress and log output
  must go to **stderr**; a stray `printf` on stdout corrupts the framing.
* **`--help` and `--version` exit 0** without starting a server.
* Unknown arguments exit non-zero with a message on stderr.

In VS Code development mode the same binary is started by hand:

```bash
CPPLS_DEV=1 ./server/cpp_ls --port 5009        # macOS / Linux
$env:CPPLS_DEV='1'; .\server\cpp_ls.exe --port 5009   # Windows PowerShell
```
## 2. Wire protocol

JSON-RPC 2.0 messages, each preceded by an ASCII header block terminated by
`\r\n\r\n`:

```text
Content-Length: 106\r\n
\r\n
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":1234,...}}
```

A minimal `initialize` exchange (this is the exact frame sequence the extension
sends first):

```jsonc
// client → server
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
  "processId": 1234,
  "rootUri": "file:///home/me/project",
  "capabilities": { "textDocument": { "hover": { "contentFormat": ["markdown"] } } },
  "clientInfo": { "name": "vscode-cppls", "version": "0.0.1" }
}}

// server → client
{"jsonrpc":"2.0","id":1,"result":{
  "capabilities": {
    "textDocumentSync": { "openClose": true, "change": 1 },
    "hoverProvider": true,
    "completionProvider": { "triggerCharacters": [".", ">", ":"] }
  },
  "serverInfo": { "name": "cpp_ls", "version": "0.0.1" }
}}
```

`initializationOptions.clientInfo` tells the server whether it was launched by
the extension or started by hand — useful when you want extra logging during
development.

### Lifecycle the server must implement

1. `initialize` — **request**, answer with capabilities.
2. `initialized` — notification, no reply.
3. `textDocument/didOpen`, `didChange`, `didClose` — notifications, no reply.
   Publish results with `textDocument/publishDiagnostics`.
4. `shutdown` — **request**, answer `null`, then stop accepting work.
5. `exit` — notification; exit with code `0` if `shutdown` was received first,
   otherwise `1`.

Requests the extension can route once the server advertises them: `hover`,
`completion`, `definition`, `references`, `documentSymbol`, `rename`,
`codeAction`, `formatting`, `semanticTokens/*`, `inlayHint`, `diagnostic`.

## 3. Compiling

The client looks for exactly `server/cpp_ls` (`server/cpp_ls.exe` on Windows),
so the build output has to land there.

### CMake

```cmake
cmake_minimum_required(VERSION 3.20)
project(cpp_ls CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR})

add_executable(cpp_ls src/main.cpp)   # → ./cpp_ls
```

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
# then move/copy the binary to server/cpp_ls (server/cpp_ls.exe on Windows)
```

### No build system

```bash
c++ -std=c++20 -O2 -o server/cpp_ls src/main.cpp
```

## 4. Minimal reference implementation

A single file server that completes the handshake, accepts documents and answers
`hover`. It compiles as-is and is enough to see the extension go green.

```cpp
// server/src/main.cpp
#include <cstdio>
#include <iostream>
#include <optional>
#include <string>

namespace {

std::optional<std::string> readMessage() {
    std::size_t length = 0;
    std::string line;
    // Header block: read until the empty line, remember Content-Length.
    while (std::getline(std::cin, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        if (line.empty()) {
            break;
        }
        constexpr const char* kHeader = "Content-Length:";
        if (line.rfind(kHeader, 0) == 0) {
            length = std::stoul(line.substr(std::char_traits<char>::length(kHeader)));
        }
    }
    if (std::cin.eof() || length == 0) {
        return std::nullopt;
    }
    std::string payload(length, '\0');
    std::cin.read(payload.data(), static_cast<std::streamsize>(length));
    return payload;
}

void writeMessage(const std::string& json) {
    std::cout << "Content-Length: " << json.size() << "\r\n\r\n" << json;
    std::cout.flush();
}

}  // namespace

int main(int argc, char** argv) {
    bool shutdownRequested = false;

    // `--port <n>` switches to TCP; a complete implementation also listens
    // there. Standard input is used for the stdio transport.
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--help" || arg == "--version") {
            std::fputs("cpp_ls 0.0.1\n", stdout);
            return 0;
        }
        if (arg == "--port" && i + 1 < argc) {
            std::fprintf(stderr, "cpp_ls: TCP transport not implemented yet\n");
            return 2;
        }
    }

    std::fprintf(stderr, "cpp_ls: serving LSP on stdio\n");
    while (const auto message = readMessage()) {
        // A real server parses JSON here. This example matches on method names to
        // stay dependency free — do not ship that.
        const std::string& payload = *message;
        if (payload.find("\"initialize\"") != std::string::npos) {
            writeMessage(
                R"({"jsonrpc":"2.0","id":1,"result":{"capabilities":{)"
                R"("textDocumentSync":{"openClose":true,"change":1},)"
                R"("hoverProvider":true},)"
                R"("serverInfo":{"name":"cpp_ls","version":"0.0.1"}}})");
        } else if (payload.find("\"shutdown\"") != std::string::npos) {
            shutdownRequested = true;
            writeMessage(R"({"jsonrpc":"2.0","id":2,"result":null})");
        } else if (payload.find("\"exit\"") != std::string::npos) {
            return shutdownRequested ? 0 : 1;
        }
    }
    return shutdownRequested ? 0 : 1;
}
```

> This example deliberately hardcodes the JSON-RPC ids so it stays dependency
> free. Use a real JSON library (`nlohmann/json`, `simdjson`, …) for a genuine
> implementation, and echo each request's own `id` back.

## 5. Verifying a server build

The quickest check is a raw frame on stdin:

```bash
printf 'Content-Length: 88\r\n\r\n{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"capabilities":{}}}' \
  | ./server/cpp_ls
```

A valid answer is a `Content-Length` header followed by a JSON object with
`capabilities` and `serverInfo`. If instead you get an error, or nothing at all,
the framing or the handshake is wrong.

Then, in VS Code:

1. Press <kbd>F5</kbd> to start the extension host. With `server/cpp_ls` present
   the client spawns it over stdio; or launch *Run Extension (TCP dev server)*
   after starting your server with `--port 5009`.
2. Open a `.cpp` file — the status bar should switch to
   `$(server-process) cppls` (stdio) or `$(radio-tower) cppls :5009` (TCP).
3. Run `cppls: Show Server Info` to confirm which executable and origin the
   client is using.

`npm test` inside the repository verifies the *client* half of the handshake
against a miniature LSP peer, so a failure there is always a client problem; the
commands above isolate the server.

