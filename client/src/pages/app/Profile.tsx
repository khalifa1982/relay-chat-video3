import { useState, useRef, useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  AtSign,
  Bell,
  BellRing,
  BellOff,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Hash,
  KeyRound,
  LogOut,
  Lock,
  Mail,
  MessageSquare,
  Monitor,
  Languages,
  Moon,
  Palette,
  PhoneMissed,
  QrCode,
  ScanFace,
  Share2,
  ShieldCheck,
  ShieldQuestion,
  Smartphone,
  Sparkles,
  Sun,
  Trash2,
  User,
  Volume2,
  Wrench,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { QrGlyph, ShareNumberSheet } from "@/app/ShareNumber";
import { useIdentity } from "@/app/useIdentity";
import { useSignOut } from "@/app/useSignOut";
import { AvatarPicker } from "@/app/AvatarPicker";
import { GuestRestore } from "@/app/GuestRestore";
import { AUDIENCE_OPTIONS } from "@/app/statusAudience";
import { takeProfilePane } from "@/app/profilePane";
import { RoleBadge, roleFromFlags } from "@/app/VerifiedBadge";
import { CountryFlag } from "@/app/CountryFlag";
// ONE formatter for "three numbers dash three number", shared with the top bar.
// Two copies of a display rule is how the two surfaces end up disagreeing about
// the same number — the class this codebase keeps re-learning.
import { formatPin } from "@/app/TopBar";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { toast } from "sonner";
import { APP_VERSION } from "@shared/version";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getNotifPermission,
  requestNotifPermission,
  unlockAudio,
  playRingtonePreview,
  type NotifPermission,
} from "@/app/notifications";
import { ensurePushSubscription, iosNeedsInstallForPush } from "@/app/pushClient";
import { isNativeShell } from "@/app/installSurface";
import { useDnd } from "@/app/dnd";
import {
  BioSection,
  StatusSection,
  ContactInfoSection,
  SocialLinksSection,
} from "./ProfileHubSections";
import { AuthPanel } from "@/app/AuthPanel";
import {
  hasPasscode,
  setPasscode,
  clearPasscode,
  lockApp,
} from "@/app/passcode";
import {
  hasBiometric,
  biometricSupported,
  enrollBiometric,
  clearBiometric,
} from "@/app/biometric";
import { useTheme } from "@/contexts/ThemeContext";
import { useLocale, useT, type TKey } from "@/app/i18n";
import { formatDateIn, formatDateTimeIn } from "@/app/dateLocale";
import { loginDetailLine } from "@/app/loginOriginCopy";

/**
 * The translator's shape, so a helper OUTSIDE a component can still speak both
 * languages. A module-level function cannot call a hook, and one that returns a
 * finished English sentence is exactly how a screen ends up 95% translated with its
 * toasts and its status pill still in English — so `t` is passed in. Same contract as
 * `MissedCalls.tsx` and `inviteMessage.ts`.
 */
type T = (key: TKey, vars?: Record<string, string | number>) => string;

/**
 * Profile page (`/app/profile`) — the app's control centre (v2.99.89).
 *
 * The owner asked for this twice, with two mockups: "you build the profile page to
 * be more advanced. Everything controlled entire things from there. Also, put the
 * barcode, put your number, put the badge, put your status, put the things that you
 * have it, which is not in the picture."
 *
 * WHAT CHANGED IS THE SHAPE, NOT THE CONTROLS. This page had grown to sixteen
 * sections stacked one under another — around sixty controls in a single column
 * roughly six phone screens tall, where "Devices" and "App lock" were reachable only
 * by scrolling past everything else. So the layout became a HUB: an identity hero
 * (avatar, name, badge, the green PIN, the QR) over grouped rows, each opening one
 * pane. Every existing section component is reused verbatim rather than rewritten —
 * that is what makes "nothing was lost" a structural fact rather than a claim, and it
 * is why this is a layout change with no new settings surface to re-verify.
 *
 * PANES ARE LOCAL STATE, NOT ROUTES. wouter's `useLocation` returns the PATHNAME
 * only, so a `#pane` or `?pane=` navigation re-renders nothing — it would look like a
 * dead tap. A real sub-route per pane would also put ten entries in the app's
 * history for what is one screen.
 *
 * Guests get the same page: statuses, Do Not Disturb, app lock, theme and the
 * recovery key all hang off the identity rather than a user row. Only the panes the
 * SERVER refuses them are withheld — see the `isGuest` gate on choosing a number.
 */
export default function ProfilePage() {
  const { me, refresh } = useIdentity();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Which pane is open; null = the hub itself. */
  const [pane, setPane] = useState<Pane | null>(null);
  const [, navigate] = useLocation();
  const paneTopRef = useRef<HTMLDivElement>(null);

  /* Dismissing an admin's registration suggestion (v2.105.15). Takes no id — the
     server scopes it to the caller's own identity — and `refresh()` is what makes
     the card go away, since whoami is where the invite is read from. */
  const dismissRegInvite = trpc.identity.dismissRegInvite.useMutation({
    onSuccess: () => refresh(),
  });

  useEffect(() => {
    if (me?.displayName) setName(me.displayName);
  }, [me?.displayName]);

  // Auto-dismiss the "Saved" toast after a short window. Without this
  // the banner sits frozen on screen because nothing re-renders the page
  // once the mutation has finished. Reported by the user on iPhone Safari
  // (v2.1.1 production): the banner appeared dim and never went away.
  useEffect(() => {
    if (savedAt === null) return;
    const id = window.setTimeout(() => setSavedAt(null), 1800);
    return () => window.clearTimeout(id);
  }, [savedAt]);

  // Shared sign-out flow (v2.88): AlertDialog confirm + full session/device
  // teardown — the same code path as the AppShell's sign-out buttons.
  const { requestSignOut, signOutDialog, signOutPending } = useSignOut(me);
  // Read at the hub so the Appearance row can show which theme is live, rather than
  // making the reader open the pane to find out.
  const { theme } = useTheme();
  const { t, tn } = useLocale();
  // Whether to DRAW the Admin row. Called unconditionally, above the `!me` early
  // return, because a hook cannot sit behind a branch. React Query dedupes by key,
  // so this is the same single request the admin page itself makes.
  const amIAdmin = trpc.admin.amIAdmin.useQuery(undefined, { staleTime: 60_000 });
  const updateProfile = trpc.identity.updateProfile.useMutation({
    onSuccess: () => {
      refresh();
      setSavedAt(Date.now());
      setError(null);
    },
    onError: (err) => setError(err.message),
  });

  async function saveName() {
    const next = name.trim();
    if (!next) {
      setError(t("profile.nameEmpty"));
      return;
    }
    if (next === me?.displayName) return;
    updateProfile.mutate({ displayName: next });
  }

  /* The page's own file <input> + upload handler are GONE (v2.99.89), and their
     removal is a correction rather than a simplification: nothing clicked that
     input. The avatar button opened `AvatarPicker`, which owns its own bare upload
     (v2.96.1: an attachments-row upload makes the storage proxy participant-gate
     the photo — fine for the uploader, a broken image for everybody else), so the
     handler here was unreachable and its `uploading` flag was permanently false —
     i.e. the avatar button's spinner branch could never render. Two upload paths for
     one photo is also how they drift apart. `AvatarPicker` is the only one. */

  function clearAvatar() {
    if (!me?.avatarUrl) return;
    updateProfile.mutate({ avatarUrl: null });
  }

  const copyNumber = () => copyNumberToClipboard(me?.number ?? "", t);

  if (!me) {
    return (
      <div className="h-full grid place-items-center text-muted-foreground">
        {t("profile.loading")}
      </div>
    );
  }

  const initials = (me.displayName || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("") || "?";

  // Presence pill colour/label derived from the saved status override.
  const st = selfStatus(me.statusOverride);

  /* Every pane's title in one place, so the header of a pane and the label of the
     row that opens it cannot drift apart — now in one place in BOTH languages.
     `theme` reuses `appearance.title` rather than minting a rival: the pane's heading
     and the settings inside it are the same fact, and two keys would let them drift. */
  const paneTitle: Record<Pane, string> = {
    name: t("profile.paneName"),
    number: t("profile.paneNumber"),
    status: t("profile.paneStatus"),
    about: t("profile.paneAbout"),
    pin: t("profile.panePin"),
    lock: t("profile.paneLock"),
    devices: t("profile.paneDevices"),
    privacy: t("profile.panePrivacy"),
    notifs: t("profile.paneNotifs"),
    theme: t("appearance.title"),
  };

  const openPane = (p: Pane) => {
    setPane(p);
    // A pane opens where the hub was scrolled to, which on a page this tall is
    // frequently halfway down a list that no longer exists. Scroll the pane's own
    // top into view rather than the window's, because the scroll container is the
    // AppShell's, not the document (v2.78).
    window.requestAnimationFrame(() =>
      paneTopRef.current?.scrollIntoView({ block: "start", behavior: "auto" })
    );
  };

  // A pane requested from somewhere else in the app (v2.101.0) — the avatar menu's
  // "Set my status" is the first caller. Read ONCE on mount and cleared by the read
  // itself, so coming back to Profile later does not reopen a pane the person shut.
  // Validated against the Pane union before use: an unknown value must land on the
  // hub rather than put this page into a state it has no branch for.
  useEffect(() => {
    const want = takeProfilePane();
    if (want && PANES.includes(want as Pane)) openPane(want as Pane);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // Flow within the AppShell's scroll container (which ends exactly at the
    // in-flow bottom tab bar) instead of creating a competing scroll area —
    // otherwise the last controls get clipped with no way to reach them.
    <div className="min-h-full">
      {/* The error banner and the "Saved" pill live OUTSIDE the pane switch: both
          report on `updateProfile`, which is fired from more than one pane, and a
          confirmation that only renders on the pane you happened to be on is worse
          than none. The pill is also outside the ANIMATED wrapper below — `animate-in`
          animates `filter`, and a filter establishes a containing block for
          `position: fixed` descendants, so nested it would centre itself on that box
          instead of the viewport. */}
      {savedAt !== null && !error && (
        <div
          className="
            pointer-events-none fixed left-1/2 top-20 z-50
            -translate-x-1/2 animate-in fade-in slide-in-from-top-2
            flex items-center gap-2 rounded-full px-4 py-2
            text-sm font-medium
            border border-emerald-400/40
            bg-emerald-500/15 text-emerald-100
            dark:bg-emerald-500/20 dark:text-emerald-50
            shadow-lg shadow-emerald-500/20 backdrop-blur-md
          "
          role="status"
          aria-live="polite"
        >
          <Check className="h-4 w-4" strokeWidth={3} />
          <span>{t("profile.saved")}</span>
        </div>
      )}

      <div
        ref={paneTopRef}
        className="max-w-xl mx-auto p-5 pb-10 space-y-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
      >
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 text-destructive-foreground px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {pane === null ? (
          <>
            {/* ── identity hero ─────────────────────────────────────────────
                Everything the owner listed, in the order they listed it: the photo,
                the name, the badge, the number, the barcode, the status. */}
            <section className="flex flex-col items-center gap-3 pt-1 text-center">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  disabled={updateProfile.isPending}
                  title={t("profile.tapAvatar")}
                  aria-label={me.avatarUrl ? t("profile.changeAvatar") : t("profile.addAvatar")}
                  className="relative grid size-24 place-items-center rounded-full outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-70"
                  style={{ background: "linear-gradient(135deg,#3FE0C5,#6EE7FF)" }}
                >
                  <span className="grid size-[86px] place-items-center overflow-hidden rounded-full">
                    {me.avatarUrl ? (
                      <img
                        src={me.avatarUrl}
                        alt={me.displayName}
                        className="size-full rounded-full object-cover"
                      />
                    ) : (
                      <span className="text-3xl font-extrabold" style={{ color: "#08211d" }}>
                        {initials}
                      </span>
                    )}
                  </span>
                  <span className="absolute -bottom-0.5 -right-0.5 grid size-8 place-items-center rounded-full border-[3px] border-background bg-secondary text-primary">
                    <Camera className="size-4" />
                  </span>
                </button>
                {/* The SAME green↔white breathing ring the top-bar avatar wears
                    (v2.99.86), so the thing you tap up there and the thing you land
                    on here read as one object. The classes carry only the animation,
                    so they are size-agnostic; the anti-phase is a half-cycle negative
                    delay, never `animation-direction: reverse`, which on this
                    symmetric keyframe is an exact no-op and would peak both rings
                    together — a white ring blinking. Ring B rests at opacity 0 so
                    the reduced-motion still frame is the green one. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-[-3px] rounded-full pointer-events-none relay-ring-a"
                  style={{ boxShadow: "0 0 0 3px var(--relay-online)" }}
                />
                <span
                  aria-hidden="true"
                  className="absolute inset-[-3px] rounded-full pointer-events-none relay-ring-b"
                  style={{ boxShadow: "0 0 0 3px rgba(255,255,255,.92)", opacity: 0 }}
                />
              </div>

              {/* RESTORED in v2.105.19 (owner: *"restore what you did in the profile
                  page, back it as it was"*).

                  v2.103.1 removed the name, badge and digits from here, reading the
                  owner's *"when you click on the profile remove this one"* as the
                  Profile PAGE. It was the top bar's AVATAR MENU they meant — the thing
                  you get when you click the icon on the right — and this release makes
                  that change there instead. So the hero goes back to what it was, byte
                  for byte, and the build stamp returns to the footer where it lived. */}
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold tracking-tight">
                  {me.displayName || t("profile.you")}
                </h1>
                {/* v2.99.6: three-tier badge (Guest/Registered/Admin) — me.verified
                    keeps the fallback for a cached whoami without `role`. */}
                <RoleBadge role={roleFromFlags(me.role, me.verified)} size={18} />
              </div>

              {/* The number, in the owner's NNN-NNN grouping and the measured-AA green,
                  with the barcode beside it. `dir="ltr"` + bidi isolation so an Arabic
                  display name above cannot reorder the digits (v2.99.77). */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openPane("number")}
                  className="rounded-full border border-border bg-card/60 px-3 py-1.5 transition active:opacity-70 hover:bg-card"
                  aria-label={t("profile.numberAria", { number: formatPin(me.number) })}
                >
                  <span
                    dir="ltr"
                    className="font-mono text-base font-bold tracking-[0.06em] tabular-nums [unicode-bidi:isolate] text-[color:var(--relay-green-text)]"
                  >
                    {formatPin(me.number)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setQrOpen(true)}
                  aria-label={t("profile.showQr")}
                  title={t("profile.shareByQr")}
                  className="grid size-9 place-items-center rounded-full border border-border bg-card/60 text-foreground transition active:opacity-70 hover:bg-card"
                >
                  <QrCode className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={copyNumber}
                  aria-label={t("profile.copyMyNumber")}
                  title={t("profile.copyMyNumber")}
                  className="grid size-9 place-items-center rounded-full border border-border bg-card/60 text-foreground transition active:opacity-70 hover:bg-card"
                >
                  <Copy className="size-4" />
                </button>
              </div>

              {/* Status — tappable, because the owner asked for the status to BE here
                  rather than be described here. */}
              <button
                type="button"
                onClick={() => openPane("status")}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground transition active:opacity-70 hover:bg-card"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: st.color, boxShadow: `0 0 8px ${st.color}` }}
                />
                {t(st.labelKey)}
                <ChevronRight className="size-3.5 opacity-60" />
              </button>
            </section>

            {/* ── grouped rows ─────────────────────────────────────────────── */}
            <HubGroup title={t("profile.groupAccount")}>
              <HubRow
                icon={<User className="size-4" />}
                tint="#3FE0C5"
                label={paneTitle.name}
                sub={me.displayName || t("profile.subSetName")}
                onClick={() => openPane("name")}
              />
              <HubRow
                icon={<Hash className="size-4" />}
                tint="#6EE7FF"
                label={paneTitle.number}
                sub={t("profile.subNumber", { number: formatPin(me.number) })}
                onClick={() => openPane("number")}
              />
              <HubRow
                icon={<Sparkles className="size-4" />}
                tint="#f59e0b"
                label={paneTitle.status}
                sub={t(st.labelKey)}
                onClick={() => openPane("status")}
              />
              <HubRow
                icon={<AtSign className="size-4" />}
                tint="#a855f7"
                label={paneTitle.about}
                sub={t("profile.subAbout")}
                onClick={() => openPane("about")}
              />
            </HubGroup>

            <HubGroup title={t("profile.groupPrivacy")}>
              <HubRow
                icon={<KeyRound className="size-4" />}
                tint="#38bdf8"
                label={paneTitle.pin}
                sub={t("profile.subPin")}
                onClick={() => openPane("pin")}
              />
              <HubRow
                icon={<Lock className="size-4" />}
                tint="#f43f5e"
                label={paneTitle.lock}
                sub={t("profile.subLock")}
                onClick={() => openPane("lock")}
              />
              <HubRow
                icon={<Smartphone className="size-4" />}
                tint="#22c55e"
                label={paneTitle.devices}
                sub={t("profile.subDevices")}
                onClick={() => openPane("devices")}
              />
              <HubRow
                icon={<Eye className="size-4" />}
                tint="#8b5cf6"
                label={paneTitle.privacy}
                sub={t("profile.subPrivacy")}
                onClick={() => openPane("privacy")}
              />
            </HubGroup>

            <HubGroup title={t("profile.groupAlerts")}>
              {/* ONE row for all three notification sections. Two of them hide
                  themselves — EmailNotificationsSection returns null without a
                  signed-in account — so a row per section would draw a row that opens
                  an empty pane for every guest. Folding them together also means the
                  "is there an account" rule stays in exactly one place instead of
                  being restated by the row that offers it. */}
              <HubRow
                icon={<Bell className="size-4" />}
                tint="#eab308"
                label={paneTitle.notifs}
                sub={t("profile.subNotifs")}
                onClick={() => openPane("notifs")}
              />
              <HubRow
                icon={<Palette className="size-4" />}
                tint="#64748b"
                label={paneTitle.theme}
                sub={theme === "dark" ? t("appearance.dark") : t("appearance.light")}
                onClick={() => openPane("theme")}
              />
              {/* Admin is a LINK to its own page, not a pane, and it is drawn only for
                  an actual admin — the single place that rule is written now that the
                  old self-hiding section is gone. The server re-checks the role on
                  every admin procedure, so this is discoverability, never permission. */}
              {amIAdmin.data?.admin && (
                <HubRow
                  icon={<Wrench className="size-4" />}
                  tint="#facc15"
                  label={t("profile.admin")}
                  sub={t("profile.subAdmin")}
                  onClick={() => navigate("/app/admin")}
                />
              )}
            </HubGroup>

            {/* Restore a previous number (v2.99.68) — deliberately NOT behind a row.
                It renders nothing unless this browser holds a recovery record that
                still resolves, which is almost never, and a row that is usually a
                dead end is worse than a block that is usually absent. */}
            <GuestRestore heading={t("profile.restoreHeading")} onRestored={refresh} />

            {/* upgrade CTA for guests */}
            {me.isGuest && (
              <section className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3">
                <h2 className="text-lg font-semibold">{t("profile.keepForever")}</h2>
                <p className="text-sm text-muted-foreground">{t("profile.keepForeverBody")}</p>
                {/* HOW LONG THE GUEST NUMBER IS HELD (v2.99.93).
                    Stated from the SERVER's own `guestExpiresAt` rather than from a
                    hardcoded number of days here, so the copy cannot drift from the
                    rule — and it deliberately says the clock RESETS on each visit,
                    which is the part that makes the figure non-alarming and is true:
                    `touchGuestExpiry` pushes it out on every visit. */}
                <GuestHoldNotice expiresAt={me.guestExpiresAt ?? null} />
                {/* AN ADMIN'S SUGGESTED ADDRESS (v2.105.15). Shown, never applied:
                    tapping Register prefills this into the email field and stops
                    there, so the person reads it and can change it before any code
                    is sent. That is the point of a suggestion — the one human who
                    owns the inbox is the one who gets to confirm which inbox it is. */}
                {me.regInvite && (
                  <div className="rounded-lg border border-primary/20 bg-background/60 p-3 space-y-1.5">
                    <p className="text-sm font-medium">{t("profile.regInviteTitle")}</p>
                    <p
                      className="break-all text-sm text-muted-foreground"
                      dir="ltr"
                      style={{ unicodeBidi: "isolate" }}
                    >
                      {me.regInvite.email}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("profile.regInviteBody")}</p>
                    {/* THE ONE THING SOFTWARE CANNOT GUARD, SAID OUT LOUD.
                        Nothing here lets an administrator complete a registration —
                        that needs a request from this browser. What it cannot stop is
                        somebody talking the person into using an address the somebody
                        controls, since whoever owns the inbox can then sign in with an
                        email code. That is unchanged by this feature (they could
                        always have said "type this address"), so the honest mitigation
                        is telling the one person who can refuse. */}
                    <p className="text-xs font-medium text-amber-600 dark:text-amber-500">
                      {t("profile.regInviteWarn")}
                    </p>
                    <button
                      type="button"
                      className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => dismissRegInvite.mutate()}
                      disabled={dismissRegInvite.isPending}
                    >
                      {t("profile.regInviteDismiss")}
                    </button>
                  </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="button" className="flex-1" onClick={() => setShowAuth(true)}>
                    {t("profile.registerWithEmail")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("profile.carryOver")}</p>
              </section>
            )}

            {/* sign out — the final, destructive action; styled as a danger card */}
            <section className="pt-2">
              <button
                type="button"
                disabled={signOutPending}
                onClick={requestSignOut}
                /* Board 1f: "red glass Sign out row" — the same translucent-gradient +
                   hairline recipe as `.rglass`, tinted red. NOT `.rglass` itself, which
                   is deliberately neutral: a red row is the one place on this page where
                   the surface colour is carrying meaning rather than depth. */
                className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-destructive transition hover:brightness-110 disabled:opacity-60"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(244,63,94,.13), rgba(244,63,94,.05))",
                  border: "1px solid rgba(244,63,94,.30)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,.07)",
                }}
              >
                <LogOut className="size-4" /> {t("common.signOut")}
              </button>
            </section>

            {/* build stamp — mirrors the prototype's mono footer line. Back here in
                v2.105.19 with the hero restored; the version the owner asked to see at
                a glance now also sits in the top bar's avatar menu, which is reachable
                from every tab rather than only from this page. */}
            <div className="pt-1 text-center">
              <span className="font-mono text-[11px] text-muted-foreground/70">
                {t("profile.buildStamp", { version: APP_VERSION })}
              </span>
            </div>
          </>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPane(null)}
                aria-label={t("profile.back")}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-card/60 text-foreground transition active:opacity-70 hover:bg-card"
              >
                <ChevronLeft className="size-5" />
              </button>
              <h1 className="min-w-0 truncate text-lg font-extrabold tracking-tight">
                {paneTitle[pane]}
              </h1>
            </div>

            {pane === "name" && (
              <>
                <section className="space-y-2">
                  <Label
                    htmlFor="displayName"
                    className="text-xs uppercase tracking-wider text-muted-foreground"
                  >
                    {t("profile.displayName")}
                  </Label>
                  <div className="rounded-2xl border border-border bg-card/50 p-4">
                    <div className="flex gap-2">
                      <Input
                        id="displayName"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={64}
                        autoComplete="off"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        onClick={saveName}
                        disabled={
                          updateProfile.isPending || !name.trim() || name.trim() === me.displayName
                        }
                      >
                        {t("common.save")}
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("profile.displayNameHint")}
                    </p>
                  </div>
                </section>
                <section className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    {t("profile.photo")}
                  </Label>
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/50 p-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPickerOpen(true)}
                      disabled={updateProfile.isPending}
                    >
                      {me.avatarUrl ? t("profile.changePhoto") : t("profile.addPhoto")}
                    </Button>
                    {me.avatarUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearAvatar}
                        disabled={updateProfile.isPending}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" /> {t("profile.removePhoto")}
                      </Button>
                    )}
                  </div>
                </section>
              </>
            )}

            {pane === "number" && (
              <NumberAndFlag
                number={me.number}
                isGuest={!!me.isGuest}
                onRegenerated={refresh}
                onShowQr={() => setQrOpen(true)}
              />
            )}
            {pane === "status" && <StatusSection me={me} onSaved={refresh} />}
            {pane === "about" && (
              <>
                <BioSection me={me} onSaved={refresh} />
                <ContactInfoSection me={me} onSaved={refresh} />
                <SocialLinksSection me={me} onSaved={refresh} />
              </>
            )}
            {pane === "pin" && <LoginPinSection onRegister={() => setShowAuth(true)} />}
            {pane === "lock" && <PasscodeSection displayName={me.displayName} />}
            {pane === "devices" && <DevicesSection onRegister={() => setShowAuth(true)} />}
            {pane === "privacy" && <StatusPrivacySection />}
            {pane === "notifs" && (
              <>
                <NotificationsSection />
                {/* Renders nothing for a guest or an account with no linked address. */}
                <EmailNotificationsSection />
                <DndSection />
              </>
            )}
            {pane === "theme" && <ThemeToggleSection />}
          </div>
        )}

        {/* The four overlays are mounted at the ROOT of the page, never inside the
            pane switch: closing a pane while a sheet or dialog is open would unmount
            the open thing from under the user. */}
        {showAuth && (
          <AuthPanel
            onClose={() => setShowAuth(false)}
            /* Prefill only — see the prop's own comment for why this is NOT
               `initialEmail`, which would mail a code to an address the person has
               not read yet. */
            suggestedEmail={me.regInvite?.email ?? ""}
          />
        )}
        <AvatarPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          displayName={me.displayName}
          onSaved={() => refresh()}
        />
        {signOutDialog}
      </div>

      {/* QR / share bottom sheet (slides up from the bottom of the screen) */}
      <ShareNumberSheet open={qrOpen} onOpenChange={setQrOpen} number={me.number} />
    </div>
  );
}

/**
 * The panes the hub can open.
 *
 * A runtime array with the type DERIVED from it, rather than a hand-kept type plus a
 * hand-kept list: an out-of-band pane request (profilePane.ts) has to be validated
 * against the real set, and two copies of "which panes exist" is how a pane added
 * later becomes un-requestable with nothing to say so.
 */
const PANES = [
  "name",
  "number",
  "status",
  "about",
  "pin",
  "lock",
  "devices",
  "privacy",
  "notifs",
  "theme",
] as const;
type Pane = (typeof PANES)[number];

/**
 * One group of rows under a small caption — the mockup's card stack.
 *
 * `divide-y` rather than a border per row, so the hairlines cannot double up where
 * two rows meet, and `overflow-hidden` so the first and last rows' tap highlight is
 * clipped to the group's rounded corners.
 */
function HubGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h2>
      <div className="overflow-hidden rounded-2xl border border-border bg-card/50 divide-y divide-border/60">
        {children}
      </div>
    </section>
  );
}

/**
 * One row: a tinted circular icon chip, a bold label, an optional subtitle, a chevron.
 *
 * The row sets a MINIMUM height and never a fixed one — a fixed 16px line clipped a
 * badge in the Dialer's preview (v2.99.39) and the subtitle here is caller-supplied
 * text that can wrap in another language. The tint is an 8-digit hex so the chip's
 * fill is the icon's own colour at low alpha, which keeps a row legible in both
 * themes without a second token per row.
 */
function HubRow({
  icon,
  label,
  sub,
  tint,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  sub?: string | null;
  tint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-h-[60px] items-center gap-3 px-3.5 py-3 text-left transition active:bg-foreground/5 hover:bg-foreground/[0.03] outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:ring-inset"
    >
      {/* Board 1f: "hub rows (34px accent icon TILES)" — a rounded tile on the cycling
          accent, not a per-row coloured circle. The GLYPH keeps its own tint, so the
          wayfinding colour these rows already had survives rather than being discarded
          (the same split the Dialer's secondary actions use). */}
      <span
        aria-hidden="true"
        className="grid size-[34px] shrink-0 place-items-center rounded-xl"
        style={{
          background: "rgba(var(--rb-rgb),0.14)",
          border: "1px solid rgba(var(--rb-rgb),0.34)",
          color: tint,
        }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-foreground">{label}</span>
        {sub && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{sub}</span>
        )}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    </button>
  );
}

/* ============================================================
   selfStatus — maps the saved status override to a presence
   label + LED colour for the identity pill. Colours are fixed
   status LEDs (available/away/travelling), theme-independent.

   IT RETURNS A KEY, NOT A LABEL. A module-level constant cannot call a hook, and
   returning finished English is exactly how a screen ends up translated everywhere
   except the one pill at the top of it — so the render site translates. The keys are
   `profile.presence*`, deliberately NOT `peer.profileStatus.*`: that is the five-value
   PROFILE STATUS (work/vacation/travel/free/busy), this is the presence OVERRIDE, and
   they share the English word "Travelling" by coincidence rather than by meaning.
   ============================================================ */
function selfStatus(override: string | null | undefined): { labelKey: TKey; color: string } {
  if (override === "away") return { labelKey: "profile.presenceAway", color: "#f5a623" };
  if (override === "travel")
    return { labelKey: "profile.presenceTravelling", color: "#38bdf8" };
  return { labelKey: "profile.presenceAvailable", color: "#06d6a0" };
}

/* ============================================================
   Number row — shows the user's 6-digit RELAY number alongside
   a country flag chip derived from their connecting IP. The flag
   is purely informational; if the geo lookup fails (e.g. private
   IP, network error) we silently render the number alone.
   ============================================================ */
/** One clipboard path, shared by the hero's copy chip and the pane's button. Takes the
 *  translator because it lives outside any component — see `T` above. */
function copyNumberToClipboard(number: string, t: T) {
  if (!number) return;
  navigator.clipboard
    ?.writeText(number)
    .then(() => toast.success(t("profile.numberCopied")))
    .catch(() => toast.error(t("profile.copyFailed")));
}

function NumberAndFlag({
  number,
  isGuest,
  onRegenerated,
  onShowQr,
}: {
  number: string;
  isGuest: boolean;
  onRegenerated: () => void;
  onShowQr: () => void;
}) {
  const t = useT();
  const geo = trpc.directory.geoSelf.useQuery(undefined, {
    staleTime: 60 * 60 * 1000, // 1h — country doesn't change often
    retry: false,
  });
  const [regenNotice, setRegenNotice] = useState<string | null>(null);
  // AlertDialog confirm (v2.88) — native confirm() is gone app-wide.
  const [confirmRegen, setConfirmRegen] = useState(false);
  const announce = (n: string) => {
    setRegenNotice(
      t("profile.numberChanged", { number: `${n.slice(0, 3)} ${n.slice(3)}` })
    );
    onRegenerated();
    window.setTimeout(() => setRegenNotice(null), 6000);
  };
  const regen = trpc.identity.regenerateNumber.useMutation({
    onSuccess: (res) => announce(res.number),
  });
  /* CHOOSING YOUR OWN NUMBER IS GONE (owner: "remove choose my number, just keep
     random number option"). v2.99.75 built it; the owner has now withdrawn it, and
     a later instruction wins. Only the RANDOM regenerate remains — which is also
     the one a guest could always use, so removing the chooser costs a guest nothing.
     THE SERVER PROCEDURE `identity.setNumber` IS DELIBERATELY LEFT IN PLACE and is
     now called by nothing in the client. Said plainly so it is a decision rather
     than an oversight: it stays reachable by a direct API call, so this removes the
     OPTION from the product, not the capability from the server. Removing the
     endpoint is a separate change and is flagged for the owner rather than taken
     unilaterally, because the admin renumber path and this one are different
     functions and conflating them is how a support tool gets deleted by accident. */
  const copyNumber = () => copyNumberToClipboard(number, t);
  // Same /i/<pin> invite link the share sheet + Dialer use, so the launcher
  // button's QR is itself a real, scannable code (not just an icon).
  const inviteUrl =
    typeof window !== "undefined" ? `${window.location.origin}/i/${number}` : `/i/${number}`;

  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              {t("profile.yourNumber")}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="font-mono text-3xl font-bold tracking-[0.08em]">
                {number.slice(0, 3)} {number.slice(3)}
              </span>
              <CountryFlag
                code={geo.data?.country}
                title={
                  geo.data?.countryName
                    ? t("profile.connectingFrom", { country: geo.data.countryName })
                    : geo.data?.country ?? ""
                }
                className="text-xl"
              />
            </div>
            <button
              type="button"
              onClick={copyNumber}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
            >
              <Copy className="size-3.5" /> {t("profile.copyNumber")}
            </button>
          </div>
          {/* QR launcher → share sheet (white plate mirrors the prototype) */}
          <button
            type="button"
            onClick={onShowQr}
            aria-label={t("profile.showQrShare")}
            className="grid size-[70px] shrink-0 place-items-center rounded-xl border border-border bg-[#eff2f5] p-2 transition hover:brightness-95"
          >
            <QrGlyph value={inviteUrl} className="size-full" />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirmRegen(true)}
            disabled={regen.isPending}
          >
            {regen.isPending ? t("profile.generating") : t("profile.randomNumber")}
          </Button>
          {regenNotice && (
            <span className="text-xs text-[color:var(--relay-online,#06d6a0)]">{regenNotice}</span>
          )}
          {regen.isError && (
            <span className="text-xs text-destructive">{t("profile.regenFailed")}</span>
          )}
        </div>
      </div>
      <p className="px-1 text-xs text-muted-foreground">{t("profile.shareNumberHint")}</p>
      <AlertDialog open={confirmRegen} onOpenChange={(open) => !open && setConfirmRegen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("profile.regenTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("profile.regenBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRegen(false);
                regen.mutate();
              }}
            >
              {t("profile.regenConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/* ============================================================
   Theme toggle — lets the user flip the entire app between
   dark (default) and light. State is persisted via the
   ThemeProvider that wraps the app in main.tsx.
   ============================================================ */
/* ============================================================
   Admin entry (v2.99.76). Asks the SERVER whether this account holds the role
   rather than reading the cached whoami, so a stale payload can neither hide the
   panel from an admin nor advertise it to somebody who would only get FORBIDDEN.
   ============================================================ */
function ThemeToggleSection() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, scale, setScale, t } = useLocale();
  const isDark = theme === "dark";

  /* One well per control, all three in the pane the owner named ("in the profile
     appearance section where you mentioned dark or light themes, add options for
     Arabic, English, big font size and small font size"). They live together
     because they are one question — how the app is presented — and splitting them
     across panes is how somebody changes the language and never finds the size. */
  const Well = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-2xl border border-border bg-card/50 p-1 grid grid-cols-2 gap-1">
      {children}
    </div>
  );

  return (
    <section className="space-y-5">
      <div className="space-y-2.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          {t("appearance.theme")}
        </Label>
        <Well>
          <Button
            type="button"
            variant={isDark ? "default" : "ghost"}
            className="justify-center gap-2"
            onClick={() => setTheme("dark")}
          >
            <Moon className="size-4" /> {t("appearance.dark")}
          </Button>
          <Button
            type="button"
            variant={!isDark ? "default" : "ghost"}
            className="justify-center gap-2"
            onClick={() => setTheme("light")}
          >
            <Sun className="size-4" /> {t("appearance.light")}
          </Button>
        </Well>
      </div>

      <div className="space-y-2.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          {t("appearance.language")}
        </Label>
        <Well>
          {/* Each option is labelled IN ITS OWN LANGUAGE — "English" and "العربية",
              never "Arabic" written in English. Somebody who has landed in the wrong
              language has to be able to read their way out, which is exactly the
              case where a translated label fails them. */}
          <Button
            type="button"
            variant={locale === "en" ? "default" : "ghost"}
            className="justify-center gap-2"
            onClick={() => setLocale("en")}
            lang="en"
          >
            <Languages className="size-4" /> English
          </Button>
          <Button
            type="button"
            variant={locale === "ar" ? "default" : "ghost"}
            className="justify-center gap-2"
            onClick={() => setLocale("ar")}
            lang="ar"
          >
            <Languages className="size-4" /> العربية
          </Button>
        </Well>
      </div>

      <div className="space-y-2.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          {t("appearance.textSize")}
        </Label>
        <div className="rounded-2xl border border-border bg-card/50 p-1 grid grid-cols-3 gap-1">
          {(
            [
              ["sm", t("appearance.small"), "text-[11px]"],
              ["md", t("appearance.normal"), "text-[13px]"],
              ["lg", t("appearance.large"), "text-[15px]"],
            ] as const
          ).map(([key, label, size]) => (
            <Button
              key={key}
              type="button"
              variant={scale === key ? "default" : "ghost"}
              className="justify-center"
              onClick={() => setScale(key)}
            >
              {/* The label is rendered at the size it selects, so the control shows
                  what it does rather than describing it. */}
              <span className={size}>{label}</span>
            </Button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t("appearance.remembered")}</p>
    </section>
  );
}

/* ============================================================
   Notifications — lets the user grant browser notification
   permission. We show a clear three-state pill (Enable / Granted /
   Blocked) so the user always knows where they stand.
   ============================================================ */
/**
 * WHY A PANE IS EMPTY, WHEN IT IS EMPTY FOR A REASON.
 *
 * The repo's own rule since v2.99.89 is that NO ROW IS A DEAD END, and two rows in
 * Privacy & security were: `Sign-in PIN` and `Devices` are both drawn unconditionally
 * while their sections returned `null` for anyone without a `users` row — which is
 * every guest, permanently. Tapping either landed on a pane containing a back arrow, a
 * title and nothing else, with nothing saying why.
 *
 * HIDING THE ROWS WOULD SATISFY THE RULE AND BE WORSE: a guest would never learn the
 * feature exists, and the reason they cannot use it is the one thing they can act on.
 * So the pane explains and offers the step — which is also the honest reading, since
 * both features are account-scoped by construction rather than by policy.
 *
 * ONE COMPONENT, TWO CALLERS: two copies of this sentence is how the two panes come to
 * describe one requirement differently.
 *
 * IT TAKES A WHOLE-SENTENCE KEY, NOT A SUBJECT TO SPLICE IN. The old shape was
 * `{what} needs a registered account.` with `what` a caller-supplied English fragment
 * ("A sign-in PIN"), and a sentence chopped at an English seam cannot be reassembled in
 * Arabic — the word order differs, so the fragment does not land between the same two
 * halves. Each caller names a complete sentence instead (the v2.106.84 `tn` reasoning,
 * one step further: here the seam is avoidable entirely).
 */
function AccountOnlyNote({ noteKey, onRegister }: { noteKey: TKey; onRegister?: () => void }) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-border bg-card/70 p-4">
      <p className="text-sm text-muted-foreground">{t(noteKey)}</p>
      {/* The register sheet is ProfilePage's own state, so the action is INJECTED by
          the pane switch rather than reached from here; without it the note is still
          honest, it just does not offer the shortcut. */}
      {onRegister && (
        <Button size="sm" className="mt-3" onClick={onRegister}>
          {t("profile.registerThisNumber")}
        </Button>
      )}
    </section>
  );
}

/** v2.87 — the 4-digit sign-in PIN: set/change/remove + the login preference.
 *  Verified accounts only (guests have no email login to shortcut). Three
 *  wrong entries at sign-in warn; the fourth locks until an email code. */
function LoginPinSection({ onRegister }: { onRegister?: () => void }) {
  const t = useT();
  const status = trpc.otpAuth.pinStatus.useQuery(undefined, { refetchOnWindowFocus: false });
  const save = trpc.otpAuth.setLoginPin.useMutation();
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  if (!status.data?.signedIn)
    return <AccountOnlyNote noteKey="profile.accountOnlyPin" onRegister={onRegister} />;
  const hasPin = status.data.hasPin;
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 4);
  const submit = async () => {
    setMsg(null);
    if (pin1.length !== 4) { setMsg(t("profile.pinLength")); return; }
    if (pin1 !== pin2) { setMsg(t("profile.pinMismatch")); return; }
    try {
      await save.mutateAsync({ pin: pin1, preferPin: true });
      setMsg(hasPin ? t("profile.pinUpdated") : t("profile.pinSaved"));
      setPin1(""); setPin2(""); setEditing(false);
      void status.refetch();
    } catch (e) {
      setMsg((e as { message?: string })?.message ?? t("profile.pinSaveFailed"));
    }
  };
  const remove = async () => {
    setMsg(null);
    try {
      await save.mutateAsync({ pin: null });
      setMsg(t("profile.pinRemoved"));
      setEditing(false);
      void status.refetch();
    } catch (e) {
      setMsg((e as { message?: string })?.message ?? t("profile.pinRemoveFailed"));
    }
  };
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-bold">{t("profile.panePin")}</h3>
      {/* TWO COMPLETE SENTENCES, joined by a space — never one sentence with a tail
          spliced on. The lock notice stands alone in both languages, so Arabic can order
          it as Arabic wants rather than inheriting the English seam. */}
      <p className="mb-3 text-xs text-muted-foreground">
        {hasPin ? t("profile.pinHas") : t("profile.pinNone")}
        {status.data.locked ? ` ${t("profile.pinLocked")}` : ""}
      </p>
      {!editing ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => { setEditing(true); setMsg(null); }}>
            {hasPin ? t("profile.pinChange") : t("profile.pinSet")}
          </Button>
          {hasPin && (
            <Button size="sm" variant="secondary" onClick={remove} disabled={save.isPending}>
              {t("profile.pinRemove")}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Input type="password" inputMode="numeric" maxLength={4} value={pin1}
            onChange={(e) => setPin1(digits(e.target.value))} placeholder={t("profile.pinNew")}
            className="w-28 text-center font-mono" />
          <Input type="password" inputMode="numeric" maxLength={4} value={pin2}
            onChange={(e) => setPin2(digits(e.target.value))} placeholder={t("profile.pinRepeat")}
            className="w-28 text-center font-mono" />
          <Button size="sm" onClick={submit} disabled={save.isPending || pin1.length !== 4}>{t("common.save")}</Button>
          <Button size="sm" variant="secondary" onClick={() => { setEditing(false); setPin1(""); setPin2(""); }}>{t("common.cancel")}</Button>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
    </section>
  );
}

/** Signed-in devices + remote logout (v2.99.1). Each login records a session in
 *  the server ledger; deleting one logs that device out. Registered users only. */
function DevicesSection({ onRegister }: { onRegister?: () => void }) {
  const { t, locale } = useLocale();
  const utils = trpc.useUtils();
  const list = trpc.otpAuth.listSessions.useQuery(undefined, { refetchOnWindowFocus: false });
  const revoke = trpc.otpAuth.revokeSession.useMutation();
  // New-device approval (v2.99.7): devices waiting for this account to approve
  // them. Polled so an approval request that arrived while this tab was idle
  // still surfaces even if the SSE toast was missed.
  const pending = trpc.otpAuth.pendingSessions.useQuery(undefined, {
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  const approve = trpc.otpAuth.approveSession.useMutation();
  const [confirm, setConfirm] = useState<{ sid: string; label: string; current: boolean } | null>(null);

  // A guest has no account sessions — say so rather than rendering an empty pane.
  if (!list.data?.signedIn)
    return <AccountOnlyNote noteKey="profile.accountOnlyDevices" onRegister={onRegister} />;

  const pendingList = pending.data?.pending ?? [];
  const refreshDeviceLists = () => {
    void list.refetch();
    void pending.refetch();
    void utils.otpAuth.pendingSessions.invalidate();
  };
  const doApprove = async (sid: string) => {
    try {
      await approve.mutateAsync({ sid });
      refreshDeviceLists();
      toast.success(t("profile.deviceApproved"));
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? t("profile.deviceApproveFailed"));
    }
  };
  const doDeny = async (sid: string) => {
    try {
      await revoke.mutateAsync({ sid });
      refreshDeviceLists();
      toast.success(t("profile.deviceDeclined"));
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? t("profile.deviceDeclineFailed"));
    }
  };

  const sessions = list.data.sessions;
  /* REUSES `alerts.*` RATHER THAN MINTING A RIVAL SET. `MissedCalls.tsx` already renders
     exactly these four bands with exactly this English ("{n}m ago"), so a second set of
     keys would be two spellings of one fact — the `contacts.tag.*` reuse `dict/peer.ts`
     records, applied here.

     The compact register is also what sidesteps the plural problem rather than dodging
     it: an abbreviated unit does not inflect in either language, so there is no
     one/two/few/many band to select. Where a WHOLE word is used — the guest-hold
     countdown below — the bands are real and `guestHoldKey` picks them.

     The >30-day fallback is deliberately still a bare `toLocaleDateString()`; see the
     note on `dateLocale` in MissedCalls.tsx for the rule it does not yet follow. */
  const relTime = (ms: number) => {
    const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (s < 60) return t("alerts.justNow");
    const m = Math.floor(s / 60);
    if (m < 60) return t("alerts.minutesAgo", { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t("alerts.hoursAgo", { n: h });
    const d = Math.floor(h / 24);
    return d < 30 ? t("alerts.daysAgo", { n: d }) : formatDateIn(locale, ms);
  };

  const doRevoke = async () => {
    if (!confirm) return;
    const wasCurrent = confirm.current;
    try {
      await revoke.mutateAsync({ sid: confirm.sid });
      setConfirm(null);
      if (wasCurrent) {
        // Our own cookie was cleared server-side — reload to the signed-out app.
        window.location.assign("/app");
        return;
      }
      void list.refetch();
      toast.success(t("profile.deviceSignedOut"));
    } catch (e) {
      setConfirm(null);
      toast.error((e as { message?: string })?.message ?? t("profile.deviceSignOutFailed"));
    }
  };

  return (
    <section id="devices" className="rounded-2xl border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-bold">{t("profile.paneDevices")}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{t("profile.devicesHint")}</p>

      {/* New-device approval requests (v2.99.7): a new sign-in on this account
          waits here until you approve it — or your 4-digit PIN bypasses it. */}
      {pendingList.length > 0 && (
        <div className="mb-3 space-y-2">
          {pendingList.map((p) => (
            <div
              key={p.sid}
              className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3"
            >
              <div className="flex items-center gap-2">
                <ShieldQuestion className="size-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{t("profile.devicePending")}</div>
                  {/* Every detail the owner asked for (v2.100.1): *"the details from
                      where his login type, country, IP, device name, everything."*
                      Each line is withheld when the server sent null rather than
                      rendered empty — a place we could not resolve must read as
                      absent, not as a blank claim. */}
                  <div className="truncate text-xs text-muted-foreground">{p.label}</div>
                  {/* Recomposed rather than rendered whole: the server's `detail` is
                      "place · method" and the method half is prose. See
                      `loginOriginCopy.ts`. */}
                  {loginDetailLine(p, t) && (
                    <div className="truncate text-xs text-muted-foreground">
                      {loginDetailLine(p, t)}
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground">
                    {formatDateTimeIn(locale, p.createdAt)}
                  </div>
                  {p.ip && (
                    <div
                      className="truncate font-mono text-[11px] text-muted-foreground"
                      dir="ltr"
                    >
                      {p.ip}
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                {t("profile.devicePendingWarn")}
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button
                  size="sm"
                  className="h-8 flex-1 rounded-lg"
                  disabled={approve.isPending}
                  onClick={() => doApprove(p.sid)}
                >
                  {t("profile.deviceApprove")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 flex-1 rounded-lg"
                  disabled={revoke.isPending}
                  onClick={() => doDeny(p.sid)}
                >
                  {t("profile.deviceDecline")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("profile.deviceNone")}</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => {
            const isDesktop = /Windows|Mac|Linux|ChromeOS/.test(s.label);
            const Icon = isDesktop ? Monitor : Smartphone;
            return (
              <li
                key={s.sid}
                className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 p-3"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{s.label}</span>
                    {s.current && (
                      <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        {t("profile.deviceThis")}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {t("profile.deviceActive", {
                      when: relTime(s.lastSeenAt),
                      added: formatDateIn(locale, s.createdAt),
                    })}
                  </div>
                  {/* Where and how this device signed in (v2.100.1) — the same
                      projection the approval prompt renders, so the device you
                      approved and the device listed here describe themselves the
                      same way. Absent on every pre-release row, and omitted rather
                      than filled with a guess. */}
                  {s.detail && (
                    <div className="truncate text-[11px] text-muted-foreground">{s.detail}</div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={
                    s.current
                      ? t("profile.deviceSignOutThis")
                      : t("profile.deviceSignOutNamed", { name: s.label })
                  }
                  onClick={() => setConfirm({ sid: s.sid, label: s.label, current: s.current })}
                  className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                >
                  {s.current ? <LogOut className="size-4" /> : <Trash2 className="size-4" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.current
                ? t("profile.deviceSignOutThisQ")
                : t("profile.deviceSignOutNamedQ", { name: confirm?.label ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.current
                ? t("profile.deviceSignOutThisBody")
                : t("profile.deviceSignOutOtherBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void doRevoke(); }}
              disabled={revoke.isPending}
            >
              {t("common.signOut")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function NotificationsSection() {
  const { t, tn } = useLocale();
  const [perm, setPerm] = useState<NotifPermission>(() =>
    getNotifPermission()
  );
  const [busy, setBusy] = useState(false);
  // Web Push (rings/notices with the app CLOSED): the VAPID key the browser
  // must subscribe with, and this device's subscription state.
  const pubKey = trpc.push.publicKey.useQuery(undefined, {
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const subscribePush = trpc.push.subscribe.useMutation();
  const [pushReady, setPushReady] = useState(false);

  // The browser's permission state can change in another tab — re-poll
  // when this tab gets focus.
  useEffect(() => {
    const onFocus = () => setPerm(getNotifPermission());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Permission already granted → make sure this device's push subscription is
  // registered (it can vanish after browser updates), and reflect the state.
  useEffect(() => {
    if (perm !== "granted" || !pubKey.data?.key) return;
    void ensurePushSubscription(pubKey.data.key, (sub) => subscribePush.mutateAsync(sub)).then(setPushReady);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perm, pubKey.data?.key]);

  if (perm === "unsupported") {
    return (
      <section className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          {t("profile.paneNotifs")}
        </Label>
        <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          {t("profile.notifUnsupported")}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {t("profile.paneNotifs")}
      </Label>
      <div className="rounded-2xl border border-border bg-card/40 p-4 flex items-start gap-3">
        <div
          className={
            "shrink-0 size-10 grid place-items-center rounded-xl " +
            (perm === "granted"
              ? "bg-[color:var(--relay-online)]/15 text-[color:var(--relay-online)]"
              : perm === "denied"
                ? "bg-destructive/15 text-destructive"
                : "bg-primary/15 text-primary")
          }
        >
          {perm === "granted" ? (
            <Bell className="size-5" />
          ) : perm === "denied" ? (
            <BellOff className="size-5" />
          ) : (
            <Bell className="size-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium">
            {perm === "granted"
              ? t("profile.notifOn")
              : perm === "denied"
                ? t("profile.notifBlocked")
                : t("profile.notifOff")}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {perm === "granted"
              ? pushReady
                ? t("profile.notifOnPush")
                : t("profile.notifOnBasic")
              : perm === "denied"
                ? t("profile.notifBlockedHint")
                : t("profile.notifOffHint")}
          </p>
          {/* SUPPRESSED INSIDE THE NATIVE SHELL, where it is flatly wrong: a WebView
              is not `display-mode: standalone` and exposes no PushManager, so
              `iosNeedsInstallForPush()` is TRUE there and this told the user to tap a
              Safari Share button that does not exist — in an app that already
              receives calls over APNs. KEPT for a real iOS Safari tab: this is the
              SETTINGS pane, reached by someone deliberately asking why they are not
              being rung, and answering that with silence is the silent-no-op class
              this repo keeps removing. The intrusive BANNER is the one the owner
              asked to drop, and it is gone. */}
          {!isNativeShell() && iosNeedsInstallForPush() ? (
            /* The menu item is bolded in the MIDDLE of the sentence, so it is rendered
               with `tn` and the placeholder stays INSIDE the string — Arabic orders the
               Share menu and the item differently, and a sentence split at the English
               seam could only be re-assembled into nonsense (v2.106.84). */
            <p className="text-xs text-sky-500/90 mt-1.5">
              {tn("profile.iosInstall", {
                item: <span className="font-medium">{t("profile.iosInstallItem")}</span>,
              })}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            {perm === "granted" ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-[color:var(--relay-online)]">
                <Check className="size-4" />{" "}
                {pushReady ? t("profile.callAlertsOn") : t("profile.notifEnabled")}
              </span>
            ) : perm === "denied" ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
                <BellOff className="size-4" /> {t("profile.notifBlockedShort")}
              </span>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  // Grants are valid only if the request comes from a
                  // user gesture — this onClick qualifies.
                  unlockAudio();
                  const result = await requestNotifPermission();
                  setPerm(result);
                  // Same gesture: register this device for call-alert pushes.
                  if (result === "granted" && pubKey.data?.key) {
                    await ensurePushSubscription(pubKey.data.key, (sub) => subscribePush.mutateAsync(sub)).then(setPushReady);
                  }
                  setBusy(false);
                }}
              >
                {busy ? t("profile.notifRequesting") : t("profile.notifEnable")}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => playRingtonePreview()}
              className="inline-flex items-center gap-1.5"
            >
              <Volume2 className="size-4" /> {t("profile.testRingtone")}
            </Button>
            <span className="text-[11px] text-muted-foreground">{t("profile.ringtoneHint")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   Email notifications (v2.99.13) — registered users with a linked
   email choose whether RELAY emails them about (a) a call they missed
   while offline and (b) a message that arrived while offline (the
   message email is CONTENT-FREE — just "you have a new message"). Both
   default ON. Guests / email-less accounts don't render this section.
   ============================================================ */
function EmailToggleRow({
  icon,
  title,
  desc,
  checked,
  disabled,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 p-4">
      <div
        className={
          "shrink-0 size-10 grid place-items-center rounded-xl " +
          (checked ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
        }
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={t("profile.toggleNamed", { name: title })}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={
          "relative shrink-0 h-7 w-12 rounded-full transition-colors duration-200 disabled:opacity-50 " +
          (checked
            ? "bg-[color:var(--relay-online,theme(colors.primary.DEFAULT))]"
            : "bg-muted-foreground/30")
        }
        style={{ transitionTimingFunction: "var(--ease-out)" }}
      >
        <span
          className={
            "absolute top-1 start-1 size-5 rounded-full bg-white shadow transition-transform duration-200 " +
            (checked ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0")
          }
          style={{ transitionTimingFunction: "var(--ease-out)" }}
        />
      </button>
    </div>
  );
}

function EmailNotificationsSection() {
  const t = useT();
  const prefs = trpc.otpAuth.getNotificationPrefs.useQuery();
  const utils = trpc.useUtils();
  const setPrefs = trpc.otpAuth.setNotificationPrefs.useMutation({
    onMutate: async (vars) => {
      await utils.otpAuth.getNotificationPrefs.cancel();
      const prev = utils.otpAuth.getNotificationPrefs.getData();
      utils.otpAuth.getNotificationPrefs.setData(undefined, (old) =>
        old
          ? {
              ...old,
              ...(vars.missedCall !== undefined ? { missedCall: vars.missedCall } : {}),
              ...(vars.message !== undefined ? { message: vars.message } : {}),
              ...(vars.push !== undefined ? { push: vars.push } : {}),
            }
          : old
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.otpAuth.getNotificationPrefs.setData(undefined, ctx.prev);
      toast.error(t("profile.prefsFailed"));
    },
    onSettled: () => {
      utils.otpAuth.getNotificationPrefs.invalidate();
    },
  });

  // Needs a signed-in account (the prefs live on the user row). Guests keep
  // their device-level controls — Do Not Disturb below — and see nothing here.
  if (!prefs.data?.signedIn) return null;

  const busy = setPrefs.isPending;
  // Email rows need a linked address; the push row doesn't (v2.99.40).
  const hasEmail = prefs.data.hasEmail;
  return (
    <section className="space-y-3">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {t("profile.paneNotifs")}
      </Label>
      <div className="rounded-2xl border border-border bg-card/40 divide-y divide-border/60">
        {/* PUSH — the master switch for calls AND messages reaching this
            account's devices when RELAY isn't open (v2.99.40). Off means we
            send nothing, on every device, regardless of subscriptions. */}
        <EmailToggleRow
          icon={<BellRing className="size-5" />}
          title={t("profile.pushTitle")}
          desc={t("profile.pushDesc")}
          checked={prefs.data.push}
          disabled={busy}
          onChange={(v) => setPrefs.mutate({ push: v })}
        />
        {hasEmail && (
          <EmailToggleRow
            icon={<PhoneMissed className="size-5" />}
            title={t("profile.missedEmailTitle")}
            desc={t("profile.missedEmailDesc")}
            checked={prefs.data.missedCall}
            disabled={busy}
            onChange={(v) => setPrefs.mutate({ missedCall: v })}
          />
        )}
        {hasEmail && (
          <EmailToggleRow
            icon={<MessageSquare className="size-5" />}
            title={t("profile.messageEmailTitle")}
            desc={t("profile.messageEmailDesc")}
            checked={prefs.data.message}
            disabled={busy}
            onChange={(v) => setPrefs.mutate({ message: v })}
          />
        )}
      </div>
      {hasEmail && (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Mail className="size-3.5" /> {t("profile.emailFooter")}
        </p>
      )}
    </section>
  );
}

/* ============================================================
   Status privacy (v2.99.55) — who can watch the stories I post.
   Two options, per the owner's ask: everyone, or contacts only.

   This is the DEFAULT for future posts, not a retroactive switch.
   Each status stamps its own audience at insert, so flipping this
   never widens something already published — a story posted to
   contacts stays contacts-only for its whole 24h, whatever this
   says later. The composer shows this value and can override it
   for one post without changing the default.
   ============================================================ */
function StatusPrivacySection() {
  const t = useT();
  const privacy = trpc.status.getPrivacy.useQuery();
  const utils = trpc.useUtils();
  const setPrivacy = trpc.status.setPrivacy.useMutation({
    onMutate: async (vars) => {
      await utils.status.getPrivacy.cancel();
      const prev = utils.status.getPrivacy.getData();
      utils.status.getPrivacy.setData(undefined, { audience: vars.audience });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.status.getPrivacy.setData(undefined, ctx.prev);
      toast.error(t("profile.privacyFailed"));
    },
    onSettled: () => {
      utils.status.getPrivacy.invalidate();
    },
  });

  // Guests post statuses too (statuses hang off the identity, not the user row),
  // so this renders for everyone — it just needs the value to have loaded.
  if (!privacy.data) return null;
  const current = privacy.data.audience;
  const busy = setPrivacy.isPending;

  return (
    <section className="space-y-3">
      {/* STORY privacy, not "Status privacy" — this label was missed by the v2.101.0
          rename that fixed the row and the pane title, and it names the wrong feature:
          the audience control gates an ephemeral POST. It now reads from the same key as
          the pane it sits in, so the two cannot say different words for one setting. */}
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {t("profile.panePrivacy")}
      </Label>
      <div
        className="rounded-2xl border border-border bg-card/40 divide-y divide-border/60"
        role="radiogroup"
        aria-label={t("profile.privacyAria")}
      >
        {AUDIENCE_OPTIONS.map((opt) => {
          const active = current === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy}
              onClick={() => {
                if (!active) setPrivacy.mutate({ audience: opt.value });
              }}
              className="flex w-full items-start gap-3 p-4 text-left disabled:opacity-60"
            >
              <span
                className={`mt-0.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
                aria-hidden
              >
                <opt.Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{opt.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{opt.hint}</span>
              </span>
              <span
                className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 ${
                  active ? "border-primary" : "border-border"
                }`}
                aria-hidden
              >
                {active && <span className="size-2.5 rounded-full bg-primary" />}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">{t("profile.privacyFooter")}</p>
    </section>
  );
}

/* ============================================================
   Restore a previous number (v2.99.68). A thin wrapper so this reads
   like every other Profile section; all the logic — and the decision
   never to discard the stored key on a failure — lives in
   client/src/app/GuestRestore.tsx, which the entry screen also uses.
   One implementation, so the two surfaces can never make different
   promises about what restoring does.
   ============================================================ */
/* ============================================================
   Do Not Disturb — a one-tap toggle that silences incoming-call
   rings, chimes, and desktop pop-ups (messages still arrive, and
   missed calls are still recorded). Persisted per-device.
   ============================================================ */
function DndSection() {
  const t = useT();
  const [dnd, setDnd] = useDnd();
  return (
    <section className="space-y-3">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {t("profile.dnd")}
      </Label>
      <div className="rounded-2xl border border-border bg-card/40 p-4 flex items-center gap-3">
        <div
          className={
            "shrink-0 size-10 grid place-items-center rounded-xl " +
            (dnd
              ? "bg-[color:var(--relay-online)]/15 text-[color:var(--relay-online)]"
              : "bg-muted text-muted-foreground")
          }
        >
          {dnd ? <BellOff className="size-5" /> : <Bell className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{dnd ? t("profile.dndOn") : t("profile.dndOff")}</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {dnd ? t("profile.dndOnDesc") : t("profile.dndOffDesc")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={dnd}
          aria-label={t("profile.dndToggle")}
          onClick={() => setDnd(!dnd)}
          className={
            "relative shrink-0 h-7 w-12 rounded-full transition-colors duration-200 " +
            (dnd
              ? "bg-[color:var(--relay-online,theme(colors.primary.DEFAULT))]"
              : "bg-muted-foreground/30")
          }
          style={{ transitionTimingFunction: "var(--ease-out)" }}
        >
          <span
            className={
              "absolute top-1 start-1 size-5 rounded-full bg-white shadow transition-transform duration-200 " +
              (dnd ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0")
            }
            style={{ transitionTimingFunction: "var(--ease-out)" }}
          />
        </button>
      </div>
    </section>
  );
}

/* ============================================================
   App lock — an optional numeric passcode that locks the app on
   this device. It's a local UI gate, not account auth: the code is
   salted + SHA-256 hashed in localStorage (plaintext never stored),
   and the app re-locks on every load until the code is entered.
   When the device supports it, Face ID / fingerprint (WebAuthn) can
   be added as a faster unlock on top of the passcode fallback.
   ============================================================ */
function PasscodeSection({ displayName }: { displayName: string }) {
  const t = useT();
  const [enabled, setEnabled] = useState(() => hasPasscode());
  // null = closed; "set" = first-time set; "change" = replace existing
  const [mode, setMode] = useState<null | "set" | "change">(null);
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Biometric (Face ID / fingerprint) — an optional faster unlock layered on
  // top of the passcode. Only offered when the device supports platform
  // verification AND a passcode is set (the always-available fallback).
  const [bioCapable, setBioCapable] = useState(false);
  const [bioOn, setBioOn] = useState(() => hasBiometric());
  const [bioBusy, setBioBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    biometricSupported().then(ok => { if (alive) setBioCapable(ok); });
    return () => { alive = false; };
  }, []);

  async function toggleBiometric() {
    if (bioBusy) return;
    setBioBusy(true);
    try {
      if (bioOn) {
        clearBiometric();
        setBioOn(false);
      } else {
        const ok = await enrollBiometric(displayName);
        setBioOn(ok);
        if (!ok) setErr(t("profile.bioFailed"));
      }
    } finally {
      setBioBusy(false);
    }
  }

  const onlyDigits = (s: string) => s.replace(/\D+/g, "").slice(0, 8);

  function reset() {
    setMode(null);
    setCode("");
    setConfirm("");
    setErr(null);
  }

  async function save() {
    if (busy) return;
    if (code.length < 4) {
      setErr(t("profile.lockShort"));
      return;
    }
    if (code !== confirm) {
      setErr(t("profile.lockMismatch"));
      return;
    }
    setBusy(true);
    try {
      await setPasscode(code);
      setEnabled(true);
      reset();
    } catch {
      setErr(t("profile.lockSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!window.confirm(t("profile.lockRemoveConfirm"))) return;
    clearPasscode();
    clearBiometric(); // biometric is only an unlock for the passcode — drop it too
    setEnabled(false);
    setBioOn(false);
    reset();
  }

  return (
    <section className="space-y-3">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {t("profile.paneLock")}
      </Label>
      <div className="rounded-2xl border border-border bg-card/40 p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div
            className={
              "shrink-0 size-10 grid place-items-center rounded-xl " +
              (enabled
                ? "bg-[color:var(--relay-online)]/15 text-[color:var(--relay-online)]"
                : "bg-muted text-muted-foreground")
            }
          >
            {enabled ? <ShieldCheck className="size-5" /> : <Lock className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {enabled ? t("profile.lockOn") : t("profile.lockOff")}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {enabled ? t("profile.lockOnDesc") : t("profile.lockOffDesc")}
            </p>
          </div>
          {enabled && mode === null && (
            <button
              type="button"
              onClick={() => lockApp()}
              className="shrink-0 text-xs font-semibold text-[color:var(--relay-online)] hover:underline underline-offset-4"
            >
              {t("profile.lockNow")}
            </button>
          )}
        </div>

        {/* Biometric unlock — only when supported AND a passcode exists. */}
        {enabled && bioCapable && mode === null && (
          <div className="flex items-center gap-3 border-t border-border/60 pt-3">
            <div
              className={
                "shrink-0 size-9 grid place-items-center rounded-lg " +
                (bioOn
                  ? "bg-[color:var(--relay-online)]/15 text-[color:var(--relay-online)]"
                  : "bg-muted text-muted-foreground")
              }
            >
              <ScanFace className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t("profile.bio")}</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {bioOn ? t("profile.bioOnDesc") : t("profile.bioOffDesc")}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={bioOn}
              aria-label={t("profile.bioToggle")}
              disabled={bioBusy}
              onClick={toggleBiometric}
              className={
                "relative shrink-0 h-7 w-12 rounded-full transition-colors duration-200 disabled:opacity-50 " +
                (bioOn
                  ? "bg-[color:var(--relay-online,theme(colors.primary.DEFAULT))]"
                  : "bg-muted-foreground/30")
              }
              style={{ transitionTimingFunction: "var(--ease-out)" }}
            >
              <span
                className={
                  "absolute top-1 start-1 size-5 rounded-full bg-white shadow transition-transform duration-200 " +
                  (bioOn ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0")
                }
                style={{ transitionTimingFunction: "var(--ease-out)" }}
              />
            </button>
          </div>
        )}

        {mode === null ? (
          <div className="flex flex-wrap gap-2">
            {enabled ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setErr(null);
                    setCode("");
                    setConfirm("");
                    setMode("change");
                  }}
                >
                  {t("profile.lockChange")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={remove}
                >
                  {t("profile.lockRemove")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setErr(null);
                  setCode("");
                  setConfirm("");
                  setMode("set");
                }}
              >
                {t("profile.lockSet")}
              </Button>
            )}
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="newPass" className="text-xs text-muted-foreground">
                  {mode === "change" ? t("profile.lockNew") : t("profile.lockCode")}
                </Label>
                <Input
                  id="newPass"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  autoFocus
                  value={code}
                  onChange={(e) => {
                    setErr(null);
                    setCode(onlyDigits(e.target.value));
                  }}
                  placeholder={t("profile.lockPlaceholder")}
                  className="font-mono tracking-widest"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPass" className="text-xs text-muted-foreground">
                  {t("profile.lockConfirm")}
                </Label>
                <Input
                  id="confirmPass"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => {
                    setErr(null);
                    setConfirm(onlyDigits(e.target.value));
                  }}
                  placeholder={t("profile.lockRepeat")}
                  className="font-mono tracking-widest"
                />
              </div>
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || code.length < 4}>
                {busy
                  ? t("profile.lockSaving")
                  : mode === "change"
                    ? t("profile.lockUpdate")
                    : t("profile.lockTurnOn")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={busy}>
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

/**
 * How long this guest number is held (v2.99.93) — the notice half of the owner's
 * "guest ID expires" ask.
 *
 * ACCURATE RATHER THAN ALARMING, and the difference matters. The clock is
 * `identities.guestExpiresAt`, which `touchGuestExpiry` pushes forward on EVERY
 * visit — so a guest who keeps using RELAY never runs out, and a notice that said
 * "expires in N days" without saying that would frighten people into thinking they
 * were on a countdown they cannot stop.
 *
 * WHAT EXPIRY ACTUALLY DOES TODAY, said precisely because it is easy to overstate:
 * it stops the guest COOKIE resolving. Nothing deletes the row, so the number,
 * contacts and messages are still there — and this browser can still reclaim them
 * with the recovery key (v2.99.68). An automatic PURGE does not exist and is not
 * being invented here: deleting somebody's messages on a timer is a decision the
 * owner has to make on purpose, and "hidden" and "deleted" are very different
 * promises.
 */
function GuestHoldNotice({ expiresAt }: { expiresAt: string | Date | null }) {
  const { tn } = useLocale();
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) return null;
  const days = Math.max(0, Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000)));
  return (
    <p className="text-xs text-muted-foreground">
      {tn(guestHoldKey(days), {
        days: <span className="font-semibold text-foreground">{days}</span>,
      })}
    </p>
  );
}

/**
 * Which wording a day count needs.
 *
 * `` `{days} more day${days === 1 ? "" : "s"}` `` is a sentence assembled from a
 * fragment and cannot be translated at all: English needs one/other, Arabic needs 1
 * singular, 2 DUAL («يومين»), 3–10 plural of paucity («أيام») and 11+ singular
 * accusative («يومًا»). So a WHOLE key is selected per band.
 *
 * THE BANDS MIRROR `guestExpiryKey` IN PeerOverlays.tsx, deliberately — the two
 * countdowns describe the same clock, and two selectors that disagreed about which form
 * a count takes would render one screen correctly and the other wrongly for the same
 * number of days. Zero falls in the "few" band, which is right in both languages: "0
 * more days" reads correctly, and Arabic takes the plural of paucity for zero too.
 *
 * Exported as a test seam: which form a count selects is exactly the thing a source pin
 * cannot answer.
 */
export function guestHoldKey(days: number): TKey {
  if (days === 1) return "profile.guestHoldOne";
  if (days === 2) return "profile.guestHoldTwo";
  return days <= 10 ? "profile.guestHoldFew" : "profile.guestHoldMany";
}
