// Windows-aware replacement for the Node `path` module inside the Tauri WebView.
//
// `path-browserify` only understands POSIX '/' separators, which mangles
// backslash paths on Windows: e.g. `path.basename` returns the *whole* path
// (since '\' is not a separator there), producing invalid thumbnail filenames
// like `D:\library\folder\image-123.webp` -> generation fails and the asset://
// URL ends up pointing to a path that cannot exist on disk (403).
//
// This shim implements the handful of path functions the renderer actually
// uses with native Windows semantics. On other platforms it simply re-exports
// `path-browserify`. CommonJS on purpose (see os-shim.js).

const browserPath = require('path-browserify');

const IS_WIN = typeof process !== 'undefined' && process.platform === 'win32';

if (!IS_WIN) {
  module.exports = browserPath;
  module.exports.default = browserPath;
} else {
  const SEP = '\\';
  const SPLIT_RE = /[\\/]+/;

  const split = (p) => String(p).split(SPLIT_RE);

  function basename(p, ext) {
    const parts = split(p);
    let name = parts.length > 0 && parts[parts.length - 1] !== '' ? parts[parts.length - 1] : '';
    if (ext && name.toLowerCase().endsWith(String(ext).toLowerCase())) {
      name = name.slice(0, -ext.length);
    }
    return name;
  }

  function extname(p) {
    const name = basename(p);
    const i = name.lastIndexOf('.');
    if (i <= 0) {
      return '';
    }
    return name.slice(i);
  }

  function dirname(p) {
    const parts = split(p);
    parts.pop();
    if (parts.length === 0) {
      return '.';
    }
    return parts.join(SEP);
  }

  function isAbsolute(p) {
    const s = String(p);
    return /^[a-zA-Z]:[\\/]/.test(s) || /^[\\/][\\/]/.test(s) || /^[\\/]/.test(s);
  }

  function normalize(p) {
    const s = String(p);
    const abs = isAbsolute(s);
    const hasDrive = /^[a-zA-Z]:/.test(s);
    const drive = hasDrive ? s.slice(0, 2) : '';
    const rest = hasDrive ? s.slice(2) : s;
    const parts = [];
    for (const seg of rest.split(SPLIT_RE)) {
      if (seg === '' || seg === '.') {
        continue;
      }
      if (seg === '..') {
        if (parts.length > 0 && parts[parts.length - 1] !== '..') {
          parts.pop();
        } else if (!abs) {
          parts.push(seg);
        }
        continue;
      }
      parts.push(seg);
    }
    let out = parts.join(SEP);
    if (hasDrive) {
      out = drive + SEP + out;
    } else if (abs && (s.startsWith('/') || s.startsWith('\\'))) {
      out = SEP + out;
    }
    return out || (hasDrive ? drive + SEP : abs ? SEP : '.');
  }

  function join(...parts) {
    const pieces = [];
    for (const part of parts) {
      if (part === undefined || part === null || part === '') {
        continue;
      }
      for (const seg of split(part)) {
        if (seg === '' || seg === '.') {
          continue;
        }
        if (seg === '..') {
          if (pieces.length > 0 && pieces[pieces.length - 1] !== '..') {
            pieces.pop();
          } else {
            pieces.push(seg);
          }
          continue;
        }
        pieces.push(seg);
      }
    }
    if (pieces.length === 0) {
      return '.';
    }
    return pieces.join(SEP);
  }

  function resolve(...parts) {
    return normalize(join(...parts));
  }

  function parse(p) {
    const s = String(p);
    const root = /^[a-zA-Z]:[\\/]/.test(s) ? s.slice(0, 3) : '';
    const rest = root ? s.slice(3) : s;
    const parts = rest.split(SPLIT_RE);
    const base = parts[parts.length - 1] || '';
    const dir = root + (parts.length > 1 ? parts.slice(0, -1).join(SEP) : '');
    const ext = extname(base);
    return { root, dir, base, ext, name: ext ? base.slice(0, -ext.length) : base };
  }

  function format(obj) {
    return obj.dir ? join(obj.dir, obj.base) : obj.base;
  }

  function relative(from, to) {
    // Not used by the renderer; best-effort approximation.
    return basename(to);
  }

  const winPath = {
    sep: SEP,
    delimiter: ';',
    basename,
    dirname,
    extname,
    isAbsolute,
    normalize,
    join,
    resolve,
    parse,
    format,
    relative,
    posix: browserPath,
    win32: null,
  };
  winPath.win32 = winPath;

  module.exports = winPath;
  module.exports.default = winPath;
}
