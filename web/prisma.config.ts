import type { PrismaConfig } from "prisma/config";

/**
 * Prisma 7 CLI 配置主入口（v7 起 schema 内的 datasource.url 已移除，CLI 的
 * 连接配置统一收敛到本文件）。
 *
 * 环境变量优先级：
 *   1. 运行方注入的 process.env（Docker entrypoint / CI job / 本机 export）
 *   2. 未注入时兜底加载仓库根 .env（本机开发跑 migrate/generate 的场景）
 *      —— Node >=20.12 内置 loadEnvFile，不引入 dotenv 依赖。
 *
 * 注意（2026-10-10 容器实测）：这里**只允许 type 导入**。生产镜像里 prisma CLI
 * 是全局安装（npm i -g，见 Dockerfile），而本文件位于 /app——若在运行时
 * `import { defineConfig } from "prisma/config"`，CLI 加载本文件时会报
 * `Cannot find module 'prisma/config'`（全局包不在 /app/node_modules 解析路径上），
 * 且 entrypoint 是 set -e，migrate deploy 静默失败会把容器拖进重启循环。
 * type 导入在转译期被擦除、无运行时解析，故用普通对象默认导出即可。
 */
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile("../.env");
  } catch {
    // 根 .env 不存在时忽略：CI/容器路径依赖显式注入的环境变量
  }
}

const config: PrismaConfig = {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // v7 起 seed 命令配置从 package.json#prisma 迁到本文件（原 db:seed 脚本保留）
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
};

export default config;
