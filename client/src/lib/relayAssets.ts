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

import { APP_VERSION, BUILD_DATE, BUILD_YEAR } from "./buildInfo";

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
      <div class="call-head-right">
        <span id="recIndicator" class="rec-ind" style="display:none"><span class="rec-blink"></span>REC</span>
        <div class="timer" id="timer">00:00</div>
      </div>
    </div>
    <div id="connSeq" class="conn-seq">
      <div class="conn-seq-card">
        <div class="conn-step" data-i="0"><span class="conn-tick"></span><span class="conn-lbl">Transmission Connected</span></div>
        <div class="conn-step" data-i="1"><span class="conn-tick"></span><span class="conn-lbl">Encryption</span></div>
        <div class="conn-step" data-i="2"><span class="conn-tick"></span><span class="conn-lbl">Join the Call</span></div>
      </div>
    </div>
    <div id="callWaiting" class="call-waiting">
      <div class="cw-info"><span class="cw-pulse"></span>
        <span class="cw-flag" id="cwFlag"></span>
        <span class="cw-meta"><b id="cwName">Someone</b><span class="cw-num" id="cwNum"></span><span class="cw-sub">Incoming call &middot; answer to hold your current call</span></span>
      </div>
      <div class="cw-actions">
        <button id="cwDecline" class="cw-btn cw-decline">Reject</button>
        <button id="cwSwitch" class="cw-btn cw-switch">Answer</button>
      </div>
    </div>
    <div id="videoAsk" class="video-ask">
      <div class="va-info"><span class="va-cam">&#127909;</span>
        <span class="va-meta"><b id="vaName">Someone</b><span class="va-sub">wants to start video &mdash; accepting turns on BOTH cameras</span></span>
      </div>
      <div class="va-actions">
        <button id="vaDecline" class="va-btn va-decline" type="button">Not now</button>
        <button id="vaAccept" class="va-btn va-accept" type="button">Turn on video</button>
      </div>
    </div>
    <div id="heldBar" class="held-bar">
      <div class="held-info"><span class="held-pulse"></span>
        <span class="held-meta"><b>On hold</b><span class="held-name" id="heldName"></span></span>
      </div>
      <div class="held-actions">
        <button id="heldSwap" class="held-btn held-swap" title="Switch to the held call">Swap</button>
        <button id="heldMerge" class="held-btn held-merge" title="Merge both calls into a conference">Merge</button>
        <button id="heldEnd" class="held-btn held-end" title="Hang up the HELD call — this call stays connected">End held</button>
      </div>
    </div>
    <!-- Being HELD (v2.97.1): shown to the party who was parked — with light
         hold music playing — until the holder swaps back or hangs up. -->
    <div id="onHoldBar" class="onhold-bar">
      <span class="oh-pulse"></span>
      <span class="oh-meta"><b><span id="onHoldName">They</span> put you on hold</b><span class="oh-sub">Hang tight &mdash; you&rsquo;ll hear them the moment they&rsquo;re back</span></span>
    </div>
    <div class="call-main">
      <div id="dialCard" class="dial-card">
        <div class="dc-av" id="dcAv">#</div>
        <div class="dc-num" id="dcNum">&mdash;</div>
        <div class="dc-name" id="dcName"></div>
        <div class="dc-mode" id="dcMode">Voice call</div>
        <div class="dc-status"><span class="dc-dot"></span><span id="dcStatusTxt">Calling&hellip;</span></div>
      </div>
      <div class="grid" id="videoGrid"></div>
      <div class="chat" id="chatPanel">
        <div class="chat-head"><span class="chat-title">Chat</span><button class="chat-close-btn" id="chatClose" aria-label="Close chat" title="Close chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
        <div class="chat-log" id="chatLog"></div>
        <!-- Emoji palette (v2.99.4): built by JS on first open; sits between the
             log and the composer so the input never loses its position. -->
        <div class="chat-emojis" id="chatEmojis"></div>
        <div class="chat-input">
          <button type="button" class="chat-emoji-btn" id="chatEmojiBtn" title="Emoji" aria-label="Insert emoji"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c.9 1.2 2.1 1.9 3.5 1.9s2.6-.7 3.5-1.9"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/></svg></button>
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
        <div class="addpad-head"><span>Add person</span><button id="addClose" type="button" aria-label="Cancel" title="Cancel">&#10005;</button></div>
        <input id="addInput" maxlength="16" inputmode="numeric" placeholder="000000">
        <div class="addpad-keys" id="addKeys"></div>
        <button id="addGo">Add to call</button>
        <div class="addpad-hint">Invites automatically once you enter all 6 digits</div>
      </div>
      <div class="audio-menu" id="audioMenu"></div>
      <div class="tile-menu" id="tileMenu">
        <div class="tm-head"><span id="tmName">Participant</span><button id="tmClose" type="button" aria-label="Close" title="Close">&#10005;</button></div>
        <div class="tm-acts" id="tmActs"></div>
      </div>
      <div class="host-panel" id="hostPanel">
        <div class="host-head"><span>Host controls</span><button id="hostClose" type="button" aria-label="Close" title="Close">&#10005;</button></div>
        <div class="host-actions">
          <button id="muteAllBtn" type="button">Mute all</button>
          <button id="unmuteAllBtn" type="button">Unmute all</button>
          <button id="gridBtn" type="button">Grid view</button>
        </div>
        <div class="host-list" id="hostList"></div>
      </div>
      <div class="more-menu" id="moreMenu">
        <!-- Overflow menu (v2.99.4). The RECORD control lives here now (was a
             bare unlabeled circle in the bar); JS keeps toggling its id's
             display/.on class exactly as before. Each row explains itself. -->
        <button type="button" class="mm-item" id="recordBtn" style="display:none" title="Record this call to the cloud">
          <span class="mm-ic mm-rec"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="7"/></svg></span>
          <span class="mm-tx"><b>Record call</b><i>Save this call as a video — everyone sees a REC badge</i></span>
        </button>
        <button type="button" class="mm-item" id="diagMenuBtn" title="Connection diagnostics">
          <span class="mm-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/></svg></span>
          <span class="mm-tx"><b>Diagnostics</b><i>Live connection details for troubleshooting</i></span>
        </button>
      </div>
      <div class="ctrl-bar">
        <!-- v2.99.4 (owner spec): every control is a COLORED icon chip with a
             LABEL underneath, so each button says what it does. Mic + camera
             carry TWO icons each (v2.96.1): the normal glyph and a SLASHED
             "off" glyph swapped by the .off class — and their labels swap the
             same way (Mute/Unmute · Cam off/Cam on). -->
        <button class="ctrl" id="micBtn" title="Microphone — tap to mute or unmute yourself" aria-label="Mute or unmute microphone">
          <span class="ctrl-ic"><svg class="ic-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg><svg class="ic-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></span>
          <span class="ctrl-lbl"><span class="lbl-on">Mute</span><span class="lbl-off">Unmute</span></span>
        </button>
        <button class="ctrl" id="camBtn" title="Camera — tap to turn your video on or off" aria-label="Turn camera on or off">
          <span class="ctrl-ic"><svg class="ic-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg><svg class="ic-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg></span>
          <span class="ctrl-lbl"><span class="lbl-on">Cam off</span><span class="lbl-off">Cam on</span></span>
        </button>
        <button class="ctrl" id="flipCamBtn" title="Switch between the front and back camera">
          <span class="ctrl-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg></span>
          <span class="ctrl-lbl">Flip</span>
        </button>
        <button class="ctrl" id="screenBtn" title="Share your screen with everyone on the call" style="display:none">
          <span class="ctrl-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg></span>
          <span class="ctrl-lbl">Share</span>
        </button>
        <button class="ctrl ctrl-text" id="qualityBtn" title="Video quality — switch between HD and Data saver">
          <span class="ctrl-ic"><span id="qualityTxt">HD</span></span>
          <span class="ctrl-lbl">Quality</span>
        </button>
        <button class="ctrl" id="audioBtn" title="Sound output — loudspeaker, earpiece or Bluetooth" style="display:none">
          <span class="ctrl-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg></span>
          <span class="ctrl-lbl">Sound</span>
        </button>
        <button class="ctrl" id="pipBtn" title="Picture-in-Picture — keeps the call visible when you switch apps" style="display:none">
          <span class="ctrl-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor" stroke="none"/></svg></span>
          <span class="ctrl-lbl">PiP</span>
        </button>
        <button class="ctrl" id="filterBtn" title="Camera filters — color effects, background blur, face fun">
          <span class="ctrl-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4"/><circle cx="17" cy="7" r="4"/><circle cx="12" cy="16" r="4"/></svg></span>
          <span class="ctrl-lbl">Filters</span>
        </button>
        <button class="ctrl" id="addBtn" title="Add another person to this call">
          <span class="ctrl-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>
          <span class="ctrl-lbl">Add</span>
        </button>
        <button class="ctrl" id="hostBtn" title="Host controls — mute, pin, promote or remove participants" style="display:none">
          <span class="ctrl-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l1.8-9 4.7 3.8L12 5l2.5 6.8L19.2 8 21 17z"/><path d="M5 21h14"/></svg></span>
          <span class="ctrl-lbl">Host</span>
        </button>
        <button class="ctrl" id="chatBtn" title="In-call chat with everyone on the line">
          <span class="ctrl-ic"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1z"/></svg><span class="badge" id="chatBadge" style="display:none">0</span></span>
          <span class="ctrl-lbl">Chat</span>
        </button>
        <button class="ctrl" id="moreBtn" title="More — recording and diagnostics">
          <span class="ctrl-ic"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></span>
          <span class="ctrl-lbl">More</span>
        </button>
        <button class="ctrl hangup" id="hangBtn" title="Leave">
          <!-- Material "call end": a DRAWN horizontal handset, no CSS transform.
               The old pickup-receiver rotated via an inline style rendered
               UNROTATED on some Android WebViews — an ANSWER icon on the End
               button (reported as corrupted/misleading). -->
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.7l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.51-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
          <!-- Visible on the pre-connect dial screen only (v2.98 redesign) —
               grounds the lone red circle with a real label, like the ring
               card's Voice/Video/Decline captions. -->
          <span class="hangup-lbl">End Call</span>
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
  <!-- Incoming-call card (v2.97 redesign, owner spec): caller PHOTO inside a
       rotating gradient orbit + radiating halos, THREE round glossy animated
       buttons (Voice / Video / Decline), a Send-to-voicemail + Message… row,
       and the caller's verified badge + live presence line. -->
  <div class="ring-card">
    <div class="ring-av-wrap">
      <span class="ring-orbit" aria-hidden="true"></span>
      <span class="ring-halo" aria-hidden="true"></span>
      <span class="ring-halo h2" aria-hidden="true"></span>
      <div class="av" id="ringAv">?</div>
      <img class="ring-av-img" id="ringAvImg" alt="" style="display:none">
    </div>
    <div class="who"><span id="ringWho">Someone</span><span class="ring-verified" id="ringVerified" style="display:none" title="Verified account"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.7l2.6 2.5 3.6-.5 1.1 3.4 3.2 1.7-1.3 3.2 1.3 3.2-3.2 1.7-1.1 3.4-3.6-.5-2.6 2.5-2.6-2.5-3.6.5-1.1-3.4-3.2-1.7L2.8 12 1.5 8.8l3.2-1.7 1.1-3.4 3.6.5z"/><path d="M10.7 15.3l-2.9-2.9 1.3-1.3 1.6 1.6 4.6-4.6 1.3 1.3z" fill="#04201B"/></svg><i class="ring-role-txt" id="ringRoleTxt"></i></span><span class="ring-flag" id="ringFlag"></span></div>
    <div class="ring-pin" id="ringPin"></div>
    <div class="ring-presence" id="ringPresence"></div>
    <div class="sub" id="ringSub">is calling you&hellip;</div>
    <div class="ring-actions">
      <div class="ra">
        <button class="rc rc-voice" id="acceptVoiceBtn" title="Answer with microphone only (camera off)">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z"/><path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.9V21a1 1 0 1 0 2 0v-3.1A7 7 0 0 0 19 11z"/></svg>
        </button>
        <span class="ra-lbl">Voice</span>
      </div>
      <div class="ra" id="acceptVideoWrap">
        <button class="rc rc-video" id="acceptBtn" title="Answer with the camera on">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>
        </button>
        <span class="ra-lbl">Video</span>
      </div>
      <div class="ra">
        <button class="rc rc-decline" id="declineBtn" title="Decline the call">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.7l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.51-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
        </button>
        <span class="ra-lbl">Decline</span>
      </div>
    </div>
    <div class="ring-extra">
      <button class="rx" id="toVoicemailBtn" type="button" title="Decline — they'll be offered to leave you a voice message">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6.5" cy="12" r="3.2"/><circle cx="17.5" cy="12" r="3.2"/><path d="M6.5 15.2h11"/></svg>
        Send to voicemail
      </button>
      <button class="rx" id="typeReplyBtn" type="button" title="Text them instead — sending declines the call">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1z"/></svg>
        Message&hellip;
      </button>
    </div>
    <div class="quick-replies" id="quickReplies">
      <button type="button" class="qr-opt" data-msg="I'll call you back shortly.">I'll call you back shortly</button>
      <button type="button" class="qr-opt" data-msg="Can't talk right now — text me.">Can't talk right now — text me</button>
      <button type="button" class="qr-opt" data-msg="On my way.">On my way</button>
      <div class="custom-reply">
        <input id="customReplyInput" maxlength="300" placeholder="Or type your own&hellip;">
        <button id="customReplySend" type="button" aria-label="Send the message and decline the call">&uarr;</button>
      </div>
    </div>
  </div>
</div>

<div class="relay-toast" id="toast"></div>

<div class="boot" id="boot"><div class="spin"></div><div class="t">Connecting&hellip;</div></div>

<div class="version-tag">© ${BUILD_YEAR} RELAY · <span class="ver-hl">v${APP_VERSION}</span> · <span class="ver-hl">${BUILD_DATE}</span></div>
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

.relay-root .relay-brand{display:flex;align-items:center;gap:11px;font-family:"Bricolage Grotesque",sans-serif;font-weight:800;letter-spacing:-.02em}
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
.relay-root .relay-btn{width:100%;border:none;border-radius:14px;padding:17px;font-family:"Bricolage Grotesque",sans-serif;font-weight:700;
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
.relay-root .me .av{width:38px;height:38px;border-radius:11px;background:var(--grad);display:grid;place-items:center;color:#04201B;font-weight:800;font-family:"Bricolage Grotesque",sans-serif;font-size:16px}
.relay-root .me .meta{line-height:1.25}
.relay-root .me .meta b{font-weight:600;font-size:14px}
.relay-root .me .meta span{display:block;font-size:12px;color:var(--muted)}

.relay-root .lobby-body{flex:1;min-height:0;display:grid;grid-template-columns:1.1fr .9fr;gap:0}
@media (max-width:860px){.relay-root .lobby-body{grid-template-columns:1fr;overflow:auto}}

.relay-root .dial-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px 20px;gap:20px}
.relay-root .mycode{text-align:center}
.relay-root .mycode .lbl{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);margin-bottom:8px}
.relay-root .mycode .num{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:38px;letter-spacing:.16em;
  background:var(--grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.relay-root .copy{margin-top:8px;background:var(--surface);border:1px solid var(--border);color:var(--muted);
  font-size:12px;padding:6px 13px;border-radius:9px;cursor:pointer;transition:.15s;font-family:inherit}
.relay-root .copy:hover{border-color:var(--accent);color:var(--accent)}

.relay-root .display{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:30px;letter-spacing:.22em;min-height:42px;
  color:var(--text);text-align:center;width:100%;max-width:320px}
.relay-root .display.empty{color:var(--faint)}
.relay-root .pad{display:grid;grid-template-columns:repeat(3,1fr);gap:13px;width:min(320px,80vw)}
.relay-root .relay-key{aspect-ratio:1.35;background:var(--surface);border:1px solid var(--border);border-radius:16px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:.12s;user-select:none}
.relay-root .relay-key:hover{background:var(--surface2);border-color:var(--border2)}
.relay-root .relay-key:active{transform:scale(.94);border-color:var(--accent)}
.relay-root .relay-key .d{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:25px}
.relay-root .relay-key .l{font-size:9px;letter-spacing:.2em;color:var(--faint);margin-top:2px;height:11px}
.relay-root .dial-actions{display:flex;gap:13px;width:min(320px,80vw)}
.relay-root .call-btn{flex:1;border:none;border-radius:16px;padding:16px;background:var(--grad);color:#04201B;
  font-family:"Bricolage Grotesque",sans-serif;font-weight:700;font-size:16px;cursor:pointer;display:flex;
  align-items:center;justify-content:center;gap:9px;transition:.15s;box-shadow:0 10px 26px -12px rgba(63,224,197,.6)}
.relay-root .call-btn:hover{transform:translateY(-2px)}
.relay-root .call-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.relay-root .back-key{width:58px;background:var(--surface);border:1px solid var(--border);border-radius:16px;color:var(--muted);
  cursor:pointer;font-size:20px;transition:.12s}
.relay-root .back-key:hover{border-color:var(--danger);color:var(--danger)}

.relay-root .directory{border-left:1px solid var(--border);padding:24px 22px;overflow:auto}
@media (max-width:860px){.relay-root .directory{border-left:none;border-top:1px solid var(--border)}}
.relay-root .directory h3{font-family:"Bricolage Grotesque",sans-serif;font-weight:600;font-size:13px;letter-spacing:.04em;
  text-transform:uppercase;color:var(--muted);margin-bottom:16px;display:flex;align-items:center;gap:8px}
.relay-root .live-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent)}
.relay-root .relay-usr{display:flex;align-items:center;gap:13px;padding:12px;border-radius:13px;cursor:pointer;transition:.13s;border:1px solid transparent}
.relay-root .relay-usr:hover{background:var(--surface);border-color:var(--border)}
.relay-root .relay-usr .av{width:40px;height:40px;border-radius:12px;background:var(--surface2);display:grid;place-items:center;
  font-family:"Bricolage Grotesque",sans-serif;font-weight:700;color:var(--accent);font-size:16px;border:1px solid var(--border)}
.relay-root .relay-usr .info{flex:1;min-width:0}
.relay-root .relay-usr .info b{font-weight:600;font-size:15px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.relay-root .relay-usr .info span{font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--muted);letter-spacing:.1em}
.relay-root .relay-usr .go{opacity:0;color:var(--accent);font-size:18px;transition:.13s}
.relay-root .relay-usr:hover .go{opacity:1}
.relay-root .empty-dir{color:var(--faint);font-size:13px;line-height:1.7;padding:8px 4px}
.relay-root .share-box{margin-top:20px;background:var(--surface);border:1px solid var(--border);border-radius:13px;padding:15px}
.relay-root .share-box .t{font-size:12px;color:var(--muted);margin-bottom:9px;display:flex;align-items:center;gap:7px}
.relay-root .share-box .url{font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--accent2);word-break:break-all;line-height:1.5;cursor:pointer}
.relay-root .share-box .url:hover{text-decoration:underline}

.relay-root .overlay{position:fixed;inset:0;z-index:50;background:rgba(4,5,8,.72);backdrop-filter:blur(8px);
  display:none;align-items:center;justify-content:center}
.relay-root .overlay.active{display:flex;animation:relayFade .25s ease both}
/* ── incoming-call card (v2.97 redesign — flashy/glossy, motion-gated) ── */
.relay-root .ring-card{width:min(390px,92vw);border-radius:28px;padding:30px 26px 24px;text-align:center;position:relative;
  background:linear-gradient(175deg,rgba(34,40,52,.96),rgba(14,17,23,.98));
  border:1px solid rgba(255,255,255,.12);
  box-shadow:0 40px 110px -24px rgba(0,0,0,.85),0 0 0 1px rgba(63,224,197,.08),inset 0 1px 0 rgba(255,255,255,.12)}
.relay-root .ring-av-wrap{position:relative;width:126px;height:126px;margin:0 auto 14px}
.relay-root .ring-av-wrap .av,.relay-root .ring-av-img{position:absolute;inset:13px;width:100px;height:100px;border-radius:50%;
  display:grid;place-items:center;color:#04201B;font-family:"Bricolage Grotesque",sans-serif;font-weight:800;font-size:36px;
  background:var(--grad);box-shadow:0 14px 44px -10px rgba(45,212,191,.45)}
.relay-root .ring-av-img{object-fit:cover;background:#10131a;border:1px solid rgba(255,255,255,.14)}
/* The rotating gradient ORBIT ("a ring line keeps going round and round"). */
.relay-root .ring-orbit{position:absolute;inset:0;border-radius:50%;
  background:conic-gradient(from 0deg,transparent 0deg,transparent 30deg,#3FE0C5 110deg,#6EE7FF 170deg,rgba(110,231,255,.15) 220deg,transparent 300deg);
  -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 5px),#000 calc(100% - 4px));
  mask:radial-gradient(farthest-side,transparent calc(100% - 5px),#000 calc(100% - 4px))}
/* Radiating halo pulses behind the avatar. */
.relay-root .ring-halo{position:absolute;inset:8px;border-radius:50%;border:2px solid rgba(63,224,197,.5);opacity:0}
.relay-root .ring-halo.h2{border-color:rgba(110,231,255,.4)}
.relay-root .ring-card .who{font-family:"Bricolage Grotesque",sans-serif;font-weight:700;font-size:27px;margin-bottom:2px;
  display:flex;align-items:center;justify-content:center;gap:8px}
/* v2.99.6: the caller's badge is TIERED (blue Guest / green Registered /
   yellow Admin — color set inline by presentRingProfile) with the tier name
   in tiny type right under the mark (owner spec). */
.relay-root .ring-verified{display:inline-flex;flex-direction:column;align-items:center;color:#3FE0C5}
.relay-root .ring-verified svg{width:19px;height:19px}
.relay-root .ring-role-txt{font-style:normal;font-size:7.5px;font-weight:800;line-height:1;margin-top:1px;letter-spacing:.02em}
.relay-root .ring-role-txt:empty{display:none}
.relay-root .ring-card .ring-flag{font-size:22px;line-height:1}
.relay-root .ring-card .ring-pin{font-family:"JetBrains Mono",monospace;font-size:15px;letter-spacing:.08em;color:var(--accent);margin-bottom:2px}
.relay-root .ring-presence{min-height:17px;font-size:12.5px;font-weight:600;color:#3ddc84}
.relay-root .ring-presence:empty{display:none}
.relay-root .ring-card .sub{color:var(--muted);font-size:14px;margin:2px 0 20px}
/* THREE round glossy buttons with labels. */
.relay-root .ring-actions{display:flex;justify-content:center;gap:30px}
.relay-root .ra{display:flex;flex-direction:column;align-items:center;gap:8px}
.relay-root .ra-lbl{font-size:12px;font-weight:600;color:var(--muted);letter-spacing:.02em}
.relay-root .rc{position:relative;width:64px;height:64px;border-radius:50%;border:none;cursor:pointer;color:#fff;
  display:grid;place-items:center;transition:transform .16s cubic-bezier(0.23,1,0.32,1),box-shadow .16s}
.relay-root .rc svg{width:26px;height:26px;position:relative;z-index:1}
/* Glossy top highlight on every round button. */
.relay-root .rc::before{content:"";position:absolute;inset:2px;border-radius:50%;pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.38),rgba(255,255,255,.06) 46%,transparent 60%)}
.relay-root .rc:hover{transform:translateY(-2px) scale(1.04)}
.relay-root .rc:active{transform:scale(.94)}
.relay-root .rc-voice{background:linear-gradient(145deg,#34d399,#059669);box-shadow:0 12px 30px -8px rgba(16,185,129,.65),inset 0 1px 0 rgba(255,255,255,.3)}
.relay-root .rc-video{background:linear-gradient(145deg,#3FE0C5,#0e7490);box-shadow:0 12px 30px -8px rgba(63,224,197,.6),inset 0 1px 0 rgba(255,255,255,.3)}
.relay-root .rc-decline{background:linear-gradient(145deg,#FF5C72,#E62E4D);box-shadow:0 12px 30px -8px rgba(255,59,92,.65),inset 0 1px 0 rgba(255,255,255,.3)}
/* Answer-side ripple ring that keeps pulsing outward. */
.relay-root .rc-voice::after,.relay-root .rc-video::after{content:"";position:absolute;inset:-4px;border-radius:50%;
  border:2px solid rgba(52,211,153,.55);opacity:0;pointer-events:none}
.relay-root .rc-video::after{border-color:rgba(63,224,197,.55)}
/* Voicemail + Message row. */
.relay-root .ring-extra{display:flex;gap:9px;margin-top:20px}
.relay-root .rx{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;border-radius:13px;padding:11px 8px;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:var(--text);
  font-size:12.5px;font-weight:600;font-family:inherit;cursor:pointer;transition:.15s}
.relay-root .rx svg{width:16px;height:16px;flex-shrink:0;color:var(--accent)}
.relay-root .rx:hover{background:rgba(255,255,255,.1);border-color:rgba(63,224,197,.4)}
.relay-root .quick-replies{display:none;margin-top:12px;gap:8px;flex-direction:column}
.relay-root .quick-replies.open{display:flex;animation:relayFade .2s ease both}
.relay-root .qr-opt{border:1px solid var(--border2);background:var(--surface2);color:var(--text);border-radius:12px;
  padding:11px 14px;font-size:14px;font-family:inherit;cursor:pointer;text-align:left;transition:.15s}
.relay-root .qr-opt:hover{border-color:var(--accent);color:var(--accent)}
/* Type-your-own reply (v2.97): sending messages the caller AND declines. */
.relay-root .custom-reply{display:flex;gap:8px}
.relay-root .custom-reply input{flex:1;background:var(--surface);border:1px solid var(--border2);border-radius:12px;
  padding:11px 14px;color:var(--text);font-family:inherit;font-size:14px;outline:none}
.relay-root .custom-reply input:focus{border-color:var(--accent)}
.relay-root .custom-reply button{width:46px;border:none;border-radius:12px;background:var(--grad);color:#04201B;
  font-size:17px;font-weight:700;cursor:pointer}
/* All ring-card motion is gated (house rule). */
@media (prefers-reduced-motion:no-preference){
  .relay-root .ring-orbit{animation:relayOrbit 1.5s linear infinite}
  .relay-root .ring-halo{animation:relayHalo 1.9s ease-out infinite}
  .relay-root .ring-halo.h2{animation-delay:.95s}
  .relay-root .rc-voice{animation:relayBob 1.5s ease-in-out infinite}
  .relay-root .rc-video{animation:relayBob 1.5s ease-in-out .25s infinite}
  .relay-root .rc-voice::after,.relay-root .rc-video::after{animation:relayRipple 1.6s ease-out infinite}
  .relay-root .rc-video::after{animation-delay:.4s}
  .relay-root .rc-decline{animation:relayNudge 2.6s ease-in-out infinite}
}
@keyframes relayOrbit{to{transform:rotate(360deg)}}
@keyframes relayHalo{0%{transform:scale(1);opacity:.85}100%{transform:scale(1.5);opacity:0}}
@keyframes relayBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes relayRipple{0%{transform:scale(1);opacity:.8}100%{transform:scale(1.45);opacity:0}}
@keyframes relayNudge{0%,86%,100%{transform:rotate(0)}90%{transform:rotate(-7deg)}94%{transform:rotate(7deg)}98%{transform:rotate(-4deg)}}

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
.relay-root .call-head .timer{font-family:"JetBrains Mono",monospace;color:var(--text);font-size:14px}
.relay-root .call-main{flex:1;min-height:0;display:flex}
/* ── pre-connect dial screen ─────────────────────────────────────────
   While an OUTGOING dial is in flight (#call.pre-connect), a dedicated
   phone-style dialing card replaces the grid — callee avatar/number/name,
   a Voice/Video mode chip, and the live staged status (Calling… → Ringing…
   → Connecting…). Every control except End Call is hidden; the full in-call
   interface appears only once the call is actually established. */
.relay-root .dial-card{display:none;flex:1;min-height:0;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:24px}
.relay-root #call.pre-connect .dial-card{display:flex;animation:relayFade .3s ease both}
.relay-root #call.pre-connect .call-main .grid{display:none}
.relay-root #call.pre-connect .ctrl-bar .ctrl{display:none}
/* GRID, not flex (v2.98.3): .ctrl centers its glyph with display:grid +
   place-items:center. This un-hide rule used display:flex, and flexbox has
   no justify-items — the handset fell back to flex-start and sat pinned to
   the LEFT edge of the big red circle (owner screenshot). */
.relay-root #call.pre-connect .ctrl-bar .ctrl.hangup{display:grid}
.relay-root .dial-card .dc-av{width:96px;height:96px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:700;color:var(--text);background:linear-gradient(160deg,#262b36,#14171d);border:1px solid var(--border);box-shadow:0 18px 50px rgba(0,0,0,.45);margin-bottom:8px}
.relay-root .dial-card .dc-num{font-family:"JetBrains Mono",monospace;font-size:34px;font-weight:700;letter-spacing:.08em;color:var(--text)}
.relay-root .dial-card .dc-name{font-size:17px;color:var(--muted)}
.relay-root .dial-card .dc-mode{font-size:12px;font-weight:700;letter-spacing:.04em;padding:5px 14px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid var(--border);color:var(--muted)}
.relay-root .dial-card .dc-mode.video{background:rgba(124,92,255,.16);border-color:rgba(124,92,255,.45);color:#c4b5ff}
.relay-root .dial-card .dc-status{display:flex;align-items:center;gap:9px;margin-top:10px;font-size:15px;font-weight:600;color:var(--muted)}
.relay-root .dial-card .dc-dot{width:9px;height:9px;border-radius:50%;background:#8ab4ff;box-shadow:0 0 10px #8ab4ff;animation:relayPulse2 1.1s ease-in-out infinite}
.relay-root .dial-card.st-ringing .dc-dot{background:#3ddc84;box-shadow:0 0 12px #3ddc84;animation-duration:.8s}
.relay-root .dial-card.st-ringing .dc-status{color:#3ddc84}
.relay-root .dial-card.st-connecting .dc-dot,.relay-root .dial-card.st-encrypting .dc-dot{background:#f5b338;box-shadow:0 0 10px #f5b338}
.relay-root .call-head .ct.st-calling .live-dot{background:#8ab4ff;box-shadow:0 0 10px #8ab4ff;animation:relayPulse2 1.2s ease-in-out infinite}
.relay-root .call-head .ct.st-ringing .live-dot{background:#3ddc84;box-shadow:0 0 10px #3ddc84;animation:relayPulse2 .8s ease-in-out infinite}
.relay-root .grid{flex:1;min-height:0;padding:16px;display:grid;gap:12px;align-content:center}
.relay-root .relay-tile{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:18px;overflow:hidden;
  min-height:0;display:flex;align-items:center;justify-content:center}
.relay-root .relay-tile video{width:100%;height:100%;object-fit:cover;background:#000}
/* Hide the inner video for audio-only tiles with visibility, NOT display:none.
   LiveKit adaptiveStream samples element visibility on track.attach() and PAUSES
   inbound video for any element whose computed display is none — so an
   audio-subscribes-before-video race (common with 3+ parties) leaves that
   participant's camera stuck/black. visibility:hidden keeps display non-none
   (video keeps flowing) while hiding the empty/old frame; the avatar (.ph)
   overlays it for true audio-only participants. */
.relay-root .relay-tile.audio-only video{visibility:hidden}
/* ── active-speaker / spotlight view (v2.35) ──────────────────────────────
   Tiles are clickable to spotlight. layoutGrid() toggles .spotlight/.compact on
   the grid and .is-spotlight/.is-thumb/.speaking on tiles, and sets the grid
   template inline; these rules just style those states. */
.relay-root .relay-tile{cursor:pointer}
.relay-root .relay-tile.is-spotlight{box-shadow:inset 0 0 0 2px var(--accent)}
.relay-root .relay-tile.speaking{outline:2px solid var(--relay-online,#22c55e);outline-offset:-2px}
.relay-root .relay-tile.screen video{object-fit:contain;background:#000}
/* Colourful "I'm talking" sound-wave under the avatar/name (cam-off speakers):
   five rainbow bars that bounce like an equaliser. Hidden unless .speaking. */
.relay-root .relay-tile .sound-wave{display:none;align-items:flex-end;justify-content:center;gap:3px;height:18px;margin-top:3px}
.relay-root .relay-tile.speaking .sound-wave{display:flex}
.relay-root .relay-tile .sound-wave i{width:3px;height:5px;border-radius:3px;background:#22c55e;display:block}
@media (prefers-reduced-motion: no-preference){
  .relay-root .relay-tile.speaking .sound-wave i{animation:relayWave .9s ease-in-out infinite}
  .relay-root .relay-tile.speaking .sound-wave i:nth-child(1){animation-delay:0s;background:#f43f5e}
  .relay-root .relay-tile.speaking .sound-wave i:nth-child(2){animation-delay:.12s;background:#f59e0b}
  .relay-root .relay-tile.speaking .sound-wave i:nth-child(3){animation-delay:.24s;background:#22c55e}
  .relay-root .relay-tile.speaking .sound-wave i:nth-child(4){animation-delay:.36s;background:#3b82f6}
  .relay-root .relay-tile.speaking .sound-wave i:nth-child(5){animation-delay:.48s;background:#a855f7}
}
@keyframes relayWave{0%,100%{height:5px}50%{height:18px}}
/* Cam-off display: full name under the avatar (never a blank black box). */
.relay-root .relay-tile .ph-name{font-size:14px;font-weight:600;color:var(--text);max-width:84%;text-align:center;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Per-tile info chip: device type + live connection speed (e.g. "5.2 Mbps").
   Pinned to the TOP-right so it never collides with the bottom-left name label
   (which, with a Host badge + flag, can be wide on a narrow tile). */
.relay-root .relay-tile .tile-info{position:absolute;right:10px;top:11px;display:flex;gap:6px;align-items:center;
  pointer-events:none;max-width:calc(100% - 20px);flex-wrap:wrap;justify-content:flex-end}
.relay-root .relay-tile .tile-info span{background:rgba(8,9,12,.62);backdrop-filter:blur(6px);padding:3px 7px;border-radius:7px;
  font-size:10px;font-weight:600;color:#cbd5e1;line-height:1.2}
.relay-root .relay-tile .tile-info span:empty{display:none}
/* Thumbnails in the spotlight filmstrip are tiny — drop the info chip there. */
.relay-root #videoGrid.spotlight .relay-tile.is-thumb .tile-info{display:none}
/* Active-speaking cue: a glowing ring + a soft sound-wave halo on the avatar.
   The static outline always marks the speaker; the pulse is motion-gated. */
@media (prefers-reduced-motion: no-preference){
  .relay-root .relay-tile.speaking{animation:relaySpeakPulse 1.4s ease-in-out infinite}
  /* Avatar breathes (heart-beat scale) with a colour-cycling glow ring. */
  .relay-root .relay-tile.speaking .ph .av{animation:relayAvBreath 1.4s ease-in-out infinite}
}
@keyframes relaySpeakPulse{0%,100%{box-shadow:inset 0 0 0 0 rgba(34,197,94,0)}50%{box-shadow:inset 0 0 22px 0 rgba(34,197,94,.30)}}
@keyframes relayAvBreath{
  0%{transform:scale(1);box-shadow:0 0 0 0 rgba(244,63,94,.55)}
  35%{transform:scale(1.07);box-shadow:0 0 0 9px rgba(245,158,11,.0),0 0 20px 5px rgba(245,158,11,.5)}
  70%{transform:scale(1.02);box-shadow:0 0 0 14px rgba(59,130,246,0),0 0 22px 7px rgba(59,130,246,.42)}
  100%{transform:scale(1);box-shadow:0 0 0 0 rgba(168,85,247,.55)}
}
.relay-root #videoGrid.spotlight .relay-tile.is-thumb .ph .av{width:46px;height:46px;font-size:20px}
.relay-root #videoGrid.spotlight .relay-tile.is-thumb .nm{font-size:11px;padding:3px 7px}
.relay-root #videoGrid.compact{padding:8px;gap:8px}
.relay-root .relay-tile .ph{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}
/* SELF tile: hide the centered avatar/name placeholder once the camera is on
   (remote tiles toggle .ph inline via JS; the self tile didn't, so the big name
   used to sit over your own face). Shown again only when cam-off (.audio-only)
   or while sharing your screen has its own .screen handling. */
.relay-root .relay-tile.you:not(.audio-only) .ph{display:none}
.relay-root .relay-tile .ph .av{width:74px;height:74px;border-radius:24px;background:var(--surface2);border:1px solid var(--border);
  display:grid;place-items:center;font-family:"Bricolage Grotesque",sans-serif;font-weight:800;font-size:30px;color:var(--accent)}
.relay-root .relay-tile .nm{position:absolute;left:12px;bottom:11px;display:flex;align-items:center;gap:7px;max-width:calc(100% - 24px);
  background:rgba(8,9,12,.62);backdrop-filter:blur(6px);padding:5px 11px;border-radius:9px;font-size:13px;font-weight:600;
  white-space:nowrap;overflow:hidden}
/* The display name itself truncates with an ellipsis (the badge/flag stay). */
.relay-root .relay-tile .nm .nm-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.relay-root .relay-tile.you .nm{background:rgba(63,224,197,.2);color:var(--accent)}
/* "connecting…" sits TOP-LEFT now (the info chip owns the top-right corner). */
.relay-root .connecting{position:absolute;top:11px;left:12px;font-size:11px;color:var(--warn);background:rgba(255,180,84,.14);
  padding:3px 9px;border-radius:7px;letter-spacing:.04em}

.relay-root .chat{width:320px;border-left:1px solid var(--border);display:none;flex-direction:column;background:var(--bg2)}
.relay-root .chat.open{display:flex}
/* Mobile chat (v2.96.1 redesign): a BOTTOM SHEET, not a full-screen sheet —
   the top strip of the call (and the floating End button) stays visible and
   untouched, the sheet has a real opaque surface + rounded top, and the
   composer clears the iOS home-bar via safe-area padding. */
@media (max-width:680px){.relay-root .chat{position:fixed;left:0;right:0;bottom:0;top:auto;width:100%;height:min(72dvh,560px);z-index:60;
  border-left:none;border-top:1px solid var(--border2);border-radius:22px 22px 0 0;background:var(--bg2);
  box-shadow:0 -18px 60px -18px rgba(0,0,0,.85)}
  .relay-root .chat-head{padding:13px 16px;justify-content:flex-start;gap:12px}
  /* Close X on the LEFT so it can never collide with the top-right End pill. */
  .relay-root .chat-head .chat-close-btn{order:-1}
  .relay-root .chat-input{padding:11px 12px max(11px,env(safe-area-inset-bottom))}}
.relay-root .chat-head{padding:15px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;
  font-family:"Bricolage Grotesque",sans-serif;font-weight:600;font-size:15px}
.relay-root .chat-head .chat-title{display:flex;align-items:center;gap:8px}
/* Obvious, high-contrast close button (the old tiny grey × was unfindable on
   the full-screen mobile chat overlay). */
.relay-root .chat-close-btn{appearance:none;-webkit-appearance:none;border:1px solid var(--border2);background:var(--surface2);color:var(--text);
  width:38px;height:38px;border-radius:50%;display:grid;place-items:center;cursor:pointer;transition:.15s;flex-shrink:0}
.relay-root .chat-close-btn svg{width:18px;height:18px}
.relay-root .chat-close-btn:hover,.relay-root .chat-close-btn:active{background:var(--accent);color:#04201B;border-color:var(--accent)}
@media (max-width:680px){.relay-root .chat-close-btn{width:44px;height:44px}.relay-root .chat-close-btn svg{width:21px;height:21px}}
.relay-root .chat-log{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:11px}
/* Chat rows (v2.96.1): avatar disc + name + time above each bubble — MINE on
   the right, THEIRS on the left (owner spec). */
.relay-root .mrow{display:flex;gap:8px;align-items:flex-end;max-width:88%}
.relay-root .mrow.them{align-self:flex-start}
.relay-root .mrow.me{align-self:flex-end;flex-direction:row-reverse}
.relay-root .mrow .mav{width:28px;height:28px;border-radius:50%;background:var(--surface2);border:1px solid var(--border);
  display:grid;place-items:center;font-size:11px;font-weight:700;color:var(--accent);flex-shrink:0}
.relay-root .mrow.me .mav{color:#04201B;background:var(--grad);border:none}
.relay-root .mrow .mbody{display:flex;flex-direction:column;min-width:0}
.relay-root .mrow.me .mbody{align-items:flex-end}
.relay-root .mrow .mmeta{display:flex;gap:7px;align-items:baseline;margin:0 2px 3px}
.relay-root .mrow .mname{font-size:11px;font-weight:600;color:var(--accent)}
.relay-root .mrow.me .mname{color:var(--faint)}
.relay-root .mrow .mtime{font-size:10px;color:var(--faint);font-family:"JetBrains Mono",monospace}
.relay-root .relay-msg{max-width:100%;padding:9px 13px;border-radius:13px;font-size:14px;line-height:1.4;word-break:break-word}
.relay-root .relay-msg .au{font-size:11px;color:var(--accent);font-weight:600;margin-bottom:2px}
.relay-root .relay-msg.them{background:var(--surface);border:1px solid var(--border);align-self:flex-start;border-bottom-left-radius:4px}
.relay-root .relay-msg.me{background:rgba(63,224,197,.16);align-self:flex-end;border-bottom-right-radius:4px}
.relay-root .relay-msg.sys{align-self:center;color:var(--faint);font-size:12px;background:none}
.relay-root .chat-input{padding:13px;border-top:1px solid var(--border);display:flex;gap:9px}
.relay-root .chat-input input{flex:1;background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:11px 14px;
  color:var(--text);font-family:inherit;font-size:14px;outline:none;min-width:0}
.relay-root .chat-input input:focus{border-color:var(--accent)}
.relay-root .chat-input button{background:var(--grad);border:none;border-radius:11px;width:44px;color:#04201B;font-size:17px;cursor:pointer;flex-shrink:0}
/* Emoji palette + toggle (v2.99.4): the composer gets a real emoji picker like
   the main Messages tab. The palette opens between the log and the input. */
.relay-root .chat-input .chat-emoji-btn{background:var(--surface);border:1px solid var(--border);color:var(--text2,#9aa);
  display:grid;place-items:center}
.relay-root .chat-input .chat-emoji-btn svg{width:20px;height:20px}
.relay-root .chat-input .chat-emoji-btn.open,.relay-root .chat-input .chat-emoji-btn:hover{color:var(--accent);border-color:var(--accent);background:var(--surface)}
.relay-root .chat-emojis{display:none;flex-wrap:wrap;gap:2px;padding:8px 10px;border-top:1px solid var(--border);
  max-height:132px;overflow-y:auto;background:var(--bg2)}
.relay-root .chat-emojis.open{display:flex}
.relay-root .chat-emojis button{background:none;border:none;font-size:21px;line-height:1;padding:5px;border-radius:8px;cursor:pointer;font-family:inherit}
.relay-root .chat-emojis button:hover{background:var(--surface)}
/* Glass identity bubble (v2.99.4 owner spec): every in-call chat message shows
   the sender's icon + username + PIN (+ time) in its OWN frosted glass chip
   above the text bubble — mine on the right, theirs on the left. */
.relay-root .mident{display:flex;align-items:center;gap:7px;padding:4px 10px 4px 5px;border-radius:999px;margin:0 2px 4px;
  width:max-content;max-width:100%;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:inset 0 1px 0 rgba(255,255,255,.07)}
.relay-root .mrow.me .mident{margin-left:auto;background:rgba(63,224,197,.10);border-color:rgba(63,224,197,.22)}
.relay-root .mident .mav{width:22px;height:22px;font-size:9px;overflow:hidden;background-size:cover;background-position:center;border-radius:50%}
.relay-root .mident .mwho{display:flex;align-items:baseline;gap:6px;min-width:0}
.relay-root .mident .mwho b{font-size:11.5px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px}
.relay-root .mident .mwho i{font-style:normal;font-family:"JetBrains Mono",monospace;font-size:9.5px;color:var(--text2,#9aa);letter-spacing:.06em;white-space:nowrap}
.relay-root .mident .mtime{font-size:9.5px;color:var(--faint);font-family:"JetBrains Mono",monospace}

/* Glassmorphic frosted control bar */
.relay-root .controls{display:flex;align-items:center;justify-content:center;gap:14px;padding:18px 16px max(22px,env(safe-area-inset-bottom));position:relative;background:none;border-top:none}
.relay-root .ctrl-bar{display:flex;align-items:center;gap:10px;padding:10px 14px;
  flex-wrap:wrap;justify-content:center;max-width:min(96vw,720px);
  background:rgba(20,23,29,.72);border:1px solid rgba(255,255,255,.10);border-radius:24px;
  box-shadow:0 16px 50px -18px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.06);
  backdrop-filter:blur(20px) saturate(1.4);-webkit-backdrop-filter:blur(20px) saturate(1.4)}
/* v2.99.4 (owner spec): each control is a COLUMN — a colored round icon chip
   (.ctrl-ic) with a small text LABEL underneath (.ctrl-lbl) — so every button
   says what it does. State classes (.on/.off) stay on the BUTTON (JS
   unchanged); the chip + label restyle from them. The hang-up button keeps its
   own dedicated circle structure below. */
.relay-root .ctrl{width:auto;height:auto;min-width:52px;border-radius:14px;background:none;border:none;
  color:var(--text);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px;padding:0;
  transition:transform .16s cubic-bezier(0.23,1,0.32,1);position:relative;font-family:inherit}
.relay-root .ctrl .ctrl-ic{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;position:relative;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);
  transition:background .16s,border-color .16s,box-shadow .16s;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.relay-root .ctrl:hover{transform:translateY(-1px)}
.relay-root .ctrl:hover .ctrl-ic{border-color:rgba(255,255,255,.22);box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 6px 18px -8px rgba(0,0,0,.6)}
.relay-root .ctrl:active{transform:scale(.94)}
.relay-root .ctrl-lbl{font-size:10px;font-weight:600;letter-spacing:.02em;color:var(--text2,#9aa);line-height:1;white-space:nowrap}
/* Distinct color identity per control (owner: "all these icons different
   colors with a very nice shape"). Chip tint + icon + label share the hue. */
.relay-root #micBtn .ctrl-ic{color:#34d399;background:rgba(52,211,153,.13);border-color:rgba(52,211,153,.3)}
.relay-root #camBtn .ctrl-ic{color:#38bdf8;background:rgba(56,189,248,.13);border-color:rgba(56,189,248,.3)}
.relay-root #flipCamBtn .ctrl-ic{color:#a78bfa;background:rgba(167,139,250,.13);border-color:rgba(167,139,250,.3)}
.relay-root #screenBtn .ctrl-ic{color:#fbbf24;background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.3)}
.relay-root #qualityBtn .ctrl-ic{color:#f472b6;background:rgba(244,114,182,.12);border-color:rgba(244,114,182,.3)}
.relay-root #audioBtn .ctrl-ic{color:#fb923c;background:rgba(251,146,60,.13);border-color:rgba(251,146,60,.3)}
.relay-root #pipBtn .ctrl-ic{color:#818cf8;background:rgba(129,140,248,.13);border-color:rgba(129,140,248,.3)}
.relay-root #filterBtn .ctrl-ic{color:#e879f9;background:rgba(232,121,249,.12);border-color:rgba(232,121,249,.3)}
.relay-root #addBtn .ctrl-ic{color:var(--accent);background:rgba(63,224,197,.13);border-color:rgba(63,224,197,.3)}
.relay-root #hostBtn .ctrl-ic{color:#facc15;background:rgba(250,204,21,.12);border-color:rgba(250,204,21,.3)}
.relay-root #chatBtn .ctrl-ic{color:#a3e635;background:rgba(163,230,53,.12);border-color:rgba(163,230,53,.3)}
.relay-root #moreBtn .ctrl-ic{color:#cbd5e1;background:rgba(203,213,225,.10);border-color:rgba(203,213,225,.24)}
/* State overrides win over the per-button tints. */
.relay-root .ctrl.off .ctrl-ic{background:rgba(255,92,114,.18);border-color:rgba(255,92,114,.4);color:var(--danger)}
.relay-root .ctrl.off .ctrl-lbl{color:var(--danger)}
.relay-root .ctrl-text .ctrl-ic{font-family:"JetBrains Mono",monospace;font-weight:800;font-size:13px;letter-spacing:.04em}
.relay-root .ctrl svg{width:20px;height:20px}
/* Dual-icon controls (v2.96.1): mic/cam swap to a SLASHED glyph when off —
   and (v2.99.4) their LABELS swap the same way (Mute/Unmute · Cam off/on). */
.relay-root .ctrl .ic-off{display:none}
.relay-root .ctrl.off .ic-on{display:none}
.relay-root .ctrl.off .ic-off{display:block}
.relay-root .ctrl .lbl-off{display:none}
.relay-root .ctrl.off .lbl-on{display:none}
.relay-root .ctrl.off .lbl-off{display:inline}
.relay-root .ctrl .badge{position:absolute;top:-4px;right:-4px;background:var(--accent);color:#04201B;font-size:10px;font-weight:700;
  min-width:17px;height:17px;border-radius:9px;display:grid;place-items:center;padding:0 4px;border:2px solid var(--bg)}
/* Hang-up (v2.96.3 redesign): a proper round red phone button — a perfect
   circle with a larger drawn call-end glyph (the old 66px rounded-rect pill
   read as a blob). The pre-connect dial screen gets a bigger one, iPhone
   style, since it's the only control on that screen. */
.relay-root .ctrl.hangup{width:58px;height:58px;border-radius:50%;background:linear-gradient(145deg,#FF5C72,#E62E4D);border-color:transparent;color:#fff;
  display:grid;place-items:center;padding:0;min-width:0;
  box-shadow:0 10px 26px -8px rgba(255,59,92,.65),inset 0 1px 0 rgba(255,255,255,.25)}
.relay-root .ctrl.hangup svg{width:26px;height:26px}
.relay-root .ctrl.hangup:hover{transform:translateY(-1px);box-shadow:0 14px 32px -8px rgba(255,92,114,.75),inset 0 1px 0 rgba(255,255,255,.25)}
.relay-root .ctrl.hangup:active{transform:scale(.94)}
/* Glossy top highlight (v2.97 — owner: "flashy and glossy"). */
.relay-root .ctrl.hangup::before{content:"";position:absolute;inset:2px;border-radius:50%;pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.35),rgba(255,255,255,.05) 48%,transparent 60%)}
/* Caller-side End Call (v2.98 redesign, owner: "the red one for Hangout…
   it's not nice"): the pre-connect dial screen is the ONE control on an
   otherwise near-empty dark screen, so a bare 72px circle read as a lonely
   dot floating in black. It now sits on its own soft ambient glow (ombré
   halo, not just a drop shadow), a richer two-tone gradient, and a real
   "End Call" caption underneath — grounded, not floating. */
.relay-root .hangup-lbl{display:none}
.relay-root #call.pre-connect .ctrl.hangup{width:76px;height:76px;
  background:linear-gradient(155deg,#FF7A8A 0%,#FF3B5C 55%,#D81B42 100%);
  box-shadow:0 22px 46px -14px rgba(216,27,66,.65),0 0 0 1px rgba(255,255,255,.06) inset}
.relay-root #call.pre-connect .ctrl.hangup svg{width:33px;height:33px}
.relay-root #call.pre-connect .ctrl.hangup .hangup-lbl{display:block;position:absolute;top:calc(100% + 12px);left:50%;
  transform:translateX(-50%);white-space:nowrap;font-family:"Bricolage Grotesque",sans-serif;font-weight:700;
  font-size:13px;letter-spacing:.02em;color:#ffb9c2}
.relay-root #call.pre-connect .ctrl-bar{background:none;border:none;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;padding:0;position:relative;
  /* Undo the mobile "wrap + scroll" override below (max-height/overflow-y:auto)
     — with just ONE button there's nothing to scroll, and auto-overflow was
     clipping the halo glow + "End Call" caption that extend past the bar's
     tight flex box. */
  max-height:none;overflow:visible}
/* The ambient halo: a large, soft, blurred glow sitting BEHIND the button —
   distinct from the tight ripple ring — so the control reads as an
   intentional focal point instead of a small shape adrift in black. */
.relay-root #call.pre-connect .ctrl-bar::before{content:"";position:absolute;left:50%;top:50%;
  width:210px;height:210px;transform:translate(-50%,-50%);border-radius:50%;pointer-events:none;
  background:radial-gradient(circle,rgba(255,59,92,.32) 0%,rgba(255,59,92,.14) 42%,transparent 72%);
  filter:blur(2px)}
/* Dial-screen hang-up breathes + ripples while ringing (motion-gated). */
@media (prefers-reduced-motion:no-preference){
  .relay-root #call.pre-connect .ctrl.hangup{animation:relayBob 1.5s ease-in-out infinite}
  .relay-root #call.pre-connect .ctrl.hangup::after{content:"";position:absolute;inset:-5px;border-radius:50%;
    border:2px solid rgba(255,92,114,.5);animation:relayRipple 1.6s ease-out infinite;pointer-events:none}
  .relay-root #call.pre-connect .ctrl-bar::before{animation:relayHaloPulse 2.4s ease-in-out infinite}
}
@keyframes relayHaloPulse{0%,100%{opacity:.75;transform:translate(-50%,-50%) scale(1)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}}

/* Self-tile camera handling: front cam mirrored locally so user feels natural,
   back cam not mirrored, and outgoing stream NEVER mirrored. */
/* -webkit-transform is REQUIRED alongside the unprefixed form: iOS Safari can
   drop an unprefixed CSS transform on a <video> playing a MediaStream, leaving
   the self-preview unmirrored (or, with object-fit, blank). */
.relay-root .relay-tile.you video{-webkit-transform:scaleX(-1);transform:scaleX(-1)}
.relay-root .relay-tile.you.back-cam video{-webkit-transform:none;transform:none}
/* Screen share: the shared screen must never be mirrored, and should be shown
   in full (letterboxed) rather than cropped like a camera tile. */
.relay-root .relay-tile.you.screen video{-webkit-transform:none;transform:none;object-fit:contain;background:#000}
/* Active control state (e.g. screen-share on) — accent-tinted like .off is red. */
.relay-root .ctrl.on .ctrl-ic{background:rgba(63,224,197,.2);border-color:rgba(63,224,197,.48);color:var(--accent);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 0 12px -2px rgba(63,224,197,.45)}
.relay-root .ctrl.on .ctrl-lbl{color:var(--accent)}
/* Mic VU feedback: a soft accent ring pulses on #micBtn while YOUR mic is picking
   up sound (live AnalyserNode on the local track) — so a forgotten mute (or a
   hot mic you meant to mute) is obvious without anyone having to say something.
   Never applied while .off (muted). transform/opacity-friendly box-shadow ring,
   matching the existing speaking-pulse / call-waiting-pulse pattern. */
.relay-root .ctrl.voiced:not(.off) .ctrl-ic{animation:relayMicVoiced 1.1s ease-out infinite}
@keyframes relayMicVoiced{0%{box-shadow:0 0 0 0 rgba(63,224,197,.45)}100%{box-shadow:0 0 0 7px rgba(63,224,197,0)}}
@media (prefers-reduced-motion: reduce){.relay-root .ctrl.voiced:not(.off) .ctrl-ic{animation:none;box-shadow:0 0 0 3px rgba(63,224,197,.35)}}
/* Record row (now inside the ⋯ More menu), when armed, glows red. */
.relay-root #recordBtn.on{background:rgba(255,76,76,.14)}
.relay-root #recordBtn.on .mm-tx b{color:#ff5d5d}
/* "● REC" live indicator in the call header. */
.relay-root .call-head-right{display:flex;align-items:center;gap:12px}
.relay-root .rec-ind{display:flex;align-items:center;gap:6px;font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.06em;color:#ff5d5d}
.relay-root .rec-blink{width:9px;height:9px;border-radius:50%;background:#ff3b3b;box-shadow:0 0 8px #ff3b3b;animation:relayPulse2 1s ease-in-out infinite}
/* The screen-share button is hidden by default and revealed by JS only when the
   browser actually supports getDisplayMedia (Android Chrome yes, iOS Safari no)
   — see the capability gate in relayClient.ts. So it now shows on mobile where
   supported, instead of being blanket-hidden by viewport. */

/* Filter dock (Snapchat-style horizontal strip) */
.relay-root .filter-dock{position:absolute;left:0;right:0;margin-inline:auto;bottom:96px;width:min(720px,94vw);
  background:rgba(20,23,29,.78);border:1px solid rgba(255,255,255,.10);border-radius:22px;padding:14px 14px 16px;
  box-shadow:0 24px 60px -22px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.05);
  backdrop-filter:blur(20px) saturate(1.4);-webkit-backdrop-filter:blur(20px) saturate(1.4);
  display:none;z-index:35}
/* Cross-browser hardening for the two blurred call surfaces (control bar +
   filter dock) — placed AFTER their base rules. Legibility fallback where
   backdrop-filter is unsupported (older Firefox) or the user asked for reduced
   transparency, and a 10px mobile blur cap (backdrop-filter is the top GPU cost
   on Android) — same tiers as the index.css glass system. */
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
  .relay-root .ctrl-bar{background:rgba(20,23,29,.94)}
  .relay-root .filter-dock{background:rgba(20,23,29,.96)}}
@media (prefers-reduced-transparency:reduce){
  .relay-root .ctrl-bar,.relay-root .filter-dock{background:rgba(20,23,29,.96);backdrop-filter:none;-webkit-backdrop-filter:none}}
@media (max-width:768px){
  .relay-root .ctrl-bar,.relay-root .filter-dock{backdrop-filter:blur(10px) saturate(1.3);-webkit-backdrop-filter:blur(10px) saturate(1.3)}}
.relay-root .filter-dock.open{display:block;animation:relayFade .22s cubic-bezier(0.23,1,0.32,1) both}
.relay-root .filter-dock-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:0 4px}
.relay-root .filter-dock-head .t{font-family:"Bricolage Grotesque",sans-serif;font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:8px}
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
  /* Allow the control bar to wrap to a 2nd row on narrow phones so every button
     (screen-share / record / pip / …) is reachable and never clipped. */
  .relay-root .ctrl-bar{gap:8px;padding:8px 10px;flex-wrap:wrap;justify-content:center;max-width:96vw;max-height:40vh;overflow-y:auto}
  /* Keep a comfortable 44px+ chip touch target even on the narrowest phones
     (the wrap absorbs the extra width; the label extends the hit area). */
  .relay-root .ctrl{min-width:48px}
  .relay-root .ctrl .ctrl-ic{width:44px;height:44px}
  .relay-root .ctrl-lbl{font-size:9.5px}
  .relay-root .ctrl.hangup{width:52px;height:52px}
  /* Clear the phone's home indicator so the wrapped 2nd row is never hidden
     behind it (this is why the screen-share button "couldn't be seen"). */
  .relay-root .controls{padding-bottom:max(22px,env(safe-area-inset-bottom))}
}

.relay-root .relay-toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%) translateY(20px);z-index:80;
  background:var(--surface2);border:1px solid var(--border2);color:var(--text);padding:13px 20px;border-radius:13px;
  font-size:14px;opacity:0;transition:.3s;pointer-events:none;box-shadow:0 16px 40px -12px rgba(0,0,0,.6);max-width:90vw}
.relay-root .relay-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.relay-root .relay-toast.err{border-color:rgba(255,92,114,.4)}

/* Centered via auto margins (NOT transform): the open animation (relayFade) ends
   on transform:none with fill-mode both, which would otherwise wipe a
   translateX(-50%) and shove the pad off the right edge on mobile. Width is
   clamped to the viewport and it scrolls if the keypad makes it taller than the
   screen, so it can never overflow. */
.relay-root .addpad{position:absolute;bottom:84px;left:0;right:0;margin-inline:auto;
  width:min(260px,calc(100vw - 24px));max-height:calc(100dvh - 200px);overflow-y:auto;overflow-x:hidden;
  background:var(--surface);
  border:1px solid var(--border2);border-radius:18px;padding:18px;display:none;flex-direction:column;gap:12px;
  box-shadow:0 24px 60px -20px rgba(0,0,0,.7);z-index:30}
.relay-root .addpad.open{display:flex;animation:relayFade .2s ease both}
.relay-root .addpad-head{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:600;color:var(--text)}
/* ── role badge + host-controls panel (v2.41) ───────────────────────────── */
.relay-root .relay-tile .nm .role-badge{background:var(--accent);color:#04201B;font-size:9px;font-weight:800;
  padding:1px 5px;border-radius:5px;letter-spacing:.02em;text-transform:uppercase}
/* Country flag emoji beside the name (in both the label + cam-off placeholder). */
.relay-root .relay-tile .nm-flag{line-height:1}
.relay-root .relay-tile .nm-flag:not(:empty){margin-right:5px}
.relay-root .relay-tile .ph-name .nm-flag:not(:empty){margin-right:4px;font-size:1.1em}
.relay-root .host-panel{position:absolute;bottom:84px;right:18px;width:320px;max-width:92vw;max-height:66vh;display:none;
  flex-direction:column;background:var(--surface);border:1px solid var(--border2);border-radius:18px;
  box-shadow:0 24px 60px -20px rgba(0,0,0,.7);z-index:31;overflow:hidden}
.relay-root .host-panel.open{display:flex;animation:relayFade .2s ease both}
.relay-root .host-head{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;border-bottom:1px solid var(--border);
  font-family:"Bricolage Grotesque",sans-serif;font-weight:600;font-size:14px}
.relay-root #hostClose{background:none;border:none;color:var(--text2,#9aa);font-size:14px;cursor:pointer;padding:3px 7px;border-radius:8px;font-weight:700}
.relay-root #hostClose:hover{background:var(--bg2);color:var(--text)}
.relay-root .host-actions{display:flex;gap:7px;padding:11px 13px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.relay-root .host-actions button{flex:1;min-width:88px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:9px 6px;
  color:var(--text);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:border-color .12s,background .12s}
.relay-root .host-actions button:hover{border-color:var(--accent);background:var(--surface)}
.relay-root .host-list{overflow-y:auto;padding:8px}
/* v2.99.3: each participant row STACKS (name over actions) and the action
   buttons WRAP — the old single inline row overflowed the panel and clipped the
   last button ("Remove") off the edge (owner screenshot). */
.relay-root .hl-row{display:flex;flex-direction:column;align-items:stretch;gap:8px;padding:10px;border-radius:12px;
  background:var(--bg2);margin-bottom:7px}
.relay-root .hl-row:last-child{margin-bottom:0}
.relay-root .hl-name{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:13.5px;font-weight:600;min-width:0}
.relay-root .hl-name .hl-pin{font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--text2,#9aa);font-weight:500}
.relay-root .hl-badge{background:var(--accent);color:#04201B;font-size:8px;font-weight:800;padding:1px 5px;border-radius:5px;text-transform:uppercase;letter-spacing:.04em}
.relay-root .hl-acts{display:flex;flex-wrap:wrap;gap:6px}
.relay-root .hl-acts button{flex:1 1 auto;min-width:72px;background:var(--surface);border:1px solid var(--border);border-radius:9px;
  padding:8px 10px;color:var(--text);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;
  text-align:center;transition:border-color .12s,background .12s,color .12s}
.relay-root .hl-acts button:hover{border-color:var(--accent);color:var(--accent)}
/* Distinct accents per action so the row is scannable at a glance. */
.relay-root .hl-acts button[data-act="mute"]{color:#fbbf24;border-color:rgba(251,191,36,.28)}
.relay-root .hl-acts button[data-act="mute"]:hover{border-color:#fbbf24;background:rgba(251,191,36,.12)}
.relay-root .hl-acts button[data-act="pin"]{color:#38bdf8;border-color:rgba(56,189,248,.28)}
.relay-root .hl-acts button[data-act="pin"]:hover{border-color:#38bdf8;background:rgba(56,189,248,.12)}
.relay-root .hl-acts button[data-act="cohost"]{color:#a78bfa;border-color:rgba(167,139,250,.28)}
.relay-root .hl-acts button[data-act="cohost"]:hover{border-color:#a78bfa;background:rgba(167,139,250,.12)}
.relay-root .hl-acts button[data-act="makehost"]{color:var(--accent);border-color:rgba(63,224,197,.28)}
.relay-root .hl-acts button[data-act="makehost"]:hover{border-color:var(--accent);background:rgba(63,224,197,.12)}
.relay-root .hl-acts button.hl-danger{color:var(--danger);border-color:rgba(255,92,114,.3)}
.relay-root .hl-acts button.hl-danger:hover{border-color:var(--danger);color:var(--danger);background:rgba(255,92,114,.12)}
.relay-root .hl-empty{padding:18px;text-align:center;font-size:12px;color:var(--text2,#9aa)}
/* Per-tile ⋮ host menu button (corner of each remote tile, moderators only). */
.relay-root .relay-tile .tile-menu-btn{position:absolute;right:8px;bottom:8px;z-index:4;width:30px;height:30px;border-radius:50%;
  border:none;display:none;place-items:center;background:rgba(8,9,12,.62);backdrop-filter:blur(6px);color:#fff;font-size:19px;
  font-weight:800;cursor:pointer;line-height:1;padding:0}
.relay-root #videoGrid.mod-on .relay-tile:not(.you) .tile-menu-btn{display:grid}
.relay-root .relay-tile .tile-menu-btn:hover{background:var(--accent);color:#04201B}
/* Shared bottom-sheet action menu opened by a tile's ⋮ button. */
.relay-root .tile-menu{position:absolute;left:0;right:0;margin-inline:auto;bottom:96px;width:min(260px,90vw);display:none;
  flex-direction:column;background:var(--surface);border:1px solid var(--border2);border-radius:16px;overflow:hidden;
  box-shadow:0 24px 60px -20px rgba(0,0,0,.7);z-index:32}
.relay-root .tile-menu.open{display:flex;animation:relayFade .2s ease both}
.relay-root .tm-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border);
  font-family:"Bricolage Grotesque",sans-serif;font-weight:600;font-size:14px}
.relay-root #tmClose{background:none;border:none;color:var(--text2,#9aa);font-size:14px;cursor:pointer;padding:3px 7px;border-radius:8px;font-weight:700}
.relay-root #tmClose:hover{background:var(--bg2);color:var(--text)}
.relay-root .tm-acts{display:flex;flex-direction:column;padding:6px}
.relay-root .tm-acts button{background:none;border:none;text-align:left;padding:11px 12px;border-radius:10px;color:var(--text);
  font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit}
.relay-root .tm-acts button:hover{background:var(--bg2)}
.relay-root .tm-acts button.tm-danger{color:var(--danger)}
.relay-root .tm-acts button.tm-danger:hover{background:rgba(255,92,114,.14)}
/* ── audio-output picker (speaker / earpiece / headset / Bluetooth) ──────── */
.relay-root .audio-menu{position:absolute;bottom:84px;right:18px;width:248px;max-width:86vw;max-height:50vh;display:none;
  flex-direction:column;background:var(--surface);border:1px solid var(--border2);border-radius:16px;overflow-y:auto;
  box-shadow:0 24px 60px -20px rgba(0,0,0,.7);z-index:31;padding:6px}
.relay-root .audio-menu.open{display:flex;animation:relayFade .2s ease both}
.relay-root .ao-item{background:none;border:none;text-align:left;padding:10px 11px;border-radius:9px;color:var(--text);
  font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:8px}
.relay-root .ao-item:hover{background:var(--bg2)}
.relay-root .ao-item.ao-sel{color:var(--accent)}
.relay-root .ao-item.ao-sel::before{content:"\\2713";font-weight:800}
.relay-root .ao-item:not(.ao-sel)::before{content:"";width:9px}
.relay-root .ao-empty{padding:16px;text-align:center;font-size:12px;color:var(--text2,#9aa)}
/* Mobile sound-route rows (v2.99.4 owner spec): Loudspeaker / Earpiece /
   Bluetooth as a real MENU (the button used to blind-toggle), each with an
   icon tile + a one-line description of what it does. */
.relay-root .ao-item .ao-ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;
  background:rgba(255,255,255,.06);border:1px solid var(--border);font-size:16px;line-height:1}
.relay-root .ao-item .ao-tx{display:flex;flex-direction:column;gap:1px;min-width:0}
.relay-root .ao-item .ao-tx i{font-style:normal;font-size:11px;color:var(--text2,#9aa);font-weight:500;line-height:1.3}
.relay-root .ao-item.ao-dim{opacity:.55}
/* ── ⋯ More menu (v2.99.4): Record + Diagnostics with real labels ────────── */
.relay-root .more-menu{position:absolute;bottom:84px;right:18px;width:300px;max-width:90vw;display:none;
  flex-direction:column;background:var(--surface);border:1px solid var(--border2);border-radius:16px;overflow:hidden;
  box-shadow:0 24px 60px -20px rgba(0,0,0,.7);z-index:31;padding:6px}
.relay-root .more-menu.open{display:flex;animation:relayFade .2s ease both}
.relay-root .mm-item{background:none;border:none;text-align:left;padding:10px 11px;border-radius:11px;color:var(--text);
  cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:11px;transition:background .12s}
.relay-root .mm-item:hover{background:var(--bg2)}
.relay-root .mm-ic{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;
  background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--text2,#9aa)}
.relay-root .mm-ic svg{width:18px;height:18px}
.relay-root .mm-ic.mm-rec{color:#ff5d5d;background:rgba(255,76,76,.12);border-color:rgba(255,76,76,.3)}
.relay-root .mm-tx{display:flex;flex-direction:column;gap:2px;min-width:0}
.relay-root .mm-tx b{font-size:13px;font-weight:600}
.relay-root .mm-tx i{font-style:normal;font-size:11px;color:var(--text2,#9aa);line-height:1.3}
.relay-root #addClose{background:none;border:none;color:var(--text2,#9aa);font-size:14px;line-height:1;cursor:pointer;padding:3px 7px;border-radius:8px;font-weight:700}
.relay-root #addClose:hover{background:var(--bg2);color:var(--text)}
.relay-root .addpad input{background:var(--bg2);border:1px solid var(--border);border-radius:11px;padding:12px;text-align:center;
  font-family:"JetBrains Mono",monospace;font-weight:700;letter-spacing:.18em;color:var(--text);font-size:16px;outline:none}
.relay-root .addpad input:focus{border-color:var(--accent)}
.relay-root .addpad #addGo{background:var(--grad);border:none;border-radius:11px;padding:12px;color:#04201B;font-weight:700;cursor:pointer;font-family:inherit}
/* On-screen keypad inside the add-person window (v2.49) — tap digits to dial the
   number; the invite fires automatically on the 6th digit. */
.relay-root .addpad-keys{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
.relay-root .addpad-key{background:var(--bg2);border:1px solid var(--border);border-radius:11px;padding:9px 0;
  font-family:"JetBrains Mono",monospace;font-weight:700;font-size:17px;color:var(--text);cursor:pointer;transition:background .12s,transform .1s;text-align:center}
.relay-root .addpad-key:hover{background:var(--surface)}
.relay-root .addpad-key:active{transform:scale(.93)}
.relay-root .addpad-key.spacer{visibility:hidden;border:none;background:none}
.relay-root .addpad-hint{font-size:10.5px;color:var(--text2,#9aa);text-align:center;line-height:1.35}

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
.relay-root .conn-step{display:flex;align-items:center;gap:14px;font-family:"Bricolage Grotesque",sans-serif;font-weight:600;font-size:17px;color:var(--faint);opacity:.4;transform:translateX(-6px);transition:.32s cubic-bezier(0.23,1,0.32,1)}
.relay-root .conn-step.active{color:var(--text);opacity:1;transform:none}
.relay-root .conn-step.done{color:var(--accent);opacity:1;transform:none}
.relay-root .conn-tick{width:24px;height:24px;border-radius:50%;border:2px solid var(--border2);display:grid;place-items:center;flex:0 0 auto;transition:.3s}
.relay-root .conn-step.active .conn-tick{border-color:var(--accent);box-shadow:0 0 0 4px rgba(63,224,197,.14)}
.relay-root .conn-step.active .conn-tick::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent);animation:relayPulse2 1s ease-in-out infinite}
.relay-root .conn-step.done .conn-tick{border-color:var(--accent);background:var(--accent)}
.relay-root .conn-step.done .conn-tick::after{content:"✓";color:#04201B;font-size:13px;font-weight:800;line-height:1}
/* Call waiting — a second incoming call during an active call */
.relay-root .call-waiting{position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:36;display:none;align-items:center;gap:14px;background:rgba(20,23,29,.92);border:1px solid var(--border2);border-radius:16px;padding:10px 12px 10px 16px;box-shadow:0 18px 50px -18px rgba(0,0,0,.7);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);max-width:94vw}
/* ── mutual-consent video prompt (1:1): "X wants to start video" ── */
.relay-root .video-ask{position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:37;display:none;align-items:center;gap:14px;background:rgba(20,23,29,.94);border:1px solid rgba(124,92,255,.4);border-radius:16px;padding:10px 12px 10px 16px;box-shadow:0 18px 50px -18px rgba(0,0,0,.7);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);max-width:94vw}
.relay-root .video-ask.show{display:flex;animation:relayFade .25s ease both}
.relay-root .va-info{display:flex;align-items:center;gap:10px;min-width:0}
.relay-root .va-cam{font-size:22px;line-height:1}
.relay-root .va-meta{display:flex;flex-direction:column;min-width:0}
.relay-root .va-meta b{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.relay-root .va-sub{font-size:12px;color:var(--muted)}
.relay-root .va-actions{display:flex;gap:8px}
.relay-root .va-btn{border:none;border-radius:12px;padding:9px 14px;font-family:inherit;font-weight:700;font-size:13px;cursor:pointer;transition:.15s;white-space:nowrap}
.relay-root .va-decline{background:rgba(255,255,255,.08);color:var(--muted);border:1px solid var(--border2)}
.relay-root .va-decline:hover{color:var(--text)}
.relay-root .va-accept{background:rgba(124,92,255,.2);color:#c4b5ff;border:1px solid rgba(124,92,255,.5)}
.relay-root .va-accept:hover{background:rgba(124,92,255,.32)}
@media (max-width:680px){.relay-root .video-ask{flex-direction:column;gap:10px;top:10px;padding:12px 14px}.relay-root .va-actions{width:100%}.relay-root .va-btn{flex:1}}
.relay-root .call-waiting.show{display:flex;animation:cwIn .3s cubic-bezier(0.23,1,0.32,1) both}
@keyframes cwIn{from{opacity:0;transform:translateX(-50%) translateY(-16px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.relay-root .call-waiting .cw-info{font-size:14px;color:var(--text);display:flex;align-items:center;gap:9px}
.relay-root .call-waiting .cw-flag{font-size:20px;line-height:1}
.relay-root .call-waiting .cw-flag:empty{display:none}
.relay-root .call-waiting .cw-meta{display:flex;flex-direction:column;line-height:1.25;min-width:0}
.relay-root .call-waiting .cw-num{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--text2,#9aa)}
.relay-root .call-waiting .cw-num:empty{display:none}
.relay-root .call-waiting .cw-sub{font-size:10.5px;color:var(--text2,#9aa)}
/* "On hold" badge on a participant's tile when they take another call. */
.relay-root .relay-tile.on-hold::after{content:"On hold";position:absolute;top:11px;left:12px;z-index:3;
  background:rgba(245,158,11,.92);color:#0b0c10;font-size:10px;font-weight:800;padding:3px 8px;border-radius:7px;letter-spacing:.02em}
.relay-root .relay-tile.on-hold video{filter:grayscale(.7) brightness(.6)}
.relay-root .call-waiting .cw-pulse{width:9px;height:9px;border-radius:50%;background:var(--accent);animation:cwPulse 1.3s ease-out infinite;flex:0 0 auto}
@keyframes cwPulse{0%{box-shadow:0 0 0 0 rgba(63,224,197,.5)}100%{box-shadow:0 0 0 9px rgba(63,224,197,0)}}
.relay-root .call-waiting .cw-actions{display:flex;gap:8px}
.relay-root .call-waiting .cw-btn{border:none;border-radius:11px;padding:8px 14px;font-family:"Bricolage Grotesque",sans-serif;font-weight:700;font-size:13px;cursor:pointer;transition:.14s}
.relay-root .call-waiting .cw-decline{background:rgba(255,92,114,.16);color:var(--danger);border:1px solid rgba(255,92,114,.3)}
.relay-root .call-waiting .cw-decline:hover{background:rgba(255,92,114,.26)}
.relay-root .call-waiting .cw-switch{background:var(--grad);color:#04201B}
.relay-root .call-waiting .cw-switch:hover{transform:translateY(-1px)}
@media (max-width:680px){.relay-root .call-waiting{flex-direction:column;gap:10px;top:10px;padding:12px 14px}.relay-root .call-waiting .cw-actions{width:100%}.relay-root .call-waiting .cw-btn{flex:1}}
/* "On hold" bar — shown while a second call is parked, with Swap / Merge. */
.relay-root .held-bar{position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:35;display:none;align-items:center;gap:14px;background:rgba(28,24,16,.94);border:1px solid rgba(245,180,80,.34);border-radius:16px;padding:9px 12px 9px 16px;box-shadow:0 18px 50px -18px rgba(0,0,0,.7);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);max-width:94vw}
.relay-root .held-bar.show{display:flex;animation:cwIn .3s cubic-bezier(0.23,1,0.32,1) both}
.relay-root .held-bar .held-info{font-size:14px;color:var(--text);display:flex;align-items:center;gap:9px}
.relay-root .held-bar .held-pulse{width:9px;height:9px;border-radius:50%;background:#f5b450;animation:cwPulse 1.3s ease-out infinite;flex:0 0 auto}
.relay-root .held-bar .held-meta{display:flex;flex-direction:column;line-height:1.25;min-width:0}
.relay-root .held-bar .held-meta b{font-size:12px;color:#f5b450;letter-spacing:.04em}
.relay-root .held-bar .held-name{font-size:13px;color:var(--text)}
.relay-root .held-bar .held-name:empty{display:none}
.relay-root .held-bar .held-actions{display:flex;gap:8px}
.relay-root .held-bar .held-btn{border:none;border-radius:11px;padding:8px 14px;font-family:"Bricolage Grotesque",sans-serif;font-weight:700;font-size:13px;cursor:pointer;transition:.14s}
.relay-root .held-bar .held-swap{background:var(--grad);color:#04201B}
.relay-root .held-bar .held-swap:hover{transform:translateY(-1px)}
.relay-root .held-bar .held-merge{background:rgba(245,180,80,.16);color:#f5b450;border:1px solid rgba(245,180,80,.34)}
.relay-root .held-bar .held-merge:hover{background:rgba(245,180,80,.26)}
.relay-root .held-bar .held-end{background:rgba(255,92,114,.14);color:var(--danger);border:1px solid rgba(255,92,114,.3)}
.relay-root .held-bar .held-end:hover{background:rgba(255,92,114,.26)}
/* Being HELD (v2.97.1): the parked party's banner — visible, calm, unmissable. */
.relay-root .onhold-bar{position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:35;display:none;align-items:center;gap:12px;
  background:rgba(16,26,32,.94);border:1px solid rgba(63,224,197,.4);border-radius:16px;padding:11px 18px;
  box-shadow:0 18px 50px -18px rgba(0,0,0,.7),0 0 24px -8px rgba(63,224,197,.35);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);max-width:94vw}
.relay-root .onhold-bar.show{display:flex}
.relay-root .onhold-bar .oh-pulse{width:11px;height:11px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent);flex-shrink:0}
@media (prefers-reduced-motion:no-preference){.relay-root .onhold-bar .oh-pulse{animation:relayPulse2 1.4s ease-in-out infinite}}
.relay-root .onhold-bar .oh-meta{display:flex;flex-direction:column;min-width:0}
.relay-root .onhold-bar .oh-meta b{font-size:14px}
.relay-root .onhold-bar .oh-sub{font-size:12px;color:var(--muted)}
/* If we're holding one line WHILE the other line holds us, stack the bars. */
.relay-root .held-bar.show ~ .onhold-bar.show{top:82px}
@media (max-width:680px){.relay-root .held-bar{flex-direction:column;gap:10px;top:10px;padding:12px 14px}.relay-root .held-bar .held-actions{width:100%}.relay-root .held-bar .held-btn{flex:1}}
.relay-root .version-tag{position:fixed;bottom:8px;right:12px;z-index:5;font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.06em;color:var(--text2,#9aa);pointer-events:none;opacity:.92}
/* Make the VERSION + BUILD numbers pop on the dark call screen: bright white with
   a soft glow, and a gentle blink so they're easy to spot (the © year stays
   muted, like a copyright line). Blink is motion-gated. */
.relay-root .version-tag .ver-hl{color:#fff;font-weight:700;text-shadow:0 0 6px rgba(255,255,255,.45)}
@media (prefers-reduced-motion: no-preference){
  .relay-root .version-tag .ver-hl{animation:relayVerBlink 1.3s ease-in-out infinite}
}
@keyframes relayVerBlink{0%,100%{opacity:1}50%{opacity:.32}}

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
.relay-root .diag-head b{font-family:"Bricolage Grotesque",sans-serif;font-weight:700;font-size:15px}
.relay-root .diag-actions{display:flex;gap:8px}
.relay-root .diag-tool{background:var(--bg2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;font-family:inherit}
.relay-root .diag-tool:hover{border-color:var(--accent);color:var(--accent)}
.relay-root .diag-body{flex:1;min-height:0;overflow:auto;padding:16px 18px;font-family:"JetBrains Mono",monospace;font-size:11.5px;line-height:1.55;color:var(--text);white-space:pre-wrap;background:var(--bg2)}
.relay-root .diag-foot{padding:10px 18px;border-top:1px solid var(--border);color:var(--faint);font-size:12px}
.relay-root .diag-foot kbd{background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:1px 6px;font-family:"JetBrains Mono",monospace;font-size:11px}

.relay-root .relay-tile .connecting{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.55);color:#fff;padding:7px 14px;border-radius:99px;font-size:12px;letter-spacing:.04em;backdrop-filter:blur(4px);border:1px solid var(--border2)}
.relay-root .relay-tile[data-state="failed"] .connecting{color:var(--danger);border-color:rgba(255,92,114,.5)}
.relay-root .relay-tile[data-state="disconnected"] .connecting{color:var(--warn);border-color:rgba(255,180,84,.5)}
.relay-root .relay-tile[data-state="connected"] .connecting{display:none!important}
/* First connect to a peer still hasn't produced media after 15s — the generic
   "connecting…" pill is swapped for a named "Waiting for X…" and the tile's
   placeholder avatar dims slightly so a stuck connect doesn't look identical to
   a fresh one. transform/opacity only, matching the project's animation rule. */
.relay-root .relay-tile.slow-connect .ph{opacity:.55}
.relay-root .relay-tile.slow-connect .connecting{color:var(--warn);border-color:rgba(255,180,84,.5)}
`;
