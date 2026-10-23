import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';

// Rules are only turned off with a reason. Everything else in the presets is
// enforced and the code is fixed to meet it.
export default tseslint.config(
  { ignores: ['dist/', 'coverage/', '.tools/', 'artifacts/', 'node_modules/'] },
  js.configs.recommended,
  unicorn.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      // Geometry and SVG code uses conventional short names (e, i, dx, svg, attrs); spelling them out hurts reading.
      'unicorn/prevent-abbreviations': 'off',
      // One-line case clauses keep the many dispatch tables compact; no-case-declarations still demands braces where a case declares.
      'unicorn/switch-case-braces': 'off',
      // Small helpers stay next to their only caller; hoisting them out of the closure makes the code harder to follow.
      'unicorn/consistent-function-scoping': 'off',
      // Conflict with Prettier, which removes the parentheses no-nested-ternary asks for and prints number literals in lower case.
      'unicorn/no-nested-ternary': 'off',
      'unicorn/number-literal-case': 'off',
      // Passing Number, Boolean or a local predicate to map/filter is intended; every callee is known and takes extra arguments safely.
      'unicorn/no-array-callback-reference': 'off',
      // In-place sort and reverse act on arrays the code has just built; toSorted/toReversed would copy them for nothing.
      'unicorn/no-array-sort': 'off',
      'unicorn/no-array-reverse': 'off',
      // `(await read()).field` is clearer than a temporary used once.
      'unicorn/no-await-expression-member': 'off',
      // null is part of JSON, of regular expression results and of the APIs this code calls.
      'unicorn/no-null': 'off',
      // The only http:// strings are the SVG namespace and the JSON Schema draft-07 URI, which are identifiers and must stay http.
      'unicorn/prefer-https': 'off',
      // TypeScript parameters typed `T | undefined` must still be passed; only redundant `return undefined` and defaults are flagged.
      'unicorn/no-useless-undefined': ['error', { checkArguments: false }],
      // reduce for sums, maxima and small folds is shorter and as clear as the loop it would become.
      'unicorn/no-array-reduce': 'off',
      // Chains of === on a discriminant narrow a union type in TypeScript; Array#includes does not.
      'unicorn/prefer-includes-over-repeated-comparisons': 'off',
      // Named imports from node:path (join, resolve) are the convention across the code base.
      'unicorn/import-style': ['error', { styles: { 'node:path': { named: true } } }],
    },
  },
  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // With noUncheckedIndexedAccess, reads at indices the code has just bounded use `!`; a runtime check there could never fail.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // SVG output is built from numbers in template literals on almost every line.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Spreading a string into code points is intended (font subsetting, coverage checks); graphemes go through Intl.Segmenter where they matter.
      '@typescript-eslint/no-misused-spread': 'off',
      // A leading underscore marks a binding that is deliberately unused, such as a property removed by rest destructuring.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      // `promise.catch(() => {})` is the idiom for ignoring a failure that is handled elsewhere.
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
    },
  },
);
