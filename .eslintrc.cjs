module.exports = {
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "prettier"],
  root: true,
  rules: {
    "@typescript-eslint/no-unused-vars": "error",

    // '@typescript-eslint/ban-ts-comment': 'off',
    // '@typescript-eslint/camelcase': 'off',
    // '@typescript-eslint/explicit-module-boundary-types': 'off',
    // '@typescript-eslint/no-empty-function': 'off',
    // '@typescript-eslint/no-explicit-any': 'off',
    // '@typescript-eslint/no-non-null-assertion': 'off',
    // '@typescript-eslint/no-unused-vars': 'off',
    // '@typescript-eslint/no-use-before-define': 'off',
    // '@typescript-eslint/no-var-requires': 'off',
    // '@typescript-eslint/no-this-alias': 'off',
    // 'no-console': 'warn',
    // 'prefer-const': 'off',
    // 'no-shadow': 'off',
    // '@typescript-eslint/no-shadow': ['error'],
    // 'no-only-tests/no-only-tests': 'error',
  },
};
