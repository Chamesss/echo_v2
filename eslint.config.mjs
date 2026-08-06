import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Deliberately narrow: dead code, dropped promises, hook rules. No formatting —
 * this codebase has a consistent hand-written style and style rules would bury
 * the findings that matter.
 *
 * Type-aware (`projectService`) because `no-floating-promises` needs types to
 * tell deliberate `void fireAndForget()` from an accident.
 */
export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/drizzle/**", "**/*.tsbuildinfo"] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        // `_`-prefixed args mean "required by the signature, unused" — Express.
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",

      // Off with reasons, not by neglect:
      // Every `catch (err)` narrowing and non-string template interpolation.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      // `checksVoidReturn` fights React: onClick={() => navigate(…)},
      // onSubmit={form.handleSubmit(…)}, react-query's async onSuccess. All 32
      // first-run hits were one of those; none was a defect. The useful half
      // (a promise used as a condition) stays on.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
      // `async` without `await` here is interface conformance (email/S3 stubs).
      "@typescript-eslint/require-await": "off",
    },
  },

  {
    files: ["echo-server/**/*.ts"],
    languageOptions: { globals: globals.node },
    // Augmenting Express's `Request` needs `declare global { namespace Express }`.
    rules: { "@typescript-eslint/no-namespace": "off" },
  },

  {
    files: ["echo-front/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The existing disables are deliberate; keep new ones justified too.
      "react-hooks/exhaustive-deps": "error",
      /**
       * Warn, not error: these ship with react-hooks v7 and encode React 19 +
       * compiler assumptions. This app is React 18, where the flagged patterns
       * (resetting derived state on a key change, a media-query sync) are
       * conventional. Revisit on a React 19 move; the remaining sites are
       * annotated individually.
       */
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  // Plain-JS tooling files: no tsconfig owns them, so type-aware rules can't run.
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/unbound-method": "off",
      // The `any` in tests is deliberate: JSON.parse of socket frames, vi.mock
      // factories. Asserting on those values IS the test.
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      /**
       * Off because `--fix` on this rule produced code that does not compile,
       * twice: it stripped `as HTMLInputElement[]` from a testing-library query
       * (generic with an HTMLElement default), and `"open" as RealtimeStatus`
       * from a fixture where the cast WIDENS a literal for later reassignment.
       */
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
);
