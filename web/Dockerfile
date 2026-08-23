# syntax=docker/dockerfile:1
# 多阶段构建：依赖安装 → 构建 → 运行
# 依赖 next.config.ts 的 output: "standalone" 产出最小运行包

# ===== 阶段1: 安装依赖 =====
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
RUN npx prisma generate

# ===== 阶段2: 构建 =====
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# app/design-tokens.css 已由上方 COPY . . 带入。
# prebuild 脚本依赖仓库根 design/ 目录（不在 web/ 构建上下文内），会失败；
# 故直接调用 next build 跳过 prebuild 钩子，复用已存在的 app/design-tokens.css。
RUN npx next build

# ===== 阶段3: 运行 =====
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# standalone 产物已含最小 node_modules；补充 prisma 客户端与静态资源
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
EXPOSE 3000
CMD ["node", "server.js"]