import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';

// Rules are only turned off with a reason. Everything else in the presets is
// enforced and the code is fixed to meet it.
export default tseslint.config(
  // Dot-directories hold tool caches, editor state and nested worktrees, never source.
  { ignores: ['dist/', 'coverage/', 'artifacts/', 'node_modules/', '**/.*/'] },
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
      // The rule matches modules without the node: prefix, so the key is `path`.
      'unicorn/import-style': ['error', { styles: { path: { default: false, named: true } } }],
      // Match the existing style: conditional spreads use a ternary, one-line JSDoc stays on one line.
      'unicorn/consistent-conditional-object-spread': ['error', 'ternary'],
      'unicorn/single-line-block-comment-style': ['error', 'single-line'],
      // Same reason as prevent-abbreviations above: short conventional names (dir, e, svg) read better here.
      'unicorn/name-replacements': 'off',
      // Boolean names follow the UML and model vocabulary (abstract, derived, strict, created); an is or has prefix on each adds noise.
      'unicorn/consistent-boolean-name': 'off',
      // Documentation comments keep the standard JSDoc layout with an asterisk on every line.
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
      // `for (const c of node.children ?? [])` and a short filter in the loop header are the idiom for optional and selected items.
      'unicorn/no-unreadable-for-of-expression': 'off',
      'unicorn/no-duplicate-loops': 'off',
      // `break` ends a switch case or a search inside the layout and routing loops; moving each loop into a function would split the algorithms.
      'unicorn/no-break-in-nested-loop': 'off',
      // Printing a parsed result nests four calls (write, stringify, result, parse); five allows that and still stops deeper chains.
      'unicorn/max-nested-calls': ['error', { max: 5 }],
      // Conditions are ordered for type narrowing and short-circuiting (`next === undefined || next.startsWith(...)`), not by size.
      'unicorn/prefer-simple-condition-first': 'off',
      // Braces in plain strings are UML and PlantUML notation ({readOnly}, {field}, {static}), not misspelled interpolation.
      'unicorn/no-incorrect-template-string-interpolation': 'off',
      // Flags indexed reads of typed arrays and lookup tables, such as the router's blocked-cell grid, which are not existence checks.
      'unicorn/no-computed-property-existence-check': 'off',
      // `await promise.catch(() => {})` is the idiom for ignoring a failure that is handled elsewhere (see no-empty-function below).
      'unicorn/prefer-await': 'off',
      // The compile target is ES2024 (Node.js 22): Iterator.zip does not exist there, and the TypeScript library has no types for
      // Iterator#toArray, the other iterator helpers or the new Set methods.
      'unicorn/prefer-iterator-zip': 'off',
      'unicorn/prefer-iterator-to-array': 'off',
      'unicorn/prefer-iterator-helpers': 'off',
      'unicorn/prefer-set-methods': 'off',
      // A helper's parameters are its contract even when every caller passes the same value today; the fix inlines the value into the body.
      'unicorn/no-unnecessary-parameters': 'off',
      // Modules set up shared state when they load (the Ajv keywords, this config) and keep lazy singletons
      // (the font loader, the ELK instance) and the schema text collector at the top level by design.
      'unicorn/no-top-level-side-effects': 'off',
      'unicorn/no-top-level-assignment-in-function': 'off',
      // Values computed together are declared together at the top of a block, even when an early exit follows.
      'unicorn/no-declarations-before-early-exit': 'off',
      // Whole alternatives side by side (`back ? end(f, 'to') : end(f, 'from')`) read better than a ternary inside an argument,
      // and `cond ? test : false` keeps the result a boolean where `cond && test` would not.
      'unicorn/prefer-minimal-ternary': 'off',
      'unicorn/prefer-logical-operator-over-ternary': 'off',
      // Class fields are ordered by initialization dependency and reading order, not by visibility.
      'unicorn/consistent-class-member-order': 'off',
      // `path || '(document root)'` also replaces the empty string, which a default parameter would not.
      'unicorn/prefer-default-parameters': 'off',
      // A pass that repeats on its own result with a depth limit reads as recursion; the loop form is longer.
      'unicorn/no-useless-recursion': 'off',
      // SVG lengths carry units ("120px"), which parseFloat reads and Number() turns into NaN.
      'unicorn/prefer-number-coercion': 'off',
      // A guarded update (`if (score < best) { best = ... }`) reads better than the negated early exit these rules write.
      'unicorn/prefer-continue': 'off',
      'unicorn/prefer-early-return': 'off',
      // `flatMap(x => (keep ? [value] : []))` filters and maps in one pass with type narrowing.
      'unicorn/no-unnecessary-array-flat-map': 'off',
      // `[a[i], a[j]] = [a[j], a[i]]` is the swap idiom.
      'unicorn/no-unreadable-array-destructuring': 'off',
      // Default sort is right for strings; the type-aware rule for src below allows it only on string arrays.
      'unicorn/require-array-sort-compare': 'off',
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
      // Sorting without a compare function is allowed only where the elements are strings.
      '@typescript-eslint/require-array-sort-compare': ['error', { ignoreStringArrays: true }],
    },
  },
);
