import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';
import importX from 'eslint-plugin-import-x';

export default ts.config(
  { ignores: ['dist/**', 'coverage/**', 'cypress/screenshots/**', 'cypress/videos/**', 'cypress/downloads/**', 'src/shared/api/schema.d.ts'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  { files: ['cypress/**/*.ts'], languageOptions: { globals: { ...globals.mocha, cy: 'readonly', Cypress: 'readonly', expect: 'readonly' } } },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks, 'import-x': importX },
    rules: { ...hooks.configs.recommended.rules, 'import-x/no-cycle': 'error' },
  },
);
