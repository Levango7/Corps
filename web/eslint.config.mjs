import js from "@eslint/js";
import ts from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default [
  // 基础推荐规则
  js.configs.recommended,
  ...ts.configs.recommended,

  // Next.js 推荐规则
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },

  // 自定义规则
  {
    rules: {
      // TypeScript
      "@typescript-eslint/no-unused-vars": ["error", { argIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": "off",

      // 通用
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
      "prefer-const": "error",
    },
  },

  // 忽略
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "prisma/generated/**",
     "*.config.*",
   ],
  },
];