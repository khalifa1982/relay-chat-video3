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
 * v2.99.94 — ONLY TWO THINGS IN THIS BAR ARE TAPPABLE, and that is a reversal the
 * owner asked for in their own words: "whoever click on the bar anywhere in the top
 * bar. no need to take him to the profile only. there is two places to be clicked
 * either the profile on the right or the notification center". So the identity strip
 * and the brand mark are now INERT — v2.99.86 had made the strip a shortcut to
 * Profile, which is exactly what is being removed. Profile stays one tap from the
 * avatar's own menu, so nothing is unreachable. The BACK arrow on sub-pages is left
 * alone: it is a navigation control the owner was not talking about, and removing it
 * would strand people on every sub-page.
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
import { RoleBadge, roleFromFlags } from "./VerifiedBadge";
import { CountryFlag } from "./CountryFlag";
import {
  CONNECTION_LABEL,
  CONNECTION_TITLE,
  CONNECTION_VAR,
  useConnectionState,
} from "./connectionStatus";

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
 * The RELAY mark (v2.99.94): a heartbeat dot that cycles through three lights, the
 * wordmark with a once-every-30-seconds flourish, and the connection line underneath.
 *
 *   "colored light blue and there was a word mention Relay make type of animation
 *    that it keep blinking their light from lighter blue to light green to light
 *    different light and flashing similar to the heart way. this is for the dot on
 *    the top left and for the word rely make kind of nice animated animation for that
 *    word. it keep animated every 30 seconds … and below the flashy light put small
 *    line and [mention] online small letter."
 *
 * THE DOT IS THREE STACKED LAYERS, NOT ONE THAT CHANGES COLOUR. An animated
 * `background-color` repaints the element every frame, and this element sits on the
 * bar's `backdrop-blur-xl backdrop-saturate-150` surface — the most expensive host in
 * the app to repaint over (v2.99.84 measured that class of cost and removed 14 of
 * them from the call grid). So the colour comes from opacity cross-fades over a
 * STATIC opaque base, and the heartbeat is a `transform: scale` on the WRAPPER,
 * because two animations on one element do not compose (v2.99.85).
 *
 * THE 30-SECOND CADENCE COSTS NO TIMER. Both wordmark animations run a 30s cycle
 * whose visible portion is only the first ~2s, so the flourish fires every half
 * minute with no interval to arm, nothing to leak, and no re-render per tick.
 *
 * NOT A LINK ANY MORE — see the file header.
 */
export function BrandMark() {
  const conn = useConnectionState();
  return (
    <div className="flex shrink-0 flex-col items-start justify-center gap-[3px] pe-1">
      <div className="flex items-center gap-2">
        {/* The dot. The heartbeat scales this wrapper; the layers inside only fade. */}
        <span aria-hidden="true" className="relative block size-2.5 shrink-0 relay-heartbeat">
          {/* Base — light blue, opaque, and never animated, so the two overlays can
              only ever ADD a colour. Three opacities engineered to sum to 1 would
              show a transparent hole the moment their easing curves disagreed, and
              would leave whichever layer is declared last as the reduced-motion
              still frame. The glow is a static box-shadow (it scales with the
              heartbeat for free — a scaled shadow is not a repainted one). */}
          <span
            className="absolute inset-0 rounded-full"
            style={{
              background: "linear-gradient(135deg,#7DD3FC,#6EE7FF)",
              boxShadow: "0 0 10px rgba(110,231,255,.85)",
            }}
          />
          <span
            className="absolute inset-0 rounded-full relay-hue-a"
            style={{ background: "linear-gradient(135deg,#5EEAD4,#86EFAC)", opacity: 0 }}
          />
          <span
            className="absolute inset-0 rounded-full relay-hue-b"
            style={{ background: "linear-gradient(135deg,#C4B5FD,#A5F3FC)", opacity: 0 }}
          />
        </span>
        {/* The wordmark. It hides below 390px so the middle zone keeps its width on
            the smallest phones — the dot and the connection line always stay, so the
            bar never loses its anchor. ONE component handles both widths now: two
            call sites would mean two subscriptions to the connection store and the
            breakpoint restated in two places. */}
        <span className="relative max-[389px]:hidden">
          <span
            className="block text-sm font-extrabold tracking-[0.22em] text-foreground relay-word-pop"
            style={{ transformOrigin: "left center" }}
          >
            RELAY
          </span>
          {/* The sheen lives in its OWN clipping layer rather than on a shared
              `overflow-hidden` parent: the word swells to 1.07 and a parent that
              clipped the band would clip the swell along with it. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <span
              className="absolute inset-y-0 -left-6 w-6 relay-sheen"
              style={{
                background:
                  "linear-gradient(90deg,rgba(110,231,255,0),rgba(190,250,255,.55),rgba(110,231,255,0))",
              }}
            />
          </span>
        </span>
      </div>
      {/* The connection line. Colour AND word, never colour alone, so it does not
          depend on being able to tell green from amber. The colour is an inline CSS
          variable rather than a class: a class name composed at runtime is absent
          from the source at build time, so Tailwind's JIT never emits it — the trap
          already documented for the bottom tab bar's accents. */}
      <span
        role="status"
        aria-live="polite"
        title={CONNECTION_TITLE[conn]}
        className="text-[9.5px] font-semibold leading-none tracking-wide"
        style={{ color: `var(${CONNECTION_VAR[conn]})` }}
      >
        {CONNECTION_LABEL[conn]}
      </span>
    </div>
  );
}

/**
 * flag · FIRST NAME · badge  /  PIN
 *
 * INERT as of v2.99.94 — it displays who you are and navigates nowhere. It was a
 * shortcut to Profile in v2.99.86; the owner has since asked for the opposite ("no
 * need to take him to the profile only … there is two places to be clicked"), so the
 * whole middle of the bar is now a label. Profile remains one tap away inside the
 * avatar's menu.
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
    <div
      title={displayName}
      className="flex-1 min-w-0 flex flex-col items-center justify-center gap-0 px-1"
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
    </div>
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
