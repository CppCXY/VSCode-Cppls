# Grammar notes

The extension ships TextMate grammars for the four language ids. `cpp` and `c` are the baseline; the two device
families add their reserved words over that baseline.

| Language | Construct | Scope |
| --- | --- | --- |
| `cuda-cpp` | `kernel<<<grid, block>>>(...)` scopes the launch configuration as `meta.launch.cuda-cpp`. |
| `cuda-cpp` | `__launch_bounds__`, `__grid_constant__` and `__cluster_dims__` are storage modifiers. |
| `cuda-cpp` | `#embed`, `#elifdef` and `#elifndef` are recognised as preprocessor directives. |
| `ascend-cpp` | `__aicore__`, `__global__`, `__host__`, `__device__`, `__gm__`, `__ubuf__`, `__cbuf__`, `__fbuf__`, `__ca__`, `__cb__` and `__cc__` are storage modifiers. |
| `ascend-cpp` | The rest of the syntax is included from `source.cpp`, because Ascend C is C++ with its own AICore qualifiers. |
