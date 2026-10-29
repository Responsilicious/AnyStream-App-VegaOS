/** Unit tests cover pure TypeScript only (providers, player logic, storage).
 *  React Native screens are exercised on the Vega simulator and device. */
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
