import { useEffect } from "react";

/**
 * RELAY landing page — visual story and call-to-action that drops people
 * into the actual calling app at `/app`. The calling UI itself is the
 * original `client/public/relay/index.html` served straight from the
 * Express layer (kept verbatim to preserve the WebRTC code paths the
 * user already verified end-to-end).
 */
export default function Home() {
  // Lock dark theme for the landing page so the brand palette renders correctly.
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!had) root.classList.remove("dark");
    };
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#08090C] text-[#EAEEF2] [font-family:'Hanken_Grotesk',ui-sans-serif,system-ui,sans-serif]">
      <BackgroundFx />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Brand />
        <nav className="flex items-center gap-3 text-sm text-[#8A93A2]">
          <a
            href="#how"
            className="hidden rounded-lg px-3 py-2 transition hover:text-white sm:inline-block">
            How it works
          </a>
          <a
            href="#privacy"
            className="hidden rounded-lg px-3 py-2 transition hover:text-white sm:inline-block">
            Privacy
          </a>
          <a
            href="/docs"
            className="hidden rounded-lg px-3 py-2 transition hover:text-white sm:inline-block">
            Docs
          </a>
          <a
            href="/app"
            className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 font-semibold text-white transition hover:border-[#3FE0C5]/60 hover:text-[#3FE0C5]">
            Open the app
          </a>
        </nav>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6">
        {/* Hero */}
        <section className="grid items-center gap-10 py-12 md:grid-cols-[1.1fr_0.9fr] md:py-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[#8A93A2]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3FE0C5] shadow-[0_0_10px_#3FE0C5]" />
              Live calling, in your browser
            </span>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight [font-family:'Bricolage_Grotesque',ui-sans-serif] sm:text-5xl md:text-6xl">
              Pick a name. Get a number.{" "}
              <span className="bg-gradient-to-br from-[#3FE0C5] to-[#6EE7FF] bg-clip-text text-transparent">
                Dial anyone.
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-[#A6AEBA] md:text-lg">
              RELAY is a self-hosted browser caller. Voice, video, and chat ride
              over native WebRTC — peer-to-peer between browsers, with this
              server only doing call setup. Up to six people in one call, no
              installs, no accounts.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="/app"
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#3FE0C5] to-[#6EE7FF] px-6 py-4 text-base font-bold text-[#04201B] shadow-[0_14px_40px_-14px_rgba(63,224,197,0.7)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_50px_-14px_rgba(63,224,197,0.85)] [font-family:'Bricolage_Grotesque',ui-sans-serif]">
                <PhoneIcon className="h-5 w-5" />
                Launch RELAY
              </a>
              <a
                href="#how"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-4 text-base font-semibold text-white transition hover:border-white/20 [font-family:'Bricolage_Grotesque',ui-sans-serif]">
                See how it works
              </a>
            </div>
            <p className="mt-5 text-xs text-[#5A6271]">
              Browsers grant camera and microphone access only on secure origins.
              Allow permissions when prompted.
            </p>
          </div>

          <HeroPreview />
        </section>

        {/* Feature row */}
        <section
          id="how"
          className="grid grid-cols-1 gap-4 pb-12 sm:grid-cols-2 lg:grid-cols-3 lg:pb-20">
          <FeatureCard
            title="Six-up video mesh"
            body="Every participant sends their stream straight to every other browser. Low latency, no media server in the path."
            icon={<UsersIcon className="h-5 w-5" />}
          />
          <FeatureCard
            title="Built-in chat"
            body="A WebRTC data channel rides on the same connection. Messages go peer-to-peer like the audio and video do."
            icon={<ChatIcon className="h-5 w-5" />}
          />
          <FeatureCard
            title="Numbers, not rooms"
            body="Register a name, get a 6-digit number. Share the number, dial anyone — no link wrangling, no scheduling."
            icon={<HashIcon className="h-5 w-5" />}
          />
          <FeatureCard
            title="Server is just signaling"
            body="The server brokers introductions and is authoritative about room membership, then steps out of the media path."
            icon={<ServerIcon className="h-5 w-5" />}
          />
          <FeatureCard
            title="Ephemeral by design"
            body="Numbers are issued on registration and released on disconnect. Nothing about your call is stored."
            icon={<SparkleIcon className="h-5 w-5" />}
          />
          <FeatureCard
            title="HTTPS &amp; STUN, ready"
            body="Hosted on Manus with HTTPS and a real WebSocket gateway. Public STUN gets most networks through; add TURN for the strict-NAT tail."
            icon={<ShieldIcon className="h-5 w-5" />}
          />
        </section>

        {/* How */}
        <section className="grid grid-cols-1 gap-6 pb-12 md:grid-cols-3">
          <Step
            n="1"
            title="Open the app"
            body="Click Launch. Pick a display name. The server hands back a 6-digit number that's yours for the session."
          />
          <Step
            n="2"
            title="Share your number"
            body="Send your 6 digits to anyone — text, email, sticky note. They can pick their own name and get their own number too."
          />
          <Step
            n="3"
            title="Dial &amp; talk"
            body="Type their number, press Call. They accept, your browsers connect directly, and audio, video, and chat flow."
          />
        </section>

        {/* Privacy / hosting note */}
        <section
          id="privacy"
          className="mb-16 grid grid-cols-1 gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-8 md:grid-cols-[0.6fr_1fr] md:p-10">
          <div>
            <h2 className="text-2xl font-bold tracking-tight [font-family:'Bricolage_Grotesque',ui-sans-serif] md:text-3xl">
              The honest version
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#A6AEBA]">
              You should know what's happening on the wire.
            </p>
          </div>
          <div className="space-y-4 text-sm leading-relaxed text-[#A6AEBA]">
            <p>
              <span className="font-semibold text-white">Media is peer-to-peer.</span>{" "}
              Audio, video, and the chat data channel travel directly between
              participants' browsers via native WebRTC. The server only relays
              connection setup messages.
            </p>
            <p>
              <span className="font-semibold text-white">State is in-memory.</span>{" "}
              Numbers and rooms live for the lifetime of the WebSocket
              connection. Restarting the server drops active calls and frees
              all numbers.
            </p>
            <p>
              <span className="font-semibold text-white">TURN is optional.</span>{" "}
              This deployment uses public STUN, which works for the vast
              majority of home, office, and mobile networks. Strict-NAT
              networks (some corporate firewalls, some carriers) can be
              supported by running a coturn relay separately and pointing
              this app at it via two environment variables.
            </p>
          </div>
        </section>

        <section className="mb-20 flex flex-col items-center gap-5 rounded-3xl border border-white/10 bg-gradient-to-br from-[#3FE0C5]/[0.06] to-[#6EE7FF]/[0.04] px-6 py-12 text-center">
          <h2 className="text-3xl font-extrabold tracking-tight [font-family:'Bricolage_Grotesque',ui-sans-serif] md:text-4xl">
            Ready when you are.
          </h2>
          <p className="max-w-md text-sm text-[#A6AEBA]">
            One click and you'll have a number anyone can dial. No sign-up.
          </p>
          <a
            href="/app"
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#3FE0C5] to-[#6EE7FF] px-7 py-4 text-base font-bold text-[#04201B] shadow-[0_14px_40px_-14px_rgba(63,224,197,0.7)] transition hover:-translate-y-0.5 [font-family:'Bricolage_Grotesque',ui-sans-serif]">
            <PhoneIcon className="h-5 w-5" />
            Launch RELAY
          </a>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/5">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 text-xs text-[#5A6271] sm:flex-row">
          <Brand small />
          <p>Self-hosted on Manus. Browser-to-browser calling, end-to-end encrypted by WebRTC.</p>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                         */
/* ------------------------------------------------------------------ */

function Brand({ small }: { small?: boolean } = {}) {
  return (
    <div
      className={
        "flex items-center gap-2 [font-family:'Bricolage_Grotesque',ui-sans-serif] font-extrabold tracking-tight " +
        (small ? "text-base" : "text-xl")
      }>
      <span className="relative inline-block h-3 w-3 rounded-full bg-gradient-to-br from-[#3FE0C5] to-[#6EE7FF] shadow-[0_0_18px_rgba(63,224,197,0.7)]">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#3FE0C5]/60" />
      </span>
      RELAY
    </div>
  );
}

function FeatureCard({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-[#3FE0C5]/30 hover:bg-white/[0.05]">
      <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#3FE0C5]/10 text-[#3FE0C5]">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-white [font-family:'Bricolage_Grotesque',ui-sans-serif]">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-[#A6AEBA]">{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#3FE0C5]/40 bg-[#3FE0C5]/10 text-sm font-bold text-[#3FE0C5] [font-family:'JetBrains_Mono',ui-monospace]">
        {n}
      </div>
      <h3 className="text-lg font-semibold [font-family:'Bricolage_Grotesque',ui-sans-serif]">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-[#A6AEBA]">{body}</p>
    </div>
  );
}

/* Decorative phone-mockup card on the right side of the hero. */
function HeroPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-[#3FE0C5]/20 to-[#6EE7FF]/10 blur-2xl" />
      <div className="rounded-3xl border border-white/10 bg-[#14171D]/90 p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur">
        <div className="flex items-center justify-between">
          <Brand />
          <span className="rounded-md bg-[#3FE0C5]/15 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-[#3FE0C5]">
            Live
          </span>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          {["KS", "AM", "JR", "TY"].map((init, i) => (
            <div
              key={init}
              className={
                "relative aspect-[4/3] overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br " +
                (i % 2 === 0
                  ? "from-[#1B1F27] to-[#0E1014]"
                  : "from-[#0E1014] to-[#1B1F27]")
              }>
              <div className="absolute inset-0 grid place-items-center text-2xl font-extrabold tracking-tight text-[#3FE0C5] [font-family:'Bricolage_Grotesque',ui-sans-serif]">
                {init}
              </div>
              <div className="absolute bottom-2 left-2 rounded-md bg-black/50 px-2 py-0.5 text-[10px] font-semibold backdrop-blur">
                {["You", "Aman", "Jared", "Tara"][i]}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-xl border border-white/10 bg-[#0E1014] p-3 text-xs text-[#A6AEBA]">
          <div className="flex items-center justify-between">
            <span>Dial</span>
            <span className="rounded bg-white/5 px-2 py-0.5 [font-family:'JetBrains_Mono',ui-monospace] text-[#EAEEF2]">
              482 015
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded bg-[#3FE0C5]/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[#3FE0C5]">
              Ringing
            </span>
            <span className="text-[#5A6271]">peer-to-peer · WebRTC</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BackgroundFx() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 [background:radial-gradient(50%_40%_at_18%_12%,rgba(63,224,197,0.12),transparent_60%),radial-gradient(45%_40%_at_85%_88%,rgba(110,231,255,0.10),transparent_60%)]" />
      <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:46px_46px] [mask-image:radial-gradient(circle_at_50%_30%,black,transparent_75%)]" />
    </div>
  );
}

/* ----- inline icons (no external deps) ----- */
function PhoneIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.3 1l-2.2 2.2
z" />
    </svg>
  );
}
function UsersIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.7 0-8 1.3-8 4v3h10v-3c0-1 .4-1.9 1-2.6A14 14 0 0 0 8 13zm8 0a14 14 0 0 0-2.5.2A5.6 5.6 0 0 1 15 17v3h9v-3c0-2.7-5.3-4-8-4z" />
    </svg>
  );
}
function ChatIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1z" />
    </svg>
  );
}
function HashIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden {...props}>
      <path d="M4 9h16M4 15h16M10 3l-2 18M16 3l-2 18" />
    </svg>
  );
}
function ServerIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden {...props}>
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <path d="M7 7h.01M7 17h.01" />
    </svg>
  );
}
function SparkleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6z" />
      <path d="M19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7z" />
    </svg>
  );
}
function ShieldIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 2l8 3v6c0 5-3.5 9.4-8 11-4.5-1.6-8-6-8-11V5l8-3z" />
    </svg>
  );
}
