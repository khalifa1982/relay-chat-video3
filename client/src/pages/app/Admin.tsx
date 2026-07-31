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
import type { CSSProperties, ReactNode } from "react";
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
} from "lucide-react";
import { RoleBadge, roleLabel } from "@/app/VerifiedBadge";
import { formatPin } from "@/app/TopBar";
import { GROUP_PALETTE, peerPaletteIndex } from "@/app/peerColors";
import { useLiveStats } from "@/app/useLiveStats";

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
  return (
    <span
      title="You are signed in as a RELAY administrator"
      className={"inline-flex shrink-0 items-center gap-1.5 rounded-[14px] px-2.5 py-1 " + GOLD_CHIP}
    >
      <ShieldCheck className={"size-3 " + GOLD_TEXT} aria-hidden="true" />
      <span className={"font-mono text-[9px] font-semibold tracking-[0.16em] " + GOLD_TEXT}>
        ADMIN
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
  const live = useLiveStats();
  const cells: { label: string; value: number | null; live?: boolean }[] = [
    { label: "Users", value: live ? live.registeredUsers : null },
    { label: "Guests", value: live ? live.guestsServed : null },
    { label: "Parties", value: live ? live.totalParties : null },
    { label: "Online", value: live ? live.onlineNow : null, live: true },
  ];
  return (
    <dl className="grid grid-cols-4 gap-2">
      {cells.map((c) => (
        <div key={c.label} className={STAT_TILE}>
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
      toast.success("Suggested. It shows in their app next time they open it.");
      setInviteError(null);
      utils.admin.findIdentities.invalidate().catch(() => {});
    },
    // Verbatim: the server names "already has an account", a malformed address and
    // "that address belongs to somebody" separately, and those are three different
    // next steps for the operator.
    onError: (e) => setInviteError(e.message || "Couldn't save that suggestion."),
  });
  const withdrawInvite = trpc.admin.clearGuestRegistrationInvite.useMutation({
    onSuccess: () => {
      setInviteError(null);
      utils.admin.findIdentities.invalidate().catch(() => {});
    },
    onError: (e) => setInviteError(e.message || "Couldn't withdraw that suggestion."),
  });
  /** Which row's DELETE panel is open, and the number typed to confirm it (v2.100.0). */
  const [deleting, setDeleting] = useState<number | null>(null);
  const [confirmNum, setConfirmNum] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const purge = trpc.admin.deleteIdentity.useMutation({
    onSuccess: () => {
      toast.success("Deleted. Their number is retired and will not be reissued.");
      setDeleting(null);
      setConfirmNum("");
      setDeleteError(null);
      utils.admin.findIdentities.invalidate().catch(() => {});
    },
    // The server names the self-deletion refusal specifically, because "another
    // admin has to do it" is a different next step from "that id doesn't exist".
    onError: (e) => setDeleteError(e.message || "Couldn't delete that person."),
  });
  const setNumber = trpc.admin.setIdentityNumber.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.unchanged
          ? "That was already their number."
          : `Changed ${formatPin(res.oldNumber)} → ${formatPin(res.newNumber)}`,
      );
      setEditing(null);
      setWanted("");
      setError(null);
      utils.admin.findIdentities.invalidate().catch(() => {});
    },
    // The server names each refusal; showing its own message means a typo and a
    // collision read differently, which is the point of naming them.
    onError: (e) => setError(e.message || "Couldn't change that number."),
  });

  const digits = wanted.replace(/[\s\-.]/g, "");
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
        <p className="text-sm font-semibold">Administrators only</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          This account doesn't hold the admin role. Nothing on this page is available to it.
        </p>
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
        <h1 className="text-[21px] font-bold leading-none">Admin</h1>
        <AdminChip />
      </div>

      <StatTiles />

      {/* FLEET state, above the per-person search, because it describes the whole
          deployment rather than anybody in particular (v2.105.22). */}
      <MediaCheck />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query.trim());
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a person — name or number"
            aria-label="Find a person"
            dir="auto"
            className="w-full rounded-[13px] border border-border bg-card/60 py-2.5 pl-9 pr-3 text-[12.5px] outline-none placeholder:text-muted-foreground focus:border-primary dark:border-white/10 dark:bg-white/5"
          />
        </div>
        <Button type="submit" size="sm" variant="outline" className="rounded-[13px]">
          Find
        </Button>
      </form>

      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        Changing a number updates everyone who saved it. Messages, calls, contacts and
        statuses all stay with the person — only the number moves, and the old one is never
        reissued to anybody else.
      </p>

      {found.isLoading ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (found.data?.rows.length ?? 0) === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          {submitted ? `Nobody matches “${submitted}”.` : "No identities yet."}
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
                        {r.displayName || "Unnamed"}
                      </span>
                      <RoleBadge role={r.role} caption={false} size={11} />
                      <span className={"ms-auto " + ROLE_TAG}>{roleLabel(r.role)}</span>
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span
                        className="shrink-0 font-mono text-[10px] text-muted-foreground [unicode-bidi:isolate]"
                        dir="ltr"
                      >
                        {formatPin(r.number)}
                      </span>
                      {r.email && (
                        <span
                          className="min-w-0 truncate text-[9.5px] text-muted-foreground/70"
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
                        aria-label={`Account tools for ${r.displayName || r.number}`}
                        className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                      >
                        <MoreVertical className="size-4" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-60">
                      <DropdownMenuLabel className={GOLD_LABEL}>
                        Account tools
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => {
                          setEditing(editing === r.id ? null : r.id);
                          setWanted("");
                          setError(null);
                        }}
                      >
                        <Hash className="size-4" />
                        {editing === r.id ? "Hide number editor" : "Change number"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setChecking(checking === r.id ? null : r.id)}
                      >
                        <BellRing className="size-4" />
                        {checking === r.id ? "Hide notifications" : "Notifications"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setTyping(typing === r.id ? null : r.id);
                          setTypeError(null);
                        }}
                      >
                        <ShieldCheck className="size-4" />
                        {typing === r.id ? "Hide account type" : "Account type"}
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
                        {deleting === r.id ? "Hide delete" : "Delete account"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {checking === r.id && <PushCheck identityId={r.id} />}
                {deleting === r.id && (
                  <ToolCard tone="danger">
                    <div className={DANGER_LABEL + " mb-2"}>
                      Delete this account
                    </div>
                    <p className="text-xs font-semibold text-destructive">
                      Delete this person completely. This cannot be undone.
                    </p>
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
                      <li>Their messages, threads, contacts, stories, call log and devices go.</li>
                      <li>
                        Anyone who was in a 1:1 chat with them loses that conversation from their own
                        inbox. Group chats survive for their other members.
                      </li>
                      <li>
                        {formatPin(r.number)} is retired for good — it is never handed to anybody
                        else.
                      </li>
                      {/* Said plainly rather than implied away. Deleting an attachments row would
                          make its media MORE readable, not less (v2.98.4/F3: the storage proxy
                          serves a key it cannot classify), and a third party's contact row is what
                          holds a BLOCK, so deleting it would silently un-block them (M13). The
                          avatar line is the honest one: a profile photo has always been readable
                          by any signed-in RELAY user (it renders on the incoming-ring card), and
                          that does not change here — the bytes stay because there is no
                          storage-delete path in this codebase to remove them with. */}
                      <li>
                        Files they sent stay in storage and stay locked shut. Their profile photo
                        stays too — no more readable than before, but not erased.
                      </li>
                      <li>A block anyone placed on them stays in place.</li>
                    </ul>
                    <p className="mt-2.5 text-[10px] text-muted-foreground">
                      Type their 6-digit number to enable Delete.
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        dir="ltr"
                        autoComplete="off"
                        maxLength={9}
                        placeholder={r.number}
                        value={confirmNum}
                        onChange={(e) => {
                          setConfirmNum(e.target.value);
                          setDeleteError(null);
                        }}
                        aria-label={`Type ${r.number} to confirm deleting this person`}
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
                          confirmNum.replace(/[\s\-.]/g, "") !== r.number || purge.isPending
                        }
                        onClick={() => purge.mutate({ identityId: r.id })}
                      >
                        {purge.isPending ? "Deleting…" : "Delete permanently"}
                      </Button>
                    </div>
                    {deleteError && <p className="mt-2 text-xs text-destructive">{deleteError}</p>}
                  </ToolCard>
                )}
                {typing === r.id && (
                  <ToolCard tone="gold">
                    <div className={GOLD_LABEL + " mb-2"}>Change account type</div>
                    {r.isGuest ? (
                      /* A guest has no account row at all — that is what being a guest
                         IS — so there is no role to write. Said here rather than offered
                         and then refused, because a control that always fails is worse
                         than one that is absent. The board's three-way segmented is
                         therefore ONE lit segment for a guest: the two transitions the
                         server refuses are not drawn as taps at all. */
                      <div className="space-y-2">
                        <TierWell current="Guest" />
                        <p className="text-xs text-muted-foreground">
                          Guests have no account behind them, so there's no role to change. They
                          keep their number and everything in it when they register themselves.
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
                          You can suggest the address they should use. They see it in their app,
                          can change it, and finish registering themselves — this doesn't create
                          an account or send anything.
                        </p>
                        {r.regInviteEmail && (
                          <p className="text-xs">
                            <span className="text-muted-foreground">Already suggested: </span>
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
                            placeholder="them@example.com"
                            value={inviteEmail[r.id] ?? ""}
                            onChange={(e) => {
                              setInviteEmail((m) => ({ ...m, [r.id]: e.target.value }));
                              setInviteError(null);
                            }}
                            aria-label={`Suggested registration address for ${r.displayName || r.number}`}
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
                            {invite.isPending ? "Saving…" : "Suggest"}
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
                              Withdraw
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
                        current={r.role === "admin" ? "Admin" : "Registered"}
                        other={r.role === "admin" ? "Registered" : "Admin"}
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
                    <div className={GOLD_LABEL + " mb-2"}>Change number</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        // Text with a numeric keypad: type="number" brings spinners,
                        // accepts "1e5" and drops a leading zero.
                        type="text"
                        inputMode="numeric"
                        dir="ltr"
                        autoComplete="off"
                        maxLength={9}
                        placeholder="777777"
                        value={wanted}
                        onChange={(e) => {
                          setWanted(e.target.value);
                          setError(null);
                        }}
                        aria-label={`New number for ${r.displayName || r.number}`}
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
                        {setNumber.isPending ? "Changing…" : "Apply"}
                      </Button>
                    </div>
                    {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
                    {!error && wanted.length > 0 && !ok && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Six digits, and it can't start with 000 or 111.
                      </p>
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
  return (
    <div
      className="flex gap-1.5 rounded-[13px] border border-border p-[5px] dark:border-transparent dark:bg-black/30"
      role="group"
      aria-label="Account type"
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
          {busy ? "Saving…" : other}
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
function MediaCheck() {
  const q = trpc.admin.mediaDiagnostics.useQuery(undefined, { staleTime: 30_000 });
  if (q.isLoading) {
    return (
      <div
        className="rsheet flex items-center gap-2 rounded-[20px] border bg-card p-4 text-xs text-muted-foreground"
        style={{ borderColor: GOLD_HAIRLINE }}
      >
        <Loader2 className="size-3.5 animate-spin" /> Reading the media config…
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
        Couldn&apos;t read the media config.
      </p>
    );
  }
  const { transport, turn } = q.data;
  return (
    <div
      className="rsheet space-y-2 rounded-[20px] border bg-card p-4"
      style={{ borderColor: GOLD_HAIRLINE }}
    >
      <h3 className={GOLD_LABEL}>Call media — this fleet</h3>
      <ul className="text-xs">
        {/* `ok` is TRUE, deliberately: the mesh is the transport this fleet is meant
            to be on, so drawing it as a fault would make the one row that always
            renders read as a permanent problem and teach an operator to ignore the
            card. The DETAIL carries the cost honestly instead. */}
        <Row
          ok
          label={transport === "mesh" ? "WebRTC mesh in use" : `${transport} in use`}
          detail="Peer-to-peer — each phone in an N-party call runs N−1 encoders, so 6 is the cap."
        />
        <Row
          ok={turn.turnsTls > 0}
          label={`Relays: ${turn.hosts.length} host${turn.hosts.length === 1 ? "" : "s"}, ${turn.turnsTls} TLS`}
          detail={
            turn.hosts.length
              ? `${turn.hosts.join(", ")} · ${turn.stun} STUN · ${turn.turnUdp} UDP · ${turn.turnTcp} TCP`
              : "No TURN advertised — a call behind a strict NAT has no fallback."
          }
        />
        <Row ok={turn.secretSet} label="TURN secret set" detail="Credentials are minted per call, never shown." />
      </ul>
      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        In a call, tap <span className="font-semibold">Stats</span> in the control bar for live
        round-trip, packet loss, and whether media is going through a relay.
      </p>
    </div>
  );
}

function PushCheck({ identityId }: { identityId: number }) {
  const q = trpc.admin.pushDiagnostics.useQuery({ identityId }, { staleTime: 5_000 });
  const test = trpc.admin.sendTestPush.useMutation({
    onSuccess: (r) =>
      r.delivered > 0
        ? toast.success(`Sent to ${r.delivered} device${r.delivered === 1 ? "" : "s"}.`)
        : // Zero is the informative case: the send path ran and nothing was
          // reachable, which is different from the request failing.
          toast.error("Nothing was reachable — no device accepted it."),
    onError: (e) => toast.error(e.message || "Couldn't send the test."),
  });

  if (q.isLoading) {
    return (
      <ToolCard tone="gold">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Checking…
        </div>
      </ToolCard>
    );
  }
  if (!q.data) {
    return (
      <ToolCard tone="danger">
        <p className="text-xs text-destructive">Couldn't read the notification state.</p>
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
      <div className={GOLD_LABEL + " mb-2"}>Push doctor — per transport</div>
      <div className="space-y-3 text-xs">
        <ul>
          <Row
            ok={native.length > 0}
            label={
              native.length > 0
                ? `${native.length} phone app device${native.length === 1 ? "" : "s"} registered`
                : "No phone-app device registered"
            }
            detail={
              native.length > 0
                ? native.map((x) => `${x.kind} · ${x.prefix}… (${x.length} chars)`).join("  ·  ")
                : "The app has never handed us a push token. Nothing the server does can fix this — the shell must post {type:\"SET_PUSH_TOKEN\", token} into the page."
            }
          />
          <Row
            ok={mismatched.length === 0}
            label={mismatched.length === 0 ? "Every token is routable" : `${mismatched.length} token filed under the wrong transport`}
            detail={
              mismatched.length === 0
                ? undefined
                : mismatched.map((x) => `stored ${x.kind}, looks like ${x.derived}`).join("; ")
            }
          />
          <Row
            ok={d.pushEnabled}
            label={d.pushEnabled ? "Their push switch is on" : "THEY turned push notifications off"}
            detail={d.pushEnabled ? undefined : "Profile → Notifications on their device."}
          />
          <Row
            ok={d.transports.fcm}
            label={d.transports.fcm ? "Firebase is configured on the server" : "Firebase is NOT configured on the server"}
            detail={
              d.transports.fcm
                ? "FIREBASE_SERVICE_ACCOUNT_JSON is present and parses."
                : "Only needed for RAW device tokens. Expo tokens go through Expo and need nothing here."
            }
          />
          <Row ok={d.transports.expo} label="Expo delivery is available" detail={d.transports.expoAccessToken ? "EXPO_ACCESS_TOKEN set." : "No access token — fine unless the Expo account enforces one."} />
          <Row ok={d.transports.webpush} label={d.transports.webpush ? "Browser push is configured" : "Browser push is NOT configured"} />
          {/* A locked iPhone's real call screen comes ONLY from APNs VoIP, so an
              iOS device holding an apns token on a keyless fleet is the one
              combination that stores a token nothing can deliver to. */}
          <Row
            ok={d.transports.apnsVoip}
            label={d.transports.apnsVoip ? "iPhone ring (APNs VoIP) is configured" : "iPhone ring (APNs VoIP) is NOT configured"}
            detail={
              d.transports.apnsVoip
                ? `A locked iPhone shows the full-screen call screen. Credential: ${
                    d.transports.apnsVoipMode === "cert"
                      ? "VoIP Services certificate"
                      : "signing key (.p8)"
                  }.`
                : "Needs either APNS_P8_KEY + APNS_KEY_ID + APNS_TEAM_ID, or APNS_VOIP_CERT_PEM + APNS_VOIP_KEY_PEM, plus a topic (APNS_VOIP_TOPIC or APNS_BUNDLE_ID). Android is unaffected."
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
                      ? `The VoIP certificate EXPIRED ${Math.abs(days)} days ago — iPhones cannot ring`
                      : days <= 30
                        ? `The VoIP certificate expires in ${days} days — reissue it now`
                        : `The VoIP certificate is valid for ${days} more days`
                  }
                  detail={`Expires ${when.toISOString().slice(0, 10)}. Apple lets two certificates exist at once, so you can reissue and swap with no downtime.`}
                />
              );
            })()
          ) : null}
          {/* The most likely reading of "it's not showing": testing by CALLING. */}
          <Row
            ok={d.ringPushed}
            label={d.ringPushed ? "A CALL pushes a ring" : "A CALL does not push at all"}
            detail={`What pushes: ${d.sendsFor.join(", ")}.`}
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
          {test.isPending ? "Sending…" : "Send a test notification"}
        </Button>
      </div>
    </ToolCard>
  );
}
