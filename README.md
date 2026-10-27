# cppls — C/C++ language support for VS Code

A C and C++ language server for VS Code, written from scratch in Rust. No compiler daemon, no
`compile_commands.json` required, no second syntax engine: one server that indexes the project, answers the
questions an editor asks, and speaks the Language Server Protocol.

```text
completion · hover · signature help · go to definition · type definition · implementation · references
document highlight · rename · call hierarchy · document symbols · workspace symbols · folding · selection range
formatting (document and range) · inlay hints · semantic tokens · code actions · diagnostics · #include links
```

It analyses the text the editor has, not only what is saved — completion and hover work in a file that has never
compiled, and a half-typed line does not stop the rest of the translation unit from resolving.

## Features

| Feature | What it gives you |
| --- | --- |
| **Completion** | Members after `.`/`->`/`::`, names in scope, keywords, `#include` paths, macro names and their parameters |
| **Hover** | The declaration and its type, a macro's body, an enumerator's value, the value of a constant |
| **Signature help** | The parameter under the cursor is picked out of the list |
| **Go to definition** | Through macros, aliases, `auto`, overloads, template instantiations and the standard library |
| **Type definition / implementation** | The class behind a `unique_ptr`, the override behind a virtual call |
| **References, rename** | Project-wide, including names reached only through an include |
| **Call hierarchy** | Who calls this function, and what it calls |
| **Semantic tokens** | Names are coloured by what they *are* — a type, a function, a member, a macro — not by how they look |
| **Inlay hints** | Parameter names inside a call: `scale(count: 3, factor: 0.5)` |
| **Formatting** | Whole document and selection, built on the same parser |
| **Code actions** | `source.include`: add the header that declares the name under the cursor, when it does not resolve |
| **Diagnostics** | Parse errors and semantic checks, pulled by the editor (`textDocument/diagnostic`) |
| **Document links** | Every `#include` is a clickable link |

### Diagnostics

Parse errors, plus checks a compiler would not tell you while you type:

```text
argument-count  parameter-type  assign-type  undefined-field  return-type-mismatch  missing-return
access-invisible  assignment-in-condition  include-not-found  macro-redefined  macro-parentheses
unused  unnecessary-branch  simplify-boolean-expr  else-after-return  braces-around-statements
c-style-cast  use-auto  use-nullptr  use-override  implicit-bool-conversion  concept-not-satisfied
module-note
```

Each rule has a stable kebab-case code and can be turned off individually — see [`[diagnostics]`](#cpplstoml). A file
whose includes have not been read yet reports nothing rather than guessing: the diagnostic arrives when the index can
justify it.

## Supported files

```text
C        .c  .h
C++      .cc .cpp .cxx .c++ .hpp .hh .hxx .h++ .inl .ipp .tpp .txx .ixx .cppm .ccm .cxxm
CUDA     .cu .cuh
```

Any other file reached through a `#include` is analysed too, whatever it is called — that is how a compiler finds a
header, so it is how the server finds one.

## Getting started

1. **Install the extension.** From the marketplace, or from a `.vsix`: `code --install-extension cppls.vsix`.
2. **Open a folder.** The server starts with the first C/C++ file and indexes the workspace in the background. The
   status bar shows how much is left, and goes away when the index can answer questions about every file.
3. **Tell it how the project is built**, when it can be told. A `compile_commands.json` is read where CMake puts it
   (`CMakeLists.txt` plus `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`), and a compiler on `PATH` is asked for its system
   include paths and predefined macros. Without either the server still works: includes resolve relative to the file,
   and — with `[compile].fuzzy_includes` on, which is the default when there is no database — a header nothing could
   place is looked for inside the project.

The server is a separate process, bundled with the extension, so nothing else has to be installed.

## Configuration

### VS Code settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `cppls.server.path` | `""` | Path to the `cpp_ls` executable. Empty uses the bundled one. |
| `cppls.server.args` | `[]` | Extra arguments for the server process. |
| `cppls.trace.server` | `off` | LSP traffic in the `cppls (LSP trace)` output channel. |
| `cppls.revealOutputChannelOnActivate` | `false` | Show the `cppls` output channel as soon as the server starts. |
| `cppls.server.launchMode` | `auto` | How the server is reached — see [Development](#development). |

### `.cppls.toml`

A project's own answers, in a file at the workspace root. Every section is optional; a key that is present wins over
what discovery worked out, and unknown keys are reported rather than silently ignored.

```toml
# Which files are the project's.
[workspace]
exclude = ["build/**", "3rd/**"]            # globs the analysis must not read
source_extensions = ["cuh", "ipp"]          # added to the engine's own list

# How it is built, when discovery cannot work it out.
[compile]
database = "build/compile_commands.json"    # where the compile database is (relative or absolute)
compiler = "clang++"                        # "auto" (or absent) leaves it to the discovery order
standard = "c++20"                          # the project-wide -std=, inherited by every target
args = ["-DFEATURE=1", "-Iinclude"]         # the project's own flags, *instead of* the compile database's
extra_args = ["-Wall"]                      # appended to whatever won
remove_args = ["-Werror"]                   # dropped from whichever set won, by whole spelling
fuzzy_includes = true                       # look for unplaced headers inside the project (default: on without a database)

[[compile.target]]                          # a target that differs from the project
name = "embedded"
standard = "c++17"
args = ["-mcpu=cortex-m4"]

# The index.
[index]
cache_dir = ".cppls"                        # where summaries are cached, relative to the root
max_files = 10000                           # bound on the scan (this is the default)

# What is reported, and when.
[diagnostics]
enable = []                                 # only these rule codes, if non-empty
disable = ["unused"]                        # and never these

[hover]
enable = true

# The language this project's messages are written in.
locale = "zh-CN"
```

### CUDA

`.cu` and `.cuh` documents are analysed as **CUDA**: a `.cu` file is C++ plus a layer of its own, and the server reads
that layer — the placement qualifiers (`__global__`, `__device__`, …) and the launch brackets of
`kernel<<<grid, block>>>(args)` — only when the project says it is CUDA.

VS Code owns the language ids and file associations (`c`, `cpp` and `cuda-cpp`); this extension owns the
**baseline highlighting**: it ships its own TextMate grammars for the three ids, forked from VS Code's MIT-licensed
grammars and patched here — the CUDA launch block of `kernel<<<grid, block>>>(args)` is scoped as such, C attributes
and C23 `#embed`/`#elifdef` are recognised, and the C/C++ keyword layer is ours to tune. The client *claims* those
documents and answers everything else from the server.

What is left to configure is the **toolkit**, which is where `dim3`, `threadIdx` and `float4` come from: they are
*declarations in nvcc's headers*, not keywords, so nothing can resolve them until those headers are on the include
path.

```toml
[compile.cuda]
enable = true                               # read this project as CUDA even without an nvcc in the database
toolkit = "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.4"
host_compiler = "cl"                        # the host dialect: cl (MSVC), or g++/clang++ (GNU)
include = ["3rd/cutlass/include"]           # extra include directories, relative to the root
args = ["-arch=sm_80"]                      # appended to whichever flags won
```

A project whose build has a compile database with `nvcc` commands needs none of this — the toolchain says it.
`__CUDA_ARCH__` is deliberately *not* a setting: it is defined only in the device compilation pass, so defining it for
a whole file would send host code down a branch a real compiler never takes.

`ms-vscode.cpptools` answers for C/C++ documents too, and on a `.cu` file both servers would try. To keep this one as
the only answer for CUDA, turn that extension's IntelliSense off (its syntax colouring can stay):

```jsonc
// settings.json
"C_Cpp.intelliSenseEngine": "disabled"
```

## Commands

| Command | What it does |
| --- | --- |
| `cppls: Restart Language Server` | Stops and starts the client. |
| `cppls: Stop Language Server` | Stops the client without restarting it. |
| `cppls: Show Server Info` | The active transport, the executable or endpoint, and every path that was searched. |
| `cppls: Show Logs` | Opens the `cppls` output channel. |
| `cppls: Check Development Server Port` | Probes the development TCP port and reports whether a server answers. |

The status bar shows the active mode and is clickable — it opens `cppls: Show Server Info`.

## Troubleshooting

**Nothing happens.** The extension only activates for C/C++/CUDA documents. If the status bar is absent, open a
`.cpp` or `.cu` file, or run any `cppls:` command.

**The server does not start.** `cppls: Show Server Info` names the executable it tried and every path it searched;
`cppls: Show Logs` has the server's own log, including why it exited. Where the bundled binary cannot run (another
platform, a locked-down volume), point `cppls.server.path` at a build of `cpp_ls`.

**Indexing takes a long time.** It is bounded by `[index].max_files` and shaped by `[workspace].exclude`; a build tree
that is not excluded is the usual cause. The index is cached in `[index].cache_dir` and reused on the next start.

**`#include <vector>` is red, or a name from the standard library is unknown.** The compiler could not be asked, so
the server has no system include paths. Set `[compile].compiler`, or provide a `compile_commands.json`.

**A file with errors has no diagnostics.** A diagnostic about a name is only reported once the file's includes have
been read; until then the honest answer is silence. The status bar shows whether the index is still filling.

**CUDA syntax is not understood.** Either the toolchain is not `nvcc` and `[compile.cuda].enable` is not set, or the
project has not been given a toolkit — see [CUDA](#cuda).

## Development

The server's sources and its build instructions are in `server/README.md`.

```text
npm run check-types    # tsc --noEmit
npm run lint           # eslint
npm run test:unit      # node --test: compiled client, plus the TextMate grammars
npm test               # extension host tests (VS Code needs a display; CI uses xvfb)
npm run bundle         # esbuild → dist/extension.js
npm run vsix           # package cppls.vsix (install:local also installs it)
npm run verify:server  # drive the server binary and check the LSP contract it must satisfy
```

**Transports.** By default the extension spawns the bundled `server/cpp_ls` and speaks LSP over stdio. For server
development it can talk TCP instead: with `CPPLS_DEV` set and a server listening on `cppls.server.port` (5009), the
client connects over TCP, so the extension host can stay running while the server is rebuilt and restarted. A
forgotten `CPPLS_DEV` never breaks an editing session — the client logs it and falls back to stdio.
`cppls.server.launchMode` forces one or the other (`auto` — the default, `tcp`, `bundled`).

| Environment variable | Meaning |
| --- | --- |
| `CPPLS_DEV` | Any value except `0`, `false`, `off`, `no` enables development (TCP) mode. |
| `CPPLS_DEV_PORT` | Overrides the development TCP port. |
| `CPPLS_SERVER_PATH` | Absolute or extension-relative path to the server executable. |

## License

MIT — see [LICENSE](LICENSE).