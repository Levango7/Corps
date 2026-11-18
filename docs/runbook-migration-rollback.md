# corps 迁移回滚手册（Runbook）

> 适用场景：上线（切版）含数据库迁移，部署失败或上线后需要回退时的数据库处置。
> 事实依据：`deploy/scripts/deploy.sh`、`deploy/scripts/rollback.sh`、
> `deploy/scripts/restore.sh`、`web/docker/entrypoint.sh`（均以 main 实际实现为准）。
> 更新日期：2026-11-17。

---

## 0. 铁律：为什么数据库"回退"不是一条命令的事

**Prisma migrate 只有前滚（`migrate deploy`），没有 `migrate down`。**
迁移一旦应用到生产库，就没有"撤销这条迁移"的官方命令。因此：

- **镜像回退 ≠ 数据库回退。** `rollback.sh` 只回滚镜像 tag，schema 停在已迁移的状态。
- 数据库回退的唯一路径是 **`restore.sh` 从上线前的 `pg_dump` 快照恢复**——
  那是"整库还原"，不是"撤销迁移"。
- 常见组合故障：回退镜像后得到「旧代码 + 新 schema」（旧代码引用已被删除/改名的列，
  应用启动即报错）；反向组合「新代码 + 旧 schema」同样起不来。schema 与代码必须一起回到同一个版本。

## 1. 迁移在切版流程中的确切位置

`deploy.sh` 的 7 步序列中，迁移发生在**第 5 步的容器启动阶段**，不在 deploy.sh 本身：

```
deploy.sh
  ├─ 1. preflight.sh（只读校验）
  ├─ 2. 记录 DEPLOY_FROM_TAG → deploy/VERSION.previous
  ├─ 3. pg_dump 快照 → ${BACKUP_DIR}/corps_predeploy_<时间戳>.dump   ← 数据库还原点
  ├─ 4. docker compose pull app
  ├─ 5. docker compose up -d --no-deps app                          ← 容器启动
  │      └─ web/docker/entrypoint.sh（set -e）：
  │           prisma migrate deploy（以 DATABASE_OWNER_URL 连接）
  │           → 迁移失败 ⇒ 容器立即退出
  ├─ 6. 健康检查轮询（上限 ${CORPS_HEALTH_TIMEOUT}s）
  │      └─ 容器退出 ⇒ 健康检查红 ⇒ deploy.sh 自动执行 rollback.sh（镜像回退）
  └─ 7. 写 deploy/VERSION
```

关键保证（读 deploy.sh 实现可逐行核验）：

- **迁移执行前必有新鲜快照**：第 3 步每次部署都新打一份 `corps_predeploy_*.dump`
  （`pg_dump --format=custom`，与每日备份同格式），且备份失败直接 `die`——
  流程根本走不到第 5 步。第 3 步到迁移之间只发生 pull 和 up，不写库，
  所以快照语义 = 「迁移前一瞬间的 schema + 数据」。
- 首次部署（VERSION 为空且 db 未运行）跳过快照：新库没有历史可回退，不适用本 runbook。
- 迁移失败时 deploy.sh 不会继续部署（健康检查不过即中止 + 自动镜像回退），并打印
  「恢复路径」两步命令，其中直接给出本次快照的文件路径。

迁移可能**部分成功**：连续多条迁移时，前面几条已应用、后面一条失败。
此时 `_prisma_migrations` 表里已有记录，库处于"半新"状态——同样走下面的 SOP，
且必须以快照整库还原，不能只"重跑失败的迁移"。

## 2. 标准回滚 SOP

以下命令均在生产服务器、仓库根目录执行（compose 走 `corpse_compose` 包装：
`docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod`）。

### 第 0 步：判定要不要动数据库

```bash
docker logs corps-app --tail 50          # 迁移报错会在这里（容器退出的头号原因）
diff deploy/VERSION.previous deploy/VERSION 2>/dev/null || true
```

- 本次上线**不含迁移**（日志无 `[entrypoint] 以 owner 连接执行 Prisma migrate deploy...`，
  或两个 VERSION 相同）⇒ 只回滚镜像即可，跳到第 1 步后收工。
- 本次上线**含迁移**且已应用（哪怕随后失败）⇒ 镜像回退 + 数据库恢复都要做，走完整流程。

### 第 1 步：回退镜像

```bash
bash deploy/scripts/rollback.sh            # 回到 VERSION.previous 记录的 tag
# 或显式指定：bash deploy/scripts/rollback.sh 0.2.0
```

脚本内部：pull 目标镜像 → `up -d --no-deps app` → 健康检查 → 交换 VERSION/VERSION.previous。
若这是 deploy.sh 自动触发的回滚，此步已经执行过，不要重复跑。

### 第 2 步：验证上线前快照（不碰生产库）

```bash
bash deploy/scripts/restore.sh --list                                  # 列备份 + 逐个验完整性
bash deploy/scripts/restore.sh --dry-run /opt/corps/backups/corps_predeploy_<时间戳>.dump
```

`--dry-run` 把快照恢复到临时库 `corps_restore_check`，输出核心表（users /
workspaces / documents / document_versions / messages）行数。判定标准：

- 快照应含迁移前的 schema 与数据；行数与线上规模量级一致。
- 「一个核心表都没有」⇒ 这份快照不可用，换 `--list` 里上一份 `corps-*.dump`（每日备份）重验。
- 生产库全程零接触；临时库保留着，可 `psql` 进去人工抽查。

### 第 3 步：真恢复（覆盖生产库）

```bash
bash deploy/scripts/restore.sh --force /opt/corps/backups/corps_predeploy_<时间戳>.dump
```

脚本内置三道闸（缺一不可）：

1. 必须先用 `--dry-run` 验证过**同一份文件**；
2. 恢复前自动对当前生产库再做一次 `pg_dumpall`（能退回去才允许往下走）；
3. 交互确认：手动输入 `RESTORE` 四个字母。

### 第 4 步：恢复后验证点

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env.prod up -d --no-deps app          # 以回退后的镜像重建 app（迁移随 entrypoint 重跑空转）
curl -fsS http://127.0.0.1/api/health | grep '"status":"ok"' # 健康检查
```

再人工冒烟：登录 → 打开任一 workspace 文档列表 → 抽查第 2 步记下的核心表行数。

### 收尾

- 清理临时库：`docker compose ... exec db psql -U postgres -d postgres -c 'DROP DATABASE corps_restore_check;'`
- 确认 `deploy/VERSION` 与运行容器一致（rollback.sh 已交换写入）。
- 工单记录：故障时间线、快照文件名、恢复后行数、数据丢失窗口（见 §3）。

## 3. 数据丢失窗口

`restore.sh --force` 是**整库还原**：库会被替换成快照那一刻的状态。
因此从「第 3 步快照打完」到「故障发生」之间发生的所有写入都会丢失：

- 常规升级（快照在部署前几分钟打的）：丢失窗口 = 快照时刻 → 恢复时刻，通常只有
  部署期间的零星写入，可接受。
- 若事故发现得晚（如上线后数小时才决定回退）：丢失窗口 = 快照时刻 → 现在，
  **期间的全部业务数据都会没**。这种情况先评估窗口大小，必要时从每日备份
  `corps-*.dump` 里挑一份更接近"回退决定时刻"的、且 schema 兼容旧镜像的快照，
  并与业务 owner 确认可接受的丢失量后再执行 `--force`。
- 兜底：`--force` 前脚本自动打的 `pg_dumpall` 保留了"恢复前"的完整状态，
  事后需要找回丢失写入时从这里捞。

## 4. 带删数据迁移上生产前的检查单

上线含 `DELETE` / `DROP` / 列改型等破坏性 DDL 的迁移（RELEASE-READINESS-2026-10-17
点名切版连带 4 条迁移、其中一条删数据）之前，逐项打勾，缺一不上：

- [ ] **快照存在且新鲜**：确认 `deploy.sh` 第 3 步会打 `corps_predeploy_*.dump`
      （`BACKUP_DIR` 可写、corps-db 在运行、非首装跳过场景）。
- [ ] **恢复演练过**：拿最近一份真实备份跑过 `restore.sh --dry-run`，核心表行数判定
      通过（不是"脚本存在就算"，要真跑、真看过行数输出）。
- [ ] **回滚剧本对齐**：把本次迁移名填进 §2 SOP，确认第 2 步抽的表在删数据迁移
      之后仍可判定"恢复成功"（删掉的表恢复后应重新出现）。
- [ ] **owner 签字**：数据 owner 明确确认"回退 = 整库还原 + 丢失窗口"可接受，
      并给出决定回退时的联系方式。
- [ ] **迁移本身可暂停**：确认失败时的表现是"容器退出 + 健康检查红"
      （deploy.sh 会自动镜像回退），而不是"应用带着半迁移 schema 继续跑"。
- [ ] 条件允许时把删数据写成三段式（先加新列/双写 → 切读 → 下个版本再删旧列），
      让"回退"退化为普通的镜像回退。

## 5. 相关文件索引

| 文件 | 角色 |
|---|---|
| `deploy/scripts/deploy.sh` | 一键升级；第 3 步打快照，失败时打印恢复路径 |
| `deploy/scripts/rollback.sh` | 镜像回退（只回镜像不回 DB，输出会指向本 runbook） |
| `deploy/scripts/restore.sh` | DB 恢复（--list / --dry-run / --force 三模式） |
| `web/docker/entrypoint.sh` | 容器启动时执行 `prisma migrate deploy` 的位置 |
| `docs/runbook-deploy.md` | 部署主手册（§4 回滚流程、§7 备份与恢复） |
