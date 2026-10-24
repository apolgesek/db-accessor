const tseslint = require('typescript-eslint');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/cdk.out/**', '**/*.d.ts'],
  },
  ...tseslint.configs.recommended,
  // Enables eslint-plugin-prettier and eslint-config-prettier. Keep it last so it can turn off conflicting rules.
  eslintPluginPrettierRecommended,
  {
    rules: {
      'prettier/prettier': [
        'error',
        {
          tabWidth: 2,
        },
      ],
    },
  },
);
