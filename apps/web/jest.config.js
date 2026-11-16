/** Unit tests for the web shell's pure parts: focus movement, codec lists, Back order, stage size.
 *  The browser parts (rendering, <video>, hls.js) are checked in a browser. */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2020',
          lib: ['ES2020', 'DOM'],
          module: 'commonjs',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: ['jest'],
        },
        diagnostics: true,
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
};
