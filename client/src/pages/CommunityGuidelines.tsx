import { siteHost, siteEmail } from "@/lib/siteHost";

/**
 * Community Guidelines + acceptable-use terms (v2.107.54).
 *
 * This page exists to satisfy App Store Review Guideline 1.2 (user-generated
 * content): the app must have terms the user agrees to that state a NO-TOLERANCE
 * policy for objectionable content and abusive users, and must tell people how to
 * report, how to block, and that the operator acts on reports within 24 hours. The
 * guest sign-up gate links here and requires ticking "I agree" before an account is
 * created, so this is the agreed-to document — keep the plain-language promises here
 * in step with what the app actually does (report = MessageMenu → Report; block =
 * the contact block control; removal = unsend / admin-remove).
 */
const ACCENT = "oklch(0.55 0.22 268)";
const PAGE_BG = "oklch(0.985 0.006 250)";

export default function CommunityGuidelines() {
  const host = siteHost();
  const reportEmail = siteEmail("report");
  return (
    <div
      className="min-h-screen overflow-x-hidden relative font-sans selection:bg-[oklch(0.55_0.22_268)] selection:text-white"
      style={{ backgroundColor: PAGE_BG, color: "oklch(0.22 0.03 265)" }}
    >
      <header className="fixed top-0 inset-x-0 h-20 z-50 flex items-center justify-between px-5 md:px-12 pointer-events-none">
        <a href="/" className="flex items-center gap-2.5 bg-white/70 backdrop-blur-md px-4 py-2 rounded-full border border-black/5 pointer-events-auto shadow-sm no-underline">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ACCENT, boxShadow: `0 0 10px ${ACCENT}` }} />
          <span className="font-extrabold tracking-[0.18em] text-sm" style={{ color: "oklch(0.25 0.04 265)" }}>RELAY</span>
        </a>
        <a
          href="/app"
          className="pointer-events-auto inline-flex items-center px-5 py-2.5 rounded-full text-xs font-bold text-white transition-all active:scale-[0.97] shadow-sm no-underline"
          style={{ backgroundColor: ACCENT, boxShadow: "0 8px 24px -6px oklch(0.55 0.22 268 / 0.6)" }}
        >
          Open RELAY →
        </a>
      </header>

      <main className="pt-28 pb-16 px-5 md:px-12">
        <div className="max-w-3xl mx-auto">
          <span
            className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.22em] uppercase mb-4 px-3 py-1.5 rounded-full"
            style={{ color: ACCENT, backgroundColor: "oklch(0.55 0.22 268 / 0.10)" }}
          >
            Terms
          </span>
          <h1 className="text-3xl md:text-4xl font-extrabold mb-2" style={{ color: "oklch(0.22 0.03 265)" }}>
            Community Guidelines &amp; Acceptable Use
          </h1>
          <p className="text-sm text-slate-500 mb-10">Last updated: August 7, 2026</p>

          <div className="space-y-8 text-[0.92rem] leading-[1.75] text-slate-600">
            {/* The no-tolerance clause, first and unmissable — this is the sentence
                Guideline 1.2 requires the user to agree to. */}
            <div
              className="rounded-2xl p-5 border"
              style={{ backgroundColor: "oklch(0.55 0.22 268 / 0.06)", borderColor: "oklch(0.55 0.22 268 / 0.25)" }}
            >
              <p className="font-semibold text-slate-800 m-0">
                RELAY has zero tolerance for objectionable content and abusive behaviour.
              </p>
              <p className="m-0 mt-2">
                By creating an account you agree to these guidelines. Content or conduct that
                breaks them is removed, and accounts that post it are ejected — see “How we
                enforce” below. There are no warnings for the most serious categories.
              </p>
            </div>

            <Section title="1. What is not allowed">
              <p>You may not use RELAY to create, send, post, or share any of the following:</p>
              <ul>
                <li><strong>Sexual content involving minors</strong>, or any content that sexualises, grooms, endangers, or exploits a child. This is reported to the authorities.</li>
                <li><strong>Harassment, bullying, threats, or stalking</strong> of any person.</li>
                <li><strong>Hate speech</strong> — attacks on people based on race, ethnicity, national origin, religion, disability, gender, age, sexual orientation, or gender identity.</li>
                <li><strong>Violent, graphic, or gory content</strong>, or content that incites or glorifies violence.</li>
                <li><strong>Non-consensual sexual content</strong>, or sexual content shared without the consent of everyone in it.</li>
                <li><strong>Content promoting self-harm, suicide, or dangerous acts.</strong></li>
                <li><strong>Spam, scams, fraud, or impersonation.</strong></li>
                <li>Anything illegal, or that infringes someone else’s rights.</li>
              </ul>
            </Section>

            <Section title="2. Report objectionable content">
              <p>
                Every message carries a report control. Open the message’s menu (the ⋮ button)
                and choose <strong>Report</strong>, then pick a reason. Reports reach our team
                directly. You can also email us at{" "}
                <a href={`mailto:${reportEmail}`} style={{ color: ACCENT, textDecoration: "underline" }} dir="ltr">{reportEmail}</a>{" "}
                to report inappropriate content or behaviour, including anything you encounter
                outside a single message.
              </p>
            </Section>

            <Section title="3. Block abusive users">
              <p>
                You can block anyone. Open their profile or contact entry and choose
                <strong> Block</strong>: a blocked person can no longer call you or message you,
                and cannot see you. You can unblock later from the same place.
              </p>
            </Section>

            <Section title="4. Remove your own content">
              <p>
                You control what you post. Open any message you sent and choose
                <strong> Unsend</strong> to remove it for everyone. In a group, an admin can
                also remove a member’s message for everyone.
              </p>
            </Section>

            <Section title="5. How we enforce">
              <p>
                We act on reports of objectionable content <strong>within 24 hours</strong>. When
                a report is upheld we remove the offending content and eject the account that
                posted it. Serious violations — sexual content involving minors, credible threats
                of violence — are removed immediately and may be referred to law enforcement.
              </p>
            </Section>

            <Section title="6. Contact us">
              <p>
                To report inappropriate activity, or for any question about these guidelines,
                email{" "}
                <a href={`mailto:${reportEmail}`} style={{ color: ACCENT, textDecoration: "underline" }} dir="ltr">{reportEmail}</a>.
                General support is at{" "}
                <a href={`mailto:${siteEmail("support")}`} style={{ color: ACCENT, textDecoration: "underline" }} dir="ltr">{siteEmail("support")}</a>.
                RELAY operates the service at {host}.
              </p>
            </Section>
          </div>

          <div className="mt-12 pt-6 border-t border-black/5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
            <a href="/" className="no-underline hover:text-slate-600">Home</a>
            <a href="/privacy-policy" className="no-underline hover:text-slate-600">Privacy Policy</a>
            <a href="/app" className="no-underline hover:text-slate-600">Open RELAY</a>
          </div>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-bold mb-3" style={{ color: "oklch(0.22 0.03 265)" }}>{title}</h2>
      <div className="space-y-3 [&_ul]:list-disc [&_ul]:ps-5 [&_ul]:space-y-1.5 [&_li]:text-slate-600 [&_strong]:text-slate-800">
        {children}
      </div>
    </section>
  );
}
