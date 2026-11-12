// Browser/WebView-safe replacement for the Node.js `os` module.
// ESM (not CJS): `vite dev` serves source files as native ESM, so
// `module.exports` breaks the dev server (see path-shim.js).
function userAgent() {
  return typeof navigator !== 'undefined' ? navigator.userAgent : '';
}

function type() {
  const ua = userAgent();
  if (/Windows/i.test(ua)) return 'Windows_NT';
  if (/Mac OS X/i.test(ua)) return 'Darwin';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

function release() {
  return userAgent() || 'unknown';
}

function platform() {
  const ua = userAgent();
  if (/Windows/i.test(ua)) return 'win32';
  if (/Mac OS X/i.test(ua)) return 'darwin';
  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
}

function arch() {
  const ua = userAgent();
  if (/arm64|aarch64/i.test(ua) && !/x86_64/i.test(ua)) return 'arm64';
  if (/Win64|x86_64/i.test(ua)) return 'x64';
  return 'x64';
}

// In a browser/WebView there is no OS-provided temp dir. Rust commands are
// responsible for real temp storage; this constant only keeps module-level
// `os.tmpdir()` callers from crashing.
function tmpdir() {
  return '/tmp';
}

const EOL = '\n';

const osShim = { type, release, platform, arch, tmpdir, EOL };

export { type, release, platform, arch, tmpdir, EOL };
export default osShim;
