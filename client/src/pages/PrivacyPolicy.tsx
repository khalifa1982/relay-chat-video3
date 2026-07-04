import { APP_VERSION } from "@shared/version";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white text-slate-800">
      {/* Header */}
      <header className="border-b border-slate-100 sticky top-0 bg-white/95 backdrop-blur-sm z-50">
        <div className="container max-w-4xl flex items-center justify-between py-4">
          <a href="/" className="flex items-center gap-2 text-slate-900 font-semibold text-lg hover:opacity-80 transition-opacity">
            <span className="size-2.5 rounded-full bg-[#4f6ef7]" />
            RELAY
          </a>
          <a
            href="/app"
            className="text-sm font-medium px-4 py-2 rounded-full bg-[#4f6ef7] text-white hover:bg-[#3b5ae0] transition-colors"
          >
            Open RELAY
          </a>
        </div>
      </header>

      {/* Content */}
      <main className="container max-w-4xl py-12 md:py-16">
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-slate-500 mb-10">Last updated: July 5, 2026</p>

        <div className="prose prose-slate max-w-none space-y-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h2]:mt-10 [&_h2]:mb-3 [&_p]:leading-relaxed [&_ul]:space-y-2 [&_li]:leading-relaxed">
          <section>
            <h2>1. Introduction</h2>
            <p>
              RELAY ("we", "us", or "our") operates the website at your-chat.org and the RELAY web application
              (collectively, the "Service"). This Privacy Policy explains how we collect, use, and protect your
              information when you use our Service.
            </p>
            <p>
              RELAY is designed with privacy as a core principle. We believe communication should be private,
              secure, and free from surveillance. Our architecture reflects this commitment.
            </p>
          </section>

          <section>
            <h2>2. Information We Collect</h2>
            <p>We collect minimal information necessary to provide the Service:</p>
            <ul className="list-disc pl-6">
              <li>
                <strong>6-Digit Number:</strong> A randomly generated identifier assigned to you when you first
                use RELAY. This number is not linked to your real phone number, email, or identity.
              </li>
              <li>
                <strong>Display Name:</strong> A name you choose to show to other users during calls and chats.
                This can be any name and does not need to be your real name.
              </li>
              <li>
                <strong>Optional Email:</strong> If you choose to create a persistent account, you may provide
                an email address. This is used solely for account recovery and is never shared with third parties.
              </li>
              <li>
                <strong>Call Metadata:</strong> Basic call records (caller, recipient, duration, timestamp) are
                stored locally to provide your call history feature. These are not shared externally.
              </li>
              <li>
                <strong>Messages:</strong> Text messages and attachments sent through RELAY are stored to enable
                message delivery. Messages are associated with your 6-digit number, not your real identity.
              </li>
            </ul>
          </section>

          <section>
            <h2>3. Information We Do NOT Collect</h2>
            <ul className="list-disc pl-6">
              <li>Your real phone number</li>
              <li>Your physical address or location</li>
              <li>Your contacts or address book</li>
              <li>Device identifiers or advertising IDs</li>
              <li>Browsing history outside of RELAY</li>
              <li>Audio or video content of your calls (calls are peer-to-peer)</li>
            </ul>
          </section>

          <section>
            <h2>4. How We Use Your Information</h2>
            <p>The limited information we collect is used exclusively to:</p>
            <ul className="list-disc pl-6">
              <li>Provide and maintain the Service (connecting calls, delivering messages)</li>
              <li>Display your chosen name to people you communicate with</li>
              <li>Show your call history and message threads within the app</li>
              <li>Send account recovery emails (only if you opted into email-based accounts)</li>
              <li>Improve the reliability and performance of the Service</li>
            </ul>
          </section>

          <section>
            <h2>5. Peer-to-Peer Architecture</h2>
            <p>
              RELAY uses WebRTC peer-to-peer technology for voice and video calls. This means:
            </p>
            <ul className="list-disc pl-6">
              <li>Audio and video streams flow directly between participants' browsers</li>
              <li>We do not record, store, or have access to the content of your calls</li>
              <li>Call signaling (connecting peers) passes through our servers, but media does not</li>
              <li>TURN relay servers may be used when direct connections are not possible, but they do not store any media</li>
            </ul>
          </section>

          <section>
            <h2>6. Data Storage and Security</h2>
            <p>
              We implement appropriate technical and organizational measures to protect your data:
            </p>
            <ul className="list-disc pl-6">
              <li>All connections to RELAY use TLS encryption (HTTPS)</li>
              <li>WebRTC media streams are encrypted end-to-end using DTLS-SRTP</li>
              <li>Session cookies are HttpOnly and Secure</li>
              <li>Guest sessions expire automatically after 30 days of inactivity</li>
              <li>We do not sell, rent, or share your data with advertisers or data brokers</li>
            </ul>
          </section>

          <section>
            <h2>7. Third-Party Services</h2>
            <p>
              RELAY uses the following third-party infrastructure services to operate:
            </p>
            <ul className="list-disc pl-6">
              <li><strong>TURN/STUN servers:</strong> For establishing peer-to-peer connections when direct connections are blocked by firewalls. These servers relay encrypted media temporarily and do not store it.</li>
              <li><strong>Cloud hosting:</strong> Our signaling servers run on cloud infrastructure with industry-standard security practices.</li>
            </ul>
            <p>
              We do not integrate any third-party analytics, advertising, or tracking services.
            </p>
          </section>

          <section>
            <h2>8. Cookies</h2>
            <p>
              RELAY uses only essential cookies required for the Service to function:
            </p>
            <ul className="list-disc pl-6">
              <li><strong>Session cookie:</strong> Maintains your login state (HttpOnly, Secure, SameSite)</li>
              <li><strong>Guest cookie:</strong> Identifies your guest session so you can receive calls</li>
            </ul>
            <p>
              We do not use tracking cookies, advertising cookies, or any third-party cookies.
            </p>
          </section>

          <section>
            <h2>9. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-6">
              <li>Use the Service without providing any real personal information</li>
              <li>Delete your account and all associated data at any time</li>
              <li>Clear your local call history and message threads</li>
              <li>Request information about what data we hold about your 6-digit number</li>
            </ul>
          </section>

          <section>
            <h2>10. Children's Privacy</h2>
            <p>
              RELAY is not directed at children under 13 years of age. We do not knowingly collect
              information from children under 13. If you believe a child has provided us with personal
              information, please contact us and we will delete it.
            </p>
          </section>

          <section>
            <h2>11. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Changes will be posted on this page
              with an updated "Last updated" date. Your continued use of the Service after changes
              constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2>12. Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy or our privacy practices, you can reach us
              through the RELAY application or by visiting our website at{" "}
              <a href="https://your-chat.org" className="text-[#4f6ef7] hover:underline">
                your-chat.org
              </a>.
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-100 py-8">
        <div className="container max-w-4xl flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[#4f6ef7]" />
            <span className="font-medium text-slate-600">RELAY</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/" className="hover:text-slate-600 transition-colors">Home</a>
            <a href="/technology" className="hover:text-slate-600 transition-colors">Technology</a>
            <a href="/app" className="hover:text-slate-600 transition-colors">Open App</a>
          </div>
          <span>© 2026 RELAY. All rights reserved. v{APP_VERSION}</span>
        </div>
      </footer>
    </div>
  );
}
