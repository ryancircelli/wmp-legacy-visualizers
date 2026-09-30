import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Old concatenated sources, A/B drivers and Playwright smokes are plain CommonJS/scripts, not linted.
  // assembly/ is AssemblyScript (its own types and decorators), checked by its compiler (npm run build:wasm).
  { ignores: ['dist', 'alchemy.html', 'src/*.js', 'tools', 'tests/*.js', 're', 'spec', 'site', 'assembly', 'tauri/target', 'tauri/gen', 'ios'] }, // ios/: observer.js is a function body Swift wraps
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // The engine is the old src/*.js wrapped verbatim (ARCHITECTURE.md "Engine"): its `var` hoisting,
    // `arguments` and let-never-reassigned are part of "same code", so the style rules that would rewrite them are off.
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-var': 'off',
      'prefer-const': 'off',
      'prefer-rest-params': 'off',
      'prefer-spread': 'off',
      'no-empty': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
    },
  },
  {
    // Engine unit tests poke engine internals, swap in fakes and spy on primitives; `any` there is the point.
    files: ['tests/engine/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'no-loss-of-precision': 'off', // DLL literals are written as the DLL's digits
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  { files: ['*.config.{js,ts}'], languageOptions: { globals: globals.node } },
);
