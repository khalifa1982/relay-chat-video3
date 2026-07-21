import { APP_VERSION } from "@shared/version";
import { siteHost } from "@/lib/siteHost";

const ACCENT = "oklch(0.55 0.22 268)";
const PAGE_BG = "oklch(0.985 0.006 250)";

export default function PrivacyPolicy() {
  return (
    <div
      className="min-h-screen overflow-x-hidden relative font-sans selection:bg-[oklch(0.55_0.22_268)] selection:text-white"
      style={{ backgroundColor: PAGE_BG, color: "oklch(0.22 0.03 265)" }}
    >
      {/* Header — matches landing page */}
      <header className="fixed top-0 inset-x-0 h-20 z-50 flex items-center justify-between px-5 md:px-12 pointer-events-none">
        <a href="/" className="flex items-center gap-2.5 bg-white/70 backdrop-blur-md px-4 py-2 rounded-full border border-black/5 pointer-events-auto shadow-sm no-underline">
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: ACCENT, boxShadow: `0 0 10px ${ACCENT}` }}
          />
          <span className="font-extrabold tracking-[0.18em] text-sm" style={{ color: "oklch(0.25 0.04 265)" }}>
            RELAY
          </span>
        </a>
        <a
          href="/app"
          className="pointer-events-auto inline-flex items-center px-5 py-2.5 rounded-full text-xs font-bold text-white transition-all active:scale-[0.97] shadow-sm no-underline"
          style={{ backgroundColor: ACCENT, boxShadow: "0 8px 24px -6px oklch(0.55 0.22 268 / 0.6)" }}
        >
          Open RELAY →
        </a>
      </header>

      {/* Content */}
      <main className="pt-28 pb-16 px-5 md:px-12">
        <div className="max-w-3xl mx-auto">
          <span
            className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.22em] uppercase mb-4 px-3 py-1.5 rounded-full"
            style={{ color: ACCENT, backgroundColor: "oklch(0.55 0.22 268 / 0.10)" }}
          >
            Legal
          </span>
          <h1 className="text-3xl md:text-4xl font-extrabold mb-2" style={{ color: "oklch(0.22 0.03 265)" }}>
            Privacy Policy
          </h1>
          <p className="text-sm text-slate-500 mb-10">Last updated: July 5, 2026</p>

          <div className="space-y-8 text-[0.92rem] leading-[1.75] text-slate-600">
            <Section title="1. Introduction">
              <p>
                RELAY ("we", "us", or "our") operates the website at {siteHost()} and the RELAY web application
                (collectively, the "Service"). This Privacy Policy explains how we collect, use, and protect your
                information when you use our Service.
              </p>
              <p>
                RELAY is designed with privacy as a core principle. We believe communication should be private,
                secure, and free from surveillance. Our architecture reflects this commitment.
              </p>
            </Section>

            <Section title="2. Information We Collect">
              <p>We collect minimal information necessary to provide the Service:</p>
              <ul>
                <li><strong>6-Digit Number:</strong> A randomly generated identifier not linked to your real phone number, email, or identity.</li>
                <li><strong>Display Name:</strong> A name you choose to show during calls and chats. It does not need to be your real name.</li>
                <li><strong>Optional Email:</strong> If you choose to create a persistent account, you may provide an email for account recovery only.</li>
                <li><strong>Call Metadata:</strong> Basic call records (caller, recipient, duration, timestamp) stored locally for your call history.</li>
                <li><strong>Messages:</strong> Text messages and attachments sent through RELAY, associated with your 6-digit number only.</li>
              </ul>
            </Section>

            <Section title="3. Information We Do NOT Collect">
              <ul>
                <li>Your real phone number</li>
                <li>Your physical address or location</li>
                <li>Your contacts or address book</li>
                <li>Device identifiers or advertising IDs</li>
                <li>Browsing history outside of RELAY</li>
                <li>Audio or video content of your calls (calls are peer-to-peer)</li>
              </ul>
            </Section>

            <Section title="4. How We Use Your Information">
              <p>The limited information we collect is used exclusively to:</p>
              <ul>
                <li>Provide and maintain the Service (connecting calls, delivering messages)</li>
                <li>Display your chosen name to people you communicate with</li>
                <li>Show your call history and message threads within the app</li>
                <li>Send account recovery emails (only if you opted into email-based accounts)</li>
                <li>Improve the reliability and performance of the Service</li>
              </ul>
            </Section>

            <Section title="5. Peer-to-Peer Architecture">
              <p>RELAY uses WebRTC peer-to-peer technology for voice and video calls. This means:</p>
              <ul>
                <li>Audio and video streams flow directly between participants' browsers</li>
                <li>We do not record, store, or have access to the content of your calls</li>
                <li>Call signaling passes through our servers, but media does not</li>
                <li>TURN relay servers may be used when direct connections are blocked, but they do not store any media</li>
              </ul>
            </Section>

            <Section title="6. Data Storage and Security">
              <p>We implement appropriate technical and organizational measures to protect your data:</p>
              <ul>
                <li>All connections use TLS encryption (HTTPS)</li>
                <li>WebRTC media streams are encrypted end-to-end using DTLS-SRTP</li>
                <li>Session cookies are HttpOnly and Secure</li>
                <li>Guest sessions are session-only — wiped when you close your browser (a 30-day row TTL is the server-side backstop)</li>
                <li>We do not sell, rent, or share your data with advertisers or data brokers</li>
              </ul>
            </Section>

            <Section title="7. Third-Party Services">
              <p>RELAY uses the following third-party infrastructure services:</p>
              <ul>
                <li><strong>TURN/STUN servers:</strong> For establishing peer-to-peer connections when direct connections are blocked. These relay encrypted media temporarily and do not store it.</li>
                <li><strong>Cloud hosting:</strong> Our signaling servers run on cloud infrastructure with industry-standard security.</li>
              </ul>
              <p>We do not integrate any third-party analytics, advertising, or tracking services.</p>
            </Section>

            <Section title="8. Cookies">
              <p>RELAY uses only essential cookies required for the Service to function:</p>
              <ul>
                <li><strong>Session cookie:</strong> Maintains your login state (HttpOnly, Secure, SameSite)</li>
                <li><strong>Guest cookie:</strong> Identifies your guest session so you can receive calls</li>
              </ul>
              <p>We do not use tracking cookies, advertising cookies, or any third-party cookies.</p>
            </Section>

            <Section title="9. Your Rights">
              <p>You have the right to:</p>
              <ul>
                <li>Use the Service without providing any real personal information</li>
                <li>Delete your account and all associated data at any time</li>
                <li>Clear your local call history and message threads</li>
                <li>Request information about what data we hold about your 6-digit number</li>
              </ul>
            </Section>

            <Section title="10. Children's Privacy">
              <p>
                RELAY is not directed at children under 13 years of age. We do not knowingly collect
                information from children under 13. If you believe a child has provided us with personal
                information, please contact us and we will delete it.
              </p>
            </Section>

            <Section title="11. Changes to This Policy">
              <p>
                We may update this Privacy Policy from time to time. Changes will be posted on this page
                with an updated "Last updated" date. Your continued use of the Service after changes
                constitutes acceptance of the updated policy.
              </p>
            </Section>

            <Section title="12. Contact Us">
              <p>
                If you have questions about this Privacy Policy or our privacy practices, you can reach us
                through the RELAY application or by visiting our website at{" "}
                <a href="/" className="font-semibold no-underline hover:underline" style={{ color: ACCENT }}>
                  {siteHost()}
                </a>.
              </p>
            </Section>
          </div>
        </div>
      </main>

      {/* Footer — matches landing page */}
      <footer className="relative z-10 border-t border-black/5 px-6 py-10">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-start">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ACCENT, boxShadow: `0 0 10px ${ACCENT}` }} />
            <div>
              <div className="font-extrabold tracking-[0.16em] text-sm" style={{ color: "oklch(0.25 0.04 265)" }}>RELAY</div>
              <div className="text-xs text-slate-500">RELAY - Private Browser Calls</div>
            </div>
          </div>
          <div className="text-xs text-slate-400 flex flex-col md:items-end gap-1">
            <a href="/technology" className="font-semibold transition-colors hover:text-slate-700 no-underline" style={{ color: ACCENT }}>
              The technology behind RELAY →
            </a>
            <span>© 2026 RELAY. All rights reserved. Peer-to-peer, secure, and instant.</span>
            <span>v{APP_VERSION}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Section helper — keeps the main body DRY */
/* ---------------------------------------------------------------- */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-bold mb-3" style={{ color: "oklch(0.22 0.03 265)" }}>{title}</h2>
      <div className="space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_li]:text-slate-600 [&_strong]:text-slate-800">
        {children}
      </div>
    </section>
  );
}
