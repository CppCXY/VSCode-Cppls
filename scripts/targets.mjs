/**
 * **The platforms this extension is built for, in one place.**
 *
 * Two different questions live here, and they were one list until a published version showed only one platform:
 *
 * * `ASSETS` — the VS Code target and the file the **server's release** names for it. `scripts/download-server.mjs`
 *   reads it; `win32-ia32` is here because the server builds it and a caller may want it by hand.
 * * `PACKAGED` — the targets **CI builds, attaches to the release and publishes**. `scripts/check-marketplace.mjs`
 *   verifies that every one of them is on the Marketplace, and the workflow matrix is the same set.
 *
 * The left-hand side is the value `vsce package --target` takes and the Marketplace calls `targetPlatform`; the
 * right-hand side is `cpp_ls-<rust platform>` from the server's `build.yml`. `alpine-*` uses the musl build, which is
 * the one that starts on a distribution without glibc.
 */
export const ASSETS = {
	'win32-x64': 'cpp_ls-win32-x64.zip',
	'win32-arm64': 'cpp_ls-win32-arm64.zip',
	'win32-ia32': 'cpp_ls-win32-ia32.zip',
	'linux-x64': 'cpp_ls-linux-x64-glibc.2.17.tar.gz',
	'linux-arm64': 'cpp_ls-linux-aarch64-glibc.2.17.tar.gz',
	'alpine-x64': 'cpp_ls-linux-musl.tar.gz',
	'darwin-x64': 'cpp_ls-darwin-x64.tar.gz',
	'darwin-arm64': 'cpp_ls-darwin-arm64.tar.gz',
};

/**
 * **What a release ships.** 32-bit Windows has a server asset but no current VS Code build, so publishing a package
 * for it would add a target nobody can install.
 */
export const PACKAGED = [
	'win32-x64',
	'win32-arm64',
	'linux-x64',
	'linux-arm64',
	'alpine-x64',
	'darwin-x64',
	'darwin-arm64',
];

/** Where the extension looks for the binary, per target family. */
export function executableName(target) {
	return target.startsWith('win32') ? 'cpp_ls.exe' : 'cpp_ls';
}
