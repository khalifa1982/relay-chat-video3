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
        {/* The wordmark. NO BREAKPOINT — v2.103.2, owner: "I saw one time you put the
            relay logo up in the top bar. It's moving animated. Now it's not showing."
            v2.99.94 hid it below 390px to protect the middle zone, and MEASUREMENT
            says that was two whole phone sizes too cautious: at 360 / 375 / 390 / 430
            the word coexists with the longest name and the PIN with real slack, and
            even at 320 the only contact is the PEAK FRAME of the swell grazing an
            already-truncated name — which is why the swell is sized to 1.10, the
            largest peak that keeps positive slack at every measured width. So the word
            is now on every phone, including the 360px Androids and the 375px iPhones
            where it had been silently absent. */}
        <span className="relative">
          <span
            className="block text-sm font-extrabold tracking-[0.22em] text-foreground relay-word-pop"
            style={{ transformOrigin: "left center" }}
          >
            RELAY
          </span>
          {/* The sheen lives in its OWN clipping layer rather than on a shared
              `overflow-hidden` parent: the word swells and a parent that clipped the
              band would clip the swell along with it.
              v2.103.2 widens the band from 24px to 40px and brightens it. The word is
              64px, so a 24px band was a thin glint crossing it in a fraction of a
              second; 40px is most of the mark lighting up. This costs nothing in
              safety, because the band is clipped to the word's own box and therefore
              cannot reach anything beside it however wide it gets — unlike the swell,
              which is a transform and does paint outside its layout box. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <span
              className="absolute inset-y-0 -left-10 w-10 relay-sheen"
              style={{
                background:
                  "linear-gradient(90deg,rgba(110,231,255,0),rgba(205,252,255,.72),rgba(110,231,255,0))",
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
 * flag · FIRST NAME · badge
 *
 * INERT as of v2.99.94 — it displays who you are and navigates nowhere. It was a
 * shortcut to Profile in v2.99.86; the owner has since asked for the opposite ("no
 * need to take him to the profile only … there is two places to be clicked"), so the
 * whole middle of the bar is now a label. Profile remains one tap away inside the
 * avatar's menu.
 *
 * ── ONE LINE, AND THE NUMBER IS GONE (v2.106.77) ────────────────────────────
 * v2.99.86 made this TWO lines and the reason was sound at the time: seven
 * monospace digits are ATOMIC — they cannot ellipsize without lying about
 * somebody's number — so the PIN could not share a line with a name that
 * truncates. That constraint dies with the PIN itself.
 *
 * The owner asked for the number to come out ("remove the pin"), chosen against
 * the alternatives with the trade stated: on the Dialer their number was on
 * screen THREE times (here, the MY NUMBER card, and the dial readout), and this
 * is the copy that carries no affordance — the card below it has copy, QR and
 * share attached to the same digits.
 *
 * SAID PLAINLY, because it is the cost: the Dialer is the only tab with that
 * card, so on Messages / History / Contacts / Groups the viewer's own number is
 * now reachable only from Profile rather than from the chrome. That is the
 * decluttering they asked for, not an oversight.
 *
 * The name grows into the freed space. It stays the ONLY shrinkable element, so
 * the row still cannot overflow — a longer name truncates, which is the
 * behaviour a name has and a number does not.
 */
export function IdentityStrip({
  displayName,
  role,
  verified,
  countryCode,
  countryName,
}: {
  displayName: string;
  role?: string | null;
  verified?: boolean | null;
  countryCode?: string | null;
  countryName?: string | null;
}) {
  const first = firstNameOf(displayName) || "You";
  return (
    <div
      title={displayName}
      className="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-1"
    >
      {/* The flag box is RESERVED whether or not geo resolved. `geoSelf` returns a
          null country for a LAN, VPN or GeoIP miss, and CountryFlag renders
          nothing for a non-2-letter code — so without a reserved box the whole
          identity block shifted sideways the moment geo landed, moving where the
          name truncates mid-session. "Little small size, not the normal size." */}
      <span className="shrink-0 grid place-items-center w-[15px]" aria-hidden={!countryCode}>
        <CountryFlag code={countryCode} title={countryName ?? countryCode ?? ""} className="text-[11px] leading-none" />
      </span>
      {/* The name is the ONLY shrinker in the row — everything else is atomic. */}
      <span className="min-w-0 truncate text-[16px] font-semibold leading-tight text-foreground">
        {first}
      </span>
      <span className="shrink-0 leading-none">
        <RoleBadge role={roleFromFlags(role, verified)} size={15} />
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
          title="You have an active story"
        />
      )}
    </span>
  );
}
