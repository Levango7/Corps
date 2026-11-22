/**
 * 功能开关三态放量（env 驱动）——灰度基础设施。
 *
 * ─── 这是什么、不是什么 ─────────────────────────────────────────────
 * 这是**纯基础设施**：只提供「按 workspace 灰度放行某个功能」的裁决函数，
 * 当前**零业务调用**（没有任何 route / handler / 组件 import 它）。
 * 业务开关按 docs/ops/rollout-runbook.md 的 SOP 接入——第一个接线的功能
 * 由该 runbook 的「接入登记」小节记录，接了谁、谁批准、何时放量都写在那里。
 *
 * 为什么现在就要它：本仓唯一的灰度机制此前只有 WRITE_POLICY_MODE 三态
 * （lib/write-policy.ts，enforce/shadow/off）。它是**写策略专用**的——
 * 三态语义钉死在写权限场景（shadow=只记不拦），无法复用到「新功能先给
 * 少数工作区开」这类需求。本文件把同一套「三态 + fail-closed」惯例推广成
 * 通用的功能开关；正式生产实例上线后即插即用。
 *
 * ─── 三种放量态（FLAG_<NAME>_ROLLOUT）──────────────────────────────
 *   off（默认）     ：功能关闭，所有人都不可见。
 *   allowlist      ：仅 FLAG_<NAME>_WORKSPACES 白名单里的 workspace 可见，
 *                    用于灰度观察期（内部工作区 / 自愿试用租户）。
 *   on             ：全量放开，所有人可见。
 * 环境变量取值非法时按 off 处理（fail-closed）：拼错 env 只会「功能不可见」，
 * 不会「意外全量放开」。取值大小写不敏感（"ON" / "on" / "On" 等价）。
 *
 * ─── env 约定 ──────────────────────────────────────────────────────
 *   isFlagEnabled("NEW_EDITOR") 读这两个 key（flag 名 trim 后转大写，
 *   调用方写 camelCase / snake_case 都会落到同一组 env key）：
 *     FLAG_NEW_EDITOR_ROLLOUT    = off | allowlist | on
 *     FLAG_NEW_EDITOR_WORKSPACES = ws-a,ws-b（仅 allowlist 态读取）
 *   白名单是逗号分隔的 workspace id，条目两侧空白容忍；on 态即使配了
 *   WORKSPACES 也忽略（放量态语义以 ROLLOUT 为唯一裁决依据）。
 */

/** flag 的放量态。off = 关闭；allowlist = 白名单灰度；on = 全量 */
export type FlagRollout = "off" | "allowlist" | "on";

/**
 * 解析 ROLLOUT env：非法值 fail-closed 到 off。
 * 空串与拼错的值都不能成为「悄悄全量放开」的路径——对齐 write-policy 的
 * parseWritePolicyMode 惯例（那边非法值收口到最严的 enforce，这边收口到最严的 off）。
 */
export function parseFlagRollout(raw: string | undefined | null): FlagRollout {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "off":
      return "off";
    case "allowlist":
      return "allowlist";
    case "on":
      return "on";
    default:
      // 空串（未配置）与拼错的 env 一律 fail-closed：宁可功能不可见，不可意外放量
      return "off";
  }
}

/** 解析 WORKSPACES env：逗号分隔，去掉条目两侧空白与空段 */
export function parseFlagAllowlist(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** flag 名 → env 变量后缀：trim + 大写，调用方写法大小写不敏感 */
function flagEnvSuffix(flag: string): string {
  return flag.trim().toUpperCase();
}

/** flag 名对应的两个 env key（导出便于测试断言与运维排查时对照） */
export function flagEnvKeys(flag: string): { rollout: string; workspaces: string } {
  const suffix = flagEnvSuffix(flag);
  return {
    rollout: `FLAG_${suffix}_ROLLOUT`,
    workspaces: `FLAG_${suffix}_WORKSPACES`,
  };
}

/**
 * 裁决一次功能可见性。纯函数，不碰 env / 不碰 DB —— 环境由调用方读好传入，
 * 这样它能被单元测试与变异测试直接打（与 write-policy 的 decideWorkspaceWrite 同款）。
 *
 *   off        ⇒ false（恒关闭）
 *   on         ⇒ true（全量；即使 wid 缺失——on 态不看身份）
 *   allowlist  ⇒ wid 精确命中白名单才 true；wid 缺失 / 空白 ⇒ false
 *                （fail-closed：拿不出 workspace 身份的调用一律按未命中处理）
 */
export function decideFlag(rollout: FlagRollout, allowlist: string[], wid?: string): boolean {
  switch (rollout) {
    case "on":
      return true;
    case "allowlist": {
      const candidate = (wid ?? "").trim();
      if (candidate.length === 0) return false;
      return allowlist.includes(candidate);
    }
    case "off":
    default:
      return false;
  }
}

/**
 * 功能是否对（可选的）workspace 放行。
 *
 * 每次调用都现读 env——不缓存快照，env 在单进程内变更后下一次调用即生效
 * （部署环境里 env 仍以实例启动时注入的为准，改配置要重启实例，见 runbook）。
 * 当前零业务调用；业务接线按 docs/ops/rollout-runbook.md 执行。
 */
export function isFlagEnabled(flag: string, wid?: string): boolean {
  const keys = flagEnvKeys(flag);
  const rollout = parseFlagRollout(process.env[keys.rollout]);
  if (rollout === "allowlist") {
    return decideFlag(rollout, parseFlagAllowlist(process.env[keys.workspaces]), wid);
  }
  // off / on 态不读 WORKSPACES：放量语义只由 ROLLOUT 决定
  return decideFlag(rollout, [], wid);
}
