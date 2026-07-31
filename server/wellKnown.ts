/**
 * /.well-known endpoints for the MOBILE store shells (v2.85).
 *
 * Digital Asset Links — Android's proof that the RELAY Android app (a Trusted
 * Web Activity wrapping this site) and this origin belong to the same owner.
 * When the file matches the app's signing-certificate fingerprint, Chrome
 * renders the TWA FULL-SCREEN (no URL bar) — the "real app" experience.
 *
 * Config (env, read per-request so the operator can set them without a code
 * change — same contract as the TURN_ vars):
 *   TWA_PACKAGE_NAME          — Android applicationId
 *                               (default: org.yourchat.relay — must match
 *                               mobile/android/app/build.gradle)
 *   TWA_SHA256_FINGERPRINTS   — comma-separated SHA-256 cert fingerprints
 *                               (colon-separated hex, as printed by
 *                               `keytool -list -v` or shown in Play Console →
 *                               App integrity → App signing). Play re-signs
 *                               uploads, so list BOTH the Play App Signing key
 *                               and the upload key.
 *
 * Until fingerprints are configured the route answers 404 with a hint — the
 * TWA still works, it just shows Chrome's URL bar.
 */
import type { Express, Request, Response } from "express";

export interface AssetLinksEnv {
  TWA_PACKAGE_NAME?: string;
  TWA_SHA256_FINGERPRINTS?: string;
}

export const DEFAULT_TWA_PACKAGE = "org.yourchat.relay";

/** Pure builder — unit-tested without HTTP. Returns null when unconfigured. */
export function buildAssetLinks(env: AssetLinksEnv): object[] | null {
  const raw = (env.TWA_SHA256_FINGERPRINTS || "").trim();
  if (!raw) return null;
  const fingerprints = raw
    .split(",")
    .map(f => f.trim().toUpperCase())
    // A SHA-256 cert fingerprint is 32 colon-separated hex bytes.
    .filter(f => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  if (fingerprints.length === 0) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: (env.TWA_PACKAGE_NAME || DEFAULT_TWA_PACKAGE).trim(),
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

export function registerWellKnown(app: Express) {
  app.get("/.well-known/assetlinks.json", (_req: Request, res: Response) => {
    const links = buildAssetLinks(process.env as AssetLinksEnv);
    if (!links) {
      res.status(404).json({
        error: "not configured",
        hint: "Set TWA_SHA256_FINGERPRINTS (comma-separated SHA-256 signing-cert fingerprints) and optionally TWA_PACKAGE_NAME — see mobile/README.md.",
      });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(links);
  });
}
