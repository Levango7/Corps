/**
 * 剪贴板写入（带降级）。
 *
 * `navigator.clipboard` 只在安全上下文（HTTPS / localhost）暴露，自托管环境常走
 * HTTP 局域网地址，此时该对象直接是 undefined；即使在安全上下文，权限被拒也会抛错。
 * 这里先走异步 Clipboard API，失败再降级到 textarea + execCommand，
 * 两条路都不通才抛错——由调用方决定怎么提示，避免"点了复制但什么也没发生"的静默失败。
 */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 权限被拒 / 文档失焦等：继续尝试降级路径
    }
  }

  if (copyViaTextarea(text)) return;
  throw new Error("clipboard unavailable");
}

/** 经典复制手法：临时 textarea + execCommand("copy")。返回是否成功。 */
function copyViaTextarea(text: string): boolean {
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  // readonly 可避免 iOS 上弹出输入法；移出视口避免页面滚动跳动
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  let ok: boolean;
  try {
    // execCommand 在部分环境会抛异常，捕获后按失败处理
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(textarea);
  }
  return ok;
}
