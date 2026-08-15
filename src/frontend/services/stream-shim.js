// Minimal browser/WebView-safe replacement for the Node.js `stream` module.
// Provides Stream/Readable/Writable/Duplex/Transform on top of the `events`
// package. Good enough for module-eval and the shimmed no-op paths; real
// streaming I/O is handled by Rust commands in Tauri.
// CommonJS on purpose (see os-shim.js).

const EventEmitter = require('events');

class Stream extends EventEmitter {
  pipe(dest) {
    this.on('data', (chunk) => {
      const ok = dest.write(chunk);
      if (ok === false && typeof this.pause === 'function') this.pause();
    });
    this.once('end', () => {
      if (typeof dest.end === 'function') dest.end();
    });
    this.on('error', (err) => {
      if (dest && typeof dest.emit === 'function') dest.emit('error', err);
    });
    return dest;
  }
}

class Readable extends Stream {
  constructor(opts) {
    super();
    this._readableState = { objectMode: !!(opts && opts.objectMode) };
    this.readable = true;
  }
  _read() {}
  read() {
    return null;
  }
  pause() {
    this.paused = true;
    return this;
  }
  resume() {
    this.paused = false;
    return this;
  }
  push(chunk) {
    if (chunk === null) {
      this.emit('end');
      return false;
    }
    this.emit('data', chunk);
    return true;
  }
  setEncoding() {}
}

class Writable extends Stream {
  constructor(opts) {
    super();
    this._writableState = { objectMode: !!(opts && opts.objectMode) };
    this.writable = true;
  }
  _write(_chunk, _enc, cb) {
    if (cb) cb();
  }
  write(chunk, enc, cb) {
    if (typeof enc === 'function') {
      cb = enc;
      enc = undefined;
    }
    try {
      this._write(chunk, enc, () => {
        if (cb) cb();
      });
    } catch (e) {
      this.emit('error', e);
    }
    return true;
  }
  end(chunk, enc, cb) {
    if (typeof chunk === 'function') {
      cb = chunk;
      chunk = undefined;
    }
    if (typeof enc === 'function') {
      cb = enc;
      enc = undefined;
    }
    if (chunk !== undefined) this.write(chunk, enc);
    this.emit('finish');
    if (cb) cb();
    return this;
  }
  cork() {}
  uncork() {}
  setDefaultEncoding() {}
}

class Duplex extends Readable {
  constructor(opts) {
    super(opts);
    this._writableState = { objectMode: !!(opts && opts.objectMode) };
    this.writable = true;
  }
  _write(_chunk, _enc, cb) {
    if (cb) cb();
  }
  write(chunk, enc, cb) {
    if (typeof enc === 'function') cb = enc;
    if (cb) cb();
    return true;
  }
  end(chunk, enc, cb) {
    if (typeof chunk === 'function') cb = chunk;
    if (typeof enc === 'function') cb = enc;
    if (chunk !== undefined) this.write(chunk);
    this.emit('finish');
    if (cb) cb();
    this.push(null);
    return this;
  }
}

class Transform extends Duplex {
  constructor(opts) {
    super(opts);
  }
  _transform(chunk, _enc, cb) {
    cb(null, chunk);
  }
  _write(chunk, enc, cb) {
    try {
      this._transform(chunk, enc, (err, data) => {
        if (err) this.emit('error', err);
        else if (data !== null && data !== undefined) this.push(data);
        if (cb) cb(err);
      });
    } catch (e) {
      if (cb) cb(e);
    }
  }
}

module.exports = Stream;
module.exports.Stream = Stream;
module.exports.Readable = Readable;
module.exports.Writable = Writable;
module.exports.Duplex = Duplex;
module.exports.Transform = Transform;
