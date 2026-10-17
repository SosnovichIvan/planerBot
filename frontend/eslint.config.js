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
    files: ['src/pages/**/*.tsx'],
    ignores: ['src/**/*.test.*'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'JSXOpeningElement[name.name=/^(button|input|textarea|select)$/]',
        message: 'Use the themed control from shared/ui instead of duplicating a native control on the page.',
      }, {
        selector: 'JSXAttribute[name.name="style"]',
        message: 'Use Tailwind utilities/tokens or the owning component stylesheet instead of inline styles.',
      }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks, 'import-x': importX },
    rules: { ...hooks.configs.recommended.rules, 'import-x/no-cycle': 'error' },
  },
);
