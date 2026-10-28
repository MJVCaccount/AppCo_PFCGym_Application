import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  // Plain CommonJS loader hook for the tests; it has to use require().
  { ignores: ["tests/support/*.cjs"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Rules that need type information. The plugin and parser come from
    // next/typescript above; this only switches the type-aware part on.
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      eqeqeq: ["error", "always"],
    },
  },
];

export default eslintConfig;
