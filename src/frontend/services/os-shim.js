// Browser/WebView-safe replacement for the Node.js `os` module.
// CommonJS on purpose: CJS consumers (`require('os')`) get the object
// directly, and ESM consumers (`import os from 'os'`) get it through
// webpack's default-import interop.
function userAgent() {
  return typeof navigator !== 'undefined' ? navigator.userAgent : '';
}

const osShim = {
  type: () => {
    const ua = userAgent();
    if (/Windows/i.test(ua)) return 'Windows_NT';
    if (/Mac OS X/i.test(ua)) return 'Darwin';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Unknown';
  },
  release: () => userAgent() || 'unknown',
  platform: () => {
    const ua = userAgent();
    if (/Windows/i.test(ua)) return 'win32';
    if (/Mac OS X/i.test(ua)) return 'darwin';
    if (/Linux/i.test(ua)) return 'linux';
    return 'unknown';
  },
  arch: () => {
    const ua = userAgent();
    if (/arm64|aarch64/i.test(ua) && !/x86_64/i.test(ua)) return 'arm64';
    if (/Win64|x86_64/i.test(ua)) return 'x64';
    return 'x64';
  },
  // In a browser/WebView there is no OS-provided temp dir. Rust commands are
  // responsible for real temp storage; this constant only keeps module-level
  // `os.tmpdir()` callers from crashing.
  tmpdir: () => '/tmp',
  EOL: '\n',
};

module.exports = osShim;
