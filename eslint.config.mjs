import astro from "eslint-plugin-astro";
import globals from "globals";
import tseslint from "typescript-eslint";

const complexityRules = {
  complexity: ["warn", { max: 15, variant: "modified" }],
  "max-depth": ["warn", 4],
  "max-lines-per-function": [
    "warn",
    { max: 100, skipBlankLines: true, skipComments: true, IIFEs: true },
  ],
};

export default [
  {
    ignores: [
      ".astro/**",
      ".githooks/**",
      ".vercel/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      parser: tseslint.parser,
      globals: globals.node,
    },
    rules: complexityRules,
  },
  ...astro.configs["flat/base"],
  {
    files: ["src/**/*.astro"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: complexityRules,
  },
  {
    files: ["src/**/__tests__/**/*", "src/**/*.{test,spec}.{ts,tsx}"],
    rules: {
      complexity: "off",
      "max-depth": "off",
      "max-lines-per-function": "off",
    },
  },
];
