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
import { QRCodeSVG } from "qrcode.react";
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
      setError("Display name can't be empty.");
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

  const copyNumber = () => copyNumberToClipboard(me?.number ?? "");

  if (!me) {
    return (
      <div className="h-full grid place-items-center text-muted-foreground">
        Loading profile…
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
     row that opens it cannot drift apart. */
  const paneTitle: Record<Pane, string> = {
    name: "Name & photo",
    number: "My RELAY number",
    status: "Status",
    about: "About & contact info",
    pin: "Sign-in PIN",
    lock: "App lock",
    devices: "Devices",
    privacy: "Story privacy",
    notifs: "Notifications",
    theme: "Appearance",
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
          <span>Saved</span>
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
                  title="Tap to set your avatar"
                  aria-label={me.avatarUrl ? "Change avatar" : "Add an avatar"}
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
                <h1 className="text-xl font-extrabold tracking-tight">{me.displayName || "You"}</h1>
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
                  aria-label={`Your RELAY number is ${formatPin(me.number)} — open number settings`}
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
                  aria-label="Show the QR code for your number"
                  title="Share your number by QR"
                  className="grid size-9 place-items-center rounded-full border border-border bg-card/60 text-foreground transition active:opacity-70 hover:bg-card"
                >
                  <QrCode className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={copyNumber}
                  aria-label="Copy your number"
                  title="Copy your number"
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
                {st.label}
                <ChevronRight className="size-3.5 opacity-60" />
              </button>
            </section>

            {/* ── grouped rows ─────────────────────────────────────────────── */}
            <HubGroup title="Account">
              <HubRow
                icon={<User className="size-4" />}
                tint="#3FE0C5"
                label={paneTitle.name}
                sub={me.displayName || "Set a name"}
                onClick={() => openPane("name")}
              />
              <HubRow
                icon={<Hash className="size-4" />}
                tint="#6EE7FF"
                label={paneTitle.number}
                sub={`${formatPin(me.number)} · QR, copy, change`}
                onClick={() => openPane("number")}
              />
              <HubRow
                icon={<Sparkles className="size-4" />}
                tint="#f59e0b"
                label={paneTitle.status}
                sub={st.label}
                onClick={() => openPane("status")}
              />
              <HubRow
                icon={<AtSign className="size-4" />}
                tint="#a855f7"
                label={paneTitle.about}
                sub="Bio, email, mobile, links"
                onClick={() => openPane("about")}
              />
            </HubGroup>

            <HubGroup title="Privacy & security">
              <HubRow
                icon={<KeyRound className="size-4" />}
                tint="#38bdf8"
                label={paneTitle.pin}
                sub="Sign in with four digits"
                onClick={() => openPane("pin")}
              />
              <HubRow
                icon={<Lock className="size-4" />}
                tint="#f43f5e"
                label={paneTitle.lock}
                sub="Passcode or Face ID on this device"
                onClick={() => openPane("lock")}
              />
              <HubRow
                icon={<Smartphone className="size-4" />}
                tint="#22c55e"
                label={paneTitle.devices}
                sub="Where you're signed in"
                onClick={() => openPane("devices")}
              />
              <HubRow
                icon={<Eye className="size-4" />}
                tint="#8b5cf6"
                label={paneTitle.privacy}
                sub="Who can watch your stories"
                onClick={() => openPane("privacy")}
              />
            </HubGroup>

            <HubGroup title="Alerts & appearance">
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
                sub="Ringtone, push, email, Do Not Disturb"
                onClick={() => openPane("notifs")}
              />
              <HubRow
                icon={<Palette className="size-4" />}
                tint="#64748b"
                label={paneTitle.theme}
                sub={theme === "dark" ? "Dark" : "Light"}
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
                  label="Admin"
                  sub="Find an account, change its number"
                  onClick={() => navigate("/app/admin")}
                />
              )}
            </HubGroup>

            {/* Restore a previous number (v2.99.68) — deliberately NOT behind a row.
                It renders nothing unless this browser holds a recovery record that
                still resolves, which is almost never, and a row that is usually a
                dead end is worse than a block that is usually absent. */}
            <GuestRestore heading="Restore a previous number" onRestored={refresh} />

            {/* upgrade CTA for guests */}
            {me.isGuest && (
              <section className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3">
                <h2 className="text-lg font-semibold">Keep this number forever</h2>
                <p className="text-sm text-muted-foreground">
                  Guest sessions end when you close your browser — this browser can restore your
                  number afterwards, but only this one. Create an account to keep your number,
                  contacts, and profile permanently across all your devices.
                </p>
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
                    <p className="text-sm font-medium">An administrator suggested an address</p>
                    <p
                      className="break-all text-sm text-muted-foreground"
                      dir="ltr"
                      style={{ unicodeBidi: "isolate" }}
                    >
                      {me.regInvite.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      You can change it — registering only ever uses an address you confirm, and the
                      code goes to whichever one you finish with.
                    </p>
                    {/* THE ONE THING SOFTWARE CANNOT GUARD, SAID OUT LOUD.
                        Nothing here lets an administrator complete a registration —
                        that needs a request from this browser. What it cannot stop is
                        somebody talking the person into using an address the somebody
                        controls, since whoever owns the inbox can then sign in with an
                        email code. That is unchanged by this feature (they could
                        always have said "type this address"), so the honest mitigation
                        is telling the one person who can refuse. */}
                    <p className="text-xs font-medium text-amber-600 dark:text-amber-500">
                      Use an address you own. Whoever can read that inbox can sign in to this
                      number.
                    </p>
                    <button
                      type="button"
                      className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => dismissRegInvite.mutate()}
                      disabled={dismissRegInvite.isPending}
                    >
                      Dismiss this suggestion
                    </button>
                  </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="button" className="flex-1" onClick={() => setShowAuth(true)}>
                    Register with email
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your current number and contacts carry over automatically.
                </p>
              </section>
            )}

            {/* sign out — the final, destructive action; styled as a danger card */}
            <section className="pt-2">
              <button
                type="button"
                disabled={signOutPending}
                onClick={requestSignOut}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
              >
                <LogOut className="size-4" /> Sign out
              </button>
            </section>

            {/* build stamp — mirrors the prototype's mono footer line. Back here in
                v2.105.19 with the hero restored; the version the owner asked to see at
                a glance now also sits in the top bar's avatar menu, which is reachable
                from every tab rather than only from this page. */}
            <div className="pt-1 text-center">
              <span className="font-mono text-[11px] text-muted-foreground/70">
                RELAY v{APP_VERSION} · auto-updates on publish
              </span>
            </div>
          </>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPane(null)}
                aria-label="Back to profile"
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
                    Display name
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
                        Save
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Shown to people you call and chat with.
                    </p>
                  </div>
                </section>
                <section className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Photo
                  </Label>
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/50 p-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPickerOpen(true)}
                      disabled={updateProfile.isPending}
                    >
                      {me.avatarUrl ? "Change photo or emoji" : "Add a photo or emoji"}
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
                        <Trash2 className="size-4" /> Remove
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
            {pane === "pin" && <LoginPinSection />}
            {pane === "lock" && <PasscodeSection displayName={me.displayName} />}
            {pane === "devices" && <DevicesSection />}
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
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full"
        style={{ background: `${tint}24`, color: tint }}
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
   ============================================================ */
function selfStatus(override: string | null | undefined): { label: string; color: string } {
  if (override === "away") return { label: "Away", color: "#f5a623" };
  if (override === "travel") return { label: "Travelling", color: "#38bdf8" };
  return { label: "Available", color: "#06d6a0" };
}

/* ============================================================
   QrGlyph — a REAL, scannable QR code (qrcode.react, bundled — no
   third-party service) encoding `value` (the /i/<number> invite
   link). Dark modules on a light plate in BOTH themes — that's how
   a code stays scannable — so the two colours are FIXED graphic
   values, not theme surfaces. `level="M"` tolerates ~15% occlusion.
   ============================================================ */
function QrGlyph({ value, className }: { value: string; className?: string }) {
  return (
    <QRCodeSVG
      value={value}
      level="M"
      marginSize={2}
      bgColor="#eff2f5"
      fgColor="#12161b"
      className={className}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

/* ============================================================
   ShareNumberSheet — the QR-share bottom sheet (prototype 423–433):
   a rounded-top sheet that slides up with the QR artwork, the
   RELAY number + flag, and real Copy / Share actions (the invite
   link reuses the app-wide /i/<pin> pattern). Uses the shared vaul
   Drawer so surfaces stay theme-aware.
   ============================================================ */
function ShareNumberSheet({
  open,
  onOpenChange,
  number,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  number: string;
}) {
  const geo = trpc.directory.geoSelf.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const pretty = `${number.slice(0, 3)} ${number.slice(3)}`;
  const inviteUrl =
    typeof window !== "undefined" ? `${window.location.origin}/i/${number}` : `/i/${number}`;

  const copyNumber = () => {
    navigator.clipboard
      ?.writeText(number)
      .then(() => toast.success("Number copied"))
      .catch(() => toast.error("Couldn't copy the number"));
  };
  const share = () => {
    const title = "Reach me on RELAY";
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({ title, text: `${title} — ${pretty}`, url: inviteUrl }).catch(() => {});
    } else {
      navigator.clipboard
        ?.writeText(`${title}\n${inviteUrl}`)
        .then(() => toast.success("Invite link copied"))
        .catch(() => toast.error("Couldn't copy the link"));
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="border-border">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 pb-8 pt-3">
          <DrawerTitle className="text-base font-extrabold">Share your RELAY number</DrawerTitle>
          {/* QR plate: fixed light plate + dark modules (legibility), themed frame */}
          <div className="grid size-44 place-items-center rounded-2xl border border-border bg-[#eff2f5] p-3.5">
            <QrGlyph value={inviteUrl} className="size-full" />
          </div>
          <div className="flex items-center gap-2">
            <CountryFlag
              code={geo.data?.country}
              title={geo.data?.countryName ?? geo.data?.country ?? ""}
              className="text-lg"
            />
            <span className="font-mono text-lg font-bold tracking-[0.12em]">{pretty}</span>
          </div>
          <DrawerDescription className="text-center text-xs">
            Share your number so friends can call or message you on RELAY.
          </DrawerDescription>
          <div className="grid w-full grid-cols-2 gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={copyNumber} className="gap-2">
              <Copy className="size-4" /> Copy number
            </Button>
            <Button
              type="button"
              onClick={share}
              className="gap-2 border-0 text-[#08211d] hover:brightness-95"
              style={{ background: "linear-gradient(135deg,#3FE0C5,#6EE7FF)" }}
            >
              <Share2 className="size-4" /> Share
            </Button>
          </div>
          <DrawerClose asChild>
            <Button type="button" variant="ghost" className="w-full">
              Done
            </Button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/* ============================================================
   Number row — shows the user's 6-digit RELAY number alongside
   a country flag chip derived from their connecting IP. The flag
   is purely informational; if the geo lookup fails (e.g. private
   IP, network error) we silently render the number alone.
   ============================================================ */
/** One clipboard path, shared by the hero's copy chip and the pane's button. */
function copyNumberToClipboard(number: string) {
  if (!number) return;
  navigator.clipboard
    ?.writeText(number)
    .then(() => toast.success("Number copied"))
    .catch(() => toast.error("Couldn't copy the number"));
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
  const geo = trpc.directory.geoSelf.useQuery(undefined, {
    staleTime: 60 * 60 * 1000, // 1h — country doesn't change often
    retry: false,
  });
  const [regenNotice, setRegenNotice] = useState<string | null>(null);
  // AlertDialog confirm (v2.88) — native confirm() is gone app-wide.
  const [confirmRegen, setConfirmRegen] = useState(false);
  const announce = (n: string) => {
    setRegenNotice(
      `Now ${n.slice(0, 3)} ${n.slice(3)} — everyone who saved you was updated automatically.`
    );
    onRegenerated();
    window.setTimeout(() => setRegenNotice(null), 6000);
  };
  const regen = trpc.identity.regenerateNumber.useMutation({
    onSuccess: (res) => announce(res.number),
  });
  /* ── Choose your own number (v2.99.75) ───────────────────────────
     Same propagation as a regenerate: the server moves the identity and rewrites
     every saved copy in ONE transaction, so contacts, blocks, threads, messages
     and call history all follow the person rather than the digits. */
  const [chooseOpen, setChooseOpen] = useState(false);
  const [wanted, setWanted] = useState("");
  const [chooseError, setChooseError] = useState<string | null>(null);
  const choose = trpc.identity.setNumber.useMutation({
    onSuccess: (res) => {
      setChooseOpen(false);
      setWanted("");
      setChooseError(null);
      announce(res.number);
    },
    // The server names each refusal for a reason — a typo and a number somebody
    // else already holds need different things from the person reading this.
    onError: (e) => setChooseError(e.message || "Couldn't change your number."),
  });
  // Accept the grouping people naturally type; the server re-validates regardless.
  const wantedDigits = wanted.replace(/[\s\-.]/g, "");
  const wantedOk = /^\d{6}$/.test(wantedDigits) && !/^(000|111)/.test(wantedDigits);
  const copyNumber = () => copyNumberToClipboard(number);
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
              Your RELAY number
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="font-mono text-3xl font-bold tracking-[0.08em]">
                {number.slice(0, 3)} {number.slice(3)}
              </span>
              <CountryFlag
                code={geo.data?.country}
                title={geo.data?.countryName ? `Connecting from ${geo.data.countryName}` : geo.data?.country ?? ""}
                className="text-xl"
              />
            </div>
            <button
              type="button"
              onClick={copyNumber}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
            >
              <Copy className="size-3.5" /> Copy number
            </button>
          </div>
          {/* QR launcher → share sheet (white plate mirrors the prototype) */}
          <button
            type="button"
            onClick={onShowQr}
            aria-label="Show QR code to share your number"
            className="grid size-[70px] shrink-0 place-items-center rounded-xl border border-border bg-[#eff2f5] p-2 transition hover:brightness-95"
          >
            <QrGlyph value={inviteUrl} className="size-full" />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
          {/* Choosing your own number needs a registered account — the server throws
              FORBIDDEN for a guest, because a chosen number is first-come and
              permanent while a guest identity is session-scoped, so a guest claim
              would squat a memorable number and then strand it. Offering the button
              anyway would have meant a guest tapping it, typing a number, and being
              refused for who they are rather than what they typed. A REGENERATE is
              still theirs: it hands out a random number and always has. */}
          {!isGuest && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setChooseError(null);
                setWanted("");
                setChooseOpen(true);
              }}
              disabled={choose.isPending || regen.isPending}
            >
              {choose.isPending ? "Changing…" : "Choose my number"}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirmRegen(true)}
            disabled={regen.isPending || choose.isPending}
          >
            {regen.isPending ? "Generating…" : "Random number"}
          </Button>
          {regenNotice && (
            <span className="text-xs text-[color:var(--relay-online,#06d6a0)]">{regenNotice}</span>
          )}
          {regen.isError && (
            <span className="text-xs text-destructive">Couldn't regenerate — try again.</span>
          )}
        </div>
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        Share this 6-digit number for people to call or message you.
      </p>
      {/* Choose your own 6-digit number (v2.99.75). */}
      <AlertDialog open={chooseOpen} onOpenChange={(open) => !open && setChooseOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Choose your RELAY number</AlertDialogTitle>
            <AlertDialogDescription>
              Six digits, not starting 000 or 111. Everyone who saved you is updated
              automatically, and your messages, calls and contacts all stay exactly as they
              are — only the number changes. Your old number stops working immediately and
              is never given to anyone else.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label htmlFor="relay-wanted-number" className="sr-only">
              Your desired 6-digit number
            </label>
            <input
              id="relay-wanted-number"
              // Numeric keypad on a phone, but a text field: `type="number"` brings
              // spinners, silently accepts "1e5", and drops a leading zero.
              type="text"
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              maxLength={9}
              placeholder="777777"
              value={wanted}
              onChange={(e) => {
                setWanted(e.target.value);
                setChooseError(null);
              }}
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-center font-mono text-2xl tracking-[0.18em] outline-none focus:border-primary"
            />
            {chooseError && <p className="text-xs text-destructive">{chooseError}</p>}
            {!chooseError && wanted.length > 0 && !wantedOk && (
              <p className="text-xs text-muted-foreground">
                Six digits, and it can't start with 000 or 111.
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!wantedOk || choose.isPending}
              // NOT auto-closing: the number may be taken, and closing the dialog
              // before the server answers would hide the one message that tells the
              // person to pick a different one.
              onClick={(e) => {
                e.preventDefault();
                if (!wantedOk) return;
                choose.mutate({ number: wantedDigits });
              }}
            >
              {choose.isPending ? "Changing…" : "Use this number"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRegen} onOpenChange={(open) => !open && setConfirmRegen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate a new 6-digit number?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone who saved you as a contact is updated automatically — they keep
              reaching you. Your old number stops working immediately, and anyone who only
              has it written down elsewhere will need the new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRegen(false);
                regen.mutate();
              }}
            >
              Regenerate
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
  const isDark = theme === "dark";
  return (
    <section className="space-y-3">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        Appearance
      </Label>
      <div className="rounded-2xl border border-border bg-card/50 p-1 grid grid-cols-2 gap-1">
        <Button
          type="button"
          variant={isDark ? "default" : "ghost"}
          className="justify-center gap-2"
          onClick={() => setTheme("dark")}
        >
          <Moon className="size-4" /> Dark
        </Button>
        <Button
          type="button"
          variant={!isDark ? "default" : "ghost"}
          className="justify-center gap-2"
          onClick={() => setTheme("light")}
        >
          <Sun className="size-4" /> Light
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Switches the entire app theme. Your choice is remembered on this
        device.
      </p>
    </section>
  );
}

/* ============================================================
   Notifications — lets the user grant browser notification
   permission. We show a clear three-state pill (Enable / Granted /
   Blocked) so the user always knows where they stand.
   ============================================================ */
/** v2.87 — the 4-digit sign-in PIN: set/change/remove + the login preference.
 *  Verified accounts only (guests have no email login to shortcut). Three
 *  wrong entries at sign-in warn; the fourth locks until an email code. */
function LoginPinSection() {
  const status = trpc.otpAuth.pinStatus.useQuery(undefined, { refetchOnWindowFocus: false });
  const save = trpc.otpAuth.setLoginPin.useMutation();
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  if (!status.data?.signedIn) return null;
  const hasPin = status.data.hasPin;
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 4);
  const submit = async () => {
    setMsg(null);
    if (pin1.length !== 4) { setMsg("The PIN is exactly 4 digits."); return; }
    if (pin1 !== pin2) { setMsg("The PINs don't match."); return; }
    try {
      await save.mutateAsync({ pin: pin1, preferPin: true });
      setMsg(hasPin ? "PIN updated." : "PIN set — you can use it at your next sign-in.");
      setPin1(""); setPin2(""); setEditing(false);
      void status.refetch();
    } catch (e) {
      setMsg((e as { message?: string })?.message ?? "Couldn't save the PIN.");
    }
  };
  const remove = async () => {
    setMsg(null);
    try {
      await save.mutateAsync({ pin: null });
      setMsg("PIN removed — sign-ins use email codes.");
      setEditing(false);
      void status.refetch();
    } catch (e) {
      setMsg((e as { message?: string })?.message ?? "Couldn't remove the PIN.");
    }
  };
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-bold">Sign-in PIN</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        {hasPin
          ? "A 4-digit PIN signs you in instead of an email code. Four wrong tries lock the account (an email code unlocks)."
          : "Set a 4-digit PIN to sign in without waiting for an email code."}
        {status.data.locked ? " Currently LOCKED — your next email-code sign-in unlocks it." : ""}
      </p>
      {!editing ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => { setEditing(true); setMsg(null); }}>
            {hasPin ? "Change PIN" : "Set a PIN"}
          </Button>
          {hasPin && (
            <Button size="sm" variant="secondary" onClick={remove} disabled={save.isPending}>
              Remove PIN
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Input type="password" inputMode="numeric" maxLength={4} value={pin1}
            onChange={(e) => setPin1(digits(e.target.value))} placeholder="New PIN"
            className="w-28 text-center font-mono" />
          <Input type="password" inputMode="numeric" maxLength={4} value={pin2}
            onChange={(e) => setPin2(digits(e.target.value))} placeholder="Repeat"
            className="w-28 text-center font-mono" />
          <Button size="sm" onClick={submit} disabled={save.isPending || pin1.length !== 4}>Save</Button>
          <Button size="sm" variant="secondary" onClick={() => { setEditing(false); setPin1(""); setPin2(""); }}>Cancel</Button>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
    </section>
  );
}

/** Signed-in devices + remote logout (v2.99.1). Each login records a session in
 *  the server ledger; deleting one logs that device out. Registered users only. */
function DevicesSection() {
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

  if (!list.data?.signedIn) return null; // guests have no account sessions

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
      toast.success("Device approved — it can sign in now.");
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Couldn't approve that device.");
    }
  };
  const doDeny = async (sid: string) => {
    try {
      await revoke.mutateAsync({ sid });
      refreshDeviceLists();
      toast.success("Sign-in declined.");
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Couldn't decline that device.");
    }
  };

  const sessions = list.data.sessions;
  const relTime = (ms: number) => {
    const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return d < 30 ? `${d}d ago` : new Date(ms).toLocaleDateString();
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
      toast.success("Signed that device out.");
    } catch (e) {
      setConfirm(null);
      toast.error((e as { message?: string })?.message ?? "Couldn't sign that device out.");
    }
  };

  return (
    <section id="devices" className="rounded-2xl border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-bold">Devices</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Where you're signed in. Remove a device to sign it out remotely.
      </p>

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
                  <div className="truncate text-sm font-semibold">New sign-in waiting</div>
                  {/* Every detail the owner asked for (v2.100.1): *"the details from
                      where his login type, country, IP, device name, everything."*
                      Each line is withheld when the server sent null rather than
                      rendered empty — a place we could not resolve must read as
                      absent, not as a blank claim. */}
                  <div className="truncate text-xs text-muted-foreground">{p.label}</div>
                  {p.detail && (
                    <div className="truncate text-xs text-muted-foreground">{p.detail}</div>
                  )}
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(p.createdAt).toLocaleString()}
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
                If this wasn't you, decline it — the sign-in cannot complete without your
                approval.
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button
                  size="sm"
                  className="h-8 flex-1 rounded-lg"
                  disabled={approve.isPending}
                  onClick={() => doApprove(p.sid)}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 flex-1 rounded-lg"
                  disabled={revoke.isPending}
                  onClick={() => doDeny(p.sid)}
                >
                  Decline
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          This device will appear here after your next sign-in.
        </p>
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
                        This device
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Active {relTime(s.lastSeenAt)} · added {new Date(s.createdAt).toLocaleDateString()}
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
                  aria-label={s.current ? "Sign out this device" : `Sign out ${s.label}`}
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
              {confirm?.current ? "Sign out this device?" : `Sign out ${confirm?.label}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.current
                ? "You'll be signed out here and returned to the start screen."
                : "That device will be signed out and will need to sign in again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void doRevoke(); }}
              disabled={revoke.isPending}
            >
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function NotificationsSection() {
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
          Notifications
        </Label>
        <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          This browser doesn't support desktop notifications.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        Notifications
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
              ? "Notifications are on"
              : perm === "denied"
                ? "Notifications are blocked"
                : "Get notified when someone calls or texts"}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {perm === "granted"
              ? pushReady
                ? "Call alerts reach this device even when RELAY is closed — plus a chime when the app is in another tab."
                : "You'll see a system notification and hear a chime when the app is in another tab."
              : perm === "denied"
                ? "Allow notifications for this site in your browser settings, then refresh."
                : "We'll ring this device for incoming calls — we never push promotional content."}
          </p>
          {iosNeedsInstallForPush() ? (
            <p className="text-xs text-sky-500/90 mt-1.5">
              iPhone/iPad: to get rung while RELAY is closed, use Safari's Share →{" "}
              <span className="font-medium">Add to Home Screen</span>, then open RELAY from the icon
              (Apple only allows call alerts for installed web apps).
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            {perm === "granted" ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-[color:var(--relay-online)]">
                <Check className="size-4" /> {pushReady ? "Call alerts on" : "Enabled"}
              </span>
            ) : perm === "denied" ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
                <BellOff className="size-4" /> Blocked in browser
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
                {busy ? "Requesting…" : "Enable notifications"}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => playRingtonePreview()}
              className="inline-flex items-center gap-1.5"
            >
              <Volume2 className="size-4" /> Test ringtone
            </Button>
            <span className="text-[11px] text-muted-foreground">
              RELAY's own ringtone — fixed medium volume, distinct from system sounds.
            </span>
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
        aria-label={`Toggle ${title}`}
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
            "absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform duration-200 " +
            (checked ? "translate-x-5" : "translate-x-0")
          }
          style={{ transitionTimingFunction: "var(--ease-out)" }}
        />
      </button>
    </div>
  );
}

function EmailNotificationsSection() {
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
      toast.error("Couldn't update email notifications — try again.");
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
        Notifications
      </Label>
      <div className="rounded-2xl border border-border bg-card/40 divide-y divide-border/60">
        {/* PUSH — the master switch for calls AND messages reaching this
            account's devices when RELAY isn't open (v2.99.40). Off means we
            send nothing, on every device, regardless of subscriptions. */}
        <EmailToggleRow
          icon={<BellRing className="size-5" />}
          title="Push notifications"
          desc="Alert my devices about incoming calls and new messages while RELAY is closed."
          checked={prefs.data.push}
          disabled={busy}
          onChange={(v) => setPrefs.mutate({ push: v })}
        />
        {hasEmail && (
          <EmailToggleRow
            icon={<PhoneMissed className="size-5" />}
            title="Missed-call email"
            desc="Email me when I miss a call while I'm offline."
            checked={prefs.data.missedCall}
            disabled={busy}
            onChange={(v) => setPrefs.mutate({ missedCall: v })}
          />
        )}
        {hasEmail && (
          <EmailToggleRow
            icon={<MessageSquare className="size-5" />}
            title="Message email"
            desc="Email me when a message arrives while I'm offline — only if your devices can't be reached, at most a few times a day. We never include the message content."
            checked={prefs.data.message}
            disabled={busy}
            onChange={(v) => setPrefs.mutate({ message: v })}
          />
        )}
      </div>
      {hasEmail && (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Mail className="size-3.5" /> Sent to your account email. Message emails never contain the message itself.
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
      toast.error("Couldn't update who can see your stories — try again.");
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
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        Status privacy
      </Label>
      <div
        className="rounded-2xl border border-border bg-card/40 divide-y divide-border/60"
        role="radiogroup"
        aria-label="Who can see my stories"
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
      <p className="text-[11px] text-muted-foreground">
        Applies to statuses you post from now on — anything already posted keeps the audience you
        chose for it. Blocking someone always hides your status from them, whichever option is set.
      </p>
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
  const [dnd, setDnd] = useDnd();
  return (
    <section className="space-y-3">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        Do Not Disturb
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
          <div className="font-medium">
            {dnd ? "Do Not Disturb is on" : "Do Not Disturb is off"}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {dnd
              ? "Incoming calls are auto-declined; chimes and pop-ups are silenced. Messages still arrive."
              : "Silence call rings, chimes, and desktop pop-ups without going offline."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={dnd}
          aria-label="Toggle Do Not Disturb"
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
              "absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform duration-200 " +
              (dnd ? "translate-x-5" : "translate-x-0")
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
        if (!ok) setErr("Couldn't set up biometric unlock on this device.");
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
      setErr("Use at least 4 digits.");
      return;
    }
    if (code !== confirm) {
      setErr("The two codes don't match.");
      return;
    }
    setBusy(true);
    try {
      await setPasscode(code);
      setEnabled(true);
      reset();
    } catch {
      setErr("Couldn't save the passcode on this device.");
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!window.confirm("Remove the app passcode on this device?")) return;
    clearPasscode();
    clearBiometric(); // biometric is only an unlock for the passcode — drop it too
    setEnabled(false);
    setBioOn(false);
    reset();
  }

  return (
    <section className="space-y-3">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        App lock
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
              {enabled ? "Passcode is on" : "Passcode is off"}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {enabled
                ? "RELAY asks for your code each time it opens on this device."
                : "Lock RELAY behind a 4–8 digit code on this device. It's stored hashed and never leaves this browser."}
            </p>
          </div>
          {enabled && mode === null && (
            <button
              type="button"
              onClick={() => lockApp()}
              className="shrink-0 text-xs font-semibold text-[color:var(--relay-online)] hover:underline underline-offset-4"
            >
              Lock now
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
              <div className="text-sm font-medium">Face ID / fingerprint</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {bioOn
                  ? "Unlock with biometrics; your passcode still works as a fallback."
                  : "Add a faster unlock using this device's built-in biometrics."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={bioOn}
              aria-label="Toggle biometric unlock"
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
                  "absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform duration-200 " +
                  (bioOn ? "translate-x-5" : "translate-x-0")
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
                  Change passcode
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={remove}
                >
                  Remove
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
                Set a passcode
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
                  {mode === "change" ? "New passcode" : "Passcode"}
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
                  placeholder="4–8 digits"
                  className="font-mono tracking-widest"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPass" className="text-xs text-muted-foreground">
                  Confirm
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
                  placeholder="Repeat code"
                  className="font-mono tracking-widest"
                />
              </div>
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || code.length < 4}>
                {busy ? "Saving…" : mode === "change" ? "Update" : "Turn on"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={busy}>
                Cancel
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
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) return null;
  const days = Math.max(0, Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000)));
  return (
    <p className="text-xs text-muted-foreground">
      This browser holds your guest number for{" "}
      <span className="font-semibold text-foreground">
        {days} more {days === 1 ? "day" : "days"}
      </span>
      , and that resets every time you open RELAY — so it only runs down if you stop
      using it. Registering removes the limit entirely.
    </p>
  );
}
