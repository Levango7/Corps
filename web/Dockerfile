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
# Prisma 引擎二进制默认从 binaries.prisma.sh 拉取，国内网络下常 ECONNRESET
# （2026-10-04 实测：构建在 deps 阶段 7/7 失败退出，而本机已有镜像能跑，
#   说明这是"能构建"与"不能构建"之间的网络脆弱性，不是代码问题）。
# 处理：改用 npmmirror 的二进制镜像，并直接调用本地 bin 而非 npx。
# 如需自建镜像，构建时覆盖：docker compose build --build-arg PRISMA_ENGINES_MIRROR=...
ARG PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
ENV PRISMA_ENGINES_MIRROR=${PRISMA_ENGINES_MIRROR}
RUN ./node_modules/.bin/prisma generate

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
# Prisma 7 布局变更：不再生成外置的 .prisma/client 目录（client 产物内联在
# @prisma/client 包内，由 Next standalone tracing 自动追踪）。本步骤保留为
# 防御性兜底——若未来版本重新引入外置产物目录，仍会被拷贝进 standalone。
RUN CLIENT_DIR=$(find node_modules -path "*/.prisma/client" -type d 2>/dev/null | head -1) \
    && if [ -n "$CLIENT_DIR" ]; then \
      mkdir -p .next/standalone/node_modules/.prisma/client \
      && cp -rL "$CLIENT_DIR"/* .next/standalone/node_modules/.prisma/client/; \
    else \
      echo "[build] v7 布局：无外置 .prisma/client 目录，跳过（产物随 @prisma/client 包追踪）"; \
    fi

# ===== 阶段3: 运行 =====
FROM docker.m.daocloud.io/library/node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Next.js standalone 运行时端口
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 安装 postgresql-client：entrypoint.sh 在 RLS_ACTIVATE=true 时需用 psql 执行
# db/rls-activate.sql（创建 corps_app 角色 + FORCE ROW LEVEL SECURITY）。
# 缺 psql 会使 entrypoint 跳过激活，corps_app 角色未创建，应用以该角色的
# DATABASE_URL 启动时连接被拒——P0 生产阻塞。必须在 runner 阶段（USER 切换前）安装。
RUN apk add --no-cache postgresql-client

# 全局安装 prisma CLI（用于启动时 prisma migrate deploy）
# pnpm 的符号链接结构使得局部 prisma CLI 难以稳定复制，全局安装最简单可靠
# v7：CLI 必须与 @prisma/client 同版本（v6 CLI 搭配 v7 client 会拒绝运行）
RUN npm install -g prisma@7.10.0

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
# Prisma 7：CLI 配置主入口（datasource.url 的唯一来源），migrate deploy 必需
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts

# 入口脚本：先执行 prisma migrate deploy，再启动 Next.js
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh
# cron 调度入口（compose 的 cron 服务复用本镜像，entrypoint 指到此脚本）
COPY --chown=nextjs:nodejs docker/entrypoint-cron.sh ./entrypoint-cron.sh
RUN chmod +x ./entrypoint.sh ./entrypoint-cron.sh

# IM 附件的本地存储目录必须在 USER 切换前建好并交给 nextjs 拥有。
# 缺这一步时 /app 是 root:root 0755，以 uid 1001 运行的应用调
# fs.mkdir('/app/uploads', {recursive:true}) 直接 EACCES ⇒ 上传恒 500；
# compose 就算挂了 uploads_data 卷，空卷挂到"镜像里不存在的目录"上也会得到
# root:root 的挂载点，同样写不进去（2026-10-06 两种形态都实测复现）。
RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app/uploads

# 声明运行时需要的环境变量（仅文档作用，仍需在 docker run/compose 中提供）
ENV DATABASE_URL=""
ENV BETTER_AUTH_SECRET=""
ENV JWT_ACCESS_SECRET=""
ENV JWT_REFRESH_SECRET=""
ENV NEXT_PUBLIC_APP_URL="http://localhost:3000"
# 结构化日志级别（debug/info/warn/error/fatal），默认 info
ENV LOG_LEVEL="info"

USER nextjs

EXPOSE 3000

# 健康检查：访问 /api/health 端点
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# 用 ENTRYPOINT 而非 CMD：compose 虽会显式覆盖 entrypoint，但这样能保证镜像
# 脱离 compose 独立运行时也能正确启动（v0.2.0 曾出现镜像层 ENTRYPOINT 元数据丢失）
ENTRYPOINT ["/app/entrypoint.sh"]
