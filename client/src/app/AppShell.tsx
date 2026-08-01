import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import { Phone, MessageCircle, UsersRound, History, LogOut, Sparkles, Sun, Moon, Smartphone, Monitor, ArrowLeft, UserRound, BadgeCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { detectDeviceType } from "@/lib/deviceType";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useLocale, TEXT_SCALE_FACTOR, type TKey } from "@/app/i18n";
import { useIdentity } from "./useIdentity";
import { installExclusivePlayback } from "./mediaExclusive";
import { useSignOut } from "./useSignOut";
import { AuthPanel } from "./AuthPanel";
import { RoleBadge, roleFromFlags } from "./VerifiedBadge";
import { CountryFlag } from "./CountryFlag";
import { OnboardingGate } from "./OnboardingGate";
import { PasscodeGate } from "./PasscodeGate";
import { useRealtime } from "./useRealtime";
import { useDeliveryReceipts } from "./useDeliveryReceipts";
import { useDnd } from "./dnd";
import { useTheme } from "@/contexts/ThemeContext";
import { NotificationBell } from "./MissedCalls";
import { BrandMark, IdentityStrip, AvatarRing } from "./TopBar";
import { openPeerStatus } from "./PeerOverlays";
import { PushBanner } from "./PushBanner";
import { CallHealthBanner } from "./CallHealthBanner";
import { PeerOverlaysHost } from "./PeerOverlays";
import { unlockAudio } from "./notifications";
import { requestProfilePane } from "./profilePane";
import { RelayBackground } from "./RelayBackground";
import { APP_VERSION } from "@shared/version";

/**
 * The GROUPS tab's glyph — four dots in a 2×2, traced from the design board
 * (design_handoff_relay_app, "icon = 2×2 dots"). Written out rather than taken from
 * lucide because lucide's nearest neighbours are SQUARES (`Grid2x2`, `LayoutGrid`) and
 * the board is explicit about dots; four `<circle>`s is smaller than the argument for
 * substituting something else. The signature matches a lucide icon (`className`,
 * `strokeWidth`) so it drops straight into the TABS array and both nav renderers.
 */
function GroupsDots({ className, strokeWidth = 2 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      aria-hidden="true"
    >
      <circle cx="7.5" cy="7.5" r="2.7" />
      <circle cx="16.5" cy="7.5" r="2.7" />
      <circle cx="7.5" cy="16.5" r="2.7" />
      <circle cx="16.5" cy="16.5" r="2.7" />
    </svg>
  );
}

/**
 * Tab keys used by the bottom-nav / sidebar. We hard-code the routes here
 * so the bottom-nav matches across pages.
 *
 * FIVE tabs since the redesign — Calls · History · Messages · Groups · Contacts, with
 * Groups between Messages and Contacts exactly as the board places it. Groups is the
 * Messages page narrowed to group threads (see `MessagesPage`'s `only` prop), not a
 * second thread list — and since v2.106.64 the narrowing runs BOTH ways: Messages is
 * DMs and Notes, Groups is groups plus the group-call section, per the owner. So the
 * two tabs partition the thread list rather than one containing the other, which is why
 * each carries its own unread count.
 *
 * Each tab still carries its OWN hue (`color` + darker `shade`). That is no longer what
 * the DARK theme uses — there the active tab is the cycling accent (`--rb`), per the
 * board — but it is what LIGHT theme uses, and deliberately so: the accent palette is
 * built for a near-black background, and its default teal `#35e0b4` computes to about
 * 1.7:1 on a light card, which is unreadable for a 9px label (the same trap v2.99.86
 * measured, where the LED green failed AA as small text and got its own darker token).
 * So the redesign's accent applies where the redesign lives, and the light theme keeps
 * the per-tab shade that was already measured to work there.
 *
 * Applied via inline styles, NOT template-composed Tailwind classes: the JIT compiler
 * can't see class names assembled at runtime.
 */
const TABS = [
  { key: "dialer", path: "/app/dialer", labelKey: "nav.calls", icon: Phone, color: "#22c55e", shade: "#15803d" },
  { key: "history", path: "/app/history", labelKey: "nav.history", icon: History, color: "#38bdf8", shade: "#0369a1" },
  { key: "messages", path: "/app/messages", labelKey: "nav.messages", icon: MessageCircle, color: "#fb923c", shade: "#c2410c" },
  { key: "groups", path: "/app/groups", labelKey: "nav.groups", icon: GroupsDots, color: "#22d3ee", shade: "#0e7490" },
  { key: "contacts", path: "/app/contacts", labelKey: "nav.contacts", icon: UsersRound, color: "#a78bfa", shade: "#7c3aed" },
] as const satisfies readonly { key: string; path: string; labelKey: TKey; icon: unknown; color: string; shade: string }[];

/** Small "Mobile"/"Desktop" chip shown next to the country flag, detected
 *  dynamically from this device. */
function DeviceChip({ className = "" }: { className?: string }) {
  const type = detectDeviceType();
  const Icon = type === "Mobile" ? Smartphone : Monitor;
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground " +
        className
      }
      title={`Calling from ${type}`}
    >
      <Icon className="size-3" />
      {type}
    </span>
  );
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "??";
}

function formatNumber(n: string): string {
  // e.g. "812345" -> "812-345"
  if (n.length !== 6) return n;
  return `${n.slice(0, 3)}-${n.slice(3)}`;
}

/** Which shell route this is. The ROUTE knows — `App.tsx` already names it when it
 *  picks the view — so both navs read this ONE value rather than each re-deriving it
 *  from the path (see `useActiveTab`). */
export type ShellTab =
  | "dialer"
  | "history"
  | "messages"
  | "groups"
  | "contacts"
  | "profile"
  | "admin"
  | "join";

export function AppShell({
  children,
  tab: routeTab,
}: {
  children: React.ReactNode;
  /** Optional so any caller that predates it degrades to path derivation, i.e. to
   *  exactly today's behaviour, rather than losing its highlight entirely. */
  tab?: ShellTab;
}) {
  // Apply the relay-v2 accent palette to <html>. We deliberately do
  // NOT toggle `.dark` here — ThemeProvider owns light/dark and the
  // user can flip from Profile.
  useEffect(() => {
    document.documentElement.classList.add("relay-v2");
  }, []);

  /* ONE THING PLAYS AT A TIME, APP-WIDE (v2.106.89, owner: *"if you play one anywhere in
     this system in the app cannot play another until that one's finished"*).
     Installed HERE rather than from whichever surface happens to mount first, so the rule
     is live for the media lightbox and the story viewer even in a session where no voice
     note was ever rendered. Idempotent. */
  useEffect(() => {
    installExclusivePlayback();
  }, []);

  // One-time gesture unlock for the notification-sound AudioContext: iOS won't
  // start ANY WebAudio outside a user gesture, so the call ring / message chime
  // fired later from an SSE event would be silent. Entering the app is itself a
  // tap, so this is armed long before the first alert. Self-removes on fire.
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      document.removeEventListener("pointerdown", unlock);
    };
    document.addEventListener("pointerdown", unlock);
    return () => document.removeEventListener("pointerdown", unlock);
  }, []);

  // PasscodeGate sits outermost: if a device passcode is set the lock
  // screen covers everything (even onboarding) until the user unlocks.
  return (
    <PasscodeGate>
      <OnboardingGate>
        <Inner tab={routeTab}>{children}</Inner>
      </OnboardingGate>
    </PasscodeGate>
  );
}

function Inner({ children, tab: routeTab }: { children: React.ReactNode; tab?: ShellTab }) {
  /* One translator for BOTH nav surfaces, and the TEXT SCALE beside it — two reads
     would be two chances for the two navs to disagree about what a tab is called, and
     the scale is what the viewport measurement below has to divide by. */
  const { t, scale } = useLocale();
  const { me } = useIdentity();
  // Shared sign-out flow (v2.88): AlertDialog confirm + full session/device
  // teardown, branching guest/member correctly (the old inline handler called
  // the GUEST mutation even for registered members).
  const { requestSignOut, signOutDialog } = useSignOut(me);
  const [location, navigate] = useLocation();
  const utils = trpc.useUtils();
  // Passwordless upgrade panel (guest → verified user). No third-party sign-in.
  const [authOpen, setAuthOpen] = useState(false);
  // v2.99.86: does the signed-in person have a LIVE status? Drives the avatar's
  // story pip and the first row of its tap menu. `status.mine` is already the
  // canonical read; a status self-expires after 24h, so this is polled rather than
  // cached indefinitely — 60s is far tighter than the thing it describes.
  const myStatus = trpc.status.mine.useQuery(undefined, {
    enabled: !!me,
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
  const statusItems = myStatus.data?.items ?? [];
  const hasStatus = statusItems.length > 0;

  // Do Not Disturb now lives inside the NotificationBell panel (it used to be a
  // SECOND, visually-identical bell icon next to the notification bell).
  const [dnd, setDnd] = useDnd();

  // Open the SSE push channel as soon as we know we have an identity.
  // Server pushes message/read/presence/contact hints → hook invalidates the
  // right tRPC queries so the UI feels near-instant without WebSockets.
  useRealtime(Boolean(me), me?.id ?? null);

  // Lock the DOCUMENT while the shell is mounted: every scrollable area lives
  // INSIDE the shell, so the page itself must never scroll or rubber-band.
  // Without this, iOS Safari's keyboard scroll-into-view (e.g. focusing the
  // Contacts search) shoved the whole shell upward and left the app scrolled
  // past its own end — a dead black band below the tab bar. Scoped to Inner so
  // the onboarding/lock screens (outside the shell) keep normal page scroll.
  useEffect(() => {
    document.documentElement.classList.add("relay-app-lock");
    document.body.classList.add("relay-app-lock");
    return () => {
      document.documentElement.classList.remove("relay-app-lock");
      document.body.classList.remove("relay-app-lock");
    };
  }, []);

  // GROUND-TRUTH viewport height for the mobile shell. CSS viewport units
  // proved unreliable on real iPhones: dvh (v2.76) reported the toolbar-
  // collapsed height while the scroll lock keeps Safari's toolbar visible,
  // so the tab bar + Messages composer sat BELOW the fold with no way to
  // scroll to them — the last messages / history rows were unreachable.
  // window.innerHeight IS the actual layout viewport right now; measure it,
  // keep it fresh (rotation, toolbar show/hide, split view), and size the
  // shell with it. 100svh remains the CSS fallback until the first
  // measurement lands. An explicit px height also makes the whole flex
  // chain below unambiguously definite for Safari's layout engine.
  //
  // …AND THE ON-SCREEN KEYBOARD IS PART OF "THE VIEWPORT RIGHT NOW", which is what this
  // used to get wrong. It listened to `visualViewport`'s resize and then wrote
  // `window.innerHeight` — and on iOS the keyboard changes `visualViewport.height` and
  // leaves `innerHeight` ALONE. So the handler fired and wrote an UNCHANGED value: a
  // subscription that reads as handled while handling nothing.
  //
  // MEASURED, before the fix, at 390x844 with the visual viewport shrunk to 400: the
  // shell stayed 844px tall and the message input's bottom edge stayed at 785 — 385px
  // BELOW the keyboard. Tap the composer on a phone and the field you just tapped, and
  // the Send button beside it, are underneath the keyboard. That is the owner's
  // "I cannot send messages", and it is invisible on a desktop browser.
  //
  // It is worse here than in most apps for a reason THIS app chose: v2.76 locks document
  // scrolling (`html/body.relay-app-lock`) to stop iOS shoving the whole app past its own
  // end. That was right, and it also removed the browser's own scroll-the-focused-input
  // -into-view rescue — so nothing was left to compensate. The lock stays; the missing
  // half is a keyboard-aware height.
  useEffect(() => {
    const root = document.documentElement;
    const set = () => {
      try {
        const vv = window.visualViewport;
        /* The VISIBLE height, not the layout height — and CONVERTED rather than discarded
         * under a pinch-zoom.
         *
         * `visualViewport.height` is expressed in the ZOOMED viewport's own CSS pixels, so
         * multiplying by `scale` recovers the visible height in LAYOUT pixels, which is the
         * unit `--relay-vh` is consumed in. The first version bailed to Infinity whenever
         * `scale > 1.01`, which sounds cautious and is not: bailing falls back to
         * `window.innerHeight`, the value that does not shrink for the keyboard on iOS —
         * so a pinch-zoom silently reinstated the exact bug this effect exists to fix, and
         * a magnified page is precisely when somebody is typing carefully.
         * At scale 1 this is byte-identical to reading `vv.height`. */
        /* `+ vv.offsetTop`, AND THAT TERM IS WHAT MAKES THE `scroll` LISTENER BELOW DO
         * ANYTHING AT ALL — a defect of mine, in the fix that added the listener.
         *
         * That listener carries a comment saying iOS MOVES the visual viewport as well as
         * resizing it, and that a move with no resize still changes what is on screen.
         * True — and `set()` read only `vv.height`, `vv.scale` and `window.innerHeight`,
         * none of which a move changes. So the handler fired and wrote a BYTE-IDENTICAL
         * value: an inert subscription under a comment claiming it handles the case, which
         * is exactly the defect v2.106.29 was written to remove, reproduced one level down.
         * (`grep -rn offsetTop client/src/` returned zero.)
         *
         * The visible band is [offsetTop, offsetTop + height] in LAYOUT pixels, and the
         * scroll-locked shell starts at 0 — so its bottom must reach the band's bottom, not
         * merely be as tall as the band. Without the term, a moved viewport leaves the shell
         * short by exactly `offsetTop` and the composer sits below the fold while the tab
         * bar, the LAST child, can still be on screen: the owner's screenshot.
         * `offsetTop` is already in layout px per spec; `height` is in the zoomed viewport's
         * px, which is why only `height` takes the `* scale`. */
        const visible = vv ? vv.height * vv.scale + vv.offsetTop : Number.POSITIVE_INFINITY;
        const measured = Math.round(Math.min(window.innerHeight, visible));
        /* FLOOR ONLY AN IMPLAUSIBLE READING, not a small-but-real one. A hard 320 floor
         * makes `--relay-vh` LARGER than the viewport in landscape with the keyboard up —
         * where ~220px visible is genuine — and being taller than the visible area is how
         * the composer ends up under the keyboard, i.e. the same failure again. A
         * non-positive reading is the one that cannot be true, so that is what falls back;
         * failing toward "too tall" there is still recoverable, while zero is a blank app. */
        const h = measured > 0 ? measured : Math.max(320, window.innerHeight);
        /* TEXT SIZE SCALES THE PAGE WITH `zoom`, AND THAT CHANGES THE UNIT THIS VALUE
         * IS SPENT IN (v2.106.83). Every reading above — innerHeight, vv.height,
         * offsetTop — is in UNZOOMED CSS pixels, while `--relay-vh` is consumed by a
         * layout that `zoom` has already scaled. Assigning the raw number at zoom 1.15
         * makes the shell 15% too tall and pushes the composer under the fold, which is
         * the v2.106.29 defect arriving by a different road.
         *
         * v2.106.86 — AND THE DIVISION WAS NOT ENOUGH, WHICH IS WHAT THE OWNER SAW.
         * The factor used to be read back out of the published `--relay-zoom`, and this
         * effect listens to `resize`, `orientationchange` and the visual viewport. NONE
         * of those fire when `style.zoom` changes: zoom re-lays-out the page without
         * moving `window.innerHeight`, so there is no resize event at all. The measured
         * value therefore kept whatever scale was in force at the LAST rotation — switch
         * to Large and the shell stayed `innerHeight` layout px rendered at 1.15, i.e.
         * 15% too tall with the tab bar below the fold; switch to Small and it was 10%
         * too short, leaving a dead band under the bar. Both of the owner's screenshots.
         *
         * So the factor now comes from the SAME STATE the provider derives its own from,
         * via the hook, and `scale` is a dependency of this effect — which re-measures on
         * the very commit that changes it. Reading the published variable instead would
         * ALSO have been wrong by ordering: React runs a child's effects before its
         * parent's, and the provider is the parent, so this effect would have read the
         * previous scale on exactly the render that matters. */
        const zoom = TEXT_SCALE_FACTOR[scale] ?? 1;
        root.style.setProperty("--relay-vh", Math.round(h / zoom) + "px");
      } catch { /* */ }
    };
    set();
    window.addEventListener("resize", set);
    window.addEventListener("orientationchange", set);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", set);
    // iOS moves the visual viewport as well as resizing it; a scroll without a resize
    // still changes what is on screen.
    vv?.addEventListener("scroll", set);
    return () => {
      window.removeEventListener("resize", set);
      window.removeEventListener("orientationchange", set);
      vv?.removeEventListener("resize", set);
      vv?.removeEventListener("scroll", set);
      root.style.removeProperty("--relay-vh");
    };
    /* `scale` IS A REAL DEPENDENCY, not a lint appeasement: `style.zoom` fires no
       resize event, so without it nothing would re-measure when the text size
       changes and the shell would keep the height it had under the previous scale. */
  }, [scale]);

  // Pre-fetch the threads & calls list once we have an identity so the
  // tab badges are warm by the time the user taps them.
  useEffect(() => {
    if (me) {
      utils.messages.threads.prefetch();
      utils.calls.history.prefetch();
    }
  }, [me, utils]);

  const threads = trpc.messages.threads.useQuery(undefined, {
    enabled: !!me,
    refetchInterval: 15_000,
  });
  // Lightweight geo lookup for the country-flag chip next to the user's PIN.
  // Polled once per session — IPs don't change often inside a tab lifetime.
  const geo = trpc.directory.geoSelf.useQuery(undefined, {
    enabled: !!me,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const { theme, setTheme } = useTheme();
  /* One translator for BOTH nav surfaces (the desktop sidebar and the mobile tab bar
     both render from TABS inside this component) — two reads would be two chances for
     the two navs to disagree about what a tab is called. */
  /* The live canvas runs in DARK ONLY — see the mount below for why. Derived here so the
     shell's own background and the mount cannot disagree: two separate reads of the
     theme is how you get an opaque shell over a running canvas, i.e. all of the cost and
     none of the effect. */
  /* THE ANIMATED BACKGROUND RUNS IN BOTH THEMES NOW (#158). It used to be dark-only —
     the engine is built for a near-black surface, so painting the same frames on white
     produced nothing — and the owner asked for the light theme to move too. The canvas
     is mounted unconditionally and told WHICH tone map to paint; see `RELAY_TONE_LIGHT`. */
  const liveBackground = true;
  const lightBackground = theme !== "dark";
  /* The redesigned nav — one CYCLING accent pill instead of five fixed hues — stays
     DARK-ONLY, and #158 is exactly why that had to be re-derived rather than left alone.
     The accent palette is built against a near-black background, so on a light card its
     default teal MEASURES about 1.7:1 — an unreadable 9px label (v2.106.2).

     It used to read `= liveBackground`, on the reasoning that the two "can never disagree
     about which design is live". That held only while the canvas was dark-only: one
     boolean was answering two different questions, and making the background run in light
     too would have silently turned the accent nav on over a pale surface and reinstated a
     measured contrast failure. It asks the THEME directly now, which is the question it
     was always really about. */
  const accentNav = theme === "dark";
  // Universal Back: Profile is the one drill-in route off the tab bar (message
  // threads handle their own in-page back). Go back in history, or fall back to
  // the dialer if there's nowhere to go.
  /* WHICH TAB AM I ON — ONE ANSWER, READ BY BOTH NAVS.
   *
   * It was `location.startsWith(tab.path)`, computed independently in the bottom bar
   * and in the desktop sidebar, and NO tab's path is a prefix of `/app` — so on `/app`
   * and `/app/` nothing was lit in either nav: no accent label, no pill, no
   * `aria-current`. That is the URL all five landing-page CTAs point at, so a visitor
   * arriving from the marketing page met a navigation bar with nothing marked, which is
   * squarely the owner's "many things is not showing".
   *
   * The route already knows — `App.tsx` writes `<ShellRoute tab="dialer" />` for both
   * `/app` and `/app/dialer` — so the prop is the truth and the path derivation is only
   * the fallback for a caller that does not pass it. Deriving it ONCE also removes the
   * second copy of the rule, which is how the two navs could have come to disagree. */
  const activeTab: ShellTab | null =
    routeTab ??
    (TABS.find((t) => location.startsWith(t.path))?.key as ShellTab | undefined) ??
    (location === "/app" || location === "/app/" ? "dialer" : null);

  /* A DRILL-IN IS ANY ROUTE THAT IS NOT ONE OF THE FIVE TABS, rather than a hardcoded
   * `/app/profile` prefix. `/app/admin` is pushed from Profile and was rendering with
   * NO Back arrow and no lit tab — reachable, but with no way to RETURN and an
   * unrelated tab as its only exit, worst of all in an installed PWA where there is no
   * browser back chrome. Deriving it means the next drill-in route gets its Back
   * affordance for free instead of needing this string updated; `/app/join` gains one
   * too, which is a deliberate consequence — `goBack` falls through to the dialer when
   * there is no history to pop, so arriving cold on an invite link still has an exit. */
  const isSubPage = activeTab != null && !TABS.some((t) => t.key === activeTab);
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
    else navigate("/app/dialer");
  };
  // Report DELIVERY for every unread thread (v2.99.74) — this is what makes the
  // sender's second tick appear. Driven off the thread list because that is the
  // signal that survives being offline when the message was sent: the SSE event is
  // long gone by the time such a recipient opens the app.
  useDeliveryReceipts(threads.data, me?.id ?? null);

  /**
   * v2.106.64 — the count is SPLIT the way the tabs are.
   *
   * Groups left the Messages tab (owner: *"from the messages section, remove the group
   * message and just keep it in the group section"*), and a single total renders only on
   * the Messages tab — so without this a group message would light a badge on a tab that
   * no longer contains it, and tapping it would find nothing. That is the silent-no-op
   * class this repo keeps removing, and it is the half of the restructure that is easy to
   * forget because nothing fails.
   *
   * `unreadTotal` is KEPT and still counts everything, because the "while you were away"
   * card is about the account rather than about one tab.
   */
  const { unreadTotal, unreadDirect, unreadGroups } = useMemo(() => {
    let direct = 0;
    let groups = 0;
    for (const t of threads.data ?? []) {
      const n = t.unreadCount ?? 0;
      if (t.kind === "group") groups += n;
      else direct += n;
    }
    return { unreadTotal: direct + groups, unreadDirect: direct, unreadGroups: groups };
  }, [threads.data]);
  // The most recent conversation with unread messages — powers the "while you
  // were away" landing card's messages row (v2.99.12). Group threads use their
  // title; 1:1 threads the peer's display name (falling back to the number).
  const latestUnread = useMemo(() => {
    const withUnread = (threads.data ?? [])
      .filter((t) => (t.unreadCount ?? 0) > 0 && t.lastMessageAt)
      .sort(
        (a, b) => new Date(b.lastMessageAt!).getTime() - new Date(a.lastMessageAt!).getTime()
      );
    const top = withUnread[0];
    if (!top) return null;
    const name = top.title || top.peerDisplayName || top.peerNumber || "New message";
    // v2.106.64 — the card ROUTES to the tab that holds it. With groups out of Messages,
    // a hardcoded `/app/messages` would open a list the named thread is not in, which is
    // worse than not offering the row at all.
    const href = top.kind === "group" ? "/app/groups" : "/app/messages";
    return { name, at: top.lastMessageAt!, href };
  }, [threads.data]);

  // Unseen-status dot (v2.96): a contact posted a story I haven't seen —
  // light a quiet teal dot on the Messages tab (the status strip lives at
  // its top). SSE "status" events invalidate this feed, so it's realtime.
  const statusFeed = trpc.status.feed.useQuery(undefined, {
    enabled: !!me,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });
  const hasUnseenStatus = useMemo(
    () => (statusFeed.data?.groups ?? []).some((g) => !g.subject.isMe && g.hasUnseen),
    [statusFeed.data]
  );

  // Missed calls that arrived while away (guest or registered). Drives the
  // landing popup + the History / bell badges.
  const missed = trpc.calls.missedSummary.useQuery(undefined, {
    enabled: !!me,
    refetchInterval: 20_000,
  });
  const missedCount = missed.data?.count ?? 0;
  // New-device sign-ins waiting for this account's approval (v2.99.7) — the
  // bell surfaces the count; SSE "device_pending" invalidates this instantly.
  const pendingDevicesQ = trpc.otpAuth.pendingSessions.useQuery(undefined, {
    enabled: !!me,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const pendingList = pendingDevicesQ.data?.pending ?? [];
  const pendingDevices = pendingList.length;
  // The waiting sign-in's own details, ONLY when there is exactly one (v2.100.1).
  // With two waiting, naming the newest would describe one and imply both.
  const pendingDetail = pendingDevices === 1 ? pendingList[0] : null;
  /* Board 2d/5h — acting on a waiting sign-in from the notification panel itself.
     The mutations live HERE rather than in the bell because this is where the query
     and its invalidation already are: a second copy of the refresh rule is how the
     panel and the Devices list come to disagree about what is still pending.
     Declining REVOKES the pending session, which is the same call Profile's Devices
     list makes, so the two cannot mean different things. */
  const approveSession = trpc.otpAuth.approveSession.useMutation();
  const revokeSession = trpc.otpAuth.revokeSession.useMutation();
  const refreshPending = () => {
    void utils.otpAuth.pendingSessions.invalidate();
    void utils.otpAuth.listSessions.invalidate();
  };
  const approveDevice = (sid: string) => {
    approveSession.mutate(
      { sid },
      {
        onSuccess: () => {
          refreshPending();
          toast.success("Device approved — it can sign in now.");
        },
        // Named, not swallowed: a silent failure here leaves somebody waiting on a
        // device that will never be let in, with nothing saying why.
        onError: (e) => toast.error(e.message || "Couldn't approve that device."),
      }
    );
  };
  const declineDevice = (sid: string) => {
    revokeSession.mutate(
      { sid },
      {
        onSuccess: () => {
          refreshPending();
          toast.success("Sign-in declined.");
        },
        onError: (e) => toast.error(e.message || "Couldn't decline that sign-in."),
      }
    );
  };
  const markSeen = trpc.calls.markMissedSeen.useMutation({
    onSuccess: () => utils.calls.missedSummary.invalidate(),
  });
  // Reviewing the History tab acknowledges all missed calls (clears the badges).
  const onHistory = location.startsWith("/app/history");
  useEffect(() => {
    if (onHistory && missedCount > 0 && !markSeen.isPending) {
      markSeen.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onHistory, missedCount]);
  // The landing card is dismissible WITHOUT clearing the History/bell badges
  // (those stay until the user actually reviews History — dismissing the card
  // just says "stop showing me this banner", not "I've seen these"). Persisted
  // to localStorage (survives a full close + reopen, not just a refresh).
  //
  // v2.99.12: the card covers BOTH missed calls and unread messages, and the
  // dismiss watermark keys on the TIMESTAMP of the latest item in each category
  // — NOT a count. Counts are non-monotonic: they FALL when you review History
  // (markMissedSeen) or read a thread, so a count high-water mark goes
  // stale-high and would silently hide genuinely-new activity that lands at or
  // below it (including a fresh next-day login with fewer-but-new items). A
  // latest-item timestamp only ever moves forward, so "newer than what I
  // dismissed" is a sound re-surface test across sessions.
  const DISMISS_KEY = "relay_away_popup_seen_v2";
  const [seen, setSeen] = useState<{ missedAt: number; msgAt: number }>(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return { missedAt: Number(p.missedAt) || 0, msgAt: Number(p.msgAt) || 0 };
      }
    } catch { /* */ }
    return { missedAt: 0, msgAt: 0 };
  });
  const latestMissedAt = missed.data?.latest?.at ? new Date(missed.data.latest.at).getTime() : 0;
  const latestMsgAt = latestUnread?.at ? new Date(latestUnread.at).getTime() : 0;
  // Show a category's alert only when it has items AND its newest item is newer
  // than what was last dismissed. The card opens if EITHER is new.
  const showMissedAlert = missedCount > 0 && latestMissedAt > seen.missedAt;
  const showUnreadAlert = unreadTotal > 0 && latestMsgAt > seen.msgAt;
  const awayOpen = showMissedAlert || showUnreadAlert;
  const dismissAway = () => {
    // Advance both watermarks to the current latest (never backwards) so
    // everything currently shown stops nagging until something newer arrives.
    const next = {
      missedAt: Math.max(latestMissedAt, seen.missedAt),
      msgAt: Math.max(latestMsgAt, seen.msgAt),
    };
    setSeen(next);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch { /* */ }
  };
  const viewMissed = () => {
    dismissAway();
    // Straight to the full Missed log (History → Missed filter pre-selected);
    // reviewing it also acknowledges the missed calls (clears the badges).
    navigate("/app/history?filter=missed");
  };
  const openMessagesFromToast = () => {
    dismissAway();
    navigate(latestUnread?.href ?? "/app/messages");
  };

  if (!me) return null;

  return (
    <div
      className={
        "min-h-svh text-foreground flex flex-col md:flex-row " +
        // TRANSPARENT ONLY WHERE THE CANVAS IS LIVE. `bg-background` is opaque, so
        // leaving it would hide the canvas completely — a loop costing frames and
        // showing nothing, which is worse than not mounting it at all.
        (liveBackground ? "bg-transparent" : "bg-background")
      }
    >
      {/* THE LIVE BACKGROUND, APP-WIDE (design_handoff_relay_app §"Background engine").
          The handoff is explicit that production wants ONE fixed fullscreen canvas
          behind the app shell rather than a canvas per screen, and that is also the only
          affordable shape: the engine runs its own rAF per canvas, so a mount per route
          would multiply the cost by the number of live screens — the class of mistake
          v2.99.67 measured when the landing page cooked a phone.

          EXACTLY ONE IS EVER LIVE. `LoginScreen` mounts its own, and this shell renders
          only for a signed-in identity, so the two are mutually exclusive branches of
          `OnboardingGate` — never both at once.

          DARK ONLY, and that is a decision rather than an omission. The board is a dark
          design throughout ("dark glass"), while this app's DEFAULT theme is light and
          the desktop sidebar offers a Dark/Light control the handoff itself keeps (1i).
          Near-black text on a live near-black canvas is unreadable, so light mode keeps
          today's opaque surfaces until a light variant is designed rather than shipping
          a screen nobody can read.

          The accent vars are published either way: the engine publishes them when it is
          mounted, and `index.css` carries a static fallback for when it is not — so a
          light-mode user still gets a coherent accent, just not a moving one. */}
      {liveBackground && <RelayBackground light={lightBackground} />}
      {/* The "while you were away" banner is GONE from the main screen
          (v2.99.67, owner: "the missed call notification, the way how it works,
          it's not nice. Don't show it on the main screen as a side banner from up
          to down. Show it only on the notification center on the top… and also on
          the history").
          Nothing is lost: the same missed calls and unread threads are still
          counted on the bell (which keeps its blink), listed inside the bell
          panel, and recorded in History. Those two are pull, not push — you look
          when you want to, instead of being covered on arrival. `awayOpen` and
          its watermark are retained so the bell's unseen logic is unchanged. */}
      {/* ── desktop / tablet sidebar ───────────────────────────── */}
      <aside
        className={
          // `relative z-10` for the same reason as the scroll container below: this is
          // unpositioned content, and the fixed background canvas at `z-index: 0`
          // paints above unpositioned content.
          "relay-appshell-chrome relative z-10 hidden md:flex md:flex-col md:w-64 lg:w-72 shrink-0 " +
          "border-r border-border/70 bg-sidebar/65 " +
          "supports-[backdrop-filter]:bg-sidebar/45 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150"
        }
      >
        <div className="px-5 pt-6 pb-4">
          <div className="flex items-center justify-between mb-3">
            {/* v2.103.2: this was a STATIC uppercase span, so the animated wordmark
                the owner asked for did not exist at all above 768px — the only mount
                lived in the `md:hidden` mobile header below. The sidebar and that
                header are mutually exclusive breakpoints, so exactly one of the two
                is ever visible; the wordmark's own rules stay inside BrandMark, so
                nothing is restated in two places. The desktop user also gains the
                connection line, which had been a phone-only indicator. */}
            <BrandMark />
            <NotificationBell
              missedCount={missedCount}
              unreadCount={unreadTotal}
              pendingDevices={pendingDevices}
              pendingDetail={pendingDetail}
              onOpenHistory={() => navigate("/app/history?filter=missed")}
              onOpenMessages={() => navigate(latestUnread?.href ?? "/app/messages")}
              onOpenDevices={() => navigate("/app/profile#devices")}
              onApproveDevice={approveDevice}
              onDeclineDevice={declineDevice}
              dnd={dnd}
              onDndChange={setDnd}
            />
          </div>
          <Link
            href="/app/profile"
            className="flex items-center gap-3 group rounded-xl -mx-1 px-1 py-1 hover:bg-muted/40 transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            {me.avatarUrl ? (
              <img
                src={me.avatarUrl}
                alt={me.displayName}
                className="size-10 rounded-2xl object-cover border border-border"
              />
            ) : (
              <div className="size-10 rounded-2xl bg-primary/15 grid place-items-center text-primary font-bold">
                {initialsFrom(me.displayName)}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-semibold truncate group-hover:text-primary transition-colors flex items-center gap-1">
                <span className="truncate">{me.displayName}</span>
                {/* v2.99.6: three-tier badge — Guest (blue) / Registered (green) / Admin (yellow). */}
                <RoleBadge role={roleFromFlags(me.role, me.verified)} size={15} />
              </div>
              <div className="font-mono text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
                {formatNumber(me.number)}
                <CountryFlag
                  code={geo.data?.country}
                  title={geo.data?.countryName ?? geo.data?.country ?? ""}
                />
                <DeviceChip />
              </div>
            </div>
          </Link>
          {me.isGuest && (
            <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed">
              <div className="flex items-center gap-2 text-primary font-semibold mb-1">
                <Sparkles className="size-3.5" /> Guest mode
              </div>
              <p className="text-muted-foreground">
                This guest number lasts for this browser session. Register to keep it forever.
              </p>
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="mt-2 inline-block text-primary underline-offset-4 hover:underline font-medium"
              >
                Register with email →
              </button>
            </div>
          )}
        </div>
        <nav className="px-3 flex-1">
          {TABS.map((tab) => {
            const active = tab.key === activeTab;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.key}
                href={tab.path}
                className={
                  "group flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-colors " +
                  "outline-none focus-visible:ring-sidebar-ring focus-visible:ring-[3px] " +
                  (active
                    ? "font-semibold" + (accentNav ? " rnav-pill" : "")
                    : "hover:bg-sidebar-accent/15 text-sidebar-foreground")
                }
                /* Board 1i: the desktop sidebar's active row is the SAME accent treatment
                   as the bottom bar's pill, which is why both take `.rnav-pill` rather
                   than each describing it. Light theme keeps the per-tab hue for the
                   contrast reason recorded on TABS. */
                style={
                  active && !accentNav
                    ? {
                        background: `color-mix(in oklab, ${tab.color} 16%, transparent)`,
                        color: theme === "light" ? tab.shade : tab.color,
                      }
                    : undefined
                }
              >
                <Icon className="size-5 shrink-0" strokeWidth={active ? 2.3 : 2} />
                <span className="flex-1">{t(tab.labelKey)}</span>
                {tab.key === "messages" && hasUnseenStatus && (
                  <span
                    className="size-2 rounded-full bg-gradient-to-tr from-[#06d6a0] to-[#0ea5e9]"
                    title="New stories"
                  />
                )}
                {/* v2.106.64 — each tab counts what it CONTAINS. A total here would light
                    the Messages badge for a group message the Messages tab no longer
                    holds. */}
                {(tab.key === "messages" || tab.key === "groups") &&
                  (tab.key === "messages" ? unreadDirect : unreadGroups) > 0 && (
                    <span
                      className={
                        "relay-blink inline-flex min-w-5 h-5 px-1.5 rounded-full text-xs items-center justify-center font-bold " +
                        (accentNav ? "rbadge-accent" : "bg-primary text-primary-foreground")
                      }
                    >
                      {(() => {
                        const n = tab.key === "messages" ? unreadDirect : unreadGroups;
                        return n > 99 ? "99+" : n;
                      })()}
                    </span>
                  )}
                {tab.key === "history" && missedCount > 0 && (
                  <span className="relay-blink inline-flex min-w-5 h-5 px-1.5 rounded-full bg-destructive text-white text-xs items-center justify-center font-bold">
                    {missedCount > 99 ? "99+" : missedCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border space-y-2">
          {/* Compact theme toggle — mirrors the segmented control on Profile */}
          <div
            role="group"
            aria-label="Theme"
            className="grid grid-cols-2 gap-1 rounded-xl bg-muted/50 p-1"
          >
            <button
              type="button"
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
              className={
                "flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 " +
                "outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
                (theme === "dark"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
              style={{ transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
            >
              <Moon className="size-3.5" /> Dark
            </button>
            <button
              type="button"
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
              className={
                "flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 " +
                "outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
                (theme === "light"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
              style={{ transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
            >
              <Sun className="size-3.5" /> Light
            </button>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={requestSignOut}
          >
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </aside>

      {/* ── main column ────────────────────────────────────────── */}
      {/* The mobile shell is sized by the MEASURED viewport (--relay-vh =
          window.innerHeight, kept fresh above), NOT by CSS viewport units:
          dvh (v2.76) reported the toolbar-collapsed height on a real iPhone
          while the scroll lock keeps the toolbar visible, so the tab bar and
          composer sat below the fold and long chats/history lists could
          never be scrolled to their end. 100svh is only the first-paint
          fallback before the measurement lands. The explicit px height also
          makes the whole flex chain below unambiguously definite, so every
          inner list scrolls within the visible area. Do not swap this back
          to a bare viewport unit without a physical-iPhone retest.

          max-md:flex-none is LOAD-BEARING: with flex-1 (basis 0%), a flex
          item's MAIN-axis size ignores its height property, and its CONTENT
          contribution inflates the auto-height root column — so any page
          taller than the viewport (a long chat, a full call log) blew the
          shell up to content height, pushed the tab bar/composer below the
          fold, and killed every inner scroll area. flex-none makes the
          explicit height authoritative on mobile; md+ keeps flex-1, where
          the root is a ROW and it governs width, not height. */}
      {/* Desktop height must be DEFINITE (md:h-svh), not just min-h-svh: a tall
          page (a long conversation with images/video) grew `main` past the
          viewport, so the inner overflow-y-auto never bounded and the Messages
          composer fell below the fold (you had to scroll the whole column to
          reach it). h-svh caps main at the viewport so every inner list scrolls
          within it and the composer stays pinned. Mobile keeps the measured
          --relay-vh height (flex-none) as before. */}
      {/* `max-md:min-h-0` IS LOAD-BEARING, and without it the keyboard fix above is a
          NO-OP: `min-h-svh` applies at every width, and `min-height` WINS over `height`,
          so shrinking `--relay-vh` to the keyboard-visible height would be overridden
          back to ~100svh and the composer would stay underneath the keyboard. Measured
          both ways. The desktop rule (`md:h-svh`) is untouched. */}
      <main className="flex-1 max-md:flex-none flex flex-col min-w-0 min-h-svh max-md:min-h-0 md:h-svh md:overflow-hidden max-md:h-[var(--relay-vh,100svh)]">
        {/* mobile header */}
        <header
          className={
            "relay-appshell-chrome relay-appshell-topbar md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-2.5 " +
            "border-b border-border/70 bg-card/70 " +
            "supports-[backdrop-filter]:bg-card/45 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150"
          }
        >
          {isSubPage && (
            <button
              type="button"
              onClick={goBack}
              aria-label="Back"
              className="me-0.5 grid size-9 shrink-0 place-items-center rounded-xl text-foreground hover:bg-muted/50 active:scale-95 transition outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
          {/* LEFT — the heartbeat dot, the RELAY wordmark and the connection line
              (see BrandMark). ONE instance: the wordmark's own 390px breakpoint
              lives inside the component, so this is no longer two mounts of it — two
              would mean two subscriptions to the connection store and the same
              breakpoint restated in two places. */}
          <BrandMark />
          {/* MIDDLE — flag · first name · badge, on one line. Inert (v2.99.94).
              The PIN left this strip in v2.106.77 at the owner's request; the
              number lives on the Dialer's MY NUMBER card and in Profile. */}
          <IdentityStrip
            displayName={me.displayName}
            role={me.role}
            verified={me.verified}
            countryCode={geo.data?.country}
            countryName={geo.data?.countryName ?? geo.data?.country ?? ""}
          />
          {/* RIGHT — notifications, then the account avatar. v2.99.94 (owner): "I
              circle on the notification center push it left little bit, keep space
              and gap between the notification center and the profile." The gap is
              what moves the bell: this cluster is pinned to the right edge by the
              header's `justify-between`, so widening the space between its two
              children pushes the bell leftward and leaves the avatar where it is.
              Measured at 320px — the two chips plus the gap still fit with the
              middle zone intact. */}
          <div className="flex items-center gap-3.5 shrink-0">
            <NotificationBell
              missedCount={missedCount}
              unreadCount={unreadTotal}
              pendingDevices={pendingDevices}
              pendingDetail={pendingDetail}
              onOpenHistory={() => navigate("/app/history?filter=missed")}
              onOpenMessages={() => navigate(latestUnread?.href ?? "/app/messages")}
              onOpenDevices={() => navigate("/app/profile#devices")}
              onApproveDevice={approveDevice}
              onDeclineDevice={declineDevice}
              dnd={dnd}
              onDndChange={setDnd}
            />
            {/* Avatar → ACCOUNT MENU (v2.95.10). The old layout crammed a
                separate "Register" pill next to the avatar, which overflowed
                the bar on phones (the pill clipped off-screen). Everything
                account-related now lives in one dropdown: Profile, Register
                (guests), Sign out. LED: amber on DND, online-green otherwise. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Account menu"
                title={me.displayName}
                className="relative shrink-0 active:scale-95 transition-transform rounded-full outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                <AvatarRing
                  avatarUrl={me.avatarUrl}
                  displayName={me.displayName}
                  initials={initialsFrom(me.displayName)}
                  dnd={dnd}
                  hasStatus={hasStatus}
                />
                {/* v2.99.10 (owner) moved the tier badge OFF this avatar's corner,
                    where it overlapped the flag/photo, and into the menu below —
                    beside the name with the PIN under it. v2.105.19 (owner) removes
                    that header: see the label. The badge itself still renders in the
                    top bar, two elements to the left of this trigger. */}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {/* v2.105.19 (owner, with a screenshot circling the name + badge +
                    PIN that used to sit here): *"I told you you remove this one, and
                    you need to put the rely and the version number of the current
                    built whenever it's updated."*

                    THE TOP BAR IS DIRECTLY BEHIND THIS MENU AND CARRIES ALL THREE —
                    `TopBar.tsx` renders the first name, the RoleBadge and
                    `formatPin(number)` — so the header repeated, three inches away,
                    exactly what the user can still see while the menu is open. That
                    is the same argument v2.103.1 used, applied to the surface the
                    owner actually meant (v2.103.1 stripped the Profile PAGE hero
                    instead, which was a misread; that hero is restored in this
                    release).

                    The build goes in the space because the owner asked to be able to
                    tell at a glance which version a screen is, and this menu is
                    reachable from EVERY tab. It comes from `shared/version.ts` — the
                    same constant the server serves at /api/version and the
                    auto-updater compares against — so the stamp can never disagree
                    with what is actually deployed. `dir="ltr"` so an RTL locale
                    cannot reorder the dotted version. */}
                <DropdownMenuLabel className="min-w-0">
                  <span
                    className="font-mono text-[13px] font-semibold tracking-tight text-muted-foreground"
                    dir="ltr"
                  >
                    RELAY v{APP_VERSION}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {/* v2.99.86 (owner): "if there is a status, if you click on it, you'll
                    see your status … even if there is a status, when you click it, it
                    will tell you to see the status or go to the profile."
                    ONE TAP, always the same menu — deliberately NOT the double-tap the
                    first half of the ask suggested. A dblclick would put a ~300ms
                    disambiguation delay on every single tap of the app's most-tapped
                    control, iOS Safari treats a double-tap as its zoom gesture, it has
                    no keyboard or assistive equivalent, and it would assign the HIDDEN
                    gesture to the COMMON case (most people have no status most of the
                    time). Both of the owner's outcomes are one visible tap away. */}
                {/* v2.101.0 — the owner's own list for this menu: *"open story / add
                    story / add status / profile / log out"*, and the two words now mean
                    two different things (a STORY is the ephemeral post; a STATUS is the
                    profile label). Open-story renders only when there IS one; add-story
                    is always offered, because having one does not stop you posting
                    another. */}
                {hasStatus && (
                  // The viewer is opened IMPERATIVELY through the global overlay host,
                  // not by navigation. There is no `/app/status` route — stories live
                  // as a strip atop Messages — so a `navigate("/app/status")` here
                  // would have been a silent no-op that no source test could catch.
                  <DropdownMenuItem onClick={() => openPeerStatus(me.number)}>
                    <Sparkles className="size-4 text-[#a855f7]" /> Open my story
                    <span className="ms-auto text-xs text-muted-foreground">
                      {statusItems.length}
                    </span>
                  </DropdownMenuItem>
                )}
                {/* No standalone composer route either: the "+ my story" ring lives on
                    the Messages strip, so that is where this honestly goes. */}
                <DropdownMenuItem onClick={() => navigate("/app/messages")}>
                  <Sparkles className="size-4" /> Add a story
                </DropdownMenuItem>
                {/* The profile LABEL, which is a different thing from a story. The pane
                    is local state (see profilePane.ts for why it cannot be a URL), so
                    the intent is set before navigating and Profile picks it up on mount. */}
                <DropdownMenuItem
                  onClick={() => {
                    requestProfilePane("status");
                    navigate("/app/profile");
                  }}
                >
                  <BadgeCheck className="size-4 text-[#38bdf8]" /> Set my status
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/app/profile")}>
                  <UserRound className="size-4" /> Profile
                </DropdownMenuItem>
                {me.isGuest && (
                  <DropdownMenuItem onClick={() => setAuthOpen(true)} className="text-primary focus:text-primary">
                    <Sparkles className="size-4" /> Register — keep this number
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={requestSignOut}>
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* The scroll container ends EXACTLY at the tab bar's top edge — the
            bar below is an in-flow flex sibling, not a floating overlay, so no
            clearance padding is needed and content can never hide behind it.
            It is itself a flex COLUMN so full-height pages (Messages, Dialer)
            can fill it with flex-1 — flex-grow needs no percentage resolution,
            whereas height:100% against a flex-derived (non-explicit) height
            silently falls back to content height in Chrome and collapses
            short pages upward. */}
        {/* `relative z-10` PUTS CONTENT ABOVE THE BACKGROUND CANVAS, and that is a
            correctness rule rather than styling. `RelayBackground`'s canvas is
            `position: fixed; z-index: 0`, and per CSS painting order a POSITIONED
            element with `z-index: 0` paints in the positioned-descendants step —
            AFTER in-flow, non-positioned content. So any page whose content is not
            inside a positioned ancestor is painted UNDER an opaque near-black canvas.
            Measured in a real browser at 390px: Profile, Messages and Contacts were
            covered (the canvas was the topmost element at the page centre, and hiding
            it changed the painted pixel), while Dialer survived only because its keypad
            happens to sit inside `relative` wrappers — i.e. three of five tabs were
            broken by accident and two worked by accident.
            Fixed HERE rather than per page, so a page added later cannot inherit the
            bug: one wrapper above `{children}` settles it for every screen. */}
        <div className="relative z-10 flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col">
          {/* One-time "get call alerts" opt-in (Web Push) + iOS install tip.
              Renders nothing once granted / denied / dismissed. */}
          <PushBanner />
          {/* Warns when the deploy is multi-instance with call signaling not
              pinned — the silent-missed-call misconfiguration. Self-hides on
              single-instance deploys. */}
          <CallHealthBanner />
          {children}
        </div>

        {/* Docked glass tab bar. IN-FLOW (not position:fixed): as the last
            flex child of the viewport-bounded column it is permanently pinned
            to the very bottom — the scrolling happens in the sibling above, so
            the bar can never scroll away and nothing can slide under it.
            (During a call, body.relay-call-active hides all .relay-appshell-chrome,
            which also returns this bar's row to the call UI.)

            FIVE tabs since the redesign. In dark theme the active one is the board's
            40×25 accent pill on the cycling `--rb`; in light theme it keeps the
            per-tab gradient squircle, because the accent palette is unreadable as
            small text on a light card (see TABS). */}
        <nav
          className={
            "relay-appshell-chrome md:hidden shrink-0 z-30 " +
            (accentNav
              ? "rtabbar "
              : "border-t border-white/10 " +
                "bg-card/80 " +
                "shadow-[0_-8px_24px_rgba(0,0,0,0.18)] " +
                "supports-[backdrop-filter]:bg-card/60 supports-[backdrop-filter]:backdrop-blur-2xl supports-[backdrop-filter]:backdrop-saturate-150")
          }
          style={{
            // v2.99.94 (owner): "at the bottom after the bottom bar there's a still
            // gap space so I stick the bottom down because I need the space for the
            // middle frame." The 0.55rem floor that used to sit under this row is
            // gone, so on a phone with no home indicator the bar now ends exactly at
            // the viewport edge and the scroll area above it gains those ~9px.
            // The safe-area inset ITSELF stays: on an iPhone it is not decoration —
            // without it the home indicator sits on top of the tab icons.
            //
            // The board writes `padding:6px 4px 18px`. The 6px and the 4px are taken;
            // its 18px is NOT, because that figure is the board's stand-in for the home
            // indicator and we compute the real inset — re-adding it as a floor would
            // undo the owner's own request above on every phone that has no indicator.
            paddingBottom: "env(safe-area-inset-bottom)",
            ...(accentNav ? { paddingTop: 6, paddingLeft: 4, paddingRight: 4 } : null),
          }}
        >
          <div className="grid grid-cols-5">
            {TABS.map((tab) => {
              const active = tab.key === activeTab;
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.key}
                  href={tab.path}
                  aria-current={active ? "page" : undefined}
                  className={
                    "flex flex-col items-center transition-transform duration-150 active:scale-[0.94] outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-xl " +
                    (accentNav ? "gap-0.5 py-0" : "gap-1 pt-1.5 pb-0.5")
                  }
                  style={{ transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
                >
                  {/* The pill. Board: 40×25, radius 11, `rgba(var(--rb-rgb),.17)` with a
                      16px glow — a WIDE SHORT pill, not the square squircle it replaces,
                      which also gives the bar back ~10px of height on top of what
                      v2.99.94 reclaimed. `--rb-rgb` is the channel triple rather than a
                      colour so the alpha can be composed here; an unset custom property
                      is an INVALID declaration the browser drops, which is why
                      `index.css` carries a `:root` fallback for both vars. */}
                  <span
                    className={
                      "relative inline-flex items-center justify-center transition-all duration-200 " +
                      (accentNav ? "w-10 h-[25px] rounded-[11px] " : "rounded-[14px] size-10 ") +
                      (active ? (accentNav ? "rnav-pill" : "") : "text-muted-foreground")
                    }
                    style={
                      active && !accentNav
                        ? {
                            color: "#fff",
                            background: `linear-gradient(135deg, ${tab.color} 0%, ${tab.shade} 100%)`,
                            boxShadow: `0 4px 14px ${tab.color}59, inset 0 1px 0 rgba(255,255,255,0.28)`,
                          }
                        : undefined
                    }
                  >
                    <Icon
                      className={accentNav ? "size-[18px]" : "size-[19px]"}
                      strokeWidth={active ? (accentNav ? 2.2 : 2.4) : 2}
                    />
                    {tab.key === "messages" && hasUnseenStatus && (
                      <span
                        className="absolute -top-0.5 -left-0.5 size-2.5 rounded-full bg-gradient-to-tr from-[#06d6a0] to-[#0ea5e9] ring-2 ring-card"
                        title="New stories"
                      />
                    )}
                    {/* Board: "Badges: History = red count (missed), Messages = accent
                        count (unread)". History is already red; this is the one that
                        moves. On-accent text is the board's `#04211a`, not white — the
                        accent hues are bright, so white-on-accent is the unreadable
                        direction.

                        v2.106.64 — GROUPS NOW CARRIES ITS OWN COUNT. It deliberately did
                        not, and the recorded reason was that "the Messages list still
                        contains every group thread, so its count is the complete one and a
                        second partial count beside it would be two numbers for one fact".
                        That reason stopped being true the moment groups left Messages
                        (the owner's own ask), and the two counts are now DISJOINT rather
                        than partial — so each tab states the number for what it holds,
                        which is one fact each rather than two for one. */}
                    {(tab.key === "messages" || tab.key === "groups") &&
                      (tab.key === "messages" ? unreadDirect : unreadGroups) > 0 && (
                        <span
                          className={
                            "relay-blink absolute -top-0.5 -right-0.5 inline-flex min-w-4 h-4 px-1 rounded-full text-[10px] items-center justify-center font-bold ring-2 ring-card " +
                            (accentNav ? "rbadge-accent" : "bg-primary text-primary-foreground")
                          }
                        >
                          {(() => {
                            const n = tab.key === "messages" ? unreadDirect : unreadGroups;
                            return n > 99 ? "99+" : n;
                          })()}
                        </span>
                      )}
                    {tab.key === "history" && missedCount > 0 && (
                      <span className="relay-blink absolute -top-0.5 -right-0.5 inline-flex min-w-4 h-4 px-1 rounded-full bg-destructive text-white text-[10px] items-center justify-center font-bold ring-2 ring-card">
                        {missedCount > 99 ? "99+" : missedCount}
                      </span>
                    )}
                  </span>
                  {/* Board: 9px, weight 700 active / 600 idle, colour `var(--rb)` active.
                      The WEIGHT and the pill are what say "you are here" — the hue cannot,
                      because it cycles, so every tab shares it at any instant. */}
                  <span
                    className={
                      "tracking-wide transition-colors " +
                      (accentNav
                        ? "text-[9px] " + (active ? "font-bold" : "font-semibold")
                        : "text-[10px] font-semibold ") +
                      (active ? "" : accentNav ? " text-[#76878f]" : " text-muted-foreground")
                    }
                    style={
                      !active
                        ? undefined
                        : accentNav
                          ? { color: "var(--rb)" }
                          : { color: theme === "light" ? tab.shade : tab.color }
                    }
                  >
                    {t(tab.labelKey)}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </main>
      {authOpen && (
        <AuthPanel
          onClose={() => setAuthOpen(false)}
          onVerified={() => {
            setAuthOpen(false);
            utils.identity.whoami.invalidate();
          }}
        />
      )}
      {signOutDialog}
      {/* Global peer overlays (v2.96): the status viewer + profile popup any
          avatar or name click opens, from ANY screen. Mounted once here. */}
      <PeerOverlaysHost />
    </div>
  );
}
