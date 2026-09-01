# syntax=docker/dockerfile:1
# 多阶段构建：依赖安装 → 构建 → 运行
# 依赖 next.config.ts 的 output: "standalone" 产出最小运行包
#
# ── 镜像源说明 ────────────────────────────────────────────────────────────────
# 基础镜像统一使用 daocloud 镜像源（docker.m.daocloud.io），因为本机/内网环境
# Docker Hub 不可达。**三个阶段必须保持同一 node 版本与同一镜像源**：
# 曾出现过 deps/builder 用 node:20 编译、runner 却用 node:22 运行的配置，
# 会导致 prisma engines / sharp 等原生模块版本错配。
# 除镜像源外，本文件与上游正式配置保持一致（node:22 + corepack pnpm +
# --frozen-lockfile）。请勿为了"能构建"而降级 node/pnpm 版本或放弃
# --frozen-lockfile —— 这会让本地产物与 CI/生产不一致。

# ===== 阶段1: 安装依赖 =====
FROM docker.m.daocloud.io/library/node:22-alpine AS deps
WORKDIR /app
RUN corepack enable pnpm
# pnpm-workspace.yaml 必须与 lockfile 一同进入构建：其 overrides 参与了
# lockfile 的生成（ERR_PNPM_LOCKFILE_CONFIG_MISMATCH：缺它时 package.json
# 的 overrides 与 lockfile 记录不一致，frozen install 拒绝执行）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
# pnpm 11 默认会拒绝运行 prisma/esbuild/sharp 等的构建脚本并报错；
# 用 --ignore-scripts 跳过所有构建脚本，后面手动 prisma generate 生成客户端。
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN npx prisma generate

# ===== 阶段2: 构建 =====
FROM docker.m.daocloud.io/library/node:22-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prebuild 脚本依赖仓库根 design/ 目录（不在 web/ 构建上下文内），会失败；
# 故直接调用 next build 跳过 prebuild 钩子，复用已存在的 app/design-tokens.css
# （在构建前由 CI/部署脚本从 ../design/design-tokens.css 同步）。
RUN npx next build
# Prisma 引擎二进制（.node）不会被 Next.js standalone 自动追踪，需手动复制到 standalone。
# 用 find 定位引擎目录（pnpm 把它放在 .pnpm/@prisma+engines@.../node_modules/@prisma/engines）
RUN ENGINES_DIR=$(find node_modules -path "*/@prisma/engines" -type d 2>/dev/null | head -1) \
    && if [ -n "$ENGINES_DIR" ]; then \
      mkdir -p .next/standalone/node_modules/@prisma/engines \
      && cp -rL "$ENGINES_DIR"/* .next/standalone/node_modules/@prisma/engines/; \
    fi
# 同样复制 prisma client 的生成产物（.prisma/client 包含引擎 .node）
RUN CLIENT_DIR=$(find node_modules -path "*/.prisma/client" -type d 2>/dev/null | head -1) \
    && if [ -n "$CLIENT_DIR" ]; then \
      mkdir -p .next/standalone/node_modules/.prisma/client \
      && cp -rL "$CLIENT_DIR"/* .next/standalone/node_modules/.prisma/client/; \
    fi

# ===== 阶段3: 运行 =====
FROM docker.m.daocloud.io/library/node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Next.js standalone 运行时端口
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 全局安装 prisma CLI（用于启动时 prisma migrate deploy）
# pnpm 的符号链接结构使得局部 prisma CLI 难以稳定复制，全局安装最简单可靠
RUN npm install -g prisma@6.15.0

# 创建非 root 用户运行应用（安全基线）
# 注意：alpine 的 adduser/addgroup 是 busybox 实现，只支持短选项（-S/-u/-G/-g），
# 不支持 --system/--uid/--ingroup 长选项，使用长选项会导致构建失败。
# 另外 1001 可能已被占用，故加 || true 容错。
RUN addgroup -S -g 1001 nodejs 2>/dev/null || true; \
    adduser -S -G nodejs -u 1001 nextjs 2>/dev/null || true

# standalone 产物已含最小 node_modules（含上一步复制的 prisma 引擎 + client 生成产物）
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# 迁移文件 + schema（用于启动时 prisma migrate deploy）
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# 入口脚本：先执行 prisma migrate deploy，再启动 Next.js
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh
# cron 调度入口（compose 的 cron 服务复用本镜像，entrypoint 指到此脚本）
COPY --chown=nextjs:nodejs docker/entrypoint-cron.sh ./entrypoint-cron.sh
RUN chmod +x ./entrypoint.sh ./entrypoint-cron.sh

# 声明运行时需要的环境变量（仅文档作用，仍需在 docker run/compose 中提供）
ENV DATABASE_URL=""
ENV BETTER_AUTH_SECRET=""
ENV JWT_ACCESS_SECRET=""
ENV JWT_REFRESH_SECRET=""
ENV NEXT_PUBLIC_APP_URL="http://localhost:3000"

USER nextjs

EXPOSE 3000

# 健康检查：访问 /api/health 端点
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# 用 ENTRYPOINT 而非 CMD：compose 虽会显式覆盖 entrypoint，但这样能保证镜像
# 脱离 compose 独立运行时也能正确启动（v0.2.0 曾出现镜像层 ENTRYPOINT 元数据丢失）
ENTRYPOINT ["/app/entrypoint.sh"]
