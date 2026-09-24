import { isIP } from "node:net";

export type ProxyMode = "none" | "caddy" | "edgeone";

export function parseProxyMode(explicit: string | undefined, legacyTrustProxy: boolean): ProxyMode {
  if (explicit === undefined) return legacyTrustProxy ? "caddy" : "none";
  const mode = explicit.trim().toLowerCase();
  if (mode === "none" || mode === "caddy" || mode === "edgeone") return mode;
  throw new Error("APP_PROXY_MODE must be none, caddy, or edgeone");
}

export function trustedClientIp(headers: Headers, mode: ProxyMode): string {
  const headerName = mode === "edgeone" ? "eo-connecting-ip" : mode === "caddy" ? "x-real-ip" : undefined;
  if (!headerName) return "shared";
  const candidate = headers.get(headerName)?.trim() ?? "";
  if (!candidate || candidate.includes(",")) return "shared";
  return isIP(candidate) ? candidate : "shared";
}
