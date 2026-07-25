import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'playwright-report', 'test-results']),
  // Frontend (browser, React)
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Empty catch blocks are deliberate for best-effort paths (localStorage,
      // clipboard, fire-and-forget fetches); require them to stay empty-only.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      // The app hydrates local state from the server (auth, settings, tabs) and
      // mirrors controlled props into local state in several places — accepted
      // patterns here, so the blanket ban on sync setState in effects is off.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  // Backend (Node) + tooling configs — no React rules, Node globals.
  {
    files: ['server/**/*.js', 'scripts/**/*.mjs', 'vite.config.js', 'playwright.config.js', 'eslint.config.js', 'diagnose-refresh.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  // Browser E2E tests execute in Node but callbacks passed to page.evaluate run
  // in Chromium, so both global sets are valid in this directory.
  {
    files: ['e2e/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
])
