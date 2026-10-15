import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/src-tauri/**", "apps/api/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // The two classic hook rules, as v5's "recommended" had them. v7's recommended set adds the React Compiler
      // rules (set-state-in-effect, refs, purity…): adopting those is a refactor of its own, not a version bump.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Raw browser storage throws when site data is blocked or full; use safeLocal / safeSession (@orbit/ui).
      "no-restricted-globals": ["error",
        { name: "localStorage", message: "Use safeLocal from @orbit/ui: localStorage throws when storage is blocked." },
        { name: "sessionStorage", message: "Use safeSession from @orbit/ui: sessionStorage throws when storage is blocked." }],
      "no-restricted-properties": ["error",
        { object: "window", property: "localStorage", message: "Use safeLocal from @orbit/ui." },
        { object: "window", property: "sessionStorage", message: "Use safeSession from @orbit/ui." }],
    },
  },
  { files: ["**/*.test.{ts,tsx}", "**/test/**", "**/tests/**"], rules: { "no-restricted-globals": "off", "no-restricted-properties": "off" } },
);
