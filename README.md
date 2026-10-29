# Cpp Language Server

**C and C++ language support for VS Code**, powered by [`cpp_ls`](https://github.com/CppCXY/cpp_ls) — a C/C++
language server written from scratch in Rust. The server is bundled with the extension, so there is nothing else to
install: no clangd, no compiler daemon, and no `compile_commands.json` required to be useful.

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/CppCXY.cppls?label=marketplace&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=CppCXY.cppls)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/CppCXY.cppls)](https://marketplace.visualstudio.com/items?itemName=CppCXY.cppls)
[![CI](https://github.com/CppCXY/VSCode-Cppls/actions/workflows/ci.yml/badge.svg)](https://github.com/CppCXY/VSCode-Cppls/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/CppCXY/VSCode-Cppls/blob/main/LICENSE)

## What it gives you

| | |
| --- | --- |
| **Completion** | Members after `.`, `->` and `::`, names in scope, keywords, `#include` paths, macros and their parameters |
| **Navigation** | Go to definition, type definition and implementation — through macros, aliases, `auto`, overloads and template instantiations |
| **Hover** | The declaration and its type, a macro's replacement list, an enumerator's value, a constant's value |
| **References and rename** | Project-wide, including names reached only through an `#include` |
| **Diagnostics** | Parse errors and semantic checks, reported as you type — [26 rules](#diagnostics), each one switchable |
| **Format strings** | `printf`, `std::format` and `scanf` strings are coloured, explained on hover, and completed — [see below](#format-strings) |
| **Inlay hints** | Parameter names inside a call: `scale(count: 3, factor: 0.5)` |
| **Formatting** | Whole document and selection — built on the same parser, [not clang-format](#formatting) |
| **Semantic tokens** | A name is coloured by what it *is* — type, function, member, macro — not by how it looks |
| **Also** | Signature help, call hierarchy, document and workspace symbols, folding, selection range, document highlight, `#include` links, and a quick fix that adds the `#include` declaring an unresolved name |

The analysis follows the text the editor has, not only what has been saved: completion and hover work in a file that has
never compiled, and a half-typed line does not stop the rest of the translation unit from resolving.

### Format strings

A format string is where C++ code most often disagrees with itself, and the server parses it with the same parser it
uses for everything else. Inside a literal, conversions are coloured as such, hovering one explains it, and typing
offers the conversions the format function accepts:

```cpp
printf("%s: %d of %d\n", name, index, total);
std::format("{} has {:.1f} MiB", file, size);
```

`printf`, `std::format` and the `scanf` family are on by default; `[format.functions]` teaches it a project's own
wrappers, including where their format string sits (`trace(level, fmt, …)`).

## Install

**Requires VS Code 1.138 or newer.**

**From the Marketplace:** install **Cpp Language Server** (`CppCXY.cppls`), then open a folder containing C or C++
sources. VS Code installs the package built for your platform automatically.

**From a `.vsix`:** each package carries the server for exactly one platform, so pick the one you need:

| Platform | Package |
| --- | --- |
| Windows x64 / arm64 | `cppls-win32-x64.vsix`, `cppls-win32-arm64.vsix` |
| Linux x64 / arm64 (glibc) | `cppls-linux-x64.vsix`, `cppls-linux-arm64.vsix` |
| Linux x64 (musl, e.g. Alpine) | `cppls-alpine-x64.vsix` |
| macOS Intel / Apple silicon | `cppls-darwin-x64.vsix`, `cppls-darwin-arm64.vsix` |

```bash
code --install-extension cppls-linux-x64.vsix
```

In **Remote-SSH**, **WSL**, a **Dev Container** or **Codespaces**, the extension runs where the sources are: install the
package for that machine, or let the Marketplace choose it.

## Getting started

1. **Open a folder** with C or C++ sources. The server starts with the first document and indexes the workspace in the
   background; the status bar shows the active mode (click it for details).
2. **Optionally, tell it how the project is built.** It reads a `compile_commands.json` from the project root or a build
   directory (CMake: `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`), and asks a compiler on `PATH` for its system include paths
   and predefined macros. Neither is required: with no database, includes resolve relative to the file and headers
   nothing could place are looked for inside the project.
3. **Point it at a compiler when discovery picks the wrong one** — `[compile].compiler` in `.cppls.toml`, or a
   `compile_commands.json`, decides whose standard library and macros are read.

## Configuration

### VS Code settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `cppls.server.path` | `""` | Path to a `cpp_ls` executable. Empty uses the bundled one. |
| `cppls.server.args` | `[]` | Extra command line arguments for the server process. |
| `cppls.server.launchMode` | `"auto"` | `auto`, `tcp` (development server) or `bundled` (spawn over stdio). |
| `cppls.server.port` | `5009` | Port of a development server in TCP mode. |
| `cppls.server.connectTimeout` | `5000` | Milliseconds to wait for the TCP server before spawning one instead. |
| `cppls.trace.server` | `"off"` | LSP traffic in the **cppls (LSP trace)** output channel: `off`, `messages` or `verbose`. |
| `cppls.revealOutputChannelOnActivate` | `false` | Show the **cppls** output channel when the server starts. |

### `.cppls.toml`

A project's own answers, in a file at the workspace root. Every key is optional, and an unknown one is reported instead
of silently ignored. The full reference is in
[`docs/configuration.md`](https://github.com/CppCXY/cpp_ls/blob/main/docs/configuration.md).

```toml
locale = "zh-CN"                             # messages in this project, over the editor's language

[workspace]
exclude = ["build/**", "third_party/**"]     # globs the analysis must not read
source_extensions = ["cuh", "ipp"]           # added to the files the engine already knows

[compile]
database = "build/compile_commands.json"     # when discovery would not find it
compiler = "clang++"                         # whose headers and macros are read
standard = "c++20"                           # the project-wide -std=
args = ["-DFEATURE=1", "-Iinclude"]          # the whole command line, *instead of* the database's
extra_args = ["-Wall"]                       # appended to whichever set won
remove_args = ["-Werror"]                    # dropped from whichever set won

[[compile.target]]                           # a target that differs from the project
name = "embedded"
sources = ["firmware/**"]
standard = "c++17"
args = ["-mcpu=cortex-m4"]

[index]
cache_dir = ".cppls"                         # where index summaries are cached, relative to the root
max_files = 10000                            # bound on the project scan

[diagnostics]
enable = []                                  # only these rules, when non-empty
disable = ["unused"]                         # and never these

[hover]
enable = true                                # false turns hover off

[format]
printf = true                                # the printf family, and fmt::printf
std = true                                   # std::format / std::print / fmt::format
scanf = true                                 # scanf and friends
```

### CUDA

`.cu` and `.cuh` files are analysed as CUDA — the placement qualifiers, the launch brackets of
`kernel<<<grid, block>>>(args)` — when the project says it is CUDA. What a project has to say is where the **toolkit**
is; `dim3`, `threadIdx` and `float4` are declarations in nvcc's headers, so nothing can resolve them until those headers
are on the include path:

```toml
[compile.cuda]
enable = true
toolkit = "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.4"
host_compiler = "cl"                         # the host dialect: cl (MSVC), or g++/clang++ (GNU)
include = ["3rd/cutlass/include"]            # extra include directories, relative to the root
args = ["-arch=sm_80"]                       # appended to whichever flags won
```

A build whose `compile_commands.json` has `nvcc` commands needs none of this — the database says it. `__CUDA_ARCH__` is
deliberately not a setting: it is defined only in the device compilation pass, and defining it for a whole file would
send host code down a branch a real compiler never takes.

If `ms-vscode.cpptools` is also installed, it answers for C/C++ documents too and on a `.cu` file both servers compete.
To keep this extension as the only answer, turn that one's IntelliSense off (its colouring can stay):

```jsonc
// settings.json
"C_Cpp.intelliSenseEngine": "disabled"
```

### Commands

| Command | What it does |
| --- | --- |
| `cppls: Restart Language Server` | Stops and starts the client. |
| `cppls: Stop Language Server` | Stops the client without restarting it. |
| `cppls: Show Server Info` | The active transport, the executable or endpoint, and every path that was searched. |
| `cppls: Show Logs` | Opens the **cppls** output channel. |
| `cppls: Check Development Server Port` | Probes the development TCP port and reports whether a server answers. |

## Languages and files

```text
C       .c .i
C++     .cc .cpp .cxx .c++ .ccm .cppm .cxxm .c++m .h .hh .hpp .hxx .h++ .inl .ipp .tpp .txx .ixx .mpp .mxx .ino
        .hpp.in .h.in .ii
CUDA    .cu .cuh
```

Any other file reached through an `#include` is analysed too, whatever it is called: that is how a compiler finds a
header, so it is how the server finds one. The extension ships its own TextMate grammars for the three language ids, so
baseline colouring does not depend on another extension.

## Diagnostics

Parse errors, plus checks a compiler would not tell you while you type:

```text
syntax-error  param-type-check  assign-type-check  argument-count  return-type-mismatch  missing-return
undefined-name  undefined-field  redefinition  unused  access-invisible  concept-not-satisfied
include-not-found  macro-redefined  macro-parentheses  module-note  assignment-in-condition
unnecessary-branch  simplify-boolean-expr  else-after-return  braces-around-statements  implicit-bool-conversion
cstyle-cast  use-auto  use-nullptr  use-override
```

Every rule has a stable kebab-case code and is switched by name in `[diagnostics]` (`disable` wins over `enable`). A file
whose includes have not been read yet reports nothing rather than guessing: the diagnostic arrives when the index can
justify it.

## Formatting

Formatting is **not** clang-format. It is a formatter built on this project's own parser, and it aims at the common
subset of the clang-format style so that the extension is useful out of the box — nothing more. **For production code,
run clang-format** (or your project's formatter) and let this be the editor's fallback.

## Troubleshooting

**Nothing happens.** The extension activates for C, C++ and CUDA documents only. Open a `.cpp` or `.cu` file, or run any
`cppls:` command.

**The server does not start.** `cppls: Show Server Info` names the executable it tried and every path it searched;
`cppls: Show Logs` has the server's own log, including why it exited. Where the bundled binary cannot run, point
`cppls.server.path` at a build of `cpp_ls`.

**`#include <vector>` is underlined, or a standard library name is unknown.** The compiler could not be asked, so the
server has no system include paths: set `[compile].compiler`, or provide a `compile_commands.json`.

**Indexing is slow.** It is bounded by `[index].max_files` and shaped by `[workspace].exclude`; a build tree that is not
excluded is the usual cause. Summaries are cached in `[index].cache_dir` and reused on the next start.

**A file with errors has no diagnostics.** A diagnostic about a name is only reported once the file's includes have been
read; until then the honest answer is silence.

## Development

The server's sources, its tests and its own documentation are in [`CppCXY/cpp_ls`](https://github.com/CppCXY/cpp_ls); the
copy in `server/README.md` is the build instructions for the bundled binary.

```bash
npm ci
npm run check-types   # tsc --noEmit
npm run lint          # eslint
npm run test:unit     # node --test, over the compiled client and the grammars
npm test              # extension host tests (needs a display; CI uses xvfb)
npm run bundle        # esbuild → dist/extension.js
npm run vsix          # a host-only cppls.vsix for local use (install:local also installs it)
npm run verify:server # drive the server binary and check the LSP contract it must satisfy
```

`cppls.server.launchMode` and the `CPPLS_DEV` environment variable let the client talk to a server that is rebuilt
underneath it (TCP instead of stdio); the mode is described in `cppls.server.launchMode` and in
[`docs/releasing.md`](https://github.com/CppCXY/VSCode-Cppls/blob/main/docs/releasing.md).

Packaging one `.vsix` per platform, the release checklist and the CI pipeline are documented in
[`docs/releasing.md`](https://github.com/CppCXY/VSCode-Cppls/blob/main/docs/releasing.md).

## Privacy

The extension and the server run entirely on your machine: no telemetry, no accounts, and no code or project data sent
anywhere. The server keeps its index cache in `.cppls/` at the workspace root — deleting that directory is always safe.

## License

MIT — see [LICENSE](https://github.com/CppCXY/VSCode-Cppls/blob/main/LICENSE).
