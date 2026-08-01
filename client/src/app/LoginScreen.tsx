/* ──────────────────────────────────────────────────────────────────────────
 * RELAY — login & registration entry page (RELAY_LOGIN_HANDOFF.md).
 *
 * One glass auth card over the animated canvas, then LIVE NETWORK stats,
 * feature chips and the "your identity is six digits" section. Tokens, copy,
 * spacing and motion are the spec's; the icons are the project's library
 * (lucide-react), which the spec explicitly asks for ("Swap for the project's
 * icon library").
 *
 * ── WHERE THIS DEPARTS FROM THE SPEC, AND WHY ──────────────────────────────
 *
 * The spec is a prototype with no backend, and says so: "Backend wiring needed:
 * live stats, email lookup (exists → login, else register), OTP issue/verify,
 * account creation returning the six-digit ID." Wiring it to the real one
 * forces three honest departures, each of which would otherwise have DELETED a
 * shipped capability:
 *
 *  1. THE STATS ARE REAL, NOT SIMULATED. §4 has the numbers tick on a 2400ms
 *     timer with random increments. RELAY already pushes all five figures over
 *     SSE (v2.99.72), so the tiles read `useLiveStats` and the spec's pop
 *     animation fires on a REAL change instead of a fabricated one. Inventing
 *     traffic on the front page of a comms product would be a lie told in
 *     numbers.
 *
 *  2. `choose` IS PROBE-DRIVEN. The spec offers "Log in / Register" as a free
 *     choice. The server already knows which is correct (`otpAuth.loginProbe`),
 *     and letting someone pick "Log in" for an unregistered address is a dead
 *     end by construction. The step is kept exactly as designed, but the probe
 *     runs on Continue so the right option is recommended and the other one
 *     explains itself rather than failing.
 *
 *  3. THREE STEPS THE SPEC DOES NOT MENTION ARE PRESERVED: the 4-digit PIN pad
 *     (`pin`), post-registration setup (`setup`), and new-device approval
 *     (`waiting`). Each is real, shipped, and reachable today — a redesign that
 *     silently dropped them would lock out everyone who set a passcode. They
 *     render in the spec's own panel language so they do not look bolted on.
 *     `remember` (0/30/60/90) is likewise kept, on the code and PIN steps.
 *
 * The `/i/<pin>` call-link join card is deliberately NOT routed here — it stays
 * the focused single-field screen it has been since v2.94.5, which the spec
 * does not cover and which exists so a shared link connects in one tap.
 * ────────────────────────────────────────────────────────────────────────── */
import { forwardRef, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  User2, Users, Mail, Lock, MessageSquare, Phone, Video, ArrowRight, ShieldCheck,
  ArrowLeft, KeyRound, Smartphone, RotateCw,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useIdentity } from "./useIdentity";
import { GuestRestore } from "./GuestRestore";
import { MatrixReveal } from "./MatrixReveal";
import { RelayBackground } from "./RelayBackground";
import { useLiveStats } from "./useLiveStats";
import { useT } from "./i18n";
import { RELAY_ACCENT, RELAY_BUSINESS_GOLD } from "@/lib/relayBackground";

/* ── tokens (spec §5) ─────────────────────────────────────────────────────── */
export const T = {
  bg: "#04070a",
  text: "#e8efec",
  bright: "#eafff6",
  muted: "#9fb0ab",
  faint: "#5c6b67",
  faint2: "#7d8f8a",
  faint3: "#4a5955",
  sub: "#8fa39d",
  accent: RELAY_ACCENT,
  onAccent: "#04211a",
  gold: RELAY_BUSINESS_GOLD,
  warning: "#c9a06a",
} as const;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Step =
  | "idle" | "guest" | "email" | "choose" | "login" | "register"
  // Not in the spec — real, shipped, and preserved. See the header note.
  | "pin" | "setup" | "waiting";

/** Format a 6-digit RELAY id as `### ###` (spec §3, register notice). */
export function fmtId(n: string): string {
  return /^\d{6}$/.test(n) ? `${n.slice(0, 3)} ${n.slice(3)}` : n;
}

/** The spec's register step takes ONE "permanent display name"; the server
 *  wants firstName + lastName. Split on the first space, everything after it is
 *  the surname, and a single word is a legitimate mononym. */
export function splitDisplayName(full: string): { firstName: string; lastName: string } {
  const t = full.trim().replace(/\s+/g, " ");
  const i = t.indexOf(" ");
  return i === -1 ? { firstName: t, lastName: "" } : { firstName: t.slice(0, i), lastName: t.slice(i + 1) };
}

const glass = (blur = 14, sat = 150, border = 0.12): React.CSSProperties => ({
  background: "linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.015))",
  backdropFilter: `blur(${blur}px) saturate(${sat}%)`,
  WebkitBackdropFilter: `blur(${blur}px) saturate(${sat}%)`,
  border: `1px solid rgba(255,255,255,${border})`,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.12), 0 12px 32px rgba(0,0,0,.35)",
});

const mono = (size: number, ls = ".18em"): React.CSSProperties => ({
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  fontSize: size, letterSpacing: ls,
});

/* ── small pieces ─────────────────────────────────────────────────────────── */

function Eyebrow({ children, color = T.faint2 }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1" style={{ background: "rgba(255,255,255,.09)" }} />
      <span style={{ ...mono(10.5, ".28em"), color, textTransform: "uppercase" }}>{children}</span>
      <span className="h-px flex-1" style={{ background: "rgba(255,255,255,.09)" }} />
    </div>
  );
}

function Notice({ children, tone = "accent" }: { children: React.ReactNode; tone?: "accent" | "warn" }) {
  const c = tone === "warn" ? T.warning : T.accent;
  return (
    <div
      className="mt-3 rounded-xl px-3.5 py-2.5 text-[13.5px]"
      style={{
        color: c, border: `1px solid ${c}40`,
        background: `linear-gradient(180deg, ${c}12, ${c}06)`,
        animation: "relayFadeUp .35s both",
      }}
    >
      {children}
    </div>
  );
}

const Field = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { accent: string }>(
  function Field(props, ref) {
  const { accent, style, ...rest } = props;
  const [focus, setFocus] = useState(false);
  return (
    <input
      ref={ref}
      {...rest}
      onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
      style={{
        width: "100%", padding: "14px 16px", fontSize: 16, color: T.text,
        background: "rgba(255,255,255,.05)", borderRadius: 12,
        border: `1px solid ${focus ? accent : "rgba(255,255,255,.13)"}`,
        boxShadow: focus ? `inset 0 1px 2px rgba(0,0,0,.25), 0 0 0 3px ${accent}24` : "inset 0 1px 2px rgba(0,0,0,.25)",
        transition: "border-color .18s, box-shadow .18s",
        ...style,
      }}
    />
  );
});

function Cta({
  accent, disabled, children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { accent: string }) {
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{
        width: "100%", padding: 13, borderRadius: 12, fontWeight: 700, fontSize: 15,
        border: "none", cursor: disabled ? "default" : "pointer",
        transition: "filter .18s, background .3s",
        ...(disabled
          ? { background: "rgba(255,255,255,.05)", color: T.faint }
          : {
              background: `linear-gradient(180deg, ${accent}f2, ${accent})`,
              color: T.onAccent,
              boxShadow: `0 8px 26px ${accent}40, inset 0 1px 0 rgba(255,255,255,.35)`,
            }),
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.filter = "brightness(1.1)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.filter = ""; }}
    >
      {children}
    </button>
  );
}

/**
 * Back, made impossible to miss (owner: *"always make the Back button flashy,
 * something clearly visible that somebody can see"*).
 *
 * It was 11.5px grey mono on a dark glass card — technically present and
 * effectively invisible, which is the same defect as the hover-only ⋮ in
 * v2.99.85. Now a real bordered control with an arrow, the accent colour, and a
 * slow breathing glow so the eye lands on it. The glow is a STATIC box-shadow on
 * a stacked overlay with only its OPACITY animated, never an animated
 * box-shadow: this sits on a `backdrop-filter` card, the most expensive surface
 * in the app to repaint over (v2.99.86), and a standing test fails the build if
 * any keyframe animates box-shadow.
 */
function BackLink({ onClick, accent, label = "Back" }: { onClick: () => void; accent: string; label?: string }) {
  return (
    <div className="mt-4 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="relative inline-flex items-center gap-2"
        style={{
          borderRadius: 999,
          padding: "10px 20px 10px 16px",
          cursor: "pointer",
          color: "#eafffb",
          fontSize: 14,
          fontWeight: 600,
          background: `linear-gradient(180deg, ${accent}2e, ${accent}12)`,
          border: `1px solid ${accent}99`,
          transition: "border-color .5s, background .5s, transform .18s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
      >
        <span
          aria-hidden
          className="motion-safe:[animation:relayBackGlow_2.6s_ease-in-out_infinite]"
          style={{
            position: "absolute", inset: -1, borderRadius: 999, pointerEvents: "none",
            boxShadow: `0 0 18px ${accent}88, 0 0 4px ${accent}cc`,
            opacity: 0.35,
          }}
        />
        <ArrowLeft size={16} style={{ color: accent, position: "relative" }} aria-hidden />
        <span style={{ position: "relative" }}>{label}</span>
      </button>
    </div>
  );
}

/**
 * #122 — seconds left on a wait, or 0 once it has elapsed.
 *
 * Ticks on a 1s interval and is keyed on `startedAt`, so RE-ARMING it (a resend,
 * a re-ask) restarts the clock rather than leaving a stale one running. A null
 * start means "not waiting" and no timer is created at all — the picker is on
 * screen in states that are not counting down, and a timer per render of those
 * would be a tick nobody reads.
 */
function useCountdown(startedAt: number | null, seconds: number): number {
  const [left, setLeft] = useState(() =>
    startedAt == null ? 0 : Math.max(0, seconds - Math.floor((Date.now() - startedAt) / 1000)),
  );
  useEffect(() => {
    if (startedAt == null) { setLeft(0); return; }
    const tick = () => setLeft(Math.max(0, seconds - Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [startedAt, seconds]);
  return left;
}

/** How long before an emailed code offers a resend, and before a pending device
 *  approval offers to be re-asked. Both are the owner's "say, 30 seconds". */
export const OTP_RESEND_SECONDS = 30;
export const APPROVAL_NUDGE_SECONDS = 30;

export type SignInMethod = "code" | "pin" | "device";

/**
 * #122 — which ways in to OFFER, given what this account actually has.
 *
 * Pure and exported so the rule can be tested without a browser: the whole point
 * is that a method is OMITTED when it cannot work rather than shown disabled (an
 * account with no passcode has nothing to unlock), and that is a claim about a
 * list, not about pixels.
 *
 * The email code is always present because every registered address can be mailed
 * one — it is the floor that guarantees the picker is never empty.
 */
export function signInMethodOptions(hasPin: boolean, hasPending: boolean): SignInMethod[] {
  return [
    "code" as const,
    ...(hasPin ? (["pin"] as const) : []),
    ...(hasPending ? (["device"] as const) : []),
  ];
}

/**
 * #122 — the method switcher (owner: *"it will always give you an option to
 * switch between different methods of authentication ... you can switch from
 * device authentication to four digits or to an OTP"*).
 *
 * ALL THREE PATHS ALREADY EXISTED — v2.99.7 shipped the passcode bypass, the
 * email code and the approve/decline, and v2.99.19 #50 added a PIN escape from
 * the waiting screen. What did not exist was a way to move BETWEEN them at will:
 * each state offered at most one exit, so somebody whose approver device was shut
 * had to guess.
 *
 * A method is OMITTED rather than shown disabled when it cannot work — an account
 * with no passcode has nothing to unlock, and offering it would be a control that
 * always refuses (the v2.103.3 rule). Second-device approval is likewise offered
 * only where it is real: it is not something a client can choose, it is what the
 * SERVER answers when a code verify lands on an unrecognised device, so it
 * appears only once that has actually happened.
 */
function MethodPicker({
  accent,
  current,
  hasPin,
  hasPending,
  onPick,
}: {
  accent: string;
  current: SignInMethod;
  hasPin: boolean;
  hasPending: boolean;
  onPick: (m: SignInMethod) => void;
}) {
  const t = useT();
  const META: Record<SignInMethod, { icon: React.ReactNode; label: string }> = {
    code: { icon: <Mail size={14} />, label: t("login.methodCode") },
    pin: { icon: <KeyRound size={14} />, label: t("login.methodPin") },
    device: { icon: <Smartphone size={14} />, label: t("login.methodDevice") },
  };
  const opts = signInMethodOptions(hasPin, hasPending).map((k) => ({ k, ...META[k] }));
  // One way in is not a choice; rendering a picker for it is noise.
  if (opts.length < 2) return null;
  return (
    <div className="mt-4">
      <div style={{ ...mono(10), color: T.faint2, marginBottom: 8 }}>{t("login.orSignInWith")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {opts.map((o) => {
          const on = o.k === current;
          return (
            <button
              key={o.k}
              type="button"
              onClick={() => { if (!on) onPick(o.k); }}
              aria-pressed={on}
              disabled={on}
              style={{
                borderRadius: 999, padding: "8px 13px", fontSize: 13, cursor: on ? "default" : "pointer",
                display: "inline-flex", alignItems: "center", gap: 7,
                transition: "background .3s, border-color .3s, color .3s",
                ...(on
                  ? { background: `${accent}22`, border: `1px solid ${accent}88`, color: "#eafffb" }
                  : { background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.14)", color: T.muted }),
              }}
            >
              <span style={{ color: on ? accent : T.faint2, display: "flex" }}>{o.icon}</span>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The spec's panel shell: radius 18, accent border + gradient, both crossfading
 *  so the Business gold sweep reaches every panel. */
function Panel({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        borderRadius: 18, padding: 18,
        border: `1px solid ${accent}40`,
        background: `linear-gradient(180deg, ${accent}12, ${accent}06)`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.1)",
        transition: "border-color .5s, background .5s",
        animation: "relayFadeUp .35s both",
      }}
    >
      {children}
    </div>
  );
}

/* ── live network ─────────────────────────────────────────────────────────── */

function StatTile({
  icon, value, label, delay, accent, big = false,
}: {
  icon: React.ReactNode; value: number | null; label: string; delay: number; accent: string; big?: boolean;
}) {
  const [flash, setFlash] = useState(false);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (value == null) return;
    if (prev.current != null && prev.current !== value) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 520);
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  useEffect(() => { if (value != null) prev.current = value; }, [value]);

  return (
    <div style={{ ...glass(), borderRadius: 16, padding: "14px 10px", textAlign: "center" }}>
      <div
        style={{ color: accent, display: "flex", justifyContent: "center", marginBottom: 7 }}
        className="motion-safe:[animation:relayFloaty_3.4s_ease-in-out_infinite]"
      >
        <span style={{ animationDelay: `${delay}s` }}>{icon}</span>
      </div>
      <div
        style={{
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          fontWeight: 600, fontSize: big ? 30 : 25,
          color: flash ? accent : T.bright,
          transform: flash ? "scale(1.22)" : "scale(1)",
          textShadow: flash ? `0 0 18px ${accent}aa` : "none",
          transition: "transform .35s cubic-bezier(.34,1.56,.64,1), color .35s, text-shadow .35s",
        }}
      >
        {value == null ? "—" : value.toLocaleString()}
      </div>
      <div style={{ ...mono(9.5), color: T.faint2, marginTop: 4 }}>{label}</div>
    </div>
  );
}

/** Two overlapping circles — the spec's CALL PARTIES mark. lucide has no
 *  equivalent, so this one stays an inline stroke SVG as the spec drew it. */
function CallPartiesIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" />
    </svg>
  );
}

function LiveNetwork({ accent }: { accent: string }) {
  const t = useT();
  const s = useLiveStats();
  // The spec renders five tiles. With no data yet the numbers show an em-dash
  // rather than a confident 0 — "0 people online" on the entry page is a claim,
  // and a cold cache must not be allowed to make it (the v2.99.72 rule).
  const tiles = [
    { icon: <User2 size={17} />, value: s?.registeredUsers ?? null, label: t("login.registered") },
    { icon: <Users size={17} />, value: s?.guestsServed ?? null, label: t("login.guestsServed") },
    { icon: <CallPartiesIcon />, value: s?.totalParties ?? null, label: t("login.callParties") },
    { icon: <MessageSquare size={17} />, value: s?.messagesSent ?? null, label: t("login.messages") },
  ];
  return (
    <div className="mt-9">
      <Eyebrow>{t("login.liveNetwork")}</Eyebrow>
      <div
        className="mt-4"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px,1fr))", gap: 10 }}
      >
        {tiles.map((t, i) => (
          <StatTile key={t.label} {...t} delay={i * 0.4} accent={accent} />
        ))}
      </div>
      <div className="mt-2.5">
        <StatTile
          icon={
            <span className="relative flex items-center justify-center">
              <span
                className="motion-safe:[animation:relayPulse_1.6s_ease-in-out_infinite]"
                style={{ width: 9, height: 9, borderRadius: 999, background: accent, display: "block" }}
              />
            </span>
          }
          value={s?.onlineNow ?? null}
          label={t("login.onlineNow")}
          delay={0}
          accent={accent}
          big
        />
      </div>
    </div>
  );
}

/* ── security & identity ──────────────────────────────────────────────────── */

function IdentitySection({ accent }: { accent: string }) {
  const t = useT();
  const [digits, setDigits] = useState<number[]>(() => [4, 8, 2, 9, 1, 7]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // Spec §4: one random tile re-rolls every 2600ms.
    const t = setInterval(() => {
      setDigits((d) => {
        const n = [...d];
        n[Math.floor(Math.random() * 6)] = Math.floor(Math.random() * 10);
        return n;
      });
    }, 2600);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="w-full" style={{ maxWidth: 560, margin: "6px 0 30px" }}>
      <div style={{ ...mono(10.5, ".28em"), color: accent, textAlign: "center" }}>{t("login.securityEyebrow")}</div>
      <h2
        style={{
          fontSize: 25, fontWeight: 700, color: T.text, margin: "9px 0 16px",
          lineHeight: 1.2, textAlign: "center",
        }}
      >
        {t("login.identityHeading")}
      </h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        {digits.map((d, i) => (
          <div
            key={i}
            // Sized by `.relay-idstrip-tile` (index.css) rather than inline, because
            // it has to CLAMP: six fixed 50px tiles wrap to two rows on a 320px
            // phone, and the measured cost of that was the access buttons falling
            // below the fold.
            className="relay-idstrip-tile"
            style={{
              borderRadius: 12,
              display: "grid", placeItems: "center",
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace", color: T.bright,
              border: `1px solid ${accent}59`,
              background: "linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.015))",
              boxShadow: `inset 0 1px 0 rgba(255,255,255,.12), 0 0 22px ${accent}22`,
              transition: "border-color .5s, box-shadow .5s",
            }}
          >
            {d}
          </div>
        ))}
      </div>
      <p
        className="relay-idstrip-note"
        style={{
          color: T.muted, fontSize: 14, lineHeight: 1.6, marginTop: 15, textAlign: "center",
        }}
      >
        {t("login.identityNote")}
      </p>
      <div
        className="mt-4 flex items-center justify-center gap-2.5"
        style={{ color: T.faint2, fontSize: 13 }}
      >
        <Lock size={15} style={{ color: accent }} />
        All calls, video and messages are end-to-end encrypted.
      </div>
    </section>
  );
}

/* ── the page ─────────────────────────────────────────────────────────────── */

export function LoginScreen() {
  const t = useT();
  const { startGuest, startGuestPending, startGuestError, refresh } = useIdentity();
  const utils = trpc.useUtils();

  const [step, setStep] = useState<Step>("idle");
  const [business, setBusiness] = useState(false);
  const accent = business ? T.gold : T.accent;

  const [guestName, setGuestName] = useState("");
  const [email, setEmail] = useState("");
  const [regName, setRegName] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [probeUnregistered, setProbeUnregistered] = useState<boolean | null>(null);
  const [reveal, setReveal] = useState<{ name: string; number: string } | null>(null);
  /** #121 — the masked leading group of this account's number, echoed back once the
   *  email resolves so the person can see they reached their own ID. */
  const [numberHint, setNumberHint] = useState<string | null>(null);
  /** #122 — whether a passcode exists for this address, so the method picker only
   *  ever offers a way in that can actually work. */
  const [probeHasPin, setProbeHasPin] = useState(false);
  /** #122 — a code verify has landed on an unrecognised device at least once, so
   *  second-device approval is a REAL option rather than a theoretical one. */
  const [approvalPending, setApprovalPending] = useState(false);
  /** #122 — when the current wait started, or null when nothing is counting down.
   *  Re-armed (not merely reset) by a resend or a re-ask, so the clock restarts. */
  const [waitStartedAt, setWaitStartedAt] = useState<number | null>(null);

  const loginProbe = trpc.otpAuth.loginProbe.useMutation();
  const requestOtp = trpc.otpAuth.requestOtp.useMutation();
  const register = trpc.otpAuth.register.useMutation();
  const verifyOtp = trpc.otpAuth.verifyOtp.useMutation();
  const loginWithPin = trpc.otpAuth.loginWithPin.useMutation();

  const busy =
    loginProbe.isPending || requestOtp.isPending || register.isPending ||
    verifyOtp.isPending || loginWithPin.isPending || startGuestPending;

  const cleanEmail = email.trim().toLowerCase();
  const emailOk = EMAIL_RE.test(cleanEmail);

  const inputRef = useRef<HTMLInputElement>(null);
  // Spec §3: each step auto-focuses its input ~80ms after mount.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [step]);

  const go = useCallback((s: Step) => { setStep(s); setError(null); setNotice(null); }, []);
  const messageOf = (e: unknown, fb: string) =>
    (e as { message?: string })?.message || fb;

  async function submitGuest(e?: FormEvent) {
    e?.preventDefault();
    const name = guestName.trim();
    if (!name) return;
    setError(null);
    try {
      const res = await startGuest(name);
      const num = (res as { number?: string })?.number;
      if (num) setReveal({ name, number: num });
      else refresh();
    } catch (err) {
      setError(messageOf(err, t("login.err.guestSession")));
    }
  }

  async function submitEmail(e?: FormEvent) {
    e?.preventDefault();
    if (!emailOk || business) return;
    setError(null);
    try {
      const p = await loginProbe.mutateAsync({ email: cleanEmail });
      setProbeUnregistered(!!p.unregistered);
      setProbeHasPin(!!p.hasPin);
      // #121 — masked, so it confirms the account without handing anybody a
      // dialable number (see the server note on `numberHint`).
      setNumberHint(p.numberHint ?? null);
      // Departure (2) in the header: the spec's free choice, but informed. A
      // PIN account skips `choose` entirely — that is the fastest real path and
      // showing "Log in / Register" in front of it would be friction for nothing.
      if (p.hasPin && !p.locked) { setPin(""); go("pin"); return; }
      if (p.hasPin && p.locked) {
        setNotice(t("login.notice.locked"));
      }
      go("choose");
    } catch (err) {
      setError(messageOf(err, t("login.err.checkAddress")));
    }
  }

  async function sendCode() {
    setError(null);
    try {
      const r = await requestOtp.mutateAsync({ email: cleanEmail });
      if (r.unregistered) { setProbeUnregistered(true); go("register"); return; }
      if (!r.ok) {
        setError("We couldn't send your code — email delivery isn't set up yet. Contact the operator.");
        return;
      }
      setCode("");
      // #122 — (re-)arm the resend clock. A RESEND lands here too, and because the
      // countdown is keyed on this timestamp it restarts rather than leaving the
      // old one running out underneath a freshly-sent code.
      setWaitStartedAt(Date.now());
      go("login");
    } catch (err) {
      setError(messageOf(err, t("login.err.sendCode")));
    }
  }

  /**
   * #122 — move between the three ways in, from any waiting state.
   *
   * `go()` clears the error and notice, which is what makes switching feel like a
   * fresh start rather than carrying the last method's failure across. Choosing
   * the code path SENDS one — a picker that navigates to a code screen without
   * mailing anything would leave the person waiting for a code nobody sent.
   */
  function pickMethod(m: SignInMethod) {
    if (m === "pin") { setPin(""); go("pin"); return; }
    if (m === "device") { go("waiting"); setWaitStartedAt(Date.now()); return; }
    void sendCode();
  }

  async function submitRegister(e?: FormEvent) {
    e?.preventDefault();
    const full = regName.trim();
    if (!full) return;
    setError(null);
    const { firstName, lastName } = splitDisplayName(full);
    try {
      const r = await register.mutateAsync({ firstName, lastName, email: cleanEmail });
      if (!r.ok) {
        setError("We couldn't send your code — email delivery isn't set up yet. Contact the operator.");
        return;
      }
      setCode("");
      go("login");
      setNotice(`We sent a 6-digit code to ${cleanEmail} — enter it to finish creating your account.`);
    } catch (err) {
      setError(messageOf(err, t("login.err.startRegistration")));
    }
  }

  async function verifyCode(codeStr: string) {
    if (verifyOtp.isPending) return;
    setError(null);
    try {
      const res = await verifyOtp.mutateAsync({ email: cleanEmail, code: codeStr.trim(), remember: 30 });
      if ((res as { pending?: boolean })?.pending) {
        utils.otpAuth.sessionApprovalStatus.reset();
        // #122 — approval is now a real, re-choosable option, and the wait has a clock.
        setApprovalPending(true);
        setWaitStartedAt(Date.now());
        go("waiting");
        return;
      }
      await utils.identity.whoami.invalidate();
      refresh();
    } catch (err) {
      setError(messageOf(err, t("login.err.badCode")));
    }
  }

  async function submitPin(e?: FormEvent) {
    e?.preventDefault();
    if (pin.length !== 4) return;
    setError(null);
    try {
      await loginWithPin.mutateAsync({ email: cleanEmail, pin, remember: 30 });
      await utils.identity.whoami.invalidate();
      refresh();
    } catch (err) {
      setError(messageOf(err, t("login.err.badPasscode")));
      setPin("");
    }
  }

  // The guest reveal must outlast `me` flipping truthy, exactly as
  // OnboardingGate handled it — the gate unmounts us the moment identity lands.
  if (reveal) {
    return (
      <MatrixReveal
        name={reveal.name}
        number={reveal.number}
        onDone={() => { setReveal(null); refresh(); }}
      />
    );
  }

  return (
    <div style={{ position: "relative", minHeight: "100dvh", background: T.bg, overflowX: "hidden" }}>
      <RelayBackground business={business} />
      <div
        className="relative mx-auto flex flex-col items-center"
        style={{ padding: "64px 20px 72px", maxWidth: 680, zIndex: 1 }}
      >
        {/* 1 — logo */}
        <div className="flex items-center gap-3">
          <span className="relative flex" style={{ width: 12, height: 12 }}>
            <span
              className="absolute inset-0 motion-safe:[animation:relayPing_2.4s_cubic-bezier(0,0,.2,1)_infinite]"
              style={{ borderRadius: 999, background: accent }}
            />
            <span style={{ width: 12, height: 12, borderRadius: 999, background: accent, position: "relative" }} />
          </span>
          <span
            style={{
              fontFamily: "'Space Grotesk', ui-sans-serif, system-ui", fontWeight: 700, fontSize: 36,
              letterSpacing: ".08em", color: T.text, textShadow: `0 0 24px ${accent}59`,
              transition: "text-shadow .5s",
            }}
          >
            RELAY
          </span>
        </div>

        {/* 2 — tagline. SHORTENED with the section's move: it used to end "…register
            your permanent six-digit ID", which the heading immediately below now
            says outright, and at 320px those three wrapped lines were height charged
            against reaching the card. */}
        <p style={{ color: T.muted, fontSize: 16, margin: "13px 0 18px", textAlign: "center" }}>
          Jump straight in as a guest — or register.
        </p>

        {/* 3 — SECURITY & IDENTITY, moved ABOVE the card (owner: "this one should be
            pushed up above the guest screen — put it somewhere spaced out so it
            appears there"). The point is that the six-digit idea should be on screen
            WHILE you enter as a guest, so the number you are handed a second later
            means something.

            Compact here on purpose: the full-height version would have pushed the
            card itself below the fold, which is the one thing this screen must not
            do. The two bullet cards it used to carry are GONE rather than moved,
            because every line in them is already said elsewhere on this screen — the
            guest ones by the note directly under the card, the registered ones by the
            tagline above and by the register step's own permanent-name warning. */}
        <IdentitySection accent={accent} />

        {/* 4 — auth card */}
        <AuthCard
          accent={accent}
          step={step}
          go={go}
          busy={busy}
          error={error}
          notice={notice}
          business={business}
          setBusiness={setBusiness}
          inputRef={inputRef}
          guestName={guestName} setGuestName={setGuestName} submitGuest={submitGuest}
          startGuestError={startGuestError?.message ?? null}
          email={email} setEmail={setEmail} emailOk={emailOk} submitEmail={submitEmail}
          probeUnregistered={probeUnregistered}
          sendCode={sendCode}
          numberHint={numberHint}
          probeHasPin={probeHasPin}
          approvalPending={approvalPending}
          pickMethod={pickMethod}
          waitStartedAt={waitStartedAt}
          regName={regName} setRegName={setRegName} submitRegister={submitRegister}
          code={code} setCode={setCode} verifyCode={verifyCode}
          pin={pin} setPin={setPin} submitPin={submitPin}
        />

        {/* 4 — guest-session note */}
        <p style={{ color: "#5f716c", fontSize: 12.5, marginTop: 14, textAlign: "center", maxWidth: 560 }}>
          {t("login.guestSessionNote")}
        </p>

        {/* Adopt-and-Retire recovery (v2.99.69) — not in the spec, but this is
            the only screen from which a returning guest can reclaim a number a
            browser close forgot. Restoring IS the primary action for them. */}
        <div className="w-full" style={{ maxWidth: 560 }}>
          <GuestRestore className="mt-4" onRestored={refresh} />
        </div>

        {/* 5 — live network */}
        <div className="w-full" style={{ maxWidth: 560 }}>
          <LiveNetwork accent={accent} />
        </div>

        {/* 6 — feature chips */}
        <div className="w-full" style={{ maxWidth: 560 }}>
          <p style={{ color: T.muted, fontSize: 14.5, textAlign: "center", marginTop: 34 }}>
            {t("login.oneLine")}
          </p>
          <div className="mt-3.5 flex flex-wrap justify-center gap-2.5">
            {[
              { icon: <Phone size={15} />, label: t("login.voice") },
              { icon: <Video size={15} />, label: t("login.video") },
              { icon: <MessageSquare size={15} />, label: t("login.chat") },
            ].map((c) => (
              <span
                key={c.label}
                style={{ ...glass(), borderRadius: 24, padding: "9px 16px", display: "inline-flex", alignItems: "center", gap: 8, color: T.text, fontSize: 14 }}
              >
                <span style={{ color: accent, display: "flex", transition: "color .5s" }}>{c.icon}</span>
                {c.label}
              </span>
            ))}
          </div>
        </div>

        {/* 8 — footer */}
        <div style={{ ...mono(10), color: T.faint3, marginTop: 46, textAlign: "center" }}>
          {t("login.footer")}
        </div>
      </div>
    </div>
  );
}

/* ── the card + its state machine ─────────────────────────────────────────── */

interface CardProps {
  accent: string; step: Step; go: (s: Step) => void; busy: boolean;
  error: string | null; notice: string | null;
  business: boolean; setBusiness: (v: boolean) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  guestName: string; setGuestName: (v: string) => void; submitGuest: (e?: FormEvent) => void;
  startGuestError: string | null;
  email: string; setEmail: (v: string) => void; emailOk: boolean; submitEmail: (e?: FormEvent) => void;
  probeUnregistered: boolean | null;
  sendCode: () => void;
  /** #121 — masked leading group of the resolved account's number, or null. */
  numberHint: string | null;
  /** #122 — method switching. */
  probeHasPin: boolean;
  approvalPending: boolean;
  pickMethod: (m: SignInMethod) => void;
  waitStartedAt: number | null;
  regName: string; setRegName: (v: string) => void; submitRegister: (e?: FormEvent) => void;
  code: string; setCode: (v: string) => void; verifyCode: (c: string) => void;
  pin: string; setPin: (v: string) => void; submitPin: (e?: FormEvent) => void;
}

function AuthCard(p: CardProps) {
  const t = useT();
  const { accent, step, go } = p;
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  return (
    <div
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTilt({
          x: ((e.clientY - r.top) / r.height - 0.5) * -3.6,
          y: ((e.clientX - r.left) / r.width - 0.5) * 3.6,
        });
      }}
      onMouseLeave={() => setTilt({ x: 0, y: 0 })}
      className="relative w-full"
      style={{
        maxWidth: 560, borderRadius: 26, padding: 26,
        background: "linear-gradient(180deg, rgba(255,255,255,.075), rgba(255,255,255,.02) 34%, rgba(14,20,22,.38))",
        backdropFilter: "blur(28px) saturate(165%)",
        WebkitBackdropFilter: "blur(28px) saturate(165%)",
        border: "1px solid rgba(255,255,255,.15)",
        boxShadow: "0 30px 90px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.22), inset 0 -1px 0 rgba(0,0,0,.3)",
        transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transition: "transform .18s",
      }}
    >
      {/* gloss overlay */}
      <span
        aria-hidden
        style={{
          position: "absolute", inset: 0, borderRadius: 26, pointerEvents: "none",
          background: "linear-gradient(168deg, rgba(255,255,255,.12), transparent 44%)",
          mixBlendMode: "screen",
        }}
      />
      <div className="relative">
        {step === "idle" && <IdleStep {...p} />}
        {step === "guest" && <GuestStep {...p} />}
        {step === "email" && <EmailStep {...p} />}
        {step === "choose" && <ChooseStep {...p} />}
        {step === "login" && <CodeStep {...p} />}
        {step === "register" && <RegisterStep {...p} />}
        {step === "pin" && <PinStep {...p} />}
        {step === "waiting" && <WaitingStep {...p} />}

        {p.error && <Notice tone="warn">{p.error}</Notice>}
        {p.notice && !p.error && <Notice>{p.notice}</Notice>}
        {step !== "idle" && (
          <BackLink
            accent={accent}
            onClick={() => go(step === "guest" || step === "email" ? "idle" : "email")}
            label={step === "guest" || step === "email" ? t("login.back") : t("login.backToEmail")}
          />
        )}
      </div>
      <span className="sr-only" data-testid="relay-login-step">{step}</span>
      {accent === T.gold && <span className="sr-only">business accent active</span>}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ ...mono(11), color: T.faint2, marginBottom: 12 }}>{children}</div>;
}

function IdleStep({ accent, go }: CardProps) {
  const t = useT();
  const opts = [
    { key: "guest" as const, icon: <User2 size={19} />, title: t("login.guest"), sub: t("login.guestSub") },
    { key: "email" as const, icon: <Mail size={19} />, title: t("login.registeredTitle"), sub: t("login.registeredSub") },
  ];
  return (
    <div style={{ animation: "relayFadeUp .35s both" }}>
      <Label>{t("login.chooseAccess")}</Label>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
        {opts.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => go(o.key)}
            style={{
              ...glass(), borderRadius: 16, padding: 18, textAlign: "left", cursor: "pointer",
              transition: "transform .18s, border-color .18s, background .18s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-3px)";
              e.currentTarget.style.borderColor = accent;
              e.currentTarget.style.background = `${accent}14`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.borderColor = "rgba(255,255,255,.12)";
              e.currentTarget.style.background = "linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.015))";
            }}
          >
            <span
              style={{
                width: 40, height: 40, borderRadius: 999, display: "grid", placeItems: "center",
                background: `${accent}1f`, color: accent, marginBottom: 12, transition: "background .5s, color .5s",
              }}
            >
              {o.icon}
            </span>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{o.title}</div>
            <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>{o.sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function GuestStep(p: CardProps) {
  const t = useT();
  return (
    <form onSubmit={p.submitGuest} style={{ animation: "relayFadeUp .35s both" }}>
      {/* #120 — the owner asked for the FULL name here, because the name is what a
          guest is known by everywhere and it cannot be edited later on this path.
          The label says so rather than leaving "display name" to be interpreted. */}
      <Label>{t("login.guestLabel")}</Label>
      <Field
        ref={p.inputRef}
        accent={p.accent}
        value={p.guestName}
        onChange={(e) => p.setGuestName(e.target.value)}
        placeholder={t("login.fullNamePlaceholder")}
        aria-label={t("login.fullName")}
        autoComplete="name"
        maxLength={40}
      />
      <p style={{ color: T.faint, fontSize: 12.5, margin: "10px 0 0", lineHeight: 1.55 }}>
        {t("login.guestNote")}
      </p>
      <div className="mt-3.5">
        <Cta accent={p.accent} disabled={!p.guestName.trim() || p.busy} type="submit">
          {p.busy ? t("login.reservingNumber") : t("login.guestCta")}
        </Cta>
      </div>
      {p.startGuestError && <Notice tone="warn">{p.startGuestError}</Notice>}
    </form>
  );
}

function EmailStep(p: CardProps) {
  const t = useT();
  return (
    <form onSubmit={p.submitEmail} style={{ animation: "relayFadeUp .35s both" }}>
      <Label>{t("login.emailLabel")}</Label>
      <Field
        ref={p.inputRef}
        accent={p.accent}
        type="email"
        inputMode="email"
        autoComplete="email"
        value={p.email}
        onChange={(e) => p.setEmail(e.target.value)}
        placeholder="you@example.com"
        aria-label={t("login.emailAria")}
      />
      <div style={{ ...mono(11), color: T.faint2, margin: "18px 0 10px" }}>{t("login.accountType")}</div>
      <div
        style={{
          padding: 5, background: "rgba(0,0,0,.3)", borderRadius: 13,
          border: "1px solid rgba(255,255,255,.08)", boxShadow: "inset 0 1px 3px rgba(0,0,0,.35)",
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5,
        }}
      >
        {([
          { k: false, label: t("login.private") },
          { k: true, label: t("login.business") },
        ] as const).map((seg) => {
          const on = p.business === seg.k;
          return (
            <button
              key={seg.label}
              type="button"
              onClick={() => p.setBusiness(seg.k)}
              aria-pressed={on}
              style={{
                borderRadius: 9, padding: "9px 10px", fontSize: 14, cursor: "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
                transition: "background .3s, border-color .3s, color .3s",
                ...(on
                  ? {
                      background: `linear-gradient(180deg,${p.accent}30,${p.accent}14)`,
                      border: `1px solid ${p.accent}88`, color: "#fdfffe",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,.22)",
                    }
                  : { background: "transparent", border: "1px solid transparent", color: "#93a5a0" }),
              }}
            >
              {seg.label}
              {seg.k && (
                <span style={{ ...mono(9, ".14em"), color: T.gold, border: `1px solid ${T.gold}66`, borderRadius: 999, padding: "2px 6px" }}>
                  {t("login.soon")}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {p.business ? (
        <div className="mt-4">
          <Panel accent={T.gold}>
            <div style={{ ...mono(10.5, ".22em"), color: T.gold, marginBottom: 8 }}>{t("login.comingSoon")}</div>
            <p style={{ color: T.muted, fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
              {t("login.businessBlurb")}
            </p>
            <div className="mt-3.5">
              <Cta accent={T.gold} disabled>{t("login.businessCta")}</Cta>
            </div>
          </Panel>
        </div>
      ) : (
        <div className="mt-4">
          <Cta accent={p.accent} disabled={!p.emailOk || p.busy} type="submit">
            {p.busy ? t("login.checking") : t("login.continue")}
          </Cta>
        </div>
      )}
    </form>
  );
}

/**
 * #121 — YOUR NUMBER, echoed back the moment the email resolves (owner: "Once you put
 * your email ID, your number will automatically show up, even before you click log in.
 * So, we will know that this is your ID and your number").
 *
 * THIS IS ITS OWN COMPONENT BECAUSE IT HAS TO APPEAR ON EVERY POST-EMAIL STEP, AND THAT
 * IS WHERE THE ORIGINAL MISS WAS. It only ever rendered inside `choose` — and
 * `submitEmail` deliberately SKIPS `choose` for an account that has a passcode, going
 * straight to `pin` because that is the fastest real path. So the one group of people the
 * owner most obviously meant — a returning user with a passcode — never saw their number
 * at all. One component, rendered from each step, is what makes that impossible to
 * forget again; a copy per step is how one of them comes to be left out.
 *
 * MASKED, and the narrowing is stated rather than left to be discovered: `loginProbe` is
 * reachable by anybody who knows an address, so printing all six digits here would build
 * an unauthenticated email → dialable-number lookup — somebody with your email could then
 * call you without ever having been given your number. The leading group confirms the
 * account, which is what recognition needs, and is not an address.
 */
function IdentityHint(p: { accent: string; email: string; numberHint: string | null; onChange?: () => void }) {
  const t = useT();
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: p.numberHint ? 10 : 0 }}>
        <span style={{ color: T.text, fontSize: 14.5 }}>
          <span style={{ color: p.accent }}>✓</span> {p.email.trim().toLowerCase()}
        </span>
        {p.onChange && (
          <button
            type="button" onClick={p.onChange}
            style={{ ...mono(10.5, ".18em"), color: T.faint2, background: "none", border: "none", cursor: "pointer" }}
          >
            {t("login.change")}
          </button>
        )}
      </div>
      {p.numberHint && (
        <div
          className="flex items-center justify-center gap-2.5"
          style={{
            borderRadius: 14, padding: "10px 12px",
            border: `1px solid ${p.accent}3d`, background: `${p.accent}0f`,
          }}
        >
          <span style={{ ...mono(10), color: T.faint2 }}>{t("login.yourRelayId")}</span>
          <span
            dir="ltr"
            style={{
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 19,
              color: T.bright, letterSpacing: ".06em", unicodeBidi: "isolate",
            }}
          >
            {p.numberHint}
          </span>
        </div>
      )}
    </div>
  );
}

function ChooseStep(p: CardProps) {
  const t = useT();
  const unreg = p.probeUnregistered === true;
  return (
    <div style={{ animation: "relayFadeUp .35s both" }}>
      {/* An UNREGISTERED address has no number to show, and the probe deliberately
          returns none — so the row degrades to the confirmed email alone rather than
          reserving space for a value that is never coming. */}
      <IdentityHint
        accent={p.accent}
        email={p.email}
        numberHint={unreg ? null : p.numberHint}
        onChange={() => p.go("email")}
      />
      {/* #121 — ONE way forward, never both. The owner asked that an address which
          already has an account say so and REFUSE to register: a Register button
          that is always going to be wrong is worse than no Register button (the
          v2.103.3 rule), and offering both is what let somebody pick the branch
          that cannot work. Until the probe answers, neither is asserted. */}
      {p.probeUnregistered === null ? (
        <Cta accent={p.accent} disabled onClick={() => {}}>
          {t("login.checkingAddress")}
        </Cta>
      ) : unreg ? (
        <Cta accent={p.accent} disabled={p.busy} onClick={() => p.go("register")}>
          {t("login.registerNew")}
        </Cta>
      ) : (
        <Cta accent={p.accent} disabled={p.busy} onClick={() => p.sendCode()}>
          {t("login.logIn")}
        </Cta>
      )}
      <p style={{ color: T.faint, fontSize: 12.5, marginTop: 12, textAlign: "center", lineHeight: 1.55 }}>
        {p.probeUnregistered === null
          ? t("login.chooseHintPending")
          : unreg
            ? t("login.chooseHintUnreg")
            : t("login.chooseHintExisting")}
      </p>
      {/* Switching method is available here too, not only once a wait has begun:
          somebody who knows they have a passcode should not have to send an email
          code first to be offered it. */}
      {!unreg && (
        <MethodPicker
          accent={p.accent}
          current="code"
          hasPin={p.probeHasPin}
          hasPending={p.approvalPending}
          onPick={p.pickMethod}
        />
      )}
    </div>
  );
}

function CodeBoxes({ value, accent }: { value: string; accent: string }) {
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const active = i === value.length;
        return (
          <div
            key={i}
            style={{
              width: 44, height: 54, borderRadius: 12, display: "grid", placeItems: "center",
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 22, color: T.bright,
              background: "rgba(255,255,255,.05)",
              border: `1px solid ${active ? accent : "rgba(255,255,255,.13)"}`,
              boxShadow: active ? `0 0 0 3px ${accent}24` : "inset 0 1px 2px rgba(0,0,0,.25)",
              transition: "border-color .18s, box-shadow .18s",
            }}
          >
            {value[i] ?? ""}
          </div>
        );
      })}
    </div>
  );
}

function CodeStep(p: CardProps) {
  const t = useT();
  const left = useCountdown(p.waitStartedAt, OTP_RESEND_SECONDS);
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (p.code.length === 6) p.verifyCode(p.code); }}
      style={{ animation: "relayFadeUp .35s both" }}
    >
      <Label>{t("login.codeLabel")}</Label>
      {/* The row names the address, so the sentence below it does not have to repeat it. */}
      <IdentityHint accent={p.accent} email={p.email} numberHint={p.numberHint} />
      <p style={{ color: T.muted, fontSize: 13.5, marginTop: -4, marginBottom: 14 }}>
        {t("login.codeSent")}
      </p>
      <div style={{ position: "relative" }}>
        <CodeBoxes value={p.code} accent={p.accent} />
        <input
          ref={p.inputRef}
          value={p.code}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            p.setCode(v);
            if (v.length === 6) p.verifyCode(v);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={t("login.codeAria")}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, border: "none", background: "transparent", color: "transparent", cursor: "pointer" }}
        />
      </div>
      <div className="mt-4">
        <Cta accent={p.accent} disabled={p.code.length !== 6 || p.busy} type="submit">
          {p.busy ? t("login.verifying") : t("login.verifySignIn")}
        </Cta>
      </div>
      {/* #122 — the countdown, then a real resend. Before it elapses the resend is
          absent rather than disabled, because a control that refuses for 30 seconds
          reads as broken; the seconds themselves say to wait. */}
      <ResendRow
        accent={p.accent}
        left={left}
        busy={p.busy}
        waiting={t("login.resendWait")}
        action={t("login.resendAction")}
        onAction={p.sendCode}
      />
      <MethodPicker
        accent={p.accent}
        current="code"
        hasPin={p.probeHasPin}
        hasPending={p.approvalPending}
        onPick={p.pickMethod}
      />
    </form>
  );
}

/**
 * #122 — "wait N seconds" followed by a retry, shared by the code and approval
 * waits so the two cannot come to phrase or time the same idea differently.
 */
function ResendRow({
  accent, left, busy, waiting, action, onAction,
}: {
  accent: string; left: number; busy: boolean;
  waiting: string; action: string; onAction: () => void;
}) {
  if (left > 0) {
    return (
      <p style={{ color: T.faint, fontSize: 12.5, marginTop: 12, textAlign: "center" }}>
        {waiting}{" "}
        <span style={{ fontFamily: "'IBM Plex Mono', ui-monospace, monospace", color: accent }}>
          {left}s
        </span>
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onAction}
      disabled={busy}
      className="mt-3 inline-flex w-full items-center justify-center gap-2"
      style={{
        borderRadius: 12, padding: "9px 12px", cursor: busy ? "default" : "pointer",
        background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.14)",
        color: T.text, fontSize: 13.5,
      }}
    >
      <RotateCw size={14} style={{ color: accent }} aria-hidden />
      {action}
    </button>
  );
}

function RegisterStep(p: CardProps) {
  const t = useT();
  return (
    <form onSubmit={p.submitRegister} style={{ animation: "relayFadeUp .35s both" }}>
      <Label>{t("login.permanentName")}</Label>
      <Field
        ref={p.inputRef}
        accent={p.accent}
        value={p.regName}
        onChange={(e) => p.setRegName(e.target.value)}
        placeholder={t("login.permanentPlaceholder")}
        aria-label={t("login.permanentAria")}
        maxLength={60}
      />
      <div
        className="mt-3 flex items-start gap-2.5 rounded-xl px-3.5 py-2.5"
        style={{ color: T.warning, border: `1px solid ${T.warning}3d`, background: `${T.warning}0f`, fontSize: 13 }}
      >
        <Lock size={14} style={{ marginTop: 2, flexShrink: 0 }} />
        {t("login.permanentWarning")}
      </div>
      <div className="mt-3.5">
        <Cta accent={p.accent} disabled={!p.regName.trim() || p.busy} type="submit">
          {p.busy ? t("login.creating") : t("login.createAccount")}
        </Cta>
      </div>
    </form>
  );
}

/** Not in the spec — preserved. A 4-digit passcode is the fastest real sign-in
 *  and dropping it would strand everyone who set one (see the header note). */
function PinStep(p: CardProps) {
  const t = useT();
  return (
    <form onSubmit={p.submitPin} style={{ animation: "relayFadeUp .35s both" }}>
      <Label>{t("login.passcodeLabel")}</Label>
      {/* This is the step the owner's ask was really about: a passcode account skips
          `choose` entirely, so before this the one group of people most likely to be
          returning never saw their own number. */}
      <IdentityHint
        accent={p.accent}
        email={p.email}
        numberHint={p.numberHint}
        onChange={() => p.go("email")}
      />
      <p style={{ color: T.muted, fontSize: 13.5, marginTop: -4, marginBottom: 14 }}>
        {t("login.passcodePrompt")}
      </p>
      <Field
        ref={p.inputRef}
        accent={p.accent}
        value={p.pin}
        onChange={(e) => p.setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
        inputMode="numeric"
        autoComplete="current-password"
        placeholder="••••"
        aria-label={t("login.passcodeAria")}
        style={{ letterSpacing: ".5em", textAlign: "center", fontFamily: "'IBM Plex Mono', ui-monospace, monospace" }}
      />
      <div className="mt-3.5">
        <Cta accent={p.accent} disabled={p.pin.length !== 4 || p.busy} type="submit">
          {p.busy ? t("login.checking") : t("login.unlock")}
        </Cta>
      </div>
      {/* The old one-way "email me a code instead" link is now one entry in the
          shared picker, so this step offers the same choices as every other. */}
      <MethodPicker
        accent={p.accent}
        current="pin"
        hasPin
        hasPending={p.approvalPending}
        onPick={p.pickMethod}
      />
    </form>
  );
}

/**
 * Not in the spec — preserved. New-device approval (v2.99.7), now with a clock and
 * a way out (#122).
 *
 * The failure this addresses is a real one: the approver device may simply be
 * closed, and before v2.99.19 #50 this screen had NO exit at all. It now counts
 * down, then offers to ask again, and the picker beside it means the person is
 * never stuck on the one method that is not working.
 */
function WaitingStep(p: CardProps) {
  const t = useT();
  const status = trpc.otpAuth.sessionApprovalStatus.useQuery(undefined, { refetchInterval: 2500 });
  const utils = trpc.useUtils();
  const left = useCountdown(p.waitStartedAt, APPROVAL_NUDGE_SECONDS);
  useEffect(() => {
    if (status.data?.status === "approved") { void utils.identity.whoami.invalidate(); }
  }, [status.data?.status, utils]);
  const declined = status.data?.status === "denied";
  return (
    <div style={{ animation: "relayFadeUp .35s both" }}>
      <Label>{declined ? t("login.approvalDeclined") : t("login.waitingApproval")}</Label>
      <IdentityHint accent={p.accent} email={p.email} numberHint={p.numberHint} />
      <Panel accent={p.accent}>
        <p style={{ color: T.muted, fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
          {declined ? t("login.declinedBody") : t("login.waitingBody")}
        </p>
      </Panel>
      {!declined && (
        <ResendRow
          accent={p.accent}
          left={left}
          busy={p.busy}
          waiting={t("login.approvalWait")}
          action={t("login.approvalAction")}
          // Re-sending the code re-creates the pending session, which is what makes
          // the other device prompt a second time; there is no separate "nudge".
          onAction={p.sendCode}
        />
      )}
      <MethodPicker
        accent={p.accent}
        current="device"
        hasPin={p.probeHasPin}
        hasPending
        onPick={p.pickMethod}
      />
      {!p.probeHasPin && (
        <p style={{ color: T.faint, fontSize: 12.5, marginTop: 12, textAlign: "center" }}>
          {t("login.passcodeNoApproval")}
        </p>
      )}
    </div>
  );
}
