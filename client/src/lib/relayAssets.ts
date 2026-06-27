/**
 * Shared markup + CSS for the imperative RELAY call engine
 * (`startRelay()` in lib/relayClient.ts). Two pages mount it:
 *   1. /app/call (Relay.tsx) — full-screen calling experience
 *   2. /app/dialer (Dialer.tsx) — keypad page that promotes the
 *      engine to a fullscreen overlay when the user places a call,
 *      so we never navigate to a separate "call" route.
 *
 * The CSS is scoped with the `.relay-root` class — every host that
 * embeds this markup must put that class on the wrapper div, or
 * the CSS won't apply.
 */

import { FOOTER_LINE } from "./buildInfo";

export const RELAY_MARKUP = `
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
      <p class="hint">Share this page (or just your number) with anyone, anywhere. Each person picks a name, then you dial each other's 6-digit code. Up to 10 in one call.</p>
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
    <div id="connSeq" class="conn-seq">
      <div class="conn-seq-card">
        <div class="conn-step" data-i="0"><span class="conn-tick"></span><span class="conn-lbl">Transmission Connected</span></div>
        <div class="conn-step" data-i="1"><span class="conn-tick"></span><span class="conn-lbl">Encryption</span></div>
        <div class="conn-step" data-i="2"><span class="conn-tick"></span><span class="conn-lbl">Join the Call</span></div>
      </div>
    </div>
    <div id="callWaiting" class="call-waiting">
      <div class="cw-info"><span class="cw-pulse"></span><b id="cwName">Someone</b> is calling&hellip;</div>
      <div class="cw-actions">
        <button id="cwDecline" class="cw-btn cw-decline">Decline</button>
        <button id="cwSwitch" class="cw-btn cw-switch">Switch</button>
      </div>
    </div>
    <div class="call-main">
      <div class="grid" id="videoGrid"></div>
      <div class="chat" id="chatPanel">
        <div class="chat-head"><span class="chat-title">Chat</span><button class="chat-close-btn" id="chatClose" aria-label="Close chat" title="Close chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
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
        <button class="ctrl" id="screenBtn" title="Share screen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
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

<div class="version-tag">${FOOTER_LINE}</div>
`;

export const RELAY_CSS = `
.relay-root {
  --bg:#08090C; --bg2:#0E1014; --surface:#14171D; --surface2:#1B1F27;
  --border:rgba(255,255,255,0.08); --border2:rgba(255,255,255,0.14);
  --text:#EAEEF2; --muted:#8A93A2; --faint:#5A6271;
  --accent:#3FE0C5; --accent2:#6EE7FF; --danger:#FF5C72; --warn:#FFB454;
  --grad:linear-gradient(135deg,#3FE0C5,#6EE7FF);
  position:fixed; inset:0; z-index:1; background:var(--bg); color:var(--text);
  font-family:"Hanken Grotesk",sans-serif; -webkit-font-smoothing:antialiased;
  overflow:hidden;
}
.relay-root *{box-sizing:border-box;margin:0;padding:0}

.relay-root .relay-bg-fx{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.relay-root .relay-bg-fx::before{content:"";position:absolute;inset:-20%;
  background:
    radial-gradient(50% 40% at 18% 12%, rgba(63,224,197,0.10), transparent 60%),
    radial-gradient(45% 40% at 85% 88%, rgba(110,231,255,0.08), transparent 60%);
  animation:relayDrift 24s ease-in-out infinite alternate;}
.relay-root .relay-bg-fx .grid{position:absolute;inset:0;opacity:.5;
  background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);
  background-size:46px 46px;-webkit-mask-image:radial-gradient(circle at 50% 40%, black, transparent 78%);mask-image:radial-gradient(circle at 50% 40%, black, transparent 78%);}
.relay-root .relay-bg-fx .noise{position:absolute;inset:0;opacity:.035;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}
@keyframes relayDrift{from{transform:translate(-2%,-1%)}to{transform:translate(2%,1%)}}

.relay-root .relay-app{position:relative;z-index:1;height:100%;display:flex;flex-direction:column}
.relay-root .relay-screen{flex:1;min-height:0;display:none;animation:relayFade .45s ease both}
.relay-root .relay-screen.active{display:flex}
@keyframes relayFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

.relay-root .relay-brand{display:flex;align-items:center;gap:11px;font-family:"Bricolage Grotesque";font-weight:800;letter-spacing:-.02em}
.relay-root .relay-brand .dot{width:13px;height:13px;border-radius:50%;background:var(--grad);box-shadow:0 0 18px rgba(63,224,197,.7);position:relative}
.relay-root .relay-brand .dot::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--accent);animation:relayPulse 2.4s ease-out infinite}
@keyframes relayPulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(3.4);opacity:0}}

.relay-root #register{align-items:center;justify-content:center}
.relay-root .reg-card{width:min(440px,92vw);text-align:center;padding:14px}
.relay-root .reg-card .relay-brand{justify-content:center;font-size:30px;margin-bottom:6px}
.relay-root .tag{color:var(--muted);font-size:15px;margin-bottom:34px;line-height:1.5}
.relay-root .relay-field{position:relative;margin-bottom:16px;text-align:left}
.relay-root .relay-field label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:var(--faint);margin:0 0 9px 3px}
.relay-root .relay-field input{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:14px;
  padding:17px 18px;color:var(--text);font-size:17px;font-family:inherit;outline:none;transition:.2s}
.relay-root .relay-field input:focus{border-color:var(--accent);box-shadow:0 0 0 4px rgba(63,224,197,.12)}
.relay-root .relay-btn{width:100%;border:none;border-radius:14px;padding:17px;font-family:"Bricolage Grotesque";font-weight:700;
  font-size:16px;cursor:pointer;transition:.18s;letter-spacing:-.01em}
.relay-root .relay-btn-primary{background:var(--grad);color:#04201B;box-shadow:0 10px 30px -10px rgba(63,224,197,.55)}
.relay-root .relay-btn-primary:hover{transform:translateY(-2px);box-shadow:0 16px 40px -12px rgba(63,224,197,.7)}
.relay-root .relay-btn-primary:active{transform:translateY(0)}
.relay-root .relay-btn:disabled{opacity:.5;cursor:not-allowed;transform:none!important}
.relay-root .hint{margin-top:18px;font-size:13px;color:var(--faint);line-height:1.6}

.relay-root #lobby{flex-direction:column}
.relay-root .topbar{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--border)}
.relay-root .topbar .relay-brand{font-size:20px}
.relay-root .me{display:flex;align-items:center;gap:12px}
.relay-root .me .av{width:38px;height:38px;border-radius:11px;background:var(--grad);display:grid;place-items:center;color:#04201B;font-weight:800;font-family:"Bricolage Grotesque";font-size:16px}
.relay-root .me .meta{line-height:1.25}
.relay-root .me .meta b{font-weight:600;font-size:14px}
.relay-root .me .meta span{display:block;font-size:12px;color:var(--muted)}

.relay-root .lobby-body{flex:1;min-height:0;display:grid;grid-template-columns:1.1fr .9fr;gap:0}
@media (max-width:860px){.relay-root .lobby-body{grid-template-columns:1fr;overflow:auto}}

.relay-root .dial-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px 20px;gap:20px}
.relay-root .mycode{text-align:center}
.relay-root .mycode .lbl{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);margin-bottom:8px}
.relay-root .mycode .num{font-family:"JetBrains Mono";font-weight:700;font-size:38px;letter-spacing:.16em;
  background:var(--grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.relay-root .copy{margin-top:8px;background:var(--surface);border:1px solid var(--border);color:var(--muted);
  font-size:12px;padding:6px 13px;border-radius:9px;cursor:pointer;transition:.15s;font-family:inherit}
.relay-root .copy:hover{border-color:var(--accent);color:var(--accent)}

.relay-root .display{font-family:"JetBrains Mono";font-weight:700;font-size:30px;letter-spacing:.22em;min-height:42px;
  color:var(--text);text-align:center;width:100%;max-width:320px}
.relay-root .display.empty{color:var(--faint)}
.relay-root .pad{display:grid;grid-template-columns:repeat(3,1fr);gap:13px;width:min(320px,80vw)}
.relay-root .relay-key{aspect-ratio:1.35;background:var(--surface);border:1px solid var(--border);border-radius:16px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:.12s;user-select:none}
.relay-root .relay-key:hover{background:var(--surface2);border-color:var(--border2)}
.relay-root .relay-key:active{transform:scale(.94);border-color:var(--accent)}
.relay-root .relay-key .d{font-family:"JetBrains Mono";font-weight:700;font-size:25px}
.relay-root .relay-key .l{font-size:9px;letter-spacing:.2em;color:var(--faint);margin-top:2px;height:11px}
.relay-root .dial-actions{display:flex;gap:13px;width:min(320px,80vw)}
.relay-root .call-btn{flex:1;border:none;border-radius:16px;padding:16px;background:var(--grad);color:#04201B;
  font-family:"Bricolage Grotesque";font-weight:700;font-size:16px;cursor:pointer;display:flex;
  align-items:center;justify-content:center;gap:9px;transition:.15s;box-shadow:0 10px 26px -12px rgba(63,224,197,.6)}
.relay-root .call-btn:hover{transform:translateY(-2px)}
.relay-root .call-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.relay-root .back-key{width:58px;background:var(--surface);border:1px solid var(--border);border-radius:16px;color:var(--muted);
  cursor:pointer;font-size:20px;transition:.12s}
.relay-root .back-key:hover{border-color:var(--danger);color:var(--danger)}

.relay-root .directory{border-left:1px solid var(--border);padding:24px 22px;overflow:auto}
@media (max-width:860px){.relay-root .directory{border-left:none;border-top:1px solid var(--border)}}
.relay-root .directory h3{font-family:"Bricolage Grotesque";font-weight:600;font-size:13px;letter-spacing:.04em;
  text-transform:uppercase;color:var(--muted);margin-bottom:16px;display:flex;align-items:center;gap:8px}
.relay-root .live-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent)}
.relay-root .relay-usr{display:flex;align-items:center;gap:13px;padding:12px;border-radius:13px;cursor:pointer;transition:.13s;border:1px solid transparent}
.relay-root .relay-usr:hover{background:var(--surface);border-color:var(--border)}
.relay-root .relay-usr .av{width:40px;height:40px;border-radius:12px;background:var(--surface2);display:grid;place-items:center;
  font-family:"Bricolage Grotesque";font-weight:700;color:var(--accent);font-size:16px;border:1px solid var(--border)}
.relay-root .relay-usr .info{flex:1;min-width:0}
.relay-root .relay-usr .info b{font-weight:600;font-size:15px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.relay-root .relay-usr .info span{font-family:"JetBrains Mono";font-size:12px;color:var(--muted);letter-spacing:.1em}
.relay-root .relay-usr .go{opacity:0;color:var(--accent);font-size:18px;transition:.13s}
.relay-root .relay-usr:hover .go{opacity:1}
.relay-root .empty-dir{color:var(--faint);font-size:13px;line-height:1.7;padding:8px 4px}
.relay-root .share-box{margin-top:20px;background:var(--surface);border:1px solid var(--border);border-radius:13px;padding:15px}
.relay-root .share-box .t{font-size:12px;color:var(--muted);margin-bottom:9px;display:flex;align-items:center;gap:7px}
.relay-root .share-box .url{font-family:"JetBrains Mono";font-size:12px;color:var(--accent2);word-break:break-all;line-height:1.5;cursor:pointer}
.relay-root .share-box .url:hover{text-decoration:underline}

.relay-root .overlay{position:fixed;inset:0;z-index:50;background:rgba(4,5,8,.72);backdrop-filter:blur(8px);
  display:none;align-items:center;justify-content:center}
.relay-root .overlay.active{display:flex;animation:relayFade .25s ease both}
.relay-root .ring-card{width:min(380px,90vw);background:var(--surface);border:1px solid var(--border2);border-radius:24px;
  padding:34px;text-align:center;box-shadow:0 30px 80px -20px rgba(0,0,0,.7)}
.relay-root .ring-card .av{width:84px;height:84px;border-radius:24px;background:var(--grad);margin:0 auto 18px;
  display:grid;place-items:center;color:#04201B;font-family:"Bricolage Grotesque";font-weight:800;font-size:34px;
  animation:relayRing 1.1s ease-in-out infinite}
@keyframes relayRing{0%,100%{transform:rotate(0) scale(1)}25%{transform:rotate(-7deg) scale(1.04)}75%{transform:rotate(7deg) scale(1.04)}}
.relay-root .ring-card .who{font-family:"Bricolage Grotesque";font-weight:700;font-size:24px;margin-bottom:4px}
.relay-root .ring-card .sub{color:var(--muted);font-size:14px;margin-bottom:26px}
.relay-root .ring-actions{display:flex;gap:14px}
.relay-root .r-btn{flex:1;border:none;border-radius:16px;padding:16px;font-family:"Bricolage Grotesque";font-weight:700;
  font-size:15px;cursor:pointer;transition:.15s}
.relay-root .r-decline{background:rgba(255,92,114,.14);color:var(--danger);border:1px solid rgba(255,92,114,.3)}
.relay-root .r-decline:hover{background:rgba(255,92,114,.24)}
.relay-root .r-accept{background:var(--grad);color:#04201B}
.relay-root .r-accept:hover{transform:translateY(-2px)}

.relay-root #call{flex-direction:column}
.relay-root .call-head{display:flex;align-items:center;justify-content:space-between;padding:13px 20px;border-bottom:1px solid var(--border)}
.relay-root .call-head .ct{display:flex;align-items:center;gap:11px;font-size:14px;color:var(--muted)}
/* Live connection status — the status dot colour + label reflect the REAL
   transport state (connecting → encrypting → live, or reconnecting). */
.relay-root .call-head .ct .live-dot{transition:background .3s,box-shadow .3s}
.relay-root .call-head .ct.st-connecting .live-dot,
.relay-root .call-head .ct.st-encrypting .live-dot{background:#f5b338;box-shadow:0 0 10px #f5b338;animation:relayPulse2 1s ease-in-out infinite}
.relay-root .call-head .ct.st-reconnecting{color:#ff7a7a}
.relay-root .call-head .ct.st-reconnecting .live-dot{background:#ff5d5d;box-shadow:0 0 10px #ff5d5d;animation:relayPulse2 .8s ease-in-out infinite}
.relay-root .call-head .ct.st-live .live-dot{background:var(--accent);box-shadow:0 0 10px var(--accent);animation:none}
.relay-root .call-head .timer{font-family:"JetBrains Mono";color:var(--text);font-size:14px}
.relay-root .call-main{flex:1;min-height:0;display:flex}
.relay-root .grid{flex:1;min-height:0;padding:16px;display:grid;gap:12px;align-content:center}
.relay-root .relay-tile{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:18px;overflow:hidden;
  min-height:0;display:flex;align-items:center;justify-content:center}
.relay-root .relay-tile video{width:100%;height:100%;object-fit:cover;background:#000}
.relay-root .relay-tile.audio-only video{display:none}
.relay-root .relay-tile .ph{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}
.relay-root .relay-tile .ph .av{width:74px;height:74px;border-radius:24px;background:var(--surface2);border:1px solid var(--border);
  display:grid;place-items:center;font-family:"Bricolage Grotesque";font-weight:800;font-size:30px;color:var(--accent)}
.relay-root .relay-tile .nm{position:absolute;left:12px;bottom:11px;display:flex;align-items:center;gap:7px;
  background:rgba(8,9,12,.62);backdrop-filter:blur(6px);padding:5px 11px;border-radius:9px;font-size:13px;font-weight:600}
.relay-root .relay-tile.you .nm{background:rgba(63,224,197,.2);color:var(--accent)}
.relay-root .connecting{position:absolute;top:11px;right:12px;font-size:11px;color:var(--warn);background:rgba(255,180,84,.14);
  padding:3px 9px;border-radius:7px;letter-spacing:.04em}

.relay-root .chat{width:320px;border-left:1px solid var(--border);display:none;flex-direction:column;background:var(--bg2)}
.relay-root .chat.open{display:flex}
@media (max-width:680px){.relay-root .chat{position:fixed;inset:0;width:100%;z-index:40}
  .relay-root .chat-head{padding-top:max(15px,env(safe-area-inset-top))}}
.relay-root .chat-head{padding:15px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;
  font-family:"Bricolage Grotesque";font-weight:600;font-size:15px}
.relay-root .chat-head .chat-title{display:flex;align-items:center;gap:8px}
/* Obvious, high-contrast close button (the old tiny grey × was unfindable on
   the full-screen mobile chat overlay). */
.relay-root .chat-close-btn{appearance:none;-webkit-appearance:none;border:1px solid var(--border2);background:var(--surface2);color:var(--text);
  width:38px;height:38px;border-radius:50%;display:grid;place-items:center;cursor:pointer;transition:.15s;flex-shrink:0}
.relay-root .chat-close-btn svg{width:18px;height:18px}
.relay-root .chat-close-btn:hover,.relay-root .chat-close-btn:active{background:var(--accent);color:#04201B;border-color:var(--accent)}
@media (max-width:680px){.relay-root .chat-close-btn{width:44px;height:44px}.relay-root .chat-close-btn svg{width:21px;height:21px}}
.relay-root .chat-log{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:11px}
.relay-root .relay-msg{max-width:80%;padding:9px 13px;border-radius:13px;font-size:14px;line-height:1.4;word-break:break-word}
.relay-root .relay-msg .au{font-size:11px;color:var(--accent);font-weight:600;margin-bottom:2px}
.relay-root .relay-msg.them{background:var(--surface);border:1px solid var(--border);align-self:flex-start;border-bottom-left-radius:4px}
.relay-root .relay-msg.me{background:rgba(63,224,197,.16);align-self:flex-end;border-bottom-right-radius:4px}
.relay-root .relay-msg.sys{align-self:center;color:var(--faint);font-size:12px;background:none}
.relay-root .chat-input{padding:13px;border-top:1px solid var(--border);display:flex;gap:9px}
.relay-root .chat-input input{flex:1;background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:11px 14px;
  color:var(--text);font-family:inherit;font-size:14px;outline:none}
.relay-root .chat-input input:focus{border-color:var(--accent)}
.relay-root .chat-input button{background:var(--grad);border:none;border-radius:11px;width:44px;color:#04201B;font-size:17px;cursor:pointer}

/* Glassmorphic Gemini-inspired control bar */
.relay-root .controls{display:flex;align-items:center;justify-content:center;gap:14px;padding:18px 16px 22px;position:relative;background:none;border-top:none}
.relay-root .ctrl-bar{display:flex;align-items:center;gap:10px;padding:10px 14px;
  background:rgba(20,23,29,.72);border:1px solid rgba(255,255,255,.10);border-radius:24px;
  box-shadow:0 16px 50px -18px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.06);
  backdrop-filter:blur(20px) saturate(1.4);-webkit-backdrop-filter:blur(20px) saturate(1.4)}
.relay-root .ctrl{width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);
  color:var(--text);cursor:pointer;display:grid;place-items:center;transition:transform .16s cubic-bezier(0.23,1,0.32,1),background .16s,border-color .16s;position:relative}
.relay-root .ctrl:hover{background:rgba(255,255,255,.10);border-color:rgba(255,255,255,.16);transform:translateY(-1px)}
.relay-root .ctrl:active{transform:scale(.94)}
.relay-root .ctrl.off{background:rgba(255,92,114,.18);border-color:rgba(255,92,114,.36);color:var(--danger)}
.relay-root .ctrl svg{width:20px;height:20px}
.relay-root .ctrl .badge{position:absolute;top:-4px;right:-4px;background:var(--accent);color:#04201B;font-size:10px;font-weight:700;
  min-width:17px;height:17px;border-radius:9px;display:grid;place-items:center;padding:0 4px;border:2px solid var(--bg)}
.relay-root .ctrl.hangup{width:66px;border-radius:26px;background:linear-gradient(135deg,#FF5C72,#FF3B5C);border-color:transparent;color:#fff;box-shadow:0 6px 22px -6px rgba(255,92,114,.6)}
.relay-root .ctrl.hangup:hover{transform:translateY(-1px);box-shadow:0 10px 30px -8px rgba(255,92,114,.75)}
.relay-root .ctrl.hangup:active{transform:scale(.96)}

/* Self-tile camera handling: front cam mirrored locally so user feels natural,
   back cam not mirrored, and outgoing stream NEVER mirrored. */
.relay-root .relay-tile.you video{transform:scaleX(-1)}
.relay-root .relay-tile.you.back-cam video{transform:none}
/* Screen share: the shared screen must never be mirrored, and should be shown
   in full (letterboxed) rather than cropped like a camera tile. */
.relay-root .relay-tile.you.screen video{transform:none;object-fit:contain;background:#000}
/* Active control state (e.g. screen-share on) — accent-tinted like .off is red. */
.relay-root .ctrl.on{background:rgba(63,224,197,.18);border-color:rgba(63,224,197,.4);color:var(--accent)}
/* Screen share is a desktop feature (iOS Safari has no getDisplayMedia, and the
   mobile control bar is already full) — hide the button on small screens. */
@media (max-width:680px){.relay-root #screenBtn{display:none}}

/* Filter dock (Snapchat-style horizontal strip) */
.relay-root .filter-dock{position:absolute;left:50%;bottom:96px;transform:translateX(-50%) translateY(12px);width:min(720px,94vw);
  background:rgba(20,23,29,.78);border:1px solid rgba(255,255,255,.10);border-radius:22px;padding:14px 14px 16px;
  box-shadow:0 24px 60px -22px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.05);
  backdrop-filter:blur(20px) saturate(1.4);-webkit-backdrop-filter:blur(20px) saturate(1.4);
  display:none;z-index:35}
.relay-root .filter-dock.open{display:block;animation:relayFade .22s cubic-bezier(0.23,1,0.32,1) both}
.relay-root .filter-dock-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:0 4px}
.relay-root .filter-dock-head .t{font-family:"Bricolage Grotesque";font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:8px}
.relay-root .filter-dock-head .x{background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;line-height:1;padding:0 4px}
.relay-root .filter-dock-head .x:hover{color:var(--text)}
.relay-root .loading-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:relayPulse2 1.2s ease-in-out infinite}
@keyframes relayPulse2{0%,100%{opacity:.4;transform:scale(.8)}50%{opacity:1;transform:scale(1.1)}}
.relay-root .filter-strip{display:flex;gap:10px;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;scrollbar-color:var(--border2) transparent;padding:4px 2px 6px;scroll-snap-type:x mandatory}
.relay-root .filter-strip::-webkit-scrollbar{height:6px}
.relay-root .filter-strip::-webkit-scrollbar-track{background:transparent}
.relay-root .filter-strip::-webkit-scrollbar-thumb{background:var(--border2);border-radius:99px}
.relay-root .relay-filter{flex:0 0 auto;min-width:78px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);
  border-radius:14px;padding:12px 6px 9px;color:var(--text);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;
  font-family:inherit;transition:transform .15s cubic-bezier(0.23,1,0.32,1),background .15s,border-color .15s;scroll-snap-align:center}
.relay-root .relay-filter:hover{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.14);transform:translateY(-2px)}
.relay-root .relay-filter:active{transform:scale(.96)}
.relay-root .relay-filter.active{background:linear-gradient(135deg,rgba(63,224,197,.22),rgba(110,231,255,.22));border-color:var(--accent);box-shadow:0 0 0 2px rgba(63,224,197,.18)}
.relay-root .relay-filter .emoji{font-size:26px;line-height:1}
.relay-root .relay-filter .lbl{font-size:11px;color:var(--muted);letter-spacing:.04em;font-weight:500}
.relay-root .relay-filter.active .lbl{color:var(--accent)}
@media (max-width:680px){
  .relay-root .filter-dock{bottom:108px;width:96vw}
  .relay-root .ctrl-bar{gap:8px;padding:8px 10px}
  .relay-root .ctrl{width:44px;height:44px}
  .relay-root .ctrl.hangup{width:58px}
}

.relay-root .relay-toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%) translateY(20px);z-index:80;
  background:var(--surface2);border:1px solid var(--border2);color:var(--text);padding:13px 20px;border-radius:13px;
  font-size:14px;opacity:0;transition:.3s;pointer-events:none;box-shadow:0 16px 40px -12px rgba(0,0,0,.6);max-width:90vw}
.relay-root .relay-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.relay-root .relay-toast.err{border-color:rgba(255,92,114,.4)}

.relay-root .addpad{position:absolute;bottom:84px;left:50%;transform:translateX(-50%);background:var(--surface);
  border:1px solid var(--border2);border-radius:18px;padding:18px;display:none;flex-direction:column;gap:12px;width:240px;
  box-shadow:0 24px 60px -20px rgba(0,0,0,.7);z-index:30}
.relay-root .addpad.open{display:flex;animation:relayFade .2s ease both}
.relay-root .addpad input{background:var(--bg2);border:1px solid var(--border);border-radius:11px;padding:12px;text-align:center;
  font-family:"JetBrains Mono";font-weight:700;letter-spacing:.18em;color:var(--text);font-size:16px;outline:none}
.relay-root .addpad input:focus{border-color:var(--accent)}
.relay-root .addpad button{background:var(--grad);border:none;border-radius:11px;padding:12px;color:#04201B;font-weight:700;cursor:pointer;font-family:inherit}

.relay-root .boot{position:fixed;inset:0;z-index:90;background:var(--bg);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px}
.relay-root .boot.hidden{display:none}
.relay-root .boot .spin{width:34px;height:34px;border-radius:50%;border:3px solid var(--border);border-top-color:var(--accent);animation:relaySpin 1s linear infinite}
@keyframes relaySpin{to{transform:rotate(360deg)}}
.relay-root .boot .t{color:var(--muted);font-size:14px}

/* Connection sequence — Transmission Connected -> Encryption -> Join the Call */
.relay-root .conn-seq{position:absolute;inset:0;z-index:25;display:none;align-items:center;justify-content:center;background:rgba(8,9,12,.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.relay-root .conn-seq.show{display:flex;animation:relayFade .25s ease both}
.relay-root .conn-seq.hide{animation:connSeqOut .4s ease both}
@keyframes connSeqOut{to{opacity:0;visibility:hidden}}
.relay-root .conn-seq-card{display:flex;flex-direction:column;gap:18px}
.relay-root .conn-step{display:flex;align-items:center;gap:14px;font-family:"Bricolage Grotesque";font-weight:600;font-size:17px;color:var(--faint);opacity:.4;transform:translateX(-6px);transition:.32s cubic-bezier(0.23,1,0.32,1)}
.relay-root .conn-step.active{color:var(--text);opacity:1;transform:none}
.relay-root .conn-step.done{color:var(--accent);opacity:1;transform:none}
.relay-root .conn-tick{width:24px;height:24px;border-radius:50%;border:2px solid var(--border2);display:grid;place-items:center;flex:0 0 auto;transition:.3s}
.relay-root .conn-step.active .conn-tick{border-color:var(--accent);box-shadow:0 0 0 4px rgba(63,224,197,.14)}
.relay-root .conn-step.active .conn-tick::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent);animation:relayPulse2 1s ease-in-out infinite}
.relay-root .conn-step.done .conn-tick{border-color:var(--accent);background:var(--accent)}
.relay-root .conn-step.done .conn-tick::after{content:"✓";color:#04201B;font-size:13px;font-weight:800;line-height:1}
/* Call waiting — a second incoming call during an active call */
.relay-root .call-waiting{position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:36;display:none;align-items:center;gap:14px;background:rgba(20,23,29,.92);border:1px solid var(--border2);border-radius:16px;padding:10px 12px 10px 16px;box-shadow:0 18px 50px -18px rgba(0,0,0,.7);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);max-width:94vw}
.relay-root .call-waiting.show{display:flex;animation:cwIn .3s cubic-bezier(0.23,1,0.32,1) both}
@keyframes cwIn{from{opacity:0;transform:translateX(-50%) translateY(-16px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.relay-root .call-waiting .cw-info{font-size:14px;color:var(--text);white-space:nowrap;display:flex;align-items:center;gap:9px}
.relay-root .call-waiting .cw-pulse{width:9px;height:9px;border-radius:50%;background:var(--accent);animation:cwPulse 1.3s ease-out infinite;flex:0 0 auto}
@keyframes cwPulse{0%{box-shadow:0 0 0 0 rgba(63,224,197,.5)}100%{box-shadow:0 0 0 9px rgba(63,224,197,0)}}
.relay-root .call-waiting .cw-actions{display:flex;gap:8px}
.relay-root .call-waiting .cw-btn{border:none;border-radius:11px;padding:8px 14px;font-family:"Bricolage Grotesque";font-weight:700;font-size:13px;cursor:pointer;transition:.14s}
.relay-root .call-waiting .cw-decline{background:rgba(255,92,114,.16);color:var(--danger);border:1px solid rgba(255,92,114,.3)}
.relay-root .call-waiting .cw-decline:hover{background:rgba(255,92,114,.26)}
.relay-root .call-waiting .cw-switch{background:var(--grad);color:#04201B}
.relay-root .call-waiting .cw-switch:hover{transform:translateY(-1px)}
@media (max-width:680px){.relay-root .call-waiting{flex-direction:column;gap:10px;top:10px;padding:12px 14px}.relay-root .call-waiting .cw-actions{width:100%}.relay-root .call-waiting .cw-btn{flex:1}}
.relay-root .version-tag{position:fixed;bottom:8px;right:12px;z-index:5;font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.06em;color:var(--faint);pointer-events:none;opacity:.7}

/* Diagnostics button is hidden from users (the "?" floater). The panel is
   still reachable for debugging via the keyboard shortcut. */
.relay-root .diag-btn{display:none!important}
.relay-root .diag-btn--shown{position:fixed;bottom:14px;left:14px;z-index:60;width:36px;height:36px;border-radius:10px;background:var(--surface);border:1px solid var(--border);color:var(--muted);display:grid;place-items:center;cursor:pointer;transition:.15s}
.relay-root .diag-btn:hover{background:var(--surface2);border-color:var(--border2);color:var(--accent)}
.relay-root .diag-btn svg{width:18px;height:18px}
.relay-root .diag-overlay{position:fixed;inset:0;z-index:95;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(6px)}
.relay-root .diag-overlay.open{display:flex;animation:relayFade .2s ease both}
.relay-root .diag-card{width:min(720px,96vw);max-height:80vh;background:var(--surface);border:1px solid var(--border2);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px -20px rgba(0,0,0,.7)}
.relay-root .diag-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border)}
.relay-root .diag-head b{font-family:"Bricolage Grotesque";font-weight:700;font-size:15px}
.relay-root .diag-actions{display:flex;gap:8px}
.relay-root .diag-tool{background:var(--bg2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;font-family:inherit}
.relay-root .diag-tool:hover{border-color:var(--accent);color:var(--accent)}
.relay-root .diag-body{flex:1;min-height:0;overflow:auto;padding:16px 18px;font-family:"JetBrains Mono",monospace;font-size:11.5px;line-height:1.55;color:var(--text);white-space:pre-wrap;background:var(--bg2)}
.relay-root .diag-foot{padding:10px 18px;border-top:1px solid var(--border);color:var(--faint);font-size:12px}
.relay-root .diag-foot kbd{background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:1px 6px;font-family:"JetBrains Mono";font-size:11px}

.relay-root .relay-tile .connecting{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.55);color:#fff;padding:7px 14px;border-radius:99px;font-size:12px;letter-spacing:.04em;backdrop-filter:blur(4px);border:1px solid var(--border2)}
.relay-root .relay-tile[data-state="failed"] .connecting{color:var(--danger);border-color:rgba(255,92,114,.5)}
.relay-root .relay-tile[data-state="disconnected"] .connecting{color:var(--warn);border-color:rgba(255,180,84,.5)}
.relay-root .relay-tile[data-state="connected"] .connecting{display:none!important}
`;
