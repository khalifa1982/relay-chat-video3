import { BadgeCheck } from "lucide-react";

/**
 * The "blue badge" shown next to a fully-verified (email-verified) user's name
 * everywhere their identity appears — contact lists, message threads, the
 * dashboard header, dialer preview, history roster, etc. A single component so
 * the mark is pixel-identical across the app. Render it ONLY when the relevant
 * `verified` flag (from whoami / directory / contacts / threads) is true.
 *
 * v2.99.6 (owner spec): superseded on the primary surfaces by the three-tier
 * RoleBadge below — kept for any remaining verified-only call sites.
 */
export function VerifiedBadge({
  className = "",
  size = 14,
  title = "Verified account",
}: {
  className?: string;
  size?: number;
  title?: string;
}) {
  return (
    <span
      title={title}
      aria-label="Verified"
      role="img"
      className={"inline-flex shrink-0 items-center text-[#2f7bff] dark:text-[#4c9bff] " + className}
    >
      <BadgeCheck width={size} height={size} aria-hidden="true" />
    </span>
  );
}

/* ── three-tier account badge (v2.99.6, owner spec) ──────────────────────────
 * Every user carries a check-mark badge tinted by ACCOUNT TIER, with the tier
 * name in very small type right under the mark (first letter capital):
 *   blue   ✓ Guest       — using RELAY without a registered account
 *   green  ✓ Registered  — email-verified account
 *   yellow ✓ Admin       — the operator's admin account (users.role = "admin")
 */
export type IdentityRole = "guest" | "registered" | "admin";

const ROLE_META: Record<IdentityRole, { color: string; label: string; title: string }> = {
  guest: { color: "#4c9bff", label: "Guest", title: "Guest — using RELAY without an account" },
  registered: { color: "#22c55e", label: "Registered", title: "Registered — email-verified account" },
  admin: { color: "#eab308", label: "Admin", title: "Admin — RELAY administrator" },
};

/**
 * Normalize a payload's badge inputs to a tier. `role` wins when present;
 * `null` means "no badge" (party lines); older cached payloads without the
 * field fall back to the verified flag (verified → Registered, else Guest).
 */
export function roleFromFlags(
  role?: string | null,
  verified?: boolean | null
): IdentityRole | null {
  if (role === "guest" || role === "registered" || role === "admin") return role;
  if (role === null) return null;
  return verified ? "registered" : "guest";
}

export function RoleBadge({
  role,
  size = 14,
  caption = true,
  className = "",
}: {
  role: IdentityRole | null | undefined;
  size?: number;
  /** The tiny tier name under the mark. On by default (owner spec). */
  caption?: boolean;
  className?: string;
}) {
  if (!role || !ROLE_META[role]) return null;
  const m = ROLE_META[role];
  return (
    <span
      title={m.title}
      aria-label={m.label}
      role="img"
      className={"inline-flex shrink-0 flex-col items-center leading-none " + className}
      style={{ color: m.color }}
    >
      <BadgeCheck width={size} height={size} aria-hidden="true" />
      {caption && (
        <span
          aria-hidden="true"
          className="mt-px font-semibold tracking-tight"
          style={{ fontSize: Math.max(7, Math.round(size * 0.52)) }}
        >
          {m.label}
        </span>
      )}
    </span>
  );
}
