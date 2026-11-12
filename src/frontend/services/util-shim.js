// Minimal browser/WebView-safe replacement for the Node.js `util` module.
// Implements the members used by bundled dependencies (yauzl, wrote, etc.).
// ESM (not CJS): `vite dev` serves source files as native ESM (see path-shim.js).

function inherits(ctor, superCtor) {
  if (typeof ctor !== 'function' || typeof superCtor !== 'function') {
    throw new TypeError('inherits: both arguments must be functions');
  }
  ctor.super_ = superCtor;
  if (typeof Object.create === 'function') {
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: { value: ctor, enumerable: false, writable: true, configurable: true },
    });
  } else {
    const TempCtor = function () {};
    TempCtor.prototype = superCtor.prototype;
    ctor.prototype = new TempCtor();
    ctor.prototype.constructor = ctor;
  }
}

function promisify(fn) {
  if (typeof fn !== 'function') throw new TypeError('promisify: argument must be a function');
  return function (...args) {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (err, ...values) => {
        if (err) return reject(err);
        resolve(values.length > 1 ? values : values[0]);
      });
    });
  };
}

function format(f) {
  let args = Array.prototype.slice.call(arguments, 1);
  if (typeof f !== 'string') {
    if (args.length === 0) return String(f);
    args.unshift(f);
    f = '%s';
  }
  let i = 0;
  return f.replace(/%[sdj%]/g, (token) => {
    if (token === '%%') return '%';
    if (i >= args.length) return token;
    switch (token) {
      case '%s':
        return String(args[i++]);
      case '%d':
        return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (e) {
          return '[Circular]';
        }
      default:
        return token;
    }
  });
}

function inspect(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (e) {
    return String(value);
  }
}

const isArray = Array.isArray;
const isString = (v) => typeof v === 'string';
const isNumber = (v) => typeof v === 'number';
const isFunction = (v) => typeof v === 'function';
const isObject = (v) => typeof v === 'object' && v !== null;
const isNullOrUndefined = (v) => v === null || v === undefined;
const isBuffer = (v) => typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(v);

function deprecate(fn, _msg) {
  return fn;
}

function callbackify(original) {
  return function (...args) {
    const callback = args.pop();
    if (typeof callback !== 'function') {
      throw new TypeError('callbackify: last argument must be a function');
    }
    original.apply(this, args).then(
      (result) => callback(null, result),
      (err) => callback(err)
    );
  };
}

const types = {
  isAnyArrayBuffer: () => false,
  isArgumentsObject: () => false,
  isArrayBuffer: (v) => typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer,
  isAsyncFunction: (v) => typeof v === 'function' && v.constructor && v.constructor.name === 'AsyncFunction',
  isBooleanObject: () => false,
  isBoxedPrimitive: () => false,
  isDataView: (v) => typeof DataView !== 'undefined' && v instanceof DataView,
  isDate: (v) => v instanceof Date,
  isFloat32Array: (v) => typeof Float32Array !== 'undefined' && v instanceof Float32Array,
  isFloat64Array: (v) => typeof Float64Array !== 'undefined' && v instanceof Float64Array,
  isGeneratorFunction: () => false,
  isMap: (v) => v instanceof Map,
  isMapIterator: () => false,
  isNativeError: (v) => v instanceof Error,
  isNumberObject: () => false,
  isPromise: (v) => !!v && typeof v.then === 'function',
  isRegExp: (v) => v instanceof RegExp,
  isSet: (v) => v instanceof Set,
  isSetIterator: () => false,
  isStringObject: () => false,
  isSymbolObject: () => false,
  isTypedArray: (v) => ArrayBuffer.isView && ArrayBuffer.isView(v),
  isWeakMap: (v) => v instanceof WeakMap,
  isWeakSet: (v) => v instanceof WeakSet,
};

export {
  inherits,
  promisify,
  format,
  inspect,
  deprecate,
  callbackify,
  isArray,
  isString,
  isNumber,
  isFunction,
  isObject,
  isNullOrUndefined,
  isBuffer,
  types,
};

const isUndefined = (v) => v === undefined;
const isRegExp = (v) => v instanceof RegExp;
const isDate = (v) => v instanceof Date;
const isPrimitive = (v) => v === null || (typeof v !== 'object' && typeof v !== 'function');

export { isUndefined, isRegExp, isDate, isPrimitive };

const utilShim = {
  inherits,
  promisify,
  format,
  inspect,
  deprecate,
  callbackify,
  isArray,
  isString,
  isNumber,
  isFunction,
  isObject,
  isNullOrUndefined,
  isBuffer,
  isUndefined,
  isRegExp,
  isDate,
  isPrimitive,
  types,
};

export default utilShim;
