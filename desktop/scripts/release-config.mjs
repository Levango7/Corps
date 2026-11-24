/**
 * @param {{ mode?: "embedded" | "remote"; webUrl?: string; updaterEndpoint?: string; updaterPubkey?: string }} input
 * @returns {Record<string, unknown>}
 */
export function buildReleaseConfig({
  mode,
  webUrl,
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
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol === "http:" && !isLoopback) {
    throw new Error("REMOTE_WEB_URL_NOT_HTTPS");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("REMOTE_WEB_URL_INVALID");
  }
  if (hasEndpoint || hasPubkey) {
    throw new Error("REMOTE_UPDATER_NOT_ALLOWED");
  }

  return {
    app: { windows: [{ url: webUrl }] },
    plugins: { updater: { endpoints: [], pubkey: "" } },
  };
}
