# TextMate grammars

These grammars are a fork of the C, C++ and CUDA grammars that ship with
Visual Studio Code (`extensions/cpp/syntaxes/`), which are MIT-licensed. They
are contributed for the same language ids and scope names, so VS Code uses them
instead of the built-in ones.

The fork exists so that the highlighting rules are part of this extension and
can be tuned here. The beginning of each `patterns` array holds the local
patches; everything below it is the upstream grammar.

## Patches

| Grammar | Patch |
| --- | --- |
| `c` | `__attribute__((...))` and `__declspec(...)` are scoped as attributes. |
| `c` | `#embed`, `#elifdef` and `#elifndef` are recognised as preprocessor directives. |
| `cpp` | `#embed` is recognised as a preprocessor directive. |
| `cuda-cpp` | `kernel<<<grid, block>>>(...)` scopes the launch configuration as `meta.launch.cuda-cpp`. |
| `cuda-cpp` | `__launch_bounds__`, `__grid_constant__` and `__cluster_dims__` are storage modifiers. |
| `cuda-cpp` | `#embed`, `#elifdef` and `#elifndef` are recognised as preprocessor directives. |

`cpp.embedded.macro.tmLanguage.json` is the helper grammar the C++ grammar
includes for the body of `#define` macros, forked unchanged.
