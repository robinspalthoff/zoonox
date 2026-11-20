import nextPlugin from "@next/eslint-plugin-next";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooksPlugin from "eslint-plugin-react-hooks";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "prisma/migrations/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: true,
      },
    },
    plugins: {
      "@next/next": nextPlugin,
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // TypeScript — nur Fehler, keine pedantischen Warnings im Blueprint
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      // react-hooks-Plugin registrieren, damit die `eslint-disable`-Kommentare
      // für exhaustive-deps eine gültige Regel referenzieren (sonst "rule not
      // found"-Fehler). Als Warning, nicht als Fehler — passt zur Blueprint-
      // Philosophie und lässt den Lint grün.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
