import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.npm-cache', '.local-backups', 'supabase/functions'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: globals.node } },
  { files: ['**/*.{ts,tsx}'], languageOptions: { globals: globals.browser }, plugins: { 'react-hooks': reactHooks }, rules: reactHooks.configs.recommended.rules }
)
