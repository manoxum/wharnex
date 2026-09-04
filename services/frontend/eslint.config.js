import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'playwright-report', 'test-results'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-globals': ['error',
        { name: 'alert', message: 'Use the Wharness application dialog helpers instead of native browser dialogs.' },
        { name: 'confirm', message: 'Use confirmDialog from lib/appDialog instead of native browser dialogs.' },
        { name: 'prompt', message: 'Use promptDialog from lib/appDialog instead of native browser dialogs.' },
      ],
      'no-restricted-properties': ['error',
        { object: 'window', property: 'alert', message: 'Use noticeDialog from lib/appDialog.' },
        { object: 'window', property: 'confirm', message: 'Use confirmDialog from lib/appDialog.' },
        { object: 'window', property: 'prompt', message: 'Use promptDialog from lib/appDialog.' },
      ],
    },
  },
)
