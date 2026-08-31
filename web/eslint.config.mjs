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
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": "off",

      // 通用
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "no-debugger": "error",
      "prefer-const": "error",
    },
  },

  // 脚本类文件允许 console 输出
  {
    files: ["prisma/**/*.ts", "tests/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },

  // 忽略
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "prisma/generated/**",
      // 浏览器直载脚本（不经打包器，运行于页面环境）
      "public/**",
      "*.config.*",
    ],
  },
];
