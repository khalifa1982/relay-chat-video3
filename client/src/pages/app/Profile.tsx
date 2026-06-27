import { useState, useRef, useEffect } from "react";
import { Bell, BellOff, Check, Lock, Moon, ScanFace, ShieldCheck, Sun } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { uploadAttachment } from "@/lib/uploadAttachment";
import { useIdentity } from "@/app/useIdentity";
import { clearRelayChannel } from "@/lib/deviceId";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getNotifPermission,
  requestNotifPermission,
  unlockAudio,
  type NotifPermission,
} from "@/app/notifications";
import { useDnd } from "@/app/dnd";
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
 * Profile page (`/app/profile`).
 *
 * Lets a registered or guest user edit their display name and upload an
 * avatar. For guests, also offers the "Keep my number forever" CTA that
 * triggers Manus OAuth so the server can migrate the guest identity into
 * a permanent user row on callback.
 */
export default function ProfilePage() {
  const { me, refresh } = useIdentity();
  const [name, setName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const signOutGuestMut = trpc.identity.signOutGuest.useMutation();
  const logoutUserMut = trpc.auth.logout.useMutation();
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

  async function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Avatar must be an image.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("Avatar must be under 4 MB.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const json = await uploadAttachment(file, { filename: file.name, mimeType: file.type });
      updateProfile.mutate({ avatarUrl: json.url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Avatar upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function clearAvatar() {
    if (!me?.avatarUrl) return;
    updateProfile.mutate({ avatarUrl: null });
  }

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

  return (
    // Flow within the AppShell's scroll container (which already reserves space
    // for the fixed bottom nav) instead of creating a competing scroll area —
    // otherwise the last controls sit UNDER the nav with no way to reach them.
    <div className="min-h-full">
      <div className="max-w-xl mx-auto p-6 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your display name and avatar are shown to people you call and chat with.
          </p>
        </header>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 text-destructive-foreground px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {savedAt !== null && !error && (
          <div
            // Centered glassy pill, online-green tint, slides up + fades in
            // on mount, then auto-dismisses after 1.8s via the effect above.
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

        {/* avatar */}
        <section className="space-y-4">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Avatar
          </Label>
          <div className="flex items-center gap-5">
            <div className="relative">
              {me.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={me.avatarUrl}
                  alt={me.displayName}
                  className="w-20 h-20 rounded-full object-cover border border-border"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-accent grid place-items-center text-2xl font-bold text-primary-foreground border border-border">
                  {initials}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={onAvatarPick}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || updateProfile.isPending}
              >
                {uploading ? "Uploading…" : me.avatarUrl ? "Replace photo" : "Upload photo"}
              </Button>
              {me.avatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={clearAvatar}
                  disabled={updateProfile.isPending}
                  className="text-destructive hover:text-destructive"
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            PNG, JPG, WebP or GIF up to 4 MB.
          </p>
        </section>

        {/* display name */}
        <section className="space-y-3">
          <Label htmlFor="displayName" className="text-xs uppercase tracking-wider text-muted-foreground">
            Display name
          </Label>
          <div className="flex gap-3">
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
              disabled={updateProfile.isPending || !name.trim() || name.trim() === me.displayName}
            >
              Save
            </Button>
          </div>
        </section>

        {/* number */}
        <NumberAndFlag
          number={me.number}
        />

        {/* theme */}
        <ThemeToggleSection />

        {/* notifications */}
        <NotificationsSection />

        {/* do not disturb */}
        <DndSection />

        {/* app lock / passcode */}
        <PasscodeSection displayName={me.displayName} />

        {/* upgrade CTA for guests */}
        {me.isGuest && (
          <section className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3">
            <h2 className="text-lg font-semibold">Keep this number forever</h2>
            <p className="text-sm text-muted-foreground">
              Guests are kept on this device for 30 days. Sign in to save your number and
              contacts permanently across all your devices.
            </p>
            <Button
              type="button"
              onClick={() => {
                window.location.href = getLoginUrl();
              }}
            >
              Sign in to upgrade
            </Button>
          </section>
        )}

        {/* sign out */}
        {/* (the upgrade CTA above stays in place — sign-out is the
           final action on this page) */}
        <section className="pt-4 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={async () => {
              const msg = me.isGuest
                ? "Sign out and forget this number on this device?"
                : "Sign out of your account on this device?";
              if (!confirm(msg)) return;
              try {
                if (me.isGuest) {
                  await signOutGuestMut.mutateAsync();
                } else {
                  await logoutUserMut.mutateAsync();
                }
              } catch {
                /* ignore */
              }
              // Sever the relay signaling channel before navigating away so the
              // next user on this browser gets a fresh number and can't be
              // auto-rejoined into this session's live call.
              clearRelayChannel();
              window.location.href = "/";
            }}
          >
            Sign out
          </Button>
        </section>
      </div>
    </div>
  );
}

/* ============================================================
   Number row — shows the user's 6-digit RELAY number alongside
   a country flag chip derived from their connecting IP. The flag
   is purely informational; if the geo lookup fails (e.g. private
   IP, network error) we silently render the number alone.
   ============================================================ */
function NumberAndFlag({ number }: { number: string }) {
  const geo = trpc.directory.geoSelf.useQuery(undefined, {
    staleTime: 60 * 60 * 1000, // 1h — country doesn't change often
    retry: false,
  });
  return (
    <section className="space-y-2">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        Your number
      </Label>
      <div className="flex items-center gap-3">
        <div className="text-2xl font-mono tracking-widest">
          {number.slice(0, 3)} {number.slice(3)}
        </div>
        {geo.data?.flagEmoji && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 border border-border px-2.5 py-1 text-sm"
            title={
              geo.data.countryName
                ? `Connecting from ${geo.data.countryName}`
                : undefined
            }
            aria-label={
              geo.data.countryName
                ? `Connecting from ${geo.data.countryName}`
                : `Country ${geo.data.country}`
            }
          >
            <span className="text-base leading-none">{geo.data.flagEmoji}</span>
            <span className="text-xs font-medium text-muted-foreground">
              {geo.data.country}
            </span>
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Share this 6-digit number for people to call or message you.
      </p>
    </section>
  );
}

/* ============================================================
   Theme toggle — lets the user flip the entire app between
   dark (default) and light. State is persisted via the
   ThemeProvider that wraps the app in main.tsx.
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
function NotificationsSection() {
  const [perm, setPerm] = useState<NotifPermission>(() =>
    getNotifPermission()
  );
  const [busy, setBusy] = useState(false);

  // The browser's permission state can change in another tab — re-poll
  // when this tab gets focus.
  useEffect(() => {
    const onFocus = () => setPerm(getNotifPermission());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

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
              ? "You'll see a system notification and hear a chime when the app is in another tab."
              : perm === "denied"
                ? "Allow notifications for this site in your browser settings, then refresh."
                : "We'll show a system notification — we never push promotional content."}
          </p>
          <div className="mt-3">
            {perm === "granted" ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-[color:var(--relay-online)]">
                <Check className="size-4" /> Enabled
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
                  setBusy(false);
                }}
              >
                {busy ? "Requesting…" : "Enable notifications"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

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
