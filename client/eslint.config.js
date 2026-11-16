import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import i18next from 'eslint-plugin-i18next'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * Files whose member-facing copy has moved to the catalogs in src/locales.
 * In these files a hard-coded string in JSX is an error, so a new string
 * cannot ship untranslated. The list only grows: add a file or folder in the
 * same PR that migrates it (docs/engineering/standards.md, section 3).
 * Admin (src/features/admin) stays English and is never listed.
 */
const I18N_MIGRATED = [
  'src/pages/NotFoundPage.tsx',
  'src/pages/OfflinePage.tsx',
]

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'e2e', 'playwright-report', 'test-results', 'playwright.config.ts', 'src/lib/database.types.ts', 'android', 'ios']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  {
    files: I18N_MIGRATED,
    ignores: ['**/*.test.{ts,tsx}', 'src/__tests__/**'],
    plugins: { i18next },
    rules: {
      // Text between tags, the attributes that carry copy, and strings inside
      // JSX expressions. Paths ("/search") and lowercase tokens ("secondary")
      // are not copy.
      'i18next/no-literal-string': ['error', {
        mode: 'jsx-only',
        'jsx-attributes': { include: ['title', 'placeholder', 'alt', 'label', 'aria-label', 'aria-description', 'description', 'subtitle', 'helperText', 'emptyText', 'confirmLabel', 'cancelLabel', 'message', 'heading', 'tooltip', 'hint'] },
        words: { exclude: ['[0-9!-/:-@[-`{-~]+', '[A-Z_-]+', '/.*', '[a-z0-9_-]+'] },
      }],
    },
  },
])
