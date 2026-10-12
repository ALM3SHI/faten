import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored, minified pdf.js worker.
    "public/**",
  ]),
]);

export default eslintConfig;
