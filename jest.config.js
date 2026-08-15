module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: [
    // FIXME: I did not manage to get Dexie working in a real browser/webview test environment. Testing in JavaScript is
    // cursed, so indexeddb is replaced by an in-memory implementation.
    'fake-indexeddb/auto',
    // Crypto module is not stable in the node version we use, nor can we use the browser.
    '<rootDir>/tests/setup/jest.crypto.js',
  ],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': '<rootDir>/tests/setup/styleMock.js',
    '^common/(.*)$': '<rootDir>/common/$1',
    '^src/(.*)$': '<rootDir>/src/$1',
    '^widgets/(.*)$': '<rootDir>/widgets/$1',
    '^@tauri-apps/api/window$': '<rootDir>/tests/setup/tauri-api.mock.ts',
    '^@tauri-apps/api/webview$': '<rootDir>/tests/setup/tauri-api.mock.ts',
  },
};
