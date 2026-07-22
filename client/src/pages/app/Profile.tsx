import { useState, useRef, useEffect } from "react";
import {
  Bell,
  BellOff,
  Camera,
  Check,
  Copy,
  LogOut,
  Lock,
  Moon,
  ScanFace,
  Share2,
  ShieldCheck,
  Sun,
  Volume2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { uploadAvatarImage } from "@/lib/uploadAttachment";
import { useIdentity } from "@/app/useIdentity";
import { useSignOut } from "@/app/useSignOut";
import { VerifiedBadge } from "@/app/VerifiedBadge";
import { CountryFlag } from "@/app/CountryFlag";
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
 * Profile page (`/app/profile`).
 *
 * Lets a registered or guest user edit their display name and upload an
 * avatar. For guests, also offers a "Register with email" CTA that opens the
 * native AuthPanel (email one-time code + optional PIN, v2.87) so the server
 * can migrate the guest identity into a permanent user row on verify.
 * v2.92 (R3): the old Manus-OAuth "Keep my number forever" path is gone —
 * AuthPanel is the ONLY sign-in.
 */
export default function ProfilePage() {
  const { me, refresh } = useIdentity();
  const [name, setName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
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

  // Shared sign-out flow (v2.88): AlertDialog confirm + full session/device
  // teardown — the same code path as the AppShell's sign-out buttons.
  const { requestSignOut, signOutDialog, signOutPending } = useSignOut(me);
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
      // BARE upload (v2.96.1) — an attachments-row upload made the storage
      // proxy participant-gate the photo: fine for YOU (uploader), broken
      // image for EVERYONE else. Avatars are semi-public; no row.
      const json = await uploadAvatarImage(file, { mimeType: file.type });
      // AWAIT the save too (v2.98.0 — owner: a captured photo sometimes
      // didn't post). The upload and the profile save are two separate
      // network round-trips; a fire-and-forget `.mutate()` here let the
      // spinner clear — telling the user it was done — the instant the
      // UPLOAD resolved, regardless of whether the save actually persisted.
      // A save failure (session hiccup, etc.) then left a real uploaded
      // photo in storage that the profile never actually points at, with
      // the UI having already reported success. `mutateAsync` makes the
      // spinner (and the catch below) cover the whole pipeline.
      await updateProfile.mutateAsync({ avatarUrl: json.url });
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

  // Presence pill colour/label derived from the saved status override.
  const st = selfStatus(me.statusOverride);

  return (
    // Flow within the AppShell's scroll container (which ends exactly at the
    // in-flow bottom tab bar) instead of creating a competing scroll area —
    // otherwise the last controls get clipped with no way to reach them. The
    // slide-up + fade echoes the prototype's full-screen Profile panel without
    // an absolute overlay that would fight the shell's scroll. The chrome's
    // Back button + brand already frame the page, so the hero avatar leads.
    <div className="min-h-full">
      <div className="max-w-xl mx-auto p-5 pb-10 space-y-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-300">
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

        {/* ── identity hero: avatar (tap to set photo) + name + status ── */}
        <section className="flex flex-col items-center gap-3 pt-1 text-center">
          <div className="relative">
            {/* The avatar IS the upload control (camera badge) — mirrors the
                prototype. The same hidden <input> + onAvatarPick handler drive
                it; the cyan ring is the shared logo gradient. */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || updateProfile.isPending}
              title="Tap to set your photo"
              aria-label={me.avatarUrl ? "Replace profile photo" : "Add profile photo"}
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
                {uploading ? (
                  <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Camera className="size-4" />
                )}
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={onAvatarPick}
            />
          </div>

          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold tracking-tight">{me.displayName || "You"}</h1>
            {me.verified && <VerifiedBadge size={18} />}
          </div>

          {/* presence pill — LED colour reflects the saved status override */}
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground">
            <span
              className="size-2 rounded-full"
              style={{ background: st.color, boxShadow: `0 0 8px ${st.color}` }}
            />
            {st.label}
            {me.verified && <span className="text-muted-foreground/70">· verified</span>}
          </span>

          <div className="flex items-center gap-3 text-xs">
            {me.avatarUrl && (
              <button
                type="button"
                onClick={clearAvatar}
                disabled={updateProfile.isPending}
                className="font-medium text-muted-foreground transition hover:text-destructive disabled:opacity-60"
              >
                Remove photo
              </button>
            )}
            <span className="text-muted-foreground/70">PNG, JPG, WebP or GIF up to 4 MB</span>
          </div>
        </section>

        {/* your RELAY number — copy + QR share, directly under the identity */}
        <NumberAndFlag
          number={me.number}
          onRegenerated={refresh}
          onShowQr={() => setQrOpen(true)}
        />

        {/* display name — kept fully functional, restyled as a settings card */}
        <section className="space-y-2">
          <Label htmlFor="displayName" className="text-xs uppercase tracking-wider text-muted-foreground">
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
                disabled={updateProfile.isPending || !name.trim() || name.trim() === me.displayName}
              >
                Save
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Shown to people you call and chat with.
            </p>
          </div>
        </section>

        {/* status (auto / away / travelling) */}
        <StatusSection me={me} onSaved={refresh} />

        {/* about / bio */}
        <BioSection me={me} onSaved={refresh} />

        {/* email + mobile numbers */}
        <ContactInfoSection me={me} onSaved={refresh} />

        {/* links & social accounts */}
        <SocialLinksSection me={me} onSaved={refresh} />

        {/* theme */}
        <ThemeToggleSection />

        {/* notifications */}
        <NotificationsSection />

        {/* sign-in PIN (v2.87) */}
        <LoginPinSection />

        {/* do not disturb */}
        <DndSection />

        {/* app lock / passcode */}
        <PasscodeSection displayName={me.displayName} />

        {/* upgrade CTA for guests */}
        {me.isGuest && (
          <section className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3">
            <h2 className="text-lg font-semibold">Keep this number forever</h2>
            <p className="text-sm text-muted-foreground">
              Guest sessions are wiped when you close your browser. Create an account to save your
              number, contacts, and profile permanently across all your devices.
            </p>
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
        {showAuth && <AuthPanel onClose={() => setShowAuth(false)} />}

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
        {signOutDialog}

        {/* build stamp — mirrors the prototype's mono footer line */}
        <div className="pt-1 text-center">
          <span className="font-mono text-[11px] text-muted-foreground/70">
            RELAY v{APP_VERSION} · auto-updates on publish
          </span>
        </div>
      </div>

      {/* QR / share bottom sheet (slides up from the bottom of the screen) */}
      <ShareNumberSheet open={qrOpen} onOpenChange={setQrOpen} number={me.number} />
    </div>
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
function NumberAndFlag({
  number,
  onRegenerated,
  onShowQr,
}: {
  number: string;
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
  const regen = trpc.identity.regenerateNumber.useMutation({
    onSuccess: (res) => {
      setRegenNotice(
        `New number ${res.number.slice(0, 3)} ${res.number.slice(3)} — your contacts were updated automatically.`
      );
      onRegenerated();
      window.setTimeout(() => setRegenNotice(null), 6000);
    },
  });
  const copyNumber = () => {
    navigator.clipboard
      ?.writeText(number)
      .then(() => toast.success("Number copied"))
      .catch(() => toast.error("Couldn't copy the number"));
  };
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirmRegen(true)}
            disabled={regen.isPending}
          >
            {regen.isPending ? "Generating…" : "Regenerate number"}
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
