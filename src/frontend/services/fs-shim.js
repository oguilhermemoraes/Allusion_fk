// Browser/WebView-safe replacement for the Node.js `fs` / `fs-extra` modules.
// Real filesystem work happens through Tauri `invoke()` commands.
// Tauri-only: the app no longer has an Electron/web fallback (see umbrella #63).
// CommonJS on purpose (see os-shim.js).

const { invoke } = require('@tauri-apps/api/core');
const { Readable, Writable } = require('./stream-shim.js');

const emptyBuffer = () => {
  if (typeof Buffer !== 'undefined') return Buffer.from('');
  return new Uint8Array(0);
};

const pathExists = async (path) => {
  try {
    await invoke('get_file_info', { path });
    return true;
  } catch (e) {
    return false;
  }
};

const pathExistsSync = () => true;

const stat = async (path) => {
  try {
    const info = await invoke('get_file_info', { path });
    return {
      isDirectory: () => info.is_dir,
      isFile: () => !info.is_dir,
      size: info.size || 0,
      mtime: new Date(info.date_modified || Date.now()),
      birthtime: new Date(info.date_created || Date.now()),
      ctime: new Date(info.date_created || Date.now()),
      ino: info.ino || info.absolute_path,
    };
  } catch (e) {
    return {
      isDirectory: () => false,
      isFile: () => true,
      size: 0,
      mtime: new Date(),
      birthtime: new Date(),
      ctime: new Date(),
      ino: path,
    };
  }
};

const statSync = () => ({
  isDirectory: () => false,
  isFile: () => true,
  size: 0,
  mtime: new Date(),
  birthtime: new Date(),
  ctime: new Date(),
  ino: '',
});

const readdir = async (path) => {
  try {
    const files = await invoke('read_directory_files', { path, extensions: [] });
    return files.map((f) => f.name);
  } catch (e) {
    return [];
  }
};

const readdirSync = () => [];

const toBytesArray = (contents) => {
  if (typeof contents === 'string') {
    if (typeof Buffer !== 'undefined') return Array.from(Buffer.from(contents, 'utf-8'));
    return Array.from(new TextEncoder().encode(contents));
  }
  if (contents instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(contents))) {
    return Array.from(contents);
  }
  if (contents instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(contents));
  }
  if (Array.isArray(contents)) {
    return contents;
  }
  return [];
};

const mkdirp = async (path) => {
  if (path) {
    await invoke('ensure_dir', { path: String(path) });
  }
};
const mkdirpSync = () => {};
const ensureDir = mkdirp;
const ensureDirSync = mkdirpSync;

const ensureFile = async (path) => {
  if (path) {
    await invoke('ensure_file', { path: String(path) });
  }
};
const ensureFileSync = () => {};

const remove = async (path) => {
  if (path) {
    await invoke('remove_path', { path: String(path) });
  }
};
const removeSync = () => {};
const unlink = remove;
const unlinkSync = removeSync;

const readFile = async (path) => {
  if (path) {
    const bytes = await invoke('read_file', { path: String(path) });
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes);
    return new Uint8Array(bytes);
  }
  return emptyBuffer();
};
const readFileSync = () => emptyBuffer();

const copyFile = async (src, dest) => {
  if (src && dest) {
    await invoke('copy_file', { src: String(src), dest: String(dest) });
  }
};
const copyFileSync = () => {};
const copy = async (src, dest) => {
  if (src && dest) {
    await invoke('copy_file', { src: String(src), dest: String(dest) });
  }
};
const copySync = () => {};
const move = async (src, dest) => {
  if (src && dest) {
    await invoke('move_file', { src: String(src), dest: String(dest) });
  }
};
const moveSync = () => {};

const writeFile = async (path, contents) => {
  if (path) {
    const bytes = toBytesArray(contents);
    await invoke('write_file', { path: String(path), contents: bytes });
  }
};
const writeFileSync = () => {};

const createReadStream = () => {
  const rs = new Readable();
  process.nextTick(() => rs.emit('end'));
  return rs;
};
const createWriteStream = () => {
  const ws = new Writable();
  process.nextTick(() => ws.emit('open'));
  return ws;
};
const outputFile = writeFile;
const outputFileSync = writeFileSync;

const fsShim = {
  pathExists,
  pathExistsSync,
  stat,
  statSync,
  lstat: stat,
  lstatSync: statSync,
  readdir,
  readdirSync,
  mkdirp,
  mkdirpSync,
  ensureDir,
  ensureDirSync,
  ensureFile,
  ensureFileSync,
  remove,
  removeSync,
  unlink,
  unlinkSync,
  readFile,
  readFileSync,
  writeFile,
  writeFileSync,
  outputFile,
  outputFileSync,
  copyFile,
  copyFileSync,
  copy,
  copySync,
  move,
  moveSync,
  createReadStream,
  createWriteStream,
  promises: {
    stat,
    readdir,
    readFile,
    writeFile,
    unlink: remove,
    mkdir: mkdirp,
    copyFile,
    copy,
    move,
  },
};

module.exports = fsShim;
