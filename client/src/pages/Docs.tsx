import { useEffect, useState } from "react";
import { Streamdown } from "streamdown";

/**
 * Renders the bundled `RELAY-README.md` (the original deployment notes
 * shipped in `relay-server.zip`) so users can read the production
 * deploy/TURN/firewall guidance without leaving the site.
 */
export default function Docs() {
  const [md, setMd] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    fetch("/RELAY-README.md")
      .then(r => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setMd)
      .catch(e => setErr(e.message || "Failed to load docs"));
  }, []);

  return (
    <div className="min-h-screen bg-[#08090C] text-[#EAEEF2] [font-family:'Hanken_Grotesk',ui-sans-serif,system-ui,sans-serif]">
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-6">
        <a
          href="/"
          className="flex items-center gap-2 text-base font-extrabold tracking-tight [font-family:'Bricolage_Grotesque',ui-sans-serif]">
          <span className="h-3 w-3 rounded-full bg-gradient-to-br from-[#3FE0C5] to-[#6EE7FF] shadow-[0_0_18px_rgba(63,224,197,0.7)]" />
          RELAY
        </a>
        <div className="flex items-center gap-3 text-sm">
          <a href="/" className="text-[#8A93A2] transition hover:text-white">
            Home
          </a>
          <a
            href="/app"
            className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 font-semibold text-white transition hover:border-[#3FE0C5]/60 hover:text-[#3FE0C5]">
            Open the app
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-6 pb-24">
        <h1 className="mb-2 text-3xl font-extrabold tracking-tight [font-family:'Bricolage_Grotesque',ui-sans-serif] md:text-4xl">
          Deployment &amp; operator notes
        </h1>
        <p className="mb-8 text-sm text-[#8A93A2]">
          The original{" "}
          <code className="rounded bg-white/5 px-1.5 py-0.5 [font-family:'JetBrains_Mono',ui-monospace] text-[#3FE0C5]">
            README.md
          </code>{" "}
          shipped with{" "}
          <code className="rounded bg-white/5 px-1.5 py-0.5 [font-family:'JetBrains_Mono',ui-monospace] text-[#3FE0C5]">
            relay-server.zip
          </code>
          . Useful if you want to enable TURN, run your own coturn relay,
          or move off this Manus deployment.
        </p>

        <article className="prose prose-invert max-w-none rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8 [&_a]:text-[#6EE7FF] [&_code]:rounded [&_code]:bg-white/5 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:[font-family:'JetBrains_Mono',ui-monospace] [&_h1]:[font-family:'Bricolage_Grotesque',ui-sans-serif] [&_h2]:[font-family:'Bricolage_Grotesque',ui-sans-serif] [&_h3]:[font-family:'Bricolage_Grotesque',ui-sans-serif] [&_pre]:bg-[#0E1014] [&_pre]:border [&_pre]:border-white/10">
          {md == null && err == null && (
            <p className="text-[#8A93A2]">Loading…</p>
          )}
          {err && (
            <p className="text-[#FF5C72]">
              Couldn't load the docs: {err}. You can also{" "}
              <a className="underline" href="/RELAY-README.md">
                download the raw README
              </a>
              .
            </p>
          )}
          {md && <Streamdown>{md}</Streamdown>}
        </article>
      </main>
    </div>
  );
}
