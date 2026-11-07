#!/bin/sh
# cron 调度容器入口：复用 app 镜像，仅以 busybox crond 跑定时调用。
#
# 职责：按计划向 app 服务（compose 内网 service 名）发起九个 cron 路由调用——
#   - due-reminders             每天 01:00（CRON_TZ 时区，默认 UTC≈北京时间 09:00）
#   - check-overdue-actions     每天 01:30（决策行动项逾期通知；此前漏排=静默关闭，2026-11-07 补排）
#   - recycle-cleanup           每天 03:00（回收站过期清理，保留期默认 30 天；同上补排）
#   - check-expired-permissions 每天 04:00（临时授权过期回收；判定时有内联兜底，低频足够）
#   - cleanup-uploads           每周一 04:00
# 九个路由均以 CRON_SECRET Bearer 鉴权（与 /api/cron/* 路由约定一致）。
#
# 说明：
#   - wget 是 alpine 自带的；busybox crond -f 前台运行，容器主进程即调度器
#   - app 未就绪期间 wget 失败仅记日志，下一周期重试（路由端到端幂等/有日期窗口）
#   - 调度目标 host 用 compose service 名 app:3000，与 REDIS_URL 同一内网模式
set -eu

CRON_TZ="${CRON_TZ:-UTC}"
APP_HOST="${APP_HOST:-app:3000}"
CRON_SECRET="${CRON_SECRET:-}"

if [ -z "${CRON_SECRET}" ]; then
  echo "[entrypoint-cron] 错误：CRON_SECRET 未设置，调度调用会被 app 拒绝（401）。" >&2
  echo "[entrypoint-cron] 请在 .env 中设置 CRON_SECRET 后重新 docker compose up -d cron" >&2
  exit 1
fi

echo "----------------------------------------------------------"
echo " [entrypoint-cron] Corps cron 调度容器启动"
echo " 时区（CRON_TZ）：${CRON_TZ}"
echo " 调度目标（APP_HOST）：${APP_HOST}"
echo " 计划：due-reminders 每日 01:00 / check-overdue-actions 每日 01:30 / recycle-cleanup 每日 03:00 / check-expired-permissions 每日 04:00 / weekly-digest 每周一 02:00 / cleanup-uploads 每周一 04:00 / ai-push-runner 每 30 分钟 / ai-push-web 每 15 分钟 / calendar-reconcile 每周日 05:00"
echo "----------------------------------------------------------"

# busybox crontab 的 TZ 通过环境注入：crond 继承本进程环境，date 按 CRON_TZ 解释计划
export TZ="${CRON_TZ}"

CRONTAB_FILE="/tmp/corps-crontab"
cat > "${CRONTAB_FILE}" <<EOF
# corps cron 调度（时区 ${CRON_TZ}）
# 截止日提醒：每天 01:00（默认 UTC，即北京时间 09:00）
0 1 * * * wget -qO- --server-response --header="Authorization: Bearer ${CRON_SECRET}" "http://${APP_HOST}/api/cron/due-reminders" 2>&1 | tail -1 >> /proc/1/fd/1
# 决策行动项逾期通知：每天 01:30（此前漏排=功能静默关闭，2026-11-07 补排）
30 1 * * * wget -qO- --server-response --header="Authorization: Bearer ${CRON_SECRET}" "http://${APP_HOST}/api/cron/check-overdue-actions" 2>&1 | tail -1 >> /proc/1/fd/1
# 回收站过期清理：每天 03:00（保留期默认 30 天；幂等，重复跑无害）
0 3 * * * wget -qO- --server-response --header="Authorization: Bearer ${CRON_SECRET}" "http://${APP_HOST}/api/cron/recycle-cleanup" 2>&1 | tail -1 >> /proc/1/fd/1
# 临时授权过期回收：每天 04:00（auth.ts 判定时另有内联检查兜底，低频足够）
0 4 * * * wget -qO- --server-response --header="Authorization: Bearer ${CRON_SECRET}" "http://${APP_HOST}/api/cron/check-expired-permissions" 2>&1 | tail -1 >> /proc/1/fd/1
# 每周任务摘要（Pro）：每周一 02:00（默认 UTC，即北京时间周一 10:00）
0 2 * * 1 wget -qO- --server-response --header="Authorization: Bearer ${CRON_SECRET}" "http://${APP_HOST}/api/cron/weekly-digest" 2>&1 | tail -1 >> /proc/1/fd/1
# IM 附件孤儿清理：每周一 04:00（幂等，重复跑无害）
0 4 * * 1 wget -qO- --server-response --header="Authorization: Bearer ${CRON_SECRET}" "http://${APP_HOST}/api/cron/cleanup-uploads" 2>&1 | tail -1 >> /proc/1/fd/1
# AI 推送自动执行器：每 30 分钟检查到期 schedule
*/30 * * * * wget -qO- --server-response --header="Authorization: Bearer ${CRON_SECRET}" "http://${APP_HOST}/api/cron/ai-push-runner" 2>&1 | tail -1 >> /proc/1/fd/1
# AI 推送 Web Push：每 15 分钟发送未读推送的 Web Push 通知
*/15 * * * * wget -qO- --server-response --header="Authorization: Bearer ${CRON_SECRET}" "http://${APP_HOST}/api/cron/ai-push-web" 2>&1 | tail -1 >> /proc/1/fd/1
# 日历同步对账：每周日 05:00（对账非实时；reconcile.ts 的过期阈值就是 7 天，更高频无收益）
0 5 * * 0 wget -qO- --server-response --header="Authorization: Bearer ${CRON_SECRET}" "http://${APP_HOST}/api/cron/calendar-reconcile" 2>&1 | tail -1 >> /proc/1/fd/1
EOF

# crond 前台运行（-f），日志输出到 stdout（docker logs 可见）
# -l 2：日志级别 notice 以上（含每次 job 触发记录）
exec crond -f -l 2 -c /tmp
