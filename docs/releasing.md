# Packaging, testing and releasing

Two things are packaged here: the extension (`dist/extension.js`, esbuild-bundled) and, inside it, the language server
binary for **one** platform. A `.vsix` is therefore platform-specific, and the `TargetPlatform` recorded in its
`extension.vsixmanifest` is what makes VS Code install the right one.

```text
cppls-win32-x64.vsix     server/cpp_ls.exe   cpp_ls-win32-x64.zip
cppls-linux-x64.vsix     server/cpp_ls       cpp_ls-linux-x64-glibc.2.17.tar.gz
cppls-darwin-arm64.vsix  server/cpp_ls       cpp_ls-darwin-arm64.tar.gz
```

## Where the server comes from

`scripts/config.json` pins the server release being shipped:

```json
{
  "serverRepo": "https://github.com/CppCXY/cpp_ls/releases/download",
  "serverVersion": "0.1.1"
}
```

`scripts/download-server.mjs` resolves a VS Code target to the asset the server's release attaches (one table: Linux
uses the `glibc.2.17` builds — a binary linked against the runner's glibc would not start on an older distribution — and
`alpine-x64` the musl build), downloads it, extracts it without any dependency, places it at `server/cpp_ls`
(`server/cpp_ls.exe` on Windows), removes the previous platform's binary, and sets `0o755` — the mode `vsce` then records
in the package.

```bash
npm run server:download -- --target linux-x64            # the pinned server version
npm run server:download -- --target win32-x64 --version 0.1.2
npm run server:download -- --target darwin-arm64 --tag 0.1.2
npm run server:download -- --target win32-x64 --from /tmp/cpp_ls-win32-x64.zip
```

`--from` packages an archive that is already on disk, which is how the pipeline is exercised before a release exists.
The binary is not committed ([`.gitignore`](https://github.com/CppCXY/VSCode-Cppls/blob/main/.gitignore) keeps it out), so
every checkout starts without one and the script is what fills `server/`.

## Packaging one target

```bash
npx vsce package --no-dependencies --target win32-x64 --out cppls-win32-x64.vsix
npm run verify:vsix -- cppls-win32-x64.vsix --target win32-x64
```

`vsce` runs `vscode:prepublish` (`npm run package`: type check, then esbuild), and `--no-dependencies` is right because
every runtime dependency is inside `dist/extension.js`.

`scripts/check-vsix.mjs` checks **what was packaged**, not what was meant to be: the `TargetPlatform` (which lives in
`extension.vsixmanifest`, *not* in `package.json` — a build that forgot `--target` produces a package that looks fine and
installs everywhere), the entry point, the binary for the target and its size, its executable bit on POSIX, and that
nothing from `temp/`, `src/` or `node_modules/` got in. That last check is not hypothetical: the first local package
shipped 30 MB of archives from `temp/` until `.vscodeignore` excluded it.

`npm run vsix` still builds a host-only `cppls.vsix` for local use. It has no `TargetPlatform`, so it is for
`--install-extension` on this machine, not for the Marketplace.

## Release checklist

1. **The server release must exist first.** The extension downloads its assets, so tag and publish `cpp_ls` before the
   extension. A 404 from the download step names the version and the platform, which are the two possible mistakes.
2. **Prepare the numbers.**

   ```bash
   npm run release:prepare -- 0.1.2 0.1.1
   ```

   That writes the extension version into `package.json` and the server version into `scripts/config.json`, as text, so a
   one-line bump stays a one-line diff. It does not commit, tag or publish; the steps it prints are next.
3. **Commit, tag, push.** The tags have no `v` prefix — `0.1.2`, not `v0.1.2` — which is also the name the server's
   release URLs use.

   ```bash
   git add package.json scripts/config.json
   git commit -m "release: 0.1.2"
   git tag 0.1.2
   git push origin main --tags
   ```

   CI refuses a tag that disagrees with `package.json` (`scripts/check-release-version.mjs`), which is cheaper than
   finding out after seven packages exist.
4. **CI builds every platform and releases it.** [`.github/workflows/build.yml`](https://github.com/CppCXY/VSCode-Cppls/blob/main/.github/workflows/build.yml)
   runs one job per target (`win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `alpine-x64`, `darwin-x64`,
   `darwin-arm64`): it downloads that platform's server, packages the `.vsix`, checks it, and uploads it. On a tag, two
   more jobs run: **release** creates the GitHub release and attaches every `.vsix`, and **publish** uploads the same
   files to the Marketplace — one per platform, which the `TargetPlatform` inside each `.vsix` makes possible. A push to
   `main` has already built the packages; only a tag attaches and publishes them.
5. **The Marketplace needs `VSCODE_RELEASE`.** The publish job reads it from the repository secrets: an Azure DevOps
   personal access token with the Marketplace's *Manage* scope, added under **Settings → Secrets and variables →
   Actions**. Without it the job fails with a message saying exactly that — the release and its assets are already
   there, so add the secret and re-run the job. Publishing a version that already exists is skipped
   (`--skip-duplicate`), so a re-run is safe.

   **One target is one upload.** The Marketplace merges those uploads into one listing, and "Works with" on the
   extension page is exactly the set that arrived. A version with a single platform looks finished and installs
   nowhere else — `0.1.1` went up as `alpine-x64` alone, from the first `.vsix` in the release. The job therefore ends
   with `scripts/check-marketplace.mjs`, which asks the public gallery which targets this version has and fails,
   naming the missing ones, when it is fewer than `scripts/targets.mjs`'s `PACKAGED`.

   The same command by hand, if the job cannot run (one path per platform):

   ```bash
   VSCE_PAT=<token> npx vsce publish --packagePath cppls-win32-x64.vsix --skip-duplicate
   ```

## Exercising the pipeline without a tag

**Every push to `main` or `master` builds the packages too** — all seven of them, exactly as a tag would — and keeps the
`.vsix` files as workflow artifacts; the two steps a push skips are creating the release and publishing it. So packaging
is checked on every change, before a tag exists, and a tag is only the moment the artifacts become a release and a
Marketplace version. `workflow_dispatch` runs the same jobs against any branch, which is how a change to
`download-server.mjs` or `check-vsix.mjs` is tried without committing it.

## Running a development server

By default the extension spawns the bundled `server/cpp_ls` and speaks LSP over stdio. For server development it can
talk TCP instead: with `CPPLS_DEV` set and a server listening on `cppls.server.port` (5009), the client connects over
TCP, so the extension host can stay running while the server is rebuilt and restarted. A forgotten `CPPLS_DEV` never
breaks an editing session — the client logs it and falls back to stdio. `cppls.server.launchMode` forces one or the other
(`auto` — the default, `tcp`, `bundled`).

| Environment variable | Meaning |
| --- | --- |
| `CPPLS_DEV` | Any value except `0`, `false`, `off`, `no` enables development (TCP) mode. |
| `CPPLS_DEV_PORT` | Overrides the development TCP port. |
| `CPPLS_SERVER_PATH` | Absolute or extension-relative path to the server executable. |

## Checks that run in CI

```bash
npm run check-types    # tsc --noEmit
npm run lint           # eslint
npm run test:unit      # node --test: the compiled client and the grammars
npm run verify:manifest
npm run verify:server  # the LSP contract, when this platform has a server binary (skipped otherwise)
xvfb-run -a npm test   # extension host tests
```
