import { NextResponse, type NextRequest } from "next/server";
import { apiMsg, API_MESSAGES, type ApiMsgKey } from "./api-messages";
import type { AuthDenial, DenialReason } from "./auth";

/**
 * 401/403 统一响应出口（W2 · F-02）
 *
 * 背景：既有 handler 拿到 `getWorkspaceContext() === null` 后一律回 401，
 * 于是「身份有效但无权」也被说成「未授权」。客户端 `lib/api.ts` 见 401 会先
 * 做一次 token refresh 再重试——对 403 场景那是无意义的一次往返，
 * 用户最终看到「未授权」，而真实原因是「你这个角色不能做这件事」。
 *
 * 本模块把「Denial → NextResponse」这一步收口到一处，保证：
 *  - status 与 reason 一一对应（不会 403 场景回 401）
 *  - message 一律取自 `api-messages.ts` 既有键，**不新增文案**
 *    （中英对称由既有键保证；新增键会破坏键级对称测试）
 *
 * 为什么复用通用键而不是新增四个词条：AC-10 只要求「取自既有键」。
 * 刻意复用 unauthorized / forbidden / noPermission 三个通用键，
 * 避免为一个判别联合引入四份新文案（且它们语义上确实就是这三类的细分）。
 */

/** DenialReason → api-messages 既有键 */
export const DENIAL_MESSAGE_KEY: Record<DenialReason, ApiMsgKey> = {
  // 没有身份：标准未授权
  unauthenticated: "unauthorized",
  // token 绑定的工作区与 URL 不一致：身份有效，但这条路径不该用它
  workspace_mismatch: "forbidden",
  // 不是该工作区成员：对用户最准确的说法是「无权限」，而非「未登录」
  not_a_member: "noPermission",
  // 写策略拒绝（如 viewer 写工作区数据）：角色不够
  write_policy: "noPermission",
};

/**
 * 把 Denial 转成统一信封的 NextResponse。
 *
 * @param denial getWorkspaceContextV2 返回的拒绝结果
 * @param req    可选；传入时按请求语言协商（与其余端点同口径），
 *               不传时取默认语言 zh（api-messages.ts 的既定默认）。
 */
export function authFailure(denial: AuthDenial, req?: NextRequest): NextResponse {
  const key = DENIAL_MESSAGE_KEY[denial.reason];
  const message = req ? apiMsg(req, key) : API_MESSAGES[key].zh;
  return NextResponse.json({ code: denial.status, message, data: null }, { status: denial.status });
}
