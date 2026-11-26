/**
 * @param {{ mode?: "embedded" | "remote"; webUrl?: string; baseWindow?: Record<string, unknown>; updaterEndpoint?: string; updaterPubkey?: string }} input
 * @returns {Record<string, unknown>}
 */
export function buildReleaseConfig({
  mode,
  webUrl,
  baseWindow,
  updaterEndpoint,
  updaterPubkey,
}) {
  if (mode !== "embedded" && mode !== "remote") {
    throw new Error("RELEASE_MODE_INVALID");
  }

  if (mode === "embedded" && webUrl) {
    throw new Error("EMBEDDED_WEB_URL_NOT_ALLOWED");
  }

  const hasEndpoint = Boolean(updaterEndpoint?.trim());
  const hasPubkey = Boolean(updaterPubkey?.trim());

  if (mode === "embedded") {
    if (hasEndpoint !== hasPubkey) {
      throw new Error("UPDATER_PAIR_INCOMPLETE");
    }
    if (!hasEndpoint) {
      return {};
    }
    if (!/^https?:\/\/\S+$/.test(updaterEndpoint)) {
      throw new Error("UPDATER_ENDPOINT_NOT_HTTP");
    }
    return {
      plugins: {
        updater: {
          endpoints: [updaterEndpoint],
          pubkey: updaterPubkey,
        },
      },
    };
  }

  if (!webUrl) {
    throw new Error("REMOTE_WEB_URL_MISSING");
  }
  let parsed;
  try {
    parsed = new URL(webUrl);
  } catch {
    throw new Error("REMOTE_WEB_URL_INVALID");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("REMOTE_WEB_URL_INVALID");
  }
  if (/^https?:\/\/[^/?#]*@/i.test(webUrl)) {
    throw new Error("REMOTE_WEB_URL_USERINFO_NOT_ALLOWED");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  if (parsed.protocol === "http:" && !isLoopback) {
    throw new Error("REMOTE_WEB_URL_NOT_HTTPS");
  }
  if (
    !baseWindow ||
    typeof baseWindow !== "object" ||
    Array.isArray(baseWindow)
  ) {
    throw new Error("REMOTE_BASE_WINDOW_MISSING");
  }

  return {
    app: { windows: [{ ...baseWindow, url: webUrl }] },
    build: {
      frontendDist: webUrl,
      beforeBuildCommand: null,
    },
    bundle: { resources: [] },
    plugins: { updater: { endpoints: [], pubkey: "" } },
  };
}
