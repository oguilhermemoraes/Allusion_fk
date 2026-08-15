// Browser/WebView-safe replacement for the Node.js `process` global.
// Tauri's webview has no Node.js integration, so the real `process` global is
// undefined. If a real `process` is ever present, prefer it so behavior stays
// identical.
// CommonJS on purpose (see os-shim.js).

const realProcess = (globalThis && globalThis.process) || undefined;

function detectPlatform() {
  if (realProcess && realProcess.platform) {
    return realProcess.platform;
  }
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Windows|Win64|Win32/i.test(userAgent)) return 'win32';
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'darwin';
  if (/Linux/i.test(userAgent)) return 'linux';
  return 'unknown';
}

function detectArch() {
  if (realProcess && realProcess.arch) {
    return realProcess.arch;
  }
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/arm64|aarch64/i.test(userAgent) && !/x86_64/i.test(userAgent)) return 'arm64';
  if (/Win64|x86_64/i.test(userAgent)) return 'x64';
  return 'x64';
}

const processShim = {
  platform: detectPlatform(),
  arch: detectArch(),
  version: (realProcess && realProcess.version) || 'tauri',
  type: (realProcess && realProcess.type) || 'renderer',
  env: (realProcess && realProcess.env) || {},
  cwd: () => (realProcess && realProcess.cwd ? realProcess.cwd() : '/'),
  on: () => {},
  nextTick: (cb, ...args) => {
    Promise.resolve().then(() => cb(...args));
  },
};

module.exports = processShim;
