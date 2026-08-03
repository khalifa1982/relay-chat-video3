/* ============================================================
   Admin panel (v2.99.76), restyled to board frames 2h + 5f.

   Owner: "why you dont do it at the backend / Or create for me an admin panel
   were i can change it".

   Find a person by number, email or name; change their 6-digit number, change
   their account type, delete them, and check why a notification did not reach
   their phone. That is the whole panel, on purpose — see the router's comment.
   The number change goes through the same single writer the self-service path
   uses, so it propagates to everyone who saved the old number and moves none of
   that person's data.

   The NOTIFICATION CHECK was added in v2.99.91 because a native push crosses five
   links and every one of them fails the same way from the phone: nothing happens.
   It reports each link separately, and the test send goes through the REAL sender —
   a parallel test path could pass while production was broken.

   The gate here is presentational only. Every procedure re-checks admin status
   server-side from the `users` row, so a client that renders this page anyway gets
   FORBIDDEN on each call rather than access.

   ── WHAT THE BOARD FRAMES CHANGED (2h Admin, 5f Admin — account tools) ────────
   Nothing was removed. The frames describe the surface this page already is, so
   this is a restyle plus two additions the frames call for and the app could
   already answer honestly:

     * 2h's four STAT TILES, fed by `useLiveStats` — the SAME hook the sign-in
       screen and the landing page read, so the console can never disagree with
       them about a number. Unknown renders as an em-dash, never as a confident 0
       (`getPublicStats` answers zeros when the database is down).
     * 2h's per-row ⋮. The four tools used to be four stacked outline buttons on
       the right of every row, which is what made the list cramped at phone width;
       they are now one 44px ⋮ menu and the panel each opens is a 5f CARD.

   TWO THINGS THE FRAMES ASK FOR AND THIS DOES NOT DO, said plainly:
     * 2h draws a gold "2 reports pending review" card. There is no reporting or
       moderation feature in this app, so that card would be a number invented for
       a screenshot. The gold warning treatment it demonstrates is spent on the
       FLEET media card instead, which reports real failures.
     * 5f puts the per-transport push detail as a short mono chip on the RIGHT of
       each row. The build's details are diagnostic sentences ("FIREBASE_SERVICE_
       ACCOUNT_JSON is present and parses", and the APNs hint naming three env
       vars) — they are the entire point of the readout and cannot fit there at
       390px, so they stay on their own line under the label.
   ============================================================ */
import type { ReactNode } from "react";
import { APP_VERSION } from "@shared/version";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  ShieldCheck,
  Search,
  Loader2,
  Hash,
  BellRing,
  Check,
  X,
  Trash2,
  MoreVertical,
  Radio,
} from "lucide-react";
import { RoleBadge } from "@/app/VerifiedBadge";
import type { IdentityRole } from "@/app/VerifiedBadge";
import { formatPin } from "@/app/TopBar";
import { GROUP_PALETTE, peerPaletteIndex } from "@/app/peerColors";
import { useLiveStats } from "@/app/useLiveStats";
import { PIN_INPUT_MAXLENGTH, capPinInput, pinDigits } from "@/app/pinInput";
import { useLocale, useT } from "@/app/i18n";
import type { TKey } from "@/app/i18n";
/* The VERDICT is imported eagerly (it is a five-line pure function), while the
   probe itself — which touches RTCPeerConnection — is loaded only when the button
   is pressed, so this page costs nothing extra to open. */
import { relayProbeVerdict } from "@/lib/relayProbe";

/** The translator, as the render sites receive it. Named so a module-level helper can
 *  take one as a parameter — a constant or a plain function cannot call a hook. */
type Translate = ReturnType<typeof useT>;

/**
 * The tier word for a role, as a dictionary KEY.
 *
 * WHY THIS IS NOT `roleLabel()` ANY MORE, and why that is not a second source of truth.
 * `roleLabel` (app/VerifiedBadge.tsx) returns finished ENGLISH, so a row tag rendered
 * through it stays English on an Arabic screen. That file is a shared component outside
 * this screen's sweep, so the tier words move into this screen's dictionary instead —
 * and the two are held in agreement by an assertion in `adminLocale.test.ts` requiring
 * each ENGLISH half to equal `roleLabel()` exactly. That is stronger than sharing the
 * function was: it also fails if somebody edits VerifiedBadge's spelling.
 *
 * The three tiers stay three distinct words in BOTH languages — they are three things
 * the server can really express, and this console's whole job is moving people between
 * them.
 */
const TIER_KEY: Record<IdentityRole, TKey> = {
  guest: "admin.tier.guest",
  registered: "admin.tier.registered",
  admin: "admin.tier.admin",
};

/** The tier word, translated, or null where `roleLabel` would return null (a party
 *  line has no badge and no tier). */
function tierWord(t: Translate, role: IdentityRole | null | undefined): string | null {
  if (!role || !TIER_KEY[role]) return null;
  return t(TIER_KEY[role]);
}

/* ── the board's gold, in one place ───────────────────────────────────────────
   Board rule 5: GOLD (#e8c94a) means admin / owner / locked. Frame 2h spends it on
   this console's own chrome — the ADMIN chip, the section labels, the card
   hairlines and the action CTAs ("Gold replaces accent for CTAs here") — which is
   also what leaves the CYCLING accent free to keep meaning "active" and
   "you are here" everywhere else in the app.

   LIGHT THEME. The board is a dark design and says nothing about light, but this
   app still DEFAULTS to light, where #e8c94a on a white card computes to about
   1.7:1 and is unreadable. Every gold TEXT token therefore carries a darker twin
   (#7a5f06 → 6.1:1 on white) behind `dark:`. A gold FILL needs no twin: its text
   is the board's near-black #04211a, which is high-contrast on gold in either
   theme.

   These are literal class strings held in a const, never composed at runtime — the
   JIT cannot see `text-[${x}]` and it comes out unstyled (the trap recorded for
   the old tab accents and the status picker). A const of literal utilities IS
   scanned, because the literal is in this file. */
const GOLD_TEXT = "text-[#7a5f06] dark:text-[#e8c94a]";
const GOLD_CHIP = "bg-[#e8c94a]/12 border border-[#c9a227]/55 dark:border-[#e8c94a]/45";
/** A gold-filled CTA. On-accent text is the board's #04211a, never white. */
const GOLD_CTA = "bg-[#e8c94a] text-[#04211a] hover:bg-[#dbb92f] dark:hover:bg-[#f0d569]";
/** 5f's section label: mono, ~10px, wide tracking, uppercase. The colour is applied
 *  separately so the danger card can take the destructive tone WITHOUT two rival
 *  `text-*` utilities in one class string — plain concatenation is not twMerge, so
 *  which of them won would be decided by Tailwind's own output order rather than by
 *  me, and v4 has no prefix `!` to force it. */
const LABEL_BASE = "font-mono text-[10px] font-semibold uppercase tracking-[0.18em]";
const GOLD_LABEL = LABEL_BASE + " text-muted-foreground dark:text-[#a99e78]";
const DANGER_LABEL = LABEL_BASE + " text-destructive";
/**
 * A card hairline, as an INLINE value rather than a class.
 *
 * `.rsheet` sets `border` as a SHORTHAND and lives unlayered in index.css, so a
 * Tailwind `border-[…]` utility loses to it; an inline `border-color` wins in every
 * theme. That also means one value has to serve both themes, so this is a mid gold
 * at a higher alpha than the board's `rgba(232,201,74,.3)` — brighter than the
 * board on dark, and still a visible hairline on a white card, where the board's
 * value would disappear.
 */
const GOLD_HAIRLINE = "rgba(196,156,42,.6)";
/**
 * The danger hairline, from the THEME token rather than the board's `#fb7185`.
 * `--destructive` is defined in both themes and its light value was measured to
 * clear AA in v2.106.10; the board's literal is dark-only. `color-mix` is what
 * Tailwind v4 itself uses for opacity modifiers, so the baseline is already here.
 */
const DANGER_HAIRLINE = "color-mix(in oklab, var(--destructive) 55%, transparent)";

/* 2h's stat tiles and person rows are the board's glass surface, so they use the
   SHIPPED `.rglass` utility (its recipe IS the board's: a white 5%→1.5% gradient
   with an inset top highlight) rather than a second copy of it.

   THE TWO INLINE TOKENS THAT USED TO LIVE HERE HAVE MOVED INTO THE RECIPE. They were an
   opaque `--card` base and a `--border` hairline, both needed because `.rglass` declared
   dark-only values on an un-dark-scoped rule — so in the light theme a card showed the
   page through it and a row had no boundary. Patching it here fixed this ONE of five call
   sites and left the other four broken, which is the shape of defect this repo keeps
   re-learning; the fix now reaches every consumer, including the next one.

   MEASURED, and worth keeping: the first cut of this wrote the board's gradient as a
   `dark:bg-[linear-gradient(…)]` arbitrary value, and grepping the BUILT stylesheet showed
   Tailwind emitted nothing for it — a nested-paren value the scanner does not take, i.e.
   the unstyled-class trap, caught only because the output was checked. */
const STAT_TILE = "rglass rounded-[13px] border px-1.5 py-2.5 text-center";
const PERSON_ROW = "rglass rounded-[15px] border p-2.5";
/**
 * 2h's per-row role tag. NEUTRAL rather than tinted by tier, and that is the one
 * place this deviates from the frame's colours on purpose: the tier palette
 * (guest blue / registered green / admin gold) lives inside `RoleBadge`, which is
 * rendered right beside this, and re-declaring those three hues here would be a
 * second source of truth for what a tier looks like. The badge carries the colour,
 * this carries the word (from `roleLabel`, so there is one spelling of it too).
 */
const ROLE_TAG =
  "shrink-0 rounded-[9px] border border-border bg-muted/60 px-1.5 py-0.5 font-mono " +
  "text-[8.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:border-white/12 dark:bg-white/5";

/** Initials for the row disc. Two words → two letters; one word → its first two. */
function initialsOf(name: string, number: string) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return number.slice(0, 2);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * The console's own identity chip (2h/5f).
 *
 * The frame's label reads OWNER; this says ADMIN because that is the tier this app
 * actually has — `users.role === "admin"`, the word `RoleBadge` and `roleLabel`
 * already use — and 5f's own chip says ADMIN too. Inventing an "owner" tier the
 * server cannot express would be a badge that lies about the account behind it.
 */
function AdminChip() {
  const t = useT();
  return (
    <span
      title={t("admin.chipTitle")}
      className={"inline-flex shrink-0 items-center gap-1.5 rounded-[14px] px-2.5 py-1 " + GOLD_CHIP}
    >
      <ShieldCheck className={"size-3 " + GOLD_TEXT} aria-hidden="true" />
      <span className={"font-mono text-[9px] font-semibold tracking-[0.16em] " + GOLD_TEXT}>
        {t("admin.chip")}
      </span>
    </span>
  );
}

/**
 * 5f's elevated card, used for every tool panel.
 *
 * `.rsheet` is the board's elevated-sheet recipe AND it is dark-scoped, which is
 * exactly what is needed here: in dark it paints the near-black gradient and the
 * drop shadow, and in light it declares nothing, so `bg-card` + `border` show
 * through as an ordinary opaque card. The coloured hairline is inline because
 * `.rsheet`'s border shorthand cannot be overridden by a utility (see above).
 */
function ToolCard({ tone, children }: { tone: "gold" | "danger"; children: ReactNode }) {
  return (
    <div
      className="rsheet mt-3 rounded-[20px] border bg-card p-4"
      style={{ borderColor: tone === "gold" ? GOLD_HAIRLINE : DANGER_HAIRLINE }}
    >
      {children}
    </div>
  );
}

/**
 * 2h's stat tiles.
 *
 * REAL NUMBERS, from the one hook the sign-in screen and the landing page already
 * read, so three surfaces cannot come to disagree about how many people are here.
 * Unknown renders as an em-dash rather than 0, for the reason `LiveStats` records:
 * `getPublicStats` answers zeros when the database is down, and a wall of zeros
 * reads as a broken product.
 *
 * "PARTIES", not the frame's "CALLS": the figure is `totalParties`, which counts
 * call PARTIES (what the landing page calls "Call parties"). Labelling it CALLS
 * would be a number that is wrong about the thing it names.
 *
 * THE LIVE DOT IS THE PRESENCE GREEN, not the frame's `var(--rb)`. This one number
 * IS a presence count, and `--relay-online` is what every LED in the app is drawn
 * with; painting it in the accent would give the accent a meaning it does not have
 * and take one away from green (the v2.106.18 rule, and what `LiveStats` already
 * does for the same figure).
 */
function StatTiles() {
  const t = useT();
  const live = useLiveStats();
  /* `id` is the STABLE identity of a tile and `label` is what it says. They were one
     field until this screen was translated, and merging them again would break two
     things at once: React would remount every tile on a language change (the key would
     move), and "which tile carries the live dot" would become a question about English
     rather than about the tile. */
  const cells: { id: string; label: string; value: number | null; live?: boolean }[] = [
    { id: "users", label: t("admin.stat.users"), value: live ? live.registeredUsers : null },
    { id: "guests", label: t("admin.stat.guests"), value: live ? live.guestsServed : null },
    { id: "parties", label: t("admin.stat.parties"), value: live ? live.totalParties : null },
    { id: "online", label: t("admin.stat.online"), value: live ? live.onlineNow : null, live: true },
  ];
  return (
    <dl className="grid grid-cols-4 gap-2">
      {cells.map((c) => (
        <div key={c.id} className={STAT_TILE}>
          <dd className="flex items-center justify-center gap-1 overflow-hidden whitespace-nowrap font-mono text-[clamp(0.9rem,4vw,1.125rem)] font-semibold leading-none tabular-nums">
            {c.value === null ? "—" : c.value.toLocaleString("en-US")}
            {c.live && c.value !== null && (
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-[color:var(--relay-online,#06d6a0)] shadow-[0_0_8px_var(--relay-online,#06d6a0)] motion-safe:animate-pulse"
              />
            )}
          </dd>
          <dt
            className={
              "mt-[3px] font-mono text-[7.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
            }
          >
            {c.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}

export default function Admin() {
  const t = useT();
  const { tn } = useLocale();
  const amIAdmin = trpc.admin.amIAdmin.useQuery(undefined, { staleTime: 60_000 });
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const utils = trpc.useUtils();
  const found = trpc.admin.findIdentities.useQuery(
    { query: submitted },
    { enabled: amIAdmin.data?.admin === true },
  );
  // Which row is being edited, and what has been typed for it.
  const [editing, setEditing] = useState<number | null>(null);
  /** Which row's notification panel is open (v2.99.91). */
  const [checking, setChecking] = useState<number | null>(null);
  const [wanted, setWanted] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Which row has its account-type controls open (v2.99.99). */
  const [typing, setTyping] = useState<number | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);
  const setType = trpc.admin.setAccountType.useMutation({
    onSuccess: () => {
      setTypeError(null);
      setTyping(null);
      utils.admin.findIdentities.invalidate();
    },
    // The server NAMES each refusal, because a guest, a self-demotion and
    // "become a guest" need three different next steps. Surfacing its message
    // verbatim is the whole point of naming them.
    onError: (e) => setTypeError(e.message),
  });
  /**
   * The registration address being suggested to a guest (v2.105.15, #111).
   *
   * Keyed per row rather than one shared string, so opening a second row's panel
   * cannot leave somebody else's half-typed address in the field — which on a
   * screen listing several people with the same control in the same place is
   * exactly the mistake that actually happens (the reason Delete confirms by
   * typing the number).
   */
  const [inviteEmail, setInviteEmail] = useState<Record<number, string>>({});
  const [inviteError, setInviteError] = useState<string | null>(null);
  const invite = trpc.admin.inviteGuestRegistration.useMutation({
    onSuccess: () => {
      toast.success(t("admin.type.suggested"));
      setInviteError(null);
      utils.admin.findIdentities.invalidate().catch(() => {});
    },
    // Verbatim: the server names "already has an account", a malformed address and
    // "that address belongs to somebody" separately, and those are three different
    // next steps for the operator. Only the FALLBACK is translated — a server message
    // that exists must reach the operator as the server worded it.
    onError: (e) => setInviteError(e.message || t("admin.type.suggestFailed")),
  });
  const withdrawInvite = trpc.admin.clearGuestRegistrationInvite.useMutation({
    onSuccess: () => {
      setInviteError(null);
      utils.admin.findIdentities.invalidate().catch(() => {});
    },
    onError: (e) => setInviteError(e.message || t("admin.type.withdrawFailed")),
  });
  /** Which row's DELETE panel is open, and the number typed to confirm it (v2.100.0). */
  const [deleting, setDeleting] = useState<number | null>(null);
  const [confirmNum, setConfirmNum] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const purge = trpc.admin.deleteIdentity.useMutation({
    onSuccess: () => {
      toast.success(t("admin.delete.done"));
      setDeleting(null);
      setConfirmNum("");
      setDeleteError(null);
      utils.admin.findIdentities.invalidate().catch(() => {});
    },
    // The server names the self-deletion refusal specifically, because "another
    // admin has to do it" is a different next step from "that id doesn't exist".
    onError: (e) => setDeleteError(e.message || t("admin.delete.failed")),
  });
  const setNumber = trpc.admin.setIdentityNumber.useMutation({
    onSuccess: (res) => {
      /* A toast is ONE flat string with no way to isolate a run, so the Arabic says
         "من … إلى …" where the English uses an arrow: two Western 6-digit numbers on
         either side of "→" inside an RTL paragraph can have their parts reordered, and
         there is no span to hang `unicode-bidi: isolate` on. */
      toast.success(
        res.unchanged
          ? t("admin.number.unchanged")
          : t("admin.number.changed", {
              from: formatPin(res.oldNumber),
              to: formatPin(res.newNumber),
            }),
      );
      setEditing(null);
      setWanted("");
      setError(null);
      utils.admin.findIdentities.invalidate().catch(() => {});
    },
    // The server names each refusal; showing its own message means a typo and a
    // collision read differently, which is the point of naming them.
    onError: (e) => setError(e.message || t("admin.number.failed")),
  });

  const digits = pinDigits(wanted);
  const ok = /^\d{6}$/.test(digits) && !/^(000|111)/.test(digits);

  if (amIAdmin.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!amIAdmin.data?.admin) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <ShieldCheck className="size-8 text-muted-foreground" />
        <p className="text-sm font-semibold">{t("admin.onlyTitle")}</p>
        <p className="max-w-xs text-xs text-muted-foreground">{t("admin.onlyBody")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 p-4">
      {/* 2h's header: the title, then the gold ADMIN chip. No shield glyph beside
          the word any more — it used to be painted with `--relay-online`, the
          presence green, which in this app means ONLINE and nothing else. The chip
          carries both the shield and the tier, in the colour the board reserves
          for exactly this. */}
      <div className="flex items-center gap-2.5">
        <h1 className="text-[21px] font-bold leading-none">{t("admin.title")}</h1>
        <AdminChip />
      </div>

      <StatTiles />

      {/* FLEET state, above the per-person search, because it describes the whole
          deployment rather than anybody in particular (v2.105.22). */}
      <MediaCheck />

      {/* Directly under the media card, because it answers the half that card
          cannot: MediaCheck reports which relays are ADVERTISED, this reports
          whether they actually accept a credential (v2.107.10). */}
      <RelaySelfTest />

      {/* Crash telemetry from every surface — web, both mobile apps, and the
          server itself — grouped by defect and kept per build version. */}
      <CrashConsole />
      <SessionsConsole />
      <CallsConsole />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query.trim());
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          {/* LOGICAL, not `left-3.5`: this glyph marks the field's LEADING edge, which
              is the right-hand side in Arabic. `top-1/2 -translate-y-1/2` stays
              physical because vertical centring is direction-independent. */}
          <Search className="pointer-events-none absolute start-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.search.placeholder")}
            aria-label={t("admin.search.aria")}
            dir="auto"
            className="w-full rounded-[13px] border border-border bg-card/60 py-2.5 ps-9 pe-3 text-[12.5px] outline-none placeholder:text-muted-foreground focus:border-primary dark:border-white/10 dark:bg-white/5"
          />
        </div>
        <Button type="submit" size="sm" variant="outline" className="rounded-[13px]">
          {t("admin.search.submit")}
        </Button>
      </form>

      <p className="text-[10.5px] leading-relaxed text-muted-foreground">{t("admin.blurb")}</p>

      {found.isLoading ? (
        <div className="p-6 text-center text-sm text-muted-foreground">{t("admin.loading")}</div>
      ) : (found.data?.rows.length ?? 0) === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          {submitted ? t("admin.noMatches", { query: submitted }) : t("admin.noneYet")}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {found.data?.rows.map((r) => {
            /* One fixed hue per person, from the app's OWN per-identity palette
               rather than a second copy of that rule — the board asks for a hue
               gradient per user and `peerColors` already derives one from the
               identity id (never from list position, which would recolour a row
               as the search changes). */
            const hue = GROUP_PALETTE[peerPaletteIndex(r.id)];
            return (
              <li key={r.id} className={PERSON_ROW}>
                {/* A DIV, not a button: this row CONTAINS buttons (the ⋮ menu) and
                    nested buttons are invalid HTML. */}
                <div className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid size-[34px] shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: `linear-gradient(135deg,${hue.from},${hue.to})` }}
                  >
                    {initialsOf(r.displayName, r.number)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="truncate text-[13px] font-semibold"
                        dir="auto"
                        title={r.displayName || undefined}
                      >
                        {r.displayName || t("admin.unnamed")}
                      </span>
                      <RoleBadge role={r.role} caption={false} size={11} />
                      <span className={"ms-auto " + ROLE_TAG}>{tierWord(t, r.role)}</span>
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span
                        className="shrink-0 font-mono text-[10px] text-muted-foreground [unicode-bidi:isolate]"
                        dir="ltr"
                      >
                        {formatPin(r.number)}
                      </span>
                      {r.email && (
                        // An address is LTR text sitting beside a display name that may
                        // be Arabic, so it is isolated as well as directed — without the
                        // isolation its parts reorder against the RTL run around it
                        // (the v2.99.77 PinTag lesson, which the PIN above already has).
                        <span
                          className="min-w-0 truncate text-[9.5px] text-muted-foreground/70 [unicode-bidi:isolate]"
                          dir="ltr"
                          title={r.email}
                        >
                          {r.email}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* 2h's ⋮. It replaces four stacked outline buttons per row — the
                      thing that made this list cramped at phone width — and every
                      one of the four survives inside it. 44px, so it is reliably
                      tappable at 320px. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("admin.row.toolsFor", { who: r.displayName || r.number })}
                        className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                      >
                        <MoreVertical className="size-4" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-60">
                      <DropdownMenuLabel className={GOLD_LABEL}>
                        {t("admin.menu.title")}
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => {
                          setEditing(editing === r.id ? null : r.id);
                          setWanted("");
                          setError(null);
                        }}
                      >
                        <Hash className="size-4" />
                        {editing === r.id
                          ? t("admin.menu.hideNumber")
                          : t("admin.menu.changeNumber")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setChecking(checking === r.id ? null : r.id)}
                      >
                        <BellRing className="size-4" />
                        {checking === r.id
                          ? t("admin.menu.hideNotifications")
                          : t("admin.menu.notifications")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setTyping(typing === r.id ? null : r.id);
                          setTypeError(null);
                        }}
                      >
                        <ShieldCheck className="size-4" />
                        {typing === r.id
                          ? t("admin.menu.hideAccountType")
                          : t("admin.menu.accountType")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => {
                          setDeleting(deleting === r.id ? null : r.id);
                          setConfirmNum("");
                          setDeleteError(null);
                        }}
                      >
                        <Trash2 className="size-4" />
                        {deleting === r.id
                          ? t("admin.menu.hideDelete")
                          : t("admin.menu.deleteAccount")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {checking === r.id && <PushCheck identityId={r.id} />}
                {deleting === r.id && (
                  <ToolCard tone="danger">
                    <div className={DANGER_LABEL + " mb-2"}>{t("admin.delete.label")}</div>
                    <p className="text-xs font-semibold text-destructive">
                      {t("admin.delete.warning")}
                    </p>
                    {/* `ps-4`, not `pl-4`: the list marker sits on the READING edge, so
                        it has to move to the right in Arabic. */}
                    <ul className="mt-1.5 list-disc space-y-0.5 ps-4 text-[11px] leading-relaxed text-muted-foreground">
                      <li>{t("admin.delete.bulletData")}</li>
                      <li>{t("admin.delete.bulletThreads")}</li>
                      {/* `tn`, not `t`: the number is a NODE so it can be LTR-ISOLATED.
                          Six Western digits inside an Arabic sentence reorder without it,
                          and the whole point of this line is that the operator can read
                          the number that is about to be retired. Keeping the placeholder
                          inside the sentence also lets Arabic put it where the language
                          wants — it leads with the verb here and English does not. */}
                      <li>
                        {tn("admin.delete.bulletNumber", {
                          number: (
                            <span dir="ltr" className="font-mono [unicode-bidi:isolate]">
                              {formatPin(r.number)}
                            </span>
                          ),
                        })}
                      </li>
                      {/* Said plainly rather than implied away. Deleting an attachments row would
                          make its media MORE readable, not less (v2.98.4/F3: the storage proxy
                          serves a key it cannot classify), and a third party's contact row is what
                          holds a BLOCK, so deleting it would silently un-block them (M13). The
                          avatar line is the honest one: a profile photo has always been readable
                          by any signed-in RELAY user (it renders on the incoming-ring card), and
                          that does not change here — the bytes stay because there is no
                          storage-delete path in this codebase to remove them with. */}
                      <li>{t("admin.delete.bulletFiles")}</li>
                      <li>{t("admin.delete.bulletBlocks")}</li>
                    </ul>
                    <p className="mt-2.5 text-[10px] text-muted-foreground">
                      {t("admin.delete.typeToEnable")}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        dir="ltr"
                        autoComplete="off"
                        maxLength={PIN_INPUT_MAXLENGTH}
                        placeholder={r.number}
                        value={confirmNum}
                        onChange={(e) => {
                          // Six digits, capped as typed (v2.106.63). The value is
                          // compared against the number below, so a cap can only ever
                          // make the confirmation harder to satisfy by accident.
                          setConfirmNum(capPinInput(e.target.value));
                          setDeleteError(null);
                        }}
                        aria-label={t("admin.delete.confirmAria", { number: r.number })}
                        className="w-36 rounded-[11px] border border-destructive/40 bg-background px-3 py-2 text-center font-mono text-lg tracking-[0.12em] outline-none focus:border-destructive"
                      />
                      {/* Typing the number is the confirmation, not a Yes/No. The panel lists
                          several rows at once and every one of them has a Delete item in the
                          same place, so a plain confirm dialog protects against hesitation but
                          not against acting on the wrong row — which is the mistake that
                          actually happens here. */}
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="rounded-[11px]"
                        disabled={
                          pinDigits(confirmNum) !== r.number || purge.isPending
                        }
                        onClick={() => purge.mutate({ identityId: r.id })}
                      >
                        {purge.isPending ? t("admin.delete.busy") : t("admin.delete.action")}
                      </Button>
                    </div>
                    {deleteError && <p className="mt-2 text-xs text-destructive">{deleteError}</p>}
                  </ToolCard>
                )}
                {typing === r.id && (
                  <ToolCard tone="gold">
                    <div className={GOLD_LABEL + " mb-2"}>{t("admin.type.label")}</div>
                    {r.isGuest ? (
                      /* A guest has no account row at all — that is what being a guest
                         IS — so there is no role to write. Said here rather than offered
                         and then refused, because a control that always fails is worse
                         than one that is absent. The board's three-way segmented is
                         therefore ONE lit segment for a guest: the two transitions the
                         server refuses are not drawn as taps at all. */
                      <div className="space-y-2">
                        <TierWell current={t("admin.tier.guest")} />
                        <p className="text-xs text-muted-foreground">
                          {t("admin.type.guestExplain")}
                        </p>
                        {/* SUGGEST AN ADDRESS (v2.105.15, #111).
                            This puts a prompt in THEIR app and does nothing else — it
                            mints no account, sends no code and signs nobody in. Only a
                            request from the device that actually holds this identity can
                            complete a registration, which is what stops an admin
                            attaching an address they control and then signing in as
                            somebody else. The copy says so, because an operator should
                            not have to guess how far a button reaches. */}
                        <p className="text-xs text-muted-foreground">
                          {t("admin.type.suggestExplain")}
                        </p>
                        {r.regInviteEmail && (
                          <p className="text-xs">
                            <span className="text-muted-foreground">
                              {t("admin.type.alreadySuggested")}
                            </span>
                            <span
                              className="break-all font-medium"
                              dir="ltr"
                              style={{ unicodeBidi: "isolate" }}
                            >
                              {r.regInviteEmail}
                            </span>
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="email"
                            inputMode="email"
                            dir="ltr"
                            autoComplete="off"
                            maxLength={320}
                            /* A language-NEUTRAL example: "them" is an English word sitting on an Arabic
                               screen, and the placeholder tells you nothing the local part has to
                               carry — so the fix costs nothing and removes a string that would
                               otherwise need translating. */
                            placeholder="name@example.com"
                            value={inviteEmail[r.id] ?? ""}
                            onChange={(e) => {
                              setInviteEmail((m) => ({ ...m, [r.id]: e.target.value }));
                              setInviteError(null);
                            }}
                            aria-label={t("admin.type.emailAria", {
                              who: r.displayName || r.number,
                            })}
                            className="min-w-0 flex-1 rounded-[11px] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                          />
                          <Button
                            type="button"
                            size="sm"
                            className={"rounded-[11px] " + GOLD_CTA}
                            disabled={
                              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((inviteEmail[r.id] ?? "").trim()) ||
                              invite.isPending
                            }
                            onClick={() =>
                              invite.mutate({
                                identityId: r.id,
                                email: (inviteEmail[r.id] ?? "").trim(),
                              })
                            }
                          >
                            {invite.isPending ? t("admin.type.suggesting") : t("admin.type.suggest")}
                          </Button>
                          {r.regInviteEmail && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-[11px]"
                              disabled={withdrawInvite.isPending}
                              onClick={() => withdrawInvite.mutate({ identityId: r.id })}
                            >
                              {t("admin.type.withdraw")}
                            </Button>
                          )}
                        </div>
                        {inviteError && <p className="text-xs text-destructive">{inviteError}</p>}
                      </div>
                    ) : (
                      /* 5f's segmented control, over the two tiers that are REAL for an
                         account that exists. The lit half is a static span and the other
                         is a real button, so there is no disabled control at all: the
                         current tier is state, not an action that refuses.
                         SELECTION IS THE CYCLING ACCENT, not gold — "you are here" means
                         the same thing here as in the tab bar's pill and the new-group
                         sheet, and gold stays spent on admin-ness and on the CTAs. */
                      <TierWell
                        current={
                          r.role === "admin" ? t("admin.tier.admin") : t("admin.tier.registered")
                        }
                        other={
                          r.role === "admin" ? t("admin.tier.registered") : t("admin.tier.admin")
                        }
                        busy={setType.isPending}
                        onPick={() =>
                          setType.mutate({
                            identityId: r.id,
                            role: r.role === "admin" ? "registered" : "admin",
                          })
                        }
                      />
                    )}
                    {typeError && <p className="mt-2 text-xs text-destructive">{typeError}</p>}
                  </ToolCard>
                )}
                {editing === r.id && (
                  <ToolCard tone="gold">
                    <div className={GOLD_LABEL + " mb-2"}>{t("admin.number.label")}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        // Text with a numeric keypad: type="number" brings spinners,
                        // accepts "1e5" and drops a leading zero.
                        type="text"
                        inputMode="numeric"
                        dir="ltr"
                        autoComplete="off"
                        maxLength={PIN_INPUT_MAXLENGTH}
                        placeholder="777777"
                        value={wanted}
                        onChange={(e) => {
                          // Capped at six digits as you type (v2.106.63).
                          setWanted(capPinInput(e.target.value));
                          setError(null);
                        }}
                        aria-label={t("admin.number.aria", { who: r.displayName || r.number })}
                        className="w-36 rounded-[11px] border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-[0.12em] outline-none focus:border-primary"
                      />
                      <Button
                        type="button"
                        size="sm"
                        className={"rounded-[11px] " + GOLD_CTA}
                        disabled={!ok || setNumber.isPending}
                        onClick={() =>
                          setNumber.mutate({ identityId: r.id, number: digits })
                        }
                      >
                        {setNumber.isPending ? t("admin.number.applying") : t("admin.number.apply")}
                      </Button>
                    </div>
                    {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
                    {!error && wanted.length > 0 && !ok && (
                      <p className="mt-2 text-xs text-muted-foreground">{t("admin.number.rule")}</p>
                    )}
                  </ToolCard>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * 5f's account-type segmented control, as an inset well.
 *
 * The board's well is `rgba(0,0,0,.32)` at radius 13 with 5px of padding, and the
 * SELECTED half is the cycling accent — the same "you are here" language as the tab
 * bar's pill (v2.106.2) and the new-group sheet's Direct/Group control (v2.106.20),
 * so one idea of selection covers the app.
 *
 * The accent fallbacks are LITERALS. `var(--rb, var(--rb))` is a custom-property
 * CYCLE: it resolves to the guaranteed-invalid value and the browser DROPS the whole
 * declaration, leaving a segment with no fill at all (the v2.106.7 trap).
 *
 * `other` is optional: with only a current tier (a guest) the well shows one lit
 * segment and no tap target, because the transitions away from guest are ones the
 * server refuses.
 */
function TierWell({
  current,
  other,
  busy,
  onPick,
}: {
  current: string;
  other?: string;
  busy?: boolean;
  onPick?: () => void;
}) {
  const t = useT();
  return (
    <div
      className="flex gap-1.5 rounded-[13px] border border-border p-[5px] dark:border-transparent dark:bg-black/30"
      role="group"
      aria-label={t("admin.type.aria")}
    >
      <span
        aria-current="true"
        className="flex-1 rounded-[10px] py-2 text-center text-[11px] font-bold"
        style={{
          background: "rgba(var(--rb-rgb, 63, 224, 197), 0.16)",
          border: "1.5px solid rgba(var(--rb-rgb, 63, 224, 197), 0.6)",
          color: "var(--rb, #3FE0C5)",
        }}
      >
        {current}
      </span>
      {other && (
        <button
          type="button"
          disabled={busy}
          onClick={onPick}
          className="flex-1 rounded-[10px] border border-border bg-muted/50 py-2 text-center text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60 dark:border-white/12 dark:bg-white/5"
        >
          {busy ? t("admin.type.saving") : other}
        </button>
      )}
    </div>
  );
}

/* ============================================================
   Why a notification did not arrive (v2.99.91).

   Owner: "Can you check the Firebase configuration as still the notification for
   the front mobile apps for Android? It's not showing or it's not active."

   A native push crosses FIVE links and each one fails identically from the phone —
   nothing happens. So this reports them one at a time, worst-first, and finishes
   with a REAL send through the production sender. What it deliberately does NOT do
   is show a token: an FCM registration token with the project key, or an Expo token
   on its own, is enough to push to that handset.
   ============================================================ */
/**
 * One diagnostic line (5f's per-transport row).
 *
 * A BARE stroked glyph on a hairline-separated row, per the frame — and the OK mark
 * is the cycling accent, which is a vocabulary fix rather than a restyle. It used to
 * be a filled `emerald-500` disc, and GREEN in this app means ONLINE: it is what
 * every presence LED is painted with, which is why v2.99.86 moved DND off it,
 * v2.106.9 moved the speaking tile off it and v2.106.11 moved the push banner off
 * it. "This link is working" is not a presence statement. The accent fallback is a
 * LITERAL, never `var(--rb, var(--rb))`, which is a property cycle the browser drops
 * entirely (v2.106.7).
 */
function Row({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2 border-b border-border/60 py-1.5 last:border-b-0 dark:border-white/10">
      <span
        aria-hidden="true"
        className={"mt-px shrink-0 " + (ok ? "" : "text-destructive")}
        style={ok ? { color: "var(--rb, #3FE0C5)" } : undefined}
      >
        {ok ? (
          <Check className="size-3.5" strokeWidth={2.5} />
        ) : (
          <X className="size-3.5" strokeWidth={2.5} />
        )}
      </span>
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        {detail && <span className="block text-muted-foreground">{detail}</span>}
      </span>
    </li>
  );
}

/**
 * WHICH MEDIA STACK THE FLEET IS ON (v2.105.22).
 *
 * Owner, while diagnosing "slowness … when the voice and video started together": make
 * sure the media details are visible in the system. `/api/health` reports the transport
 * as a bare boolean; this screen is `requireAdmin`-gated, so it can also enumerate the
 * relays, which is the part an operator has to act on.
 *
 * IT LOST A ROW IN v2.106.53 rather than gaining one. It used to name the hosted SFU's
 * project host, because "configured" is not the same claim as "pointed at the right
 * project" — and the account behind it is gone, so there is no project to name and no
 * key to report. What is left is the transport, stated plainly, plus the relays.
 *
 * NOT per-identity: it describes the FLEET, so it renders once at the top rather than
 * inside a searched user's card. It is also the first thing to look at when the
 * v2.105.21 call readout says "via TURN relay" — the relay list is right here.
 *
 * It wears 2h's gold card, because it is fleet configuration — the thing this console
 * exists to be able to see — and because the frame's gold warning treatment belongs
 * on a card that reports REAL failures rather than on an invented count.
 */
/**
 * WHAT THE POOL ROW SAYS, and each line names the action its reason calls for.
 *
 * Deliberately NOT one "pool unhealthy" sentence: an empty registry and a saturated fleet
 * are the same empty list and opposite jobs, and telling somebody to add a node when the
 * agent is not running has them launch a second box that also fails to register.
 */
/* THE TRANSLATOR IS A PARAMETER, not a hook call: this is a module-level function and a
   function that is not a component cannot call one. The alternative — returning a key and
   translating at the render site — cannot work here, because three of these lines
   interpolate a COUNT, so the key alone does not carry the sentence. */
function poolDetail(
  p: {
    configured: boolean;
    reason: string;
    total: number;
    eligible: number;
    saturated: number;
    drainingCount: number;
  },
  t: Translate,
): string {
  if (!p.configured) return t("admin.pool.unconfigured");
  switch (p.reason) {
    case "ok":
      /* TWO WHOLE SENTENCES rather than one with an appended fragment. The English used
         to concatenate " {n} draining." onto the end, which is a sentence chopped at the
         English seam — Arabic cannot always re-assemble that in the same order, and this
         dictionary's rule is that a placeholder stays INSIDE its sentence. */
      return p.drainingCount
        ? t("admin.pool.okDraining", { count: p.drainingCount })
        : t("admin.pool.ok");
    case "no-nodes":
      return t("admin.pool.noNodes");
    case "all-stale":
      return t("admin.pool.allStale", { total: p.total });
    case "all-draining":
      return t("admin.pool.allDraining");
    case "all-excluded":
      return t("admin.pool.allExcluded");
    case "all-saturated":
      return t("admin.pool.allSaturated", { saturated: p.saturated });
    default:
      return t("admin.pool.disabled");
  }
}

function MediaCheck() {
  const t = useT();
  const { tn } = useLocale();
  const q = trpc.admin.mediaDiagnostics.useQuery(undefined, { staleTime: 30_000 });
  if (q.isLoading) {
    return (
      <div
        className="rsheet flex items-center gap-2 rounded-[20px] border bg-card p-4 text-xs text-muted-foreground"
        style={{ borderColor: GOLD_HAIRLINE }}
      >
        <Loader2 className="size-3.5 animate-spin" /> {t("admin.media.reading")}
      </div>
    );
  }
  if (!q.data) {
    // A failure is reported as a failure, never as "not configured" — those need
    // different next steps and conflating them sends somebody to the wrong file.
    return (
      <p
        className="rsheet rounded-[20px] border bg-card p-4 text-xs text-destructive"
        style={{ borderColor: DANGER_HAIRLINE }}
      >
        {t("admin.media.readFailed")}
      </p>
    );
  }
  const { transport, turn, voipPool } = q.data;
  return (
    <div
      className="rsheet space-y-2 rounded-[20px] border bg-card p-4"
      style={{ borderColor: GOLD_HAIRLINE }}
    >
      <h3 className={GOLD_LABEL}>{t("admin.media.label")}</h3>
      <ul className="text-xs">
        {/* `ok` is TRUE, deliberately: the mesh is the transport this fleet is meant
            to be on, so drawing it as a fault would make the one row that always
            renders read as a permanent problem and teach an operator to ignore the
            card. The DETAIL carries the cost honestly instead. */}
        <Row
          ok
          label={
            transport === "mesh"
              ? t("admin.media.mesh")
              : t("admin.media.transportInUse", { transport })
          }
          detail={t("admin.media.meshCost")}
        />
        <Row
          ok={turn.turnsTls > 0}
          label={
            turn.hosts.length === 1
              ? t("admin.media.relaysOne", { tls: turn.turnsTls })
              : t("admin.media.relaysMany", { hosts: turn.hosts.length, tls: turn.turnsTls })
          }
          detail={
            turn.hosts.length
              ? /* NOT a dictionary entry, on purpose: protocol names and Western digits
                   with no prose in them, so an entry's two halves would have been
                   identical — a translation that translates nothing. See dict/admin.ts. */
                `${turn.hosts.join(", ")} · ${turn.stun} STUN · ${turn.turnUdp} UDP · ${turn.turnTcp} TCP`
              : t("admin.media.noTurn")
          }
        />
        <Row
          ok={turn.secretSet}
          label={t("admin.media.turnSecret")}
          detail={t("admin.media.turnSecretDetail")}
        />
        {/* THE CAPACITY ROW, AND ITS `ok` IS NOT "are there nodes".
            An unconfigured pool is the fleet's normal state today, so drawing that red
            would make this card cry wolf on every load — the thing that teaches an
            operator to stop reading it. It is a fault only when a pool EXISTS and has
            nothing to give, which is the condition somebody has to act on. */}
        <Row
          ok={!voipPool.configured || voipPool.reason === "ok" || voipPool.reason === "disabled"}
          label={
            !voipPool.configured
              ? t("admin.media.poolOff")
              : t("admin.media.poolOn", {
                  eligible: voipPool.eligible,
                  total: voipPool.total,
                })
          }
          detail={poolDetail(voipPool, t)}
        />
      </ul>
      {voipPool.nodes.length > 0 && (
        <ul className="space-y-1 text-[10.5px] text-muted-foreground">
          {voipPool.nodes.map((n) => (
            <li key={n.instanceId} className="flex flex-wrap items-baseline gap-x-2">
              {/* dir=ltr + isolation on BOTH identifiers: an instance id and an address
                  are LTR runs sitting in what is an RTL paragraph in Arabic, and without
                  isolation their parts reorder. The id used to carry only `dir`. */}
              <span className="font-mono [unicode-bidi:isolate]" dir="ltr">
                {n.instanceId}
              </span>
              <span className="[unicode-bidi:isolate]" dir="ltr">
                {n.az}
              </span>
              <span className="font-mono [unicode-bidi:isolate]" dir="ltr">
                {n.publicIp}
              </span>
              <span>
                {n.routers === 1
                  ? t("admin.media.nodeRoomsOne", {
                      consumers: n.consumers,
                      cpu: Math.round(n.cpuLoad * 100),
                    })
                  : t("admin.media.nodeRoomsMany", {
                      rooms: n.routers,
                      consumers: n.consumers,
                      cpu: Math.round(n.cpuLoad * 100),
                    })}
              </span>
              {n.draining && (
                <span className="font-semibold text-destructive">{t("admin.media.draining")}</span>
              )}
              {n.ageMs > 15_000 && (
                <span className="font-semibold text-destructive">{t("admin.media.stale")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* `tn`, so the bolded control name stays a NODE inside the sentence. Splitting
          this as `{t(part1)}<b>Stats</b>{t(part2)}` is the shortcut this dictionary
          forbids: Arabic puts the verb first, so the emphasised run does not sit between
          the same two fragments and the halves could only be re-assembled into nonsense.

          THE WORD "Stats" IS DELIBERATELY NOT TRANSLATED. It is the literal face of the
          in-call button (`lib/relayAssets.ts`, `<span class="ctrl-lbl">Stats</span>`),
          which this sweep does not cover — telling somebody in Arabic to tap a control
          whose label reads "Stats" would send them looking for one that is not there. */}
      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        {tn("admin.media.statsHint", {
          stats: <span className="font-semibold">Stats</span>,
        })}
      </p>
    </div>
  );
}

/**
 * The force-relay self-test (v2.107.10).
 *
 * WHY IT IS HERE AND NOT IN THE CALL UI. v2.99.67 removed the in-call Diagnostics
 * panel because it was a permanent floater nobody had asked for, and this answers
 * a question about the FLEET rather than about a call — so it sits beside the
 * media card, which already reports what TURN the fleet advertises. This reports
 * what those relays actually DO when handed a live credential, which is the half
 * a config readout cannot answer.
 *
 * IT NEEDS NO CALL. The credentials come from `/api/relay/ice`, which mints
 * short-lived ones for exactly this purpose, so the credential question is
 * answerable at any moment rather than only while something is ringing.
 *
 * IT OPENS NO CAMERA AND NO MICROPHONE — a data channel is all that is needed to
 * make the browser gather, which is what makes this safe to put behind a button.
 */
function RelaySelfTest() {
  const t = useT();
  const [state, setState] = useState<
    | { phase: "idle" }
    | { phase: "running" }
    | { phase: "done"; result: import("@/lib/relayProbe").RelayProbeResult }
    | { phase: "failed" }
  >({ phase: "idle" });

  async function run() {
    setState({ phase: "running" });
    try {
      const [{ probeRelayReachability }, res] = await Promise.all([
        import("@/lib/relayProbe"),
        fetch("/api/relay/ice", { credentials: "same-origin" }),
      ]);
      const body = (await res.json()) as {
        iceServers?: Array<{ urls: string; username?: string; credential?: string }>;
      };
      const servers = body.iceServers || [];
      const result = await probeRelayReachability({
        servers,
        makePc: (cfg) =>
          new RTCPeerConnection(cfg as RTCConfiguration) as unknown as import(
            "@/lib/relayProbe"
          ).ProbePc,
      });
      setState({ phase: "done", result });
    } catch {
      // A failure to even ASK is its own outcome and must not read as "the relay
      // is down" — those are different next steps.
      setState({ phase: "failed" });
    }
  }

  const busy = state.phase === "running";
  return (
    <div
      className="rsheet space-y-2 rounded-[20px] border bg-card p-4"
      style={{ borderColor: GOLD_HAIRLINE }}
    >
      <h3 className={GOLD_LABEL}>{t("admin.relay.label")}</h3>
      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        {t("admin.relay.hint")}
      </p>
      {state.phase === "done" && <RelayVerdict result={state.result} />}
      {state.phase === "failed" && (
        <p className="text-xs text-destructive">{t("admin.relay.failed")}</p>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="rounded-[13px]"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? (
          <>
            <Loader2 className="me-1.5 size-3.5 animate-spin" />
            {t("admin.relay.running")}
          </>
        ) : (
          <>
            <Radio className="me-1.5 size-3.5" aria-hidden="true" />
            {state.phase === "done" ? t("admin.relay.again") : t("admin.relay.run")}
          </>
        )}
      </Button>
    </div>
  );
}

/** The verdict row plus, when there are any, the raw gathering errors. Split out
 *  so the four outcomes read as four cases rather than a chain of ternaries. */
function RelayVerdict({ result }: { result: import("@/lib/relayProbe").RelayProbeResult }) {
  const t = useT();
  const verdict = relayProbeVerdict(result);
  const label =
    verdict === "ok"
      ? t("admin.relay.ok", {
          relays: result.relayUrls.length || result.relayCandidates,
          total: result.turnUrls.length,
          ms: result.ms,
        })
      : verdict === "unauthorized"
        ? t("admin.relay.unauthorized")
        : verdict === "unreachable"
          ? t("admin.relay.unreachable")
          : t("admin.relay.noTurn");
  const detail =
    verdict === "ok"
      ? t("admin.relay.okDetail")
      : verdict === "unauthorized"
        ? t("admin.relay.unauthorizedDetail")
        : verdict === "unreachable"
          ? t("admin.relay.unreachableDetail")
          : undefined;
  return (
    <div className="space-y-1.5">
      <ul className="text-xs">
        <Row ok={verdict === "ok"} label={label} detail={detail} />
      </ul>
      {result.errors.length > 0 && (
        <>
          <p className="text-[10.5px] text-muted-foreground">
            {t("admin.relay.errors", { count: result.errors.length })}
          </p>
          {/* The URL and the STUN code VERBATIM: 401 vs 701 vs a timeout are three
              different problems, and paraphrasing them is how the actual code gets
              lost. LTR-isolated — a URL inside an RTL paragraph reorders. */}
          <ul className="space-y-0.5 text-[10.5px] text-muted-foreground">
            {result.errors.slice(0, 8).map((e, i) => (
              <li key={i} className="font-mono [unicode-bidi:isolate]" dir="ltr">
                {(e.url || "?") + " · " + (e.code ?? "?") + (e.text ? " · " + e.text : "")}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * CRASH CONSOLE (v2.107.x) — reads the telemetry pipe every surface writes to:
 * the web app, the Capacitor iOS/Android shells (which run this same bundle),
 * the React Native app, and the server process. One card, three layers:
 * version chips (the "review several versions per build" rollup) filter the
 * grouped defect list; a group opens its occurrence history; an occurrence
 * opens the full diagnostics — stack, breadcrumb trail, device.
 *
 * PLATFORM NAMES AND VERSION STRINGS RENDER RAW from the rows — they are
 * identifiers (the same token in both languages), not copy, exactly like the
 * 6-digit numbers everywhere else in this console.
 */
/** SESSION JOURNEYS (v2.107.23) — the owner's "everything the user does, icon
 *  by icon" made readable: one row per session, expandable into the full
 *  step-by-step trail, with the open / closed / VANISHED verdict up front. */
function SessionsConsole() {
  const t = useT();
  const stateLabel = (st: "open" | "closed" | "vanished") =>
    st === "open"
      ? t("admin.tele.state.open")
      : st === "closed"
        ? t("admin.tele.state.closed")
        : t("admin.tele.state.vanished");
  const [openSid, setOpenSid] = useState<string | null>(null);
  const listQ = trpc.admin.sessionList.useQuery({ days: 7, limit: 60 }, { staleTime: 15_000 });
  const detailQ = trpc.admin.sessionDetail.useQuery(
    { sessionId: openSid ?? "" },
    { enabled: !!openSid }
  );
  const ts = (v: unknown) => String(v).replace("T", " ").slice(0, 16);
  const stateChip = (state: string) =>
    "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] " +
    (state === "vanished"
      ? "border-destructive/60 text-destructive"
      : state === "open"
        ? "border-[#c9a227]/70 text-[#c9a227] dark:text-[#e8c94a]"
        : "border-border text-muted-foreground");
  const journey = (() => {
    const raw = detailQ.data?.session?.events;
    if (typeof raw !== "string") return "";
    try {
      const evs = JSON.parse(raw) as { t: number; kind: string; msg: string }[];
      return evs.map((e) => `${e.t}s  ${e.kind.padEnd(5)} ${e.msg}`).join("\n");
    } catch {
      return raw;
    }
  })();
  return (
    <div
      className="rsheet space-y-3 rounded-[20px] border bg-card p-4"
      style={{ borderColor: GOLD_HAIRLINE }}
    >
      <h3 className={GOLD_LABEL}>{t("admin.sessions.label")}</h3>
      <p className="text-xs text-muted-foreground">{t("admin.sessions.body")}</p>
      {listQ.isError ? (
        <p className="text-xs text-destructive">{t("admin.sessions.loadError")}</p>
      ) : (listQ.data?.rows ?? []).length === 0 && !listQ.isLoading ? (
        <p className="text-xs text-muted-foreground">{t("admin.sessions.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {(listQ.data?.rows ?? []).map((r) => (
            <li key={r.sessionId}>
              <button
                type="button"
                onClick={() => setOpenSid(openSid === r.sessionId ? null : r.sessionId)}
                className="w-full rounded-[14px] border border-border/70 bg-background/40 px-3 py-2 text-start hover:border-[#c9a227]/50"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className={stateChip(r.state)}>{stateLabel(r.state)}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground [unicode-bidi:isolate]" dir="ltr">
                    {r.platform} · {r.appVersion}
                  </span>
                </span>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground/80 [unicode-bidi:isolate]" dir="ltr">
                  <span>{t("admin.sessions.started")} {ts(r.startedAt)}</span>
                  <span>{t("admin.sessions.lastSeen")} {ts(r.lastSeenAt)}</span>
                  <span>{t("admin.sessions.taps", { n: r.taps })}</span>
                  <span>{t("admin.sessions.errors", { n: r.errors })}</span>
                  <span>{t("admin.sessions.fails", { n: r.fails })}</span>
                  {r.url ? <span className="truncate">{r.url}</span> : null}
                </span>
              </button>
              {openSid === r.sessionId && (
                <div className="mt-1.5 space-y-1.5 rounded-[14px] border border-border/50 bg-background/30 p-2.5 [unicode-bidi:isolate]" dir="ltr">
                  <div className={GOLD_LABEL}>{t("admin.sessions.journey")}</div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[10px] bg-background/70 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {journey || "…"}
                  </pre>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-[13px]"
                    onClick={() => setOpenSid(null)}
                  >
                    {t("admin.crash.close")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** CALL VITALS (v2.107.23) — kilobytes up/down, bitrate, round-trip, loss,
 *  duration, end reason and the clean/leaked verdict. Never a frame of media:
 *  the source feed is the stats summarizer, which has none to give. */
function CallsConsole() {
  const t = useT();
  const stateLabel = (st: "open" | "closed" | "vanished") =>
    st === "open"
      ? t("admin.tele.state.open")
      : st === "closed"
        ? t("admin.tele.state.closed")
        : t("admin.tele.state.vanished");
  const [openCid, setOpenCid] = useState<string | null>(null);
  const listQ = trpc.admin.callList.useQuery({ days: 7, limit: 60 }, { staleTime: 15_000 });
  const detailQ = trpc.admin.callDetail.useQuery(
    { callInstanceId: openCid ?? "" },
    { enabled: !!openCid }
  );
  const ts = (v: unknown) => String(v).replace("T", " ").slice(0, 16);
  const stateChip = (state: string, clean: number | null) =>
    "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] " +
    (state === "vanished" || clean === 0
      ? "border-destructive/60 text-destructive"
      : state === "open"
        ? "border-[#c9a227]/70 text-[#c9a227] dark:text-[#e8c94a]"
        : "border-border text-muted-foreground");
  const parsed = (raw: unknown) => {
    if (typeof raw !== "string") return "";
    try {
      return (JSON.parse(raw) as Record<string, unknown>[])
        .map((e) =>
          "t" in e && "upKbps" in e
            ? `${e.t}s  ↑${e.upKbps}kbps ↓${e.downKbps}kbps  rtt=${e.rttMs ?? "-"}ms loss=${e.lossPct ?? "-"}%`
            : `${e.t}s  ${e.msg}`
        )
        .join("\n");
    } catch {
      return raw;
    }
  };
  return (
    <div
      className="rsheet space-y-3 rounded-[20px] border bg-card p-4"
      style={{ borderColor: GOLD_HAIRLINE }}
    >
      <h3 className={GOLD_LABEL}>{t("admin.calls.label")}</h3>
      <p className="text-xs text-muted-foreground">{t("admin.calls.body")}</p>
      {listQ.isError ? (
        <p className="text-xs text-destructive">{t("admin.calls.loadError")}</p>
      ) : (listQ.data?.rows ?? []).length === 0 && !listQ.isLoading ? (
        <p className="text-xs text-muted-foreground">{t("admin.calls.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {(listQ.data?.rows ?? []).map((r) => (
            <li key={r.callInstanceId}>
              <button
                type="button"
                onClick={() => setOpenCid(openCid === r.callInstanceId ? null : r.callInstanceId)}
                className="w-full rounded-[14px] border border-border/70 bg-background/40 px-3 py-2 text-start hover:border-[#c9a227]/50"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="flex items-baseline gap-2">
                    <span className={stateChip(r.state, r.clean)}>{stateLabel(r.state)}</span>
                    {r.clean === 1 ? (
                      <span className="font-mono text-[10px] text-muted-foreground">{t("admin.calls.clean")}</span>
                    ) : r.clean === 0 ? (
                      <span className="font-mono text-[10px] text-destructive">{t("admin.calls.leaked")}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground [unicode-bidi:isolate]" dir="ltr">
                    {r.platform} · {r.appVersion}
                  </span>
                </span>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground/80 [unicode-bidi:isolate]" dir="ltr">
                  <span>{ts(r.startedAt)}</span>
                  <span>{t("admin.calls.durationS", { n: r.durationSec })}</span>
                  <span>{t("admin.calls.upDown", { u: r.upKB, d: r.downKB })}</span>
                  {r.avgRttMs != null ? <span>{t("admin.calls.rtt", { n: r.avgRttMs })}</span> : null}
                  {r.lossWorstPct != null ? <span>{t("admin.calls.loss", { n: r.lossWorstPct })}</span> : null}
                  <span>{t("admin.calls.peers", { n: r.peersMax })}</span>
                  {r.endReason ? <span>{r.endReason}</span> : null}
                </span>
              </button>
              {openCid === r.callInstanceId && (
                <div className="mt-1.5 space-y-1.5 rounded-[14px] border border-border/50 bg-background/30 p-2.5 [unicode-bidi:isolate]" dir="ltr">
                  <div className={GOLD_LABEL}>{t("admin.calls.timeline")}</div>
                  <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-[10px] bg-background/70 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {parsed(detailQ.data?.call?.samples) || "…"}
                  </pre>
                  <div className={GOLD_LABEL}>{t("admin.calls.moments")}</div>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-[10px] bg-background/70 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {parsed(detailQ.data?.call?.events) || "…"}
                  </pre>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-[13px]"
                    onClick={() => setOpenCid(null)}
                  >
                    {t("admin.crash.close")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CrashConsole() {
  const t = useT();
  const [ver, setVer] = useState("");
  const [plat, setPlat] = useState("");
  const [openFp, setOpenFp] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [showSolved, setShowSolved] = useState(false);
  const versionsQ = trpc.admin.crashVersions.useQuery(undefined, { staleTime: 30_000 });
  const groupsQ = trpc.admin.crashGroups.useQuery(
    { appVersion: ver || undefined, platform: plat || undefined, days: 365, includeSolved: showSolved || undefined },
    { staleTime: 15_000 }
  );
  const occQ = trpc.admin.crashOccurrences.useQuery(
    { fingerprint: openFp ?? "" },
    { enabled: !!openFp }
  );
  const detailQ = trpc.admin.crashDetail.useQuery({ id: openId ?? 0 }, { enabled: !!openId });
  /* SOLVED workflow (v2.107.23): resolve pins the CURRENT build as the fix
     version — the operator presses it right after shipping the fix, so "this
     build" is the honest value; the note field stays server-side optional. */
  const resolveM = trpc.admin.crashResolve.useMutation({ onSuccess: () => void groupsQ.refetch() });
  const unsolveM = trpc.admin.crashUnsolve.useMutation({ onSuccess: () => void groupsQ.refetch() });

  /* MySQL timestamps arrive as "YYYY-MM-DDTHH:MM:SS…" or "YYYY-MM-DD HH:MM:SS";
     shown to the minute, UTC, mono — an operator compares builds across days,
     and a locale-shaped date would make two rows disagree about one moment. */
  const ts = (v: string) => String(v).replace("T", " ").slice(0, 16);
  const platforms = Array.from(new Set((versionsQ.data?.rows ?? []).map((r) => r.platform)));

  const chip = (active: boolean) =>
    "shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors " +
    (active
      ? "border-[#c9a227]/70 bg-[#e8c94a]/15 text-foreground"
      : "border-border text-muted-foreground hover:text-foreground");

  return (
    <div
      className="rsheet space-y-3 rounded-[20px] border bg-card p-4"
      style={{ borderColor: GOLD_HAIRLINE }}
    >
      <h3 className={GOLD_LABEL}>{t("admin.crash.label")}</h3>
      <p className="text-xs text-muted-foreground">{t("admin.crash.body")}</p>

      {/* The per-build rollup — each chip is a (version, platform) with its hit
          count, and tapping it filters the group list to that build. */}
      <div
        className="flex gap-1.5 overflow-x-auto pb-1"
        role="group"
        aria-label={t("admin.crash.pickVersion")}
      >
        <button type="button" className={chip(!ver && !plat)} onClick={() => { setVer(""); setPlat(""); }}>
          {t("admin.crash.allVersions")}
        </button>
        <button type="button" className={chip(showSolved)} onClick={() => setShowSolved((v) => !v)}>
          {t("admin.solve.showSolved")}
        </button>
        {(versionsQ.data?.rows ?? []).slice(0, 14).map((r) => {
          const active = ver === r.appVersion && plat === r.platform;
          return (
            <button
              key={r.appVersion + "/" + r.platform}
              type="button"
              className={chip(active)}
              onClick={() => {
                setVer(active ? "" : r.appVersion);
                setPlat(active ? "" : r.platform);
              }}
            >
              {r.appVersion} · {r.platform} {t("admin.crash.timesShort", { n: r.hits })}
            </button>
          );
        })}
      </div>
      {platforms.length > 1 && (
        <div
          className="flex gap-1.5 overflow-x-auto"
          role="group"
          aria-label={t("admin.crash.pickPlatform")}
        >
          <button type="button" className={chip(!plat)} onClick={() => setPlat("")}>
            {t("admin.crash.allPlatforms")}
          </button>
          {platforms.map((p) => (
            <button
              key={p}
              type="button"
              className={chip(plat === p && !ver)}
              onClick={() => {
                setPlat(plat === p ? "" : p);
                setVer("");
              }}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {groupsQ.isError ? (
        <p className="text-xs text-destructive">{t("admin.crash.loadError")}</p>
      ) : (groupsQ.data?.rows ?? []).length === 0 && !groupsQ.isLoading ? (
        <p className="text-xs text-muted-foreground">{t("admin.crash.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {(groupsQ.data?.rows ?? []).map((g) => (
            <li key={g.fingerprint}>
              <button
                type="button"
                onClick={() => {
                  setOpenFp(openFp === g.fingerprint ? null : g.fingerprint);
                  setOpenId(null);
                }}
                className="w-full rounded-[14px] border border-border/70 bg-background/40 px-3 py-2 text-start hover:border-[#c9a227]/50"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-xs font-semibold text-foreground">
                    {g.errorName}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-[#c9a227] dark:text-[#e8c94a]">
                    {t("admin.crash.timesShort", { n: g.hits })}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground [unicode-bidi:isolate]" dir="ltr">
                  {g.errorMessage}
                </span>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground/80 [unicode-bidi:isolate]" dir="ltr">
                  <span>{g.platform} · {g.appVersion}</span>
                  {g.solvedInVersion && !g.regressed ? (
                    <span className="text-emerald-600 dark:text-emerald-400">✓ {t("admin.solve.solvedIn", { v: g.solvedInVersion })}</span>
                  ) : null}
                  {g.regressed ? (
                    <span className="text-destructive">{t("admin.solve.regressed")}</span>
                  ) : null}
                  <span>{t("admin.crash.lastSeen")} {ts(g.lastSeen)}</span>
                  <span>{t("admin.crash.firstSeen")} {ts(g.firstSeen)}</span>
                </span>
              </button>
              {openFp === g.fingerprint && (
                <div className="mt-1.5 space-y-1.5 rounded-[14px] border border-border/50 bg-background/30 p-2.5">
                  <div className="flex gap-2">
                    {!g.solvedInVersion || g.regressed ? (
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-[13px]"
                        disabled={resolveM.isPending}
                        onClick={() => resolveM.mutate({ fingerprint: g.fingerprint, solvedInVersion: APP_VERSION })}
                      >
                        {t("admin.solve.solve", { v: APP_VERSION })}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="rounded-[13px]"
                        disabled={unsolveM.isPending}
                        onClick={() => unsolveM.mutate({ fingerprint: g.fingerprint })}
                      >
                        {t("admin.solve.unsolve")}
                      </Button>
                    )}
                  </div>
                  <div className={GOLD_LABEL}>{t("admin.crash.occurrences")}</div>
                  <ul className="space-y-1">
                    {(occQ.data?.rows ?? []).map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          onClick={() => setOpenId(openId === o.id ? null : o.id)}
                          className="flex w-full items-baseline justify-between gap-2 rounded-[10px] px-2 py-1 font-mono text-[10px] text-muted-foreground hover:bg-background/60 hover:text-foreground"
                          dir="ltr"
                        >
                          <span>{ts(o.createdAt)} · {o.platform} · {o.appVersion}</span>
                          <span>{t("admin.crash.timesShort", { n: o.dupCount })}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {openId != null && detailQ.data?.report && (
                    <div className="space-y-1.5" dir="ltr">
                      <div className={GOLD_LABEL}>{t("admin.crash.stack")}</div>
                      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-[10px] bg-background/70 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                        {detailQ.data.report.stack || detailQ.data.report.errorMessage}
                        {detailQ.data.report.componentStack
                          ? "\n\n" + detailQ.data.report.componentStack
                          : ""}
                      </pre>
                      {detailQ.data.report.breadcrumbs && (
                        <>
                          <div className={GOLD_LABEL}>{t("admin.crash.breadcrumbs")}</div>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[10px] bg-background/70 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                            {detailQ.data.report.breadcrumbs}
                          </pre>
                        </>
                      )}
                      {detailQ.data.report.device && (
                        <>
                          <div className={GOLD_LABEL}>{t("admin.crash.device")}</div>
                          <pre className="overflow-auto whitespace-pre-wrap break-all rounded-[10px] bg-background/70 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                            {detailQ.data.report.device}
                          </pre>
                        </>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="rounded-[13px]"
                        onClick={() => setOpenId(null)}
                      >
                        {t("admin.crash.close")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PushCheck({ identityId }: { identityId: number }) {
  const t = useT();
  const q = trpc.admin.pushDiagnostics.useQuery({ identityId }, { staleTime: 5_000 });
  const test = trpc.admin.sendTestPush.useMutation({
    onSuccess: (r) =>
      r.delivered > 0
        ? toast.success(
            r.delivered === 1
              ? t("admin.push.sentOne")
              : t("admin.push.sentMany", { count: r.delivered }),
          )
        : // Zero is the informative case: the send path ran and nothing was
          // reachable, which is different from the request failing.
          toast.error(t("admin.push.nothingReachable")),
    onError: (e) => toast.error(e.message || t("admin.push.testFailed")),
  });

  if (q.isLoading) {
    return (
      <ToolCard tone="gold">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> {t("admin.push.checking")}
        </div>
      </ToolCard>
    );
  }
  if (!q.data) {
    return (
      <ToolCard tone="danger">
        <p className="text-xs text-destructive">{t("admin.push.readFailed")}</p>
      </ToolCard>
    );
  }
  const d = q.data;
  const native = d.devices.filter((x) => x.kind === "fcm" || x.kind === "expo");
  /* A row whose STORED kind and SHAPE-DERIVED kind disagree is unroutable: the
     sender picks the transport by the stored kind, so an Expo token filed as `fcm`
     goes to FCM and is dropped with no error anywhere. This is the one failure that
     is completely invisible without printing both. */
  const mismatched = d.devices.filter((x) => x.derived !== "unknown" && x.derived !== x.kind);

  return (
    <ToolCard tone="gold">
      <div className={GOLD_LABEL + " mb-2"}>{t("admin.push.label")}</div>
      <div className="space-y-3 text-xs">
        <ul>
          <Row
            ok={native.length > 0}
            label={
              native.length === 0
                ? t("admin.push.noDevices")
                : native.length === 1
                  ? t("admin.push.devicesOne")
                  : t("admin.push.devicesMany", { count: native.length })
            }
            detail={
              native.length > 0
                ? native
                    .map((x) =>
                      t("admin.push.deviceEntry", {
                        kind: x.kind,
                        prefix: x.prefix,
                        length: x.length,
                      }),
                    )
                    .join("  ·  ")
                : t("admin.push.noDevicesDetail")
            }
          />
          <Row
            ok={mismatched.length === 0}
            label={
              mismatched.length === 0
                ? t("admin.push.routable")
                : mismatched.length === 1
                  ? t("admin.push.mismatchedOne")
                  : t("admin.push.mismatchedMany", { count: mismatched.length })
            }
            detail={
              mismatched.length === 0
                ? undefined
                : mismatched
                    .map((x) =>
                      t("admin.push.mismatchEntry", { kind: x.kind, derived: x.derived }),
                    )
                    .join("; ")
            }
          />
          <Row
            ok={d.pushEnabled}
            label={d.pushEnabled ? t("admin.push.switchOn") : t("admin.push.switchOff")}
            detail={d.pushEnabled ? undefined : t("admin.push.switchOffDetail")}
          />
          <Row
            ok={d.transports.fcm}
            label={d.transports.fcm ? t("admin.push.fcmOn") : t("admin.push.fcmOff")}
            detail={
              d.transports.fcm ? t("admin.push.fcmOnDetail") : t("admin.push.fcmOffDetail")
            }
          />
          <Row
            ok={d.transports.expo}
            label={t("admin.push.expo")}
            detail={
              d.transports.expoAccessToken
                ? t("admin.push.expoTokenSet")
                : t("admin.push.expoTokenMissing")
            }
          />
          <Row
            ok={d.transports.webpush}
            label={d.transports.webpush ? t("admin.push.webOn") : t("admin.push.webOff")}
          />
          {/* A locked iPhone's real call screen comes ONLY from APNs VoIP, so an
              iOS device holding an apns token on a keyless fleet is the one
              combination that stores a token nothing can deliver to. */}
          <Row
            ok={d.transports.apnsVoip}
            label={d.transports.apnsVoip ? t("admin.push.apnsOn") : t("admin.push.apnsOff")}
            detail={
              d.transports.apnsVoip
                ? t("admin.push.apnsOnDetail", {
                    credential:
                      d.transports.apnsVoipMode === "cert"
                        ? t("admin.push.apnsCert")
                        : t("admin.push.apnsKey"),
                  })
                : t("admin.push.apnsOffDetail")
            }
          />
          {/* A certificate expires on a date nobody is watching — ringing would just
              stop one morning with nothing in the diff to blame. Warn a month out,
              which is enough time to reissue without downtime. A .p8 never expires,
              so this row is absent for it rather than reassuring about nothing. */}
          {d.transports.apnsVoipExpiresAt ? (
            (() => {
              const when = new Date(d.transports.apnsVoipExpiresAt);
              const days = Math.round((when.getTime() - Date.now()) / 86_400_000);
              return (
                <Row
                  ok={days > 30}
                  label={
                    days <= 0
                      ? t("admin.push.certExpired", { days: Math.abs(days) })
                      : days <= 30
                        ? t("admin.push.certExpiring", { days })
                        : t("admin.push.certValid", { days })
                  }
                  /* The DATE stays an ISO `YYYY-MM-DD` slice rather than a localised
                     one: it is Western digits by construction, unambiguous in every
                     locale, and it is the form an operator compares against Apple's
                     own console. */
                  detail={t("admin.push.certDetail", {
                    date: when.toISOString().slice(0, 10),
                  })}
                />
              );
            })()
          ) : null}
          {/* The most likely reading of "it's not showing": testing by CALLING. */}
          <Row
            ok={d.ringPushed}
            label={d.ringPushed ? t("admin.push.ringOn") : t("admin.push.ringOff")}
            detail={t("admin.push.sendsFor", { kinds: d.sendsFor.join(", ") })}
          />
        </ul>
        <Button
          type="button"
          size="sm"
          className={"rounded-[11px] " + GOLD_CTA}
          disabled={test.isPending}
          onClick={() => test.mutate({ identityId })}
        >
          <BellRing className="size-3.5" />
          {test.isPending ? t("admin.push.testing") : t("admin.push.test")}
        </Button>
      </div>
    </ToolCard>
  );
}
