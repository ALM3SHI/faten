import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import fs from "node:fs";
import { RAW_BUTTON_MESSAGE, RULES } from "./design-rules.mjs";

// Design system v2 guard. Files listed in design-debt.json have not been
// migrated yet and are exempt; every other file must stay on the system.
// The list only shrinks (scripts/design-debt.mjs).
const designDebt = JSON.parse(fs.readFileSync(new URL("./design-debt.json", import.meta.url), "utf8")).files;
const classRules = RULES.flatMap((rule) => [
  { selector: `Literal[value=/${rule.pattern}/]`, message: rule.message },
  { selector: `TemplateElement[value.raw=/${rule.pattern}/]`, message: rule.message },
]);
const rawButton = { selector: "JSXOpeningElement[name.name='button']", message: RAW_BUTTON_MESSAGE };

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The app is a static export: many pages set a `mounted` flag or read
      // localStorage in an effect to avoid hydration mismatches. That is the
      // documented pattern here, so keep it visible as a warning, not a CI blocker.
      "react-hooks/set-state-in-effect": "warn",
      // Remaining `any`s are at API/Firestore boundaries; tracked as warnings.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [...designDebt, "src/**/__tests__/**"],
    rules: { "no-restricted-syntax": ["error", ...classRules, rawButton] },
  },
  {
    // The primitives themselves are where <button> is allowed.
    files: ["src/components/ds/**", "src/components/ui/**"],
    ignores: designDebt,
    rules: { "no-restricted-syntax": ["error", ...classRules] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored, minified pdf.js worker.
    "public/**",
    // End-to-end build output and Playwright reports.
    "out-e2e/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
