import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // Suppress "unused" lint warning for now-unused helpers retained for
  // future use (e.g. when we explicitly bind a domain).
  void LOCAL_HOSTS;
  void isIpAddress;

  const secure = isSecureRequest(req);

  /*
   * SameSite=Lax is the right choice for a same-origin app like RELAY.
   *
   * We previously used SameSite=None, which requires Secure=true and is
   * widely dropped by privacy-protective browsers (Safari ITP, Brave
   * Shields, Firefox ETP) when they treat the host as third-party. The
   * symptom: cookies silently disappear and the user looks signed out
   * after a navigation — the exact bug reported as "randomly disconnects
   * and my number changes".
   *
   * Lax is sent on top-level navigations (same-site GETs) and on all
   * same-origin requests, including same-origin fetch/XHR. The tRPC
   * client uses same-origin fetch with `credentials: "include"`, so the
   * cookie travels with every API call.
   *
   * On local non-HTTPS dev (`secure=false`), some browsers also refuse
   * SameSite=None entirely, which would have prevented dev-loop cookie
   * round-trips. Lax works in both dev and prod.
   */
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure,
  };
}
