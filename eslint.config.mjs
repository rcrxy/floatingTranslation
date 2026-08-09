import typescriptEslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default [
   {
      ignores: [
         "package.json",
         "package-lock.json",
         ".vscode/**",
         "out/**",
         "dist/**",
         "*.config.js",
         "*.config.cjs",
         "*.config.mjs",
         "*.config.ts",
         "tsconfig*.json",
         ".prettierrc*",
      ],
   },
   {
      files: ["**/*.ts"],
   },
   {
      plugins: {
         "@typescript-eslint": typescriptEslint.plugin,
      },

      languageOptions: {
         parser: typescriptEslint.parser,
         ecmaVersion: 2022,
         sourceType: "module",
      },

      rules: {
         "@typescript-eslint/naming-convention": [
            "warn",
            {
               selector: "import",
               format: ["camelCase", "PascalCase"],
            },
         ],

         curly: ["warn", "multi-line"],
         eqeqeq: "warn",
         "no-throw-literal": "warn",
         semi: "warn",
      },
   },
   eslintConfigPrettier,
];
