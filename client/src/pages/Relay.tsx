import { useEffect, useRef } from "react";
import { startRelay } from "@/lib/relayClient";
import { RELAY_MARKUP, RELAY_CSS } from "@/lib/relayAssets";
import { trpc } from "@/lib/trpc";

/**
 * The RELAY calling UI as a React page. We render the original
 * markup and styles inside a scoped wrapper, then start the
 * imperative client logic in a useEffect once the DOM is ready.
 *
 * Why not a pure-React rewrite? The WebRTC mesh code is heavy on
 * direct DOM manipulation (video tile lifecycle, data channels,
 * ICE state) and was already validated end-to-end in the user's
 * standalone server. Porting it 1:1 keeps the proven code path.
 *
 * CSS classes are prefixed with `relay-` to keep them out of
 * Tailwind's namespace. The original IDs are preserved because
 * the imperative client looks them up via `root.querySelector`.
 */

const MARKUP = `
<div class="relay-bg-fx"><div class="grid"></div><div class="noise"></div></div>

<div class="relay-app">

  <section id="register" class="relay-screen active">
    <div class="reg-card">
      <div class="relay-brand"><span class="dot"></span>RELAY</div>
      <p class="tag">Pick a name, get a number, dial anyone.<br>Voice &middot; video &middot; chat &mdash; straight in the browser.</p>
      <div class="relay-field">
        <label>Display name</label>
        <input id="nameInput" maxlength="20" placeholder="e.g. Khalifa" autocomplete="off">
      </div>
      <button id="joinBtn" class="relay-btn relay-btn-primary">Get my number &rarr;</button>
      <p class="hint">Share this page (or just your number) with anyone, anywhere. Each person picks a name, then you dial each other's 6-digit code. Up to 6 in one call.</p>
    </div>
  </section>

  <section id="lobby" class="relay-screen">
    <div class="topbar">
      <div class="relay-brand"><span class="dot"></span>RELAY</div>
      <div class="me">
        <div class="meta" style="text-align:right">
          <b id="meName">&mdash;</b>
          <span id="meCode">&mdash;</span>
        </div>
        <div class="av" id="meAv">?</div>
      </div>
    </div>
    <div class="lobby-body">
      <div class="dial-wrap">
        <div class="mycode">
          <div class="lbl">Your number</div>
          <div class="num" id="bigCode">000000</div>
          <button class="copy" id="copyBtn">Copy number</button>
        </div>
        <div class="display empty" id="dialDisplay">Enter a number</div>
        <div class="pad" id="pad"></div>
        <div class="dial-actions">
          <button class="back-key" id="backKey">&#9003;</button>
          <button class="call-btn" id="callBtn" disabled>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.3 1l-2.2 2.2z"/></svg>
            Call
          </button>
        </div>
      </div>
      <div class="directory">
        <h3><span class="live-dot"></span> Recent calls</h3>
        <div id="dirList"><p class="empty-dir">People you call will appear here for quick redial.<br><br>To connect with someone: send them your number, or type theirs on the keypad and hit Call.</p></div>
        <div class="share-box">
          <div class="t"><span class="live-dot"></span> Invite link</div>
          <div class="url" id="shareUrl" title="Click to copy">&mdash;</div>
        </div>
      </div>
    </div>
  </section>

  <section id="call" class="relay-screen">
    <div class="call-head">
      <div class="ct"><span class="live-dot"></span> <span id="callRoomLbl">In call</span></div>
      <div class="timer" id="timer">00:00</div>
    </div>
    <div class="call-main">
      <div class="grid" id="videoGrid"></div>
      <div class="chat" id="chatPanel">
        <div class="chat-head">Chat <span class="x" id="chatClose">&times;</span></div>
        <div class="chat-log" id="chatLog"></div>
        <div class="chat-input">
          <input id="chatField" placeholder="Message everyone&hellip;" maxlength="500">
          <button id="chatSend">&uarr;</button>
        </div>
      </div>
    </div>
    <div id="filterDock" class="filter-dock">
      <div class="filter-dock-head">
        <span class="t">Filters <span id="filterLoading" class="loading-dot" style="display:none"></span></span>
        <button id="filterClose" class="x" aria-label="Close filters">&times;</button>
      </div>
      <div id="filterStrip" class="filter-strip"></div>
    </div>

    <div class="controls">
      <div class="addpad" id="addpad">
        <input id="addInput" maxlength="6" inputmode="numeric" placeholder="000000">
        <button id="addGo">Add to call</button>
      </div>
      <div class="ctrl-bar">
        <button class="ctrl" id="micBtn" title="Mute">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z"/><path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.9V21a1 1 0 1 0 2 0v-3.1A7 7 0 0 0 19 11z"/></svg>
        </button>
        <button class="ctrl" id="camBtn" title="Camera">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>
        </button>
        <button class="ctrl" id="flipCamBtn" title="Flip camera (front ↔ back)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>
        </button>
        <button class="ctrl" id="filterBtn" title="Filters">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4"/><circle cx="17" cy="7" r="4"/><circle cx="12" cy="16" r="4"/></svg>
        </button>
        <button class="ctrl" id="addBtn" title="Add person">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <button class="ctrl" id="chatBtn" title="Chat">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1z"/></svg>
          <span class="badge" id="chatBadge" style="display:none">0</span>
        </button>
        <button class="ctrl hangup" id="hangBtn" title="Leave">
          <svg viewBox="0 0 24 24" fill="currentColor" style="transform:rotate(135deg)"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.3 1l-2.2 2.2z"/></svg>
        </button>
      </div>
    </div>
  </section>
</div>

<button id="diagBtn" class="diag-btn" title="Diagnostics (?)" aria-label="Open diagnostics">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/></svg>
</button>

<div id="diagOverlay" class="diag-overlay">
  <div class="diag-card">
    <div class="diag-head">
      <b>Diagnostics</b>
      <div class="diag-actions">
        <button id="diagCopy" class="diag-tool">Copy</button>
        <button id="diagClose" class="diag-tool">Close</button>
      </div>
    </div>
    <pre id="diagBody" class="diag-body">(open this while a call is connecting to see ICE/connection state per peer)</pre>
    <p class="diag-foot">Tip: press <kbd>?</kbd> anywhere to toggle this panel.</p>
  </div>
</div>

<div class="overlay" id="ringOverlay">
  <div class="ring-card">
    <div class="av" id="ringAv">?</div>
    <div class="who" id="ringWho">Someone</div>
    <div class="sub" id="ringSub">is calling you&hellip;</div>
    <div class="ring-actions">
      <button class="r-btn r-decline" id="declineBtn">Decline</button>
      <button class="r-btn r-accept" id="acceptBtn">Accept</button>
    </div>
  </div>
</div>

<div class="relay-toast" id="toast"></div>

<div class="boot" id="boot"><div class="spin"></div><div class="t">Connecting&hellip;</div></div>

<div class="version-tag">RELAY &middot; v2.1.0</div>
`;

export default function Relay() {
  const ref = useRef<HTMLDivElement>(null);
  // Read the v2.0 guest identity so we can auto-register and not ask the user
  // for their name a second time. If whoami fails (e.g. cookie not set), we
  // gracefully fall back to the existing manual register form.
  const whoami = trpc.identity.whoami.useQuery(undefined, { staleTime: 30_000 });

  // The relay engine MUST be created exactly once for the lifetime of this
  // page. It was previously keyed on `whoami.data?.displayName`, but that query
  // polls/refetches, so the effect re-ran -> destroy() + startRelay() on a loop.
  // Each teardown sent a `leave`, the SSE reconnected with a fresh identity, and
  // the user's number kept changing — which is why calls dropped instantly.
  const handleRef = useRef<ReturnType<typeof startRelay> | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = RELAY_MARKUP;
    const handle = startRelay(el);
    handleRef.current = handle;

    // Auto-fill the dial pad with ?to=<6digits> if present in the URL.
    const params = new URLSearchParams(window.location.search);
    const to = (params.get("to") || "").replace(/\D+/g, "").slice(0, 6);
    let observer: MutationObserver | null = null;
    if (to.length === 6) {
      observer = new MutationObserver(() => {
        const display = el.querySelector<HTMLElement>("#dialDisplay");
        const lobby = el.querySelector<HTMLElement>("#lobby");
        if (display && lobby?.classList.contains("active")) {
          display.textContent = to;
          display.classList.remove("empty");
          observer?.disconnect();
          observer = null;
        }
      });
      observer.observe(el, { attributes: true, subtree: true, attributeFilter: ["class"] });
    }

    return () => {
      observer?.disconnect();
      handle.destroy();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-fill name + auto-click Join once we know the user's identity. This runs
  // separately so it never tears down the engine. It only touches DOM the engine
  // already created.
  useEffect(() => {
    const el = ref.current;
    const name = whoami.data?.displayName;
    if (!el || !name) return;
    const autofill = () => {
      const nameInput = el.querySelector<HTMLInputElement>("#nameInput");
      if (nameInput && !nameInput.value) nameInput.value = name;
      if (nameInput?.value) {
        const btn = el.querySelector<HTMLButtonElement>("#joinBtn");
        if (btn && !btn.disabled) btn.click();
      }
    };
    const t = window.setTimeout(autofill, 30);
    return () => window.clearTimeout(t);
  }, [whoami.data?.displayName]);

  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap"
      />
      <style>{RELAY_CSS}</style>
      <div ref={ref} className="relay-root" />
    </>
  );
}

