/**
 * The app shell's mobile top bar, to the owner's three-zone spec (v2.99.86).
 *
 *   LEFT    "there is the green icon, green blue of rely, and rely make it flashy,
 *            glossy, glossy. and it's, like, animated slowly. Uh, nice animation,
 *            but don't make it so much."
 *   MIDDLE  "put the flag first, little small size, not the normal size, make it
 *            little small. Then the first name and then the badge and then the PIN
 *            number, three numbers dash three number, put it in green color."
 *   RIGHT   the notification bell (green when clear, red + blinking when not — see
 *            NotificationBell), then the avatar with a two-colour ring.
 *
 * THE MIDDLE ZONE IS TWO LINES, and that is the decision the whole layout rests on.
 * Seven monospace digits are ATOMIC — they cannot ellipsize without becoming a lie
 * about somebody's number — so on one line they compete against the name, the flag,
 * the badge, the wordmark, a back arrow and two 36px chips, and at 320px something
 * has to give. Putting the PIN on its own line takes it out of the contest
 * entirely: line 1 is flag + name + badge (the name is the only shrinker), line 2 is
 * the PIN alone. Vertical cost is zero because the bar's height was already set by
 * the 36px avatar, not by its text.
 */
import { Link } from "wouter";
import { RoleBadge, roleFromFlags } from "./VerifiedBadge";
import { CountryFlag } from "./CountryFlag";

/** `812345` → `812-345`. The owner's "three numbers dash three number". */
export function formatPin(n: string | null | undefined): string {
  if (!n || n.length !== 6) return n ?? "";
  return `${n.slice(0, 3)}-${n.slice(3)}`;
}

/** First name only, for a bar that has no room for two. */
export function firstNameOf(displayName: string | null | undefined): string {
  const t = (displayName ?? "").trim();
  if (!t) return "";
  return t.split(/\s+/)[0] || t;
}

/**
 * The RELAY mark: a green→cyan dot and the wordmark, with a slow sheen.
 *
 * The sheen TRANSLATES a narrow bright band behind `overflow-hidden`. It does not
 * animate `background-position`, which would repaint the element every frame — the
 * class of animation v2.99.84 measured and removed 14 of. It is also mostly idle by
 * design ("don't make it so much"): the band is off-screen for ~62% of a 5.5s cycle.
 */
export function BrandMark({ compact }: { compact?: boolean }) {
  return (
    <Link
      href="/app/dialer"
      aria-label="RELAY"
      className="relative flex items-center gap-2 shrink-0 overflow-hidden rounded-lg px-0.5 active:opacity-70 transition-opacity outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
    >
      <span
        className="size-2.5 rounded-full shrink-0"
        style={{
          background: "linear-gradient(135deg,#3FE0C5,#6EE7FF)",
          boxShadow: "0 0 10px rgba(63,224,197,.8)",
        }}
      />
      {!compact && (
        <span className="text-sm font-extrabold tracking-[0.22em] text-foreground">RELAY</span>
      )}
      {/* The sheen. `pointer-events-none` so it can never eat the tap, and inert
          under reduced motion (the class carries no animation there), where it
          simply sits off to the left at rest. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 -left-6 w-6 pointer-events-none relay-sheen"
        style={{
          background: "linear-gradient(90deg,rgba(110,231,255,0),rgba(190,250,255,.55),rgba(110,231,255,0))",
        }}
      />
    </Link>
  );
}

/**
 * flag · FIRST NAME · badge  /  PIN
 *
 * The whole block is one tap to the profile — which is also the fix for the thing
 * the owner has complained about twice, that reaching your own profile took a
 * dropdown hop.
 */
export function IdentityStrip({
  displayName,
  number,
  role,
  verified,
  countryCode,
  countryName,
}: {
  displayName: string;
  number: string;
  role?: string | null;
  verified?: boolean | null;
  countryCode?: string | null;
  countryName?: string | null;
}) {
  const first = firstNameOf(displayName) || "You";
  return (
    <Link
      href="/app/profile"
      title={displayName}
      aria-label={`${displayName}, number ${formatPin(number)} — open profile`}
      className="flex-1 min-w-0 flex flex-col items-center justify-center gap-0 rounded-lg px-1 active:opacity-70 transition-opacity outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
    >
      <span className="flex items-center gap-1.5 max-w-full">
        {/* The flag box is RESERVED whether or not geo resolved. `geoSelf` returns a
            null country for a LAN, VPN or GeoIP miss, and CountryFlag renders
            nothing for a non-2-letter code — so without a reserved box the whole
            identity block shifted sideways the moment geo landed, moving where the
            name truncates mid-session. "Little small size, not the normal size." */}
        <span className="shrink-0 grid place-items-center w-[15px]" aria-hidden={!countryCode}>
          <CountryFlag code={countryCode} title={countryName ?? countryCode ?? ""} className="text-[11px] leading-none" />
        </span>
        {/* The name is the ONLY shrinker in the row — everything else is atomic. */}
        <span className="min-w-0 truncate text-[13px] font-semibold leading-tight text-foreground">
          {first}
        </span>
        <span className="shrink-0 leading-none">
          <RoleBadge role={roleFromFlags(role, verified)} size={14} />
        </span>
      </span>
      {/* The PIN, alone on line 2 so it can never be squeezed. `dir="ltr"` plus bidi
          ISOLATION (the v2.99.77 lesson) so an Arabic first name above cannot
          reorder the digits or the dash. The green is a token measured to pass AA in
          BOTH themes — the presence-LED green fails it for text at this size. */}
      <span
        dir="ltr"
        className="font-mono text-[11.5px] font-semibold leading-tight tabular-nums [unicode-bidi:isolate] text-[color:var(--relay-green-text)]"
      >
        {formatPin(number)}
      </span>
    </Link>
  );
}

/**
 * The avatar: a two-colour ring that breathes green↔white, a presence LED, and a
 * pip when there is a live status.
 *
 * The ring is TWO stacked rings whose opacities cross-fade, half a cycle apart —
 * never an animated border-color or conic gradient, both of which repaint. The
 * anti-phase comes from a negative delay rather than `animation-direction: reverse`,
 * because on a symmetric keyframe with a point-symmetric easing `reverse` is an
 * EXACT no-op (verified numerically) and both rings would peak together, rendering
 * as a white ring blinking — the one thing the owner ruled out.
 *
 * Not a button: the caller wraps it in the dropdown trigger, and a button inside a
 * button is invalid HTML (v2.99.39).
 */
export function AvatarRing({
  avatarUrl,
  displayName,
  initials,
  dnd,
  hasStatus,
}: {
  avatarUrl?: string | null;
  displayName: string;
  initials: string;
  dnd: boolean;
  hasStatus: boolean;
}) {
  return (
    <span className="relative block size-9 shrink-0">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={displayName}
          className="size-9 rounded-full object-cover"
        />
      ) : (
        <span
          className="size-9 rounded-full grid place-items-center font-bold text-sm"
          style={{ background: "linear-gradient(135deg,#3FE0C5,#6EE7FF)", color: "#08211d" }}
        >
          {initials}
        </span>
      )}
      {/* The two rings. `inset-[-2px]` keeps the whole halo inside the header's
          padding at 320px — a wider outset bled past the edge and was sliced by the
          bar's own clipping. */}
      <span
        aria-hidden="true"
        className="absolute inset-[-2px] rounded-full pointer-events-none relay-ring-a"
        style={{ boxShadow: "0 0 0 2px var(--relay-online)" }}
      />
      {/* Ring B rests at opacity 0. Under REDUCED MOTION neither ring animates, and
          without this the later-declared white ring sat at full opacity and covered
          the green one — a plain white ring as the still frame, which is not what the
          moving version looks like. A running animation outranks an inline style for
          the property it animates, so this only governs the rest state. */}
      <span
        aria-hidden="true"
        className="absolute inset-[-2px] rounded-full pointer-events-none relay-ring-b"
        style={{ boxShadow: "0 0 0 2px rgba(255,255,255,.92)", opacity: 0 }}
      />
      {/* Presence LED — amber while Do Not Disturb is on, so the ring's green can
          never be read as "alerts are getting through". */}
      <span
        className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card"
        style={{ background: dnd ? "var(--relay-dnd)" : "var(--relay-online)" }}
      />
      {/* "There is a story here" lives on this pip, NOT on the ring. The ring means
          "this is you"; making it also mean "you posted something" would change an
          identity signal whenever you post a photo, and it would contradict
          PeerAvatar, where a ring means somebody ELSE'S unseen story. */}
      {hasStatus && (
        <span
          className="absolute -left-0.5 -top-0.5 size-2.5 rounded-full border-2 border-card"
          style={{ background: "linear-gradient(135deg,#a855f7,#6d28d9)" }}
          title="You have an active status"
        />
      )}
    </span>
  );
}
