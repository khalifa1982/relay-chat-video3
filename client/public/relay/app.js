"use strict";
/* ============================================================
   RELAY client — native WebRTC mesh over our own WebSocket server.
   Server is authoritative about rooms; only the newcomer sends
   offers to existing members, so there is no SDP glare.
   ============================================================ */

let ws = null, reconnectT = null, registeredOnce = false;
let me = { pin:null, name:null };
let iceConfig = { iceServers:[ { urls:"stun:stun.l.google.com:19302" } ] };
let localStream = null, micOn = true, camOn = true;
let inCall = false, roomId = null;
const peers = {};            // pin -> { pc, name, dc, el, candQ:[], remoteSet, gotStream }
let pendingRing = null;      // { from, fromName, roomId }
const recents = [];
let callStart = 0, timerInt = null, unread = 0, dialed = "";
let wantName = null;

/* ---------- utils ---------- */
const $ = id => document.getElementById(id);
function show(s){ document.querySelectorAll(".screen").forEach(x=>x.classList.remove("active")); $(s).classList.add("active"); }
function initials(n){ return (n||"?").trim().slice(0,2).toUpperCase() || "?"; }
function escapeHtml(s){ return (s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
let toastT;
function toast(msg, err){ const t=$("toast"); t.textContent=msg; t.className="toast show"+(err?" err":""); clearTimeout(toastT); toastT=setTimeout(()=>t.className="toast",3400); }
function fmtPin(p){ return String(p).replace(/(\d{3})(\d{3})/,"$1 $2"); }
function nameOf(pin){ const p=peers[pin]; return p ? p.name : pin; }

/* ============================================================
   WEBSOCKET
   ============================================================ */
function wsUrl(){ const proto = location.protocol==="https:" ? "wss" : "ws"; return proto + "://" + location.host + "/api/relay"; }
function connectWS(){
  try { ws = new WebSocket(wsUrl()); } catch(e){ toast("Can't reach the server.",true); return; }
  ws.onopen = ()=>{
    if(wantName){ sendWS({ type:"register", name:wantName, pin:me.pin || undefined }); }
  };
  ws.onmessage = e=>{ let m; try{ m=JSON.parse(e.data); }catch(_){ return; } handle(m); };
  ws.onclose = ()=>{ scheduleReconnect(); };
  ws.onerror = ()=>{};
}
function scheduleReconnect(){ if(reconnectT) return; reconnectT=setTimeout(()=>{ reconnectT=null; connectWS(); }, 1500); }
function sendWS(obj){ try{ if(ws && ws.readyState===1) ws.send(JSON.stringify(obj)); }catch(e){} }

function handle(m){
  switch(m.type){
    case "registered": onRegistered(m); break;
    case "room":        roomId = m.roomId; break;
    case "ring":        onRing(m); break;
    case "joined":      onJoined(m); break;
    case "peer-joined": onPeerJoined(m); break;
    case "rejected":    toast(nameOf(m.from)+" declined."); if(inCall && Object.keys(peers).length===0) hangUp(); break;
    case "busy":        toast("They're on another call.",true); if(inCall && Object.keys(peers).length===0) hangUp(); break;
    case "peer-left":   removePeer(m.pin); break;
    case "signal":      onSignal(m.from, m.data); break;
    case "error":       toast(m.message||"Something went wrong.",true); if((m.code==="offline"||m.code==="self"||m.code==="gone") && inCall && Object.keys(peers).length===0) hangUp(); break;
  }
}

/* ============================================================
   REGISTRATION
   ============================================================ */
function register(){
  const name = $("nameInput").value.trim();
  if(!name){ toast("Enter a display name first.",true); return; }
  me.name = name; wantName = name;
  $("joinBtn").disabled = true; $("joinBtn").textContent = "Connecting…";
  if(ws && ws.readyState===1) sendWS({ type:"register", name });
  else connectWS();
}
function onRegistered(m){
  me.pin = String(m.pin);
  if(m.iceServers && m.iceServers.length) iceConfig = { iceServers: m.iceServers };
  if(!registeredOnce){
    registeredOnce = true;
    $("meName").textContent = me.name;
    $("meAv").textContent = initials(me.name);
    $("meCode").textContent = fmtPin(me.pin);
    $("bigCode").textContent = me.pin;
    var shareLink = location.origin + "/";
    $("shareUrl").textContent = shareLink;
    buildPad();
    show("lobby");
  } else {
    $("meCode").textContent = fmtPin(me.pin);
    $("bigCode").textContent = me.pin;
  }
}

/* ============================================================
   DIAL PAD
   ============================================================ */
const KEYS=[["1",""],["2","ABC"],["3","DEF"],["4","GHI"],["5","JKL"],["6","MNO"],["7","PQRS"],["8","TUV"],["9","WXYZ"],["*",""],["0","+"],["#",""]];
function buildPad(){
  const pad=$("pad"); pad.innerHTML="";
  KEYS.forEach(([d,l])=>{
    const k=document.createElement("div"); k.className="key";
    k.innerHTML='<span class="d">'+d+'</span><span class="l">'+l+'</span>';
    k.onclick=()=>pushDigit(d);
    pad.appendChild(k);
  });
}
function refreshDisplay(){
  const el=$("dialDisplay");
  if(!dialed){ el.textContent="Enter a number"; el.classList.add("empty"); }
  else { el.textContent=dialed; el.classList.remove("empty"); }
  $("callBtn").disabled=!/^\d{6}$/.test(dialed);
}
function pushDigit(d){ if(/\d/.test(d) && dialed.length<6){ dialed+=d; refreshDisplay(); } }

/* ============================================================
   MEDIA
   ============================================================ */
async function ensureMedia(){
  if(localStream) return localStream;
  try{
    localStream=await navigator.mediaDevices.getUserMedia({ audio:true, video:{ width:{ideal:1280}, height:{ideal:720}, facingMode:"user" } });
  }catch(e){
    try{ localStream=await navigator.mediaDevices.getUserMedia({ audio:true, video:false }); camOn=false; toast("No camera found — joining with audio only."); }
    catch(e2){ toast("Mic/camera blocked. Allow access in your browser, then retry.",true); throw e2; }
  }
  return localStream;
}

/* ============================================================
   PLACING A CALL
   ============================================================ */
async function startCall(){
  if(!/^\d{6}$/.test(dialed)) return;
  if(dialed===me.pin){ toast("That's your own number.",true); return; }
  if(peers[dialed]){ toast("You're already connected to them.",true); return; }
  try{ await ensureMedia(); }catch(e){ return; }
  const target=dialed; dialed=""; refreshDisplay(); closeAddPad();
  if(!inCall){ inCall=true; enterCallUI("Calling…"); }
  sendWS({ type:"invite", to:target });
  toast("Calling "+target+"…");
}

/* ============================================================
   INCOMING
   ============================================================ */
function onRing(m){
  if(inCall){ if(m.roomId===roomId) return; sendWS({ type:"reject", to:m.from }); return; }
  if(pendingRing){ sendWS({ type:"reject", to:m.from }); return; }
  pendingRing = { from:m.from, fromName:m.fromName, roomId:m.roomId };
  $("ringAv").textContent = initials(m.fromName);
  $("ringWho").textContent = m.fromName;
  $("ringSub").textContent = "is calling you…";
  $("ringOverlay").classList.add("active");
}
async function acceptInvite(){
  const r=pendingRing; pendingRing=null;
  $("ringOverlay").classList.remove("active");
  if(!r) return;
  try{ await ensureMedia(); }catch(e){ sendWS({ type:"reject", to:r.from }); return; }
  inCall=true; roomId=r.roomId; enterCallUI("In call");
  sendWS({ type:"accept", roomId:r.roomId });   // server replies 'joined' -> we offer to members
}
function declineInvite(){
  const r=pendingRing; pendingRing=null;
  $("ringOverlay").classList.remove("active");
  if(r) sendWS({ type:"reject", to:r.from });
}

/* ============================================================
   MESH
   ============================================================ */
function onJoined(m){            // I'm the newcomer: offer to everyone already here
  roomId = m.roomId;
  (m.members||[]).forEach(mem => callPeer(mem.pin, mem.name));
}
function onPeerJoined(m){         // someone joined: they'll offer to me, just prepare
  if(peers[m.pin]) return;
  createPeer(m.pin, m.name, false);
}
function createPeer(pin, name, initiator){
  if(peers[pin]) return peers[pin];
  const pc = new RTCPeerConnection(iceConfig);
  const peer = { pc, name:name||"Guest", dc:null, el:null, candQ:[], remoteSet:false, gotStream:false };
  peers[pin] = peer;
  if(localStream) localStream.getTracks().forEach(t=>pc.addTrack(t, localStream));
  pc.onicecandidate = e=>{ if(e.candidate) sendWS({ type:"signal", to:pin, data:{ candidate:e.candidate } }); };
  pc.ontrack = e=>attachRemote(pin, e.streams[0]);
  pc.onconnectionstatechange = ()=>{
    const st=pc.connectionState;
    if(peer.el){ const c=peer.el.querySelector(".connecting"); if(c) c.style.display=(st==="connected")?"none":"block"; }
    if(st==="failed"||st==="closed") removePeer(pin);
  };
  if(initiator){ const dc=pc.createDataChannel("chat"); setupDC(pin, dc); peer.dc=dc; }
  else { pc.ondatachannel = e=>{ setupDC(pin, e.channel); peer.dc=e.channel; }; }
  addTile(pin, peer.name);
  return peer;
}
async function callPeer(pin, name){
  const peer = createPeer(pin, name, true);
  try{
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    sendWS({ type:"signal", to:pin, data:{ sdp:peer.pc.localDescription } });
  }catch(e){ console.warn("offer error", e); }
}
async function onSignal(from, data){
  if(!data) return;
  let peer = peers[from];
  if(data.sdp){
    if(!peer) peer = createPeer(from, "Guest", false);
    try{
      await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      peer.remoteSet = true; await flushCand(from);
      if(data.sdp.type==="offer"){
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        sendWS({ type:"signal", to:from, data:{ sdp:peer.pc.localDescription } });
      }
    }catch(e){ console.warn("sdp error", e); }
  } else if(data.candidate){
    if(!peer) peer = createPeer(from, "Guest", false);
    if(peer.remoteSet){ try{ await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate)); }catch(e){} }
    else peer.candQ.push(data.candidate);
  }
}
async function flushCand(pin){ const peer=peers[pin]; if(!peer) return; for(const c of peer.candQ){ try{ await peer.pc.addIceCandidate(new RTCIceCandidate(c)); }catch(e){} } peer.candQ=[]; }
function removePeer(pin){
  const e=peers[pin]; if(!e) return;
  const nm=e.name;
  try{ e.pc.close(); }catch(_){}
  if(e.el) e.el.remove();
  delete peers[pin];
  layoutGrid();
  if(inCall) addSysMsg((nm||"Someone")+" left the call.");
}

/* ============================================================
   VIDEO GRID
   ============================================================ */
function enterCallUI(label){
  show("call");
  $("callRoomLbl").textContent = label||"In call";
  $("videoGrid").innerHTML="";
  addSelfTile();
  for(const id in peers){ if(!peers[id].el) addTile(id, peers[id].name); }
  layoutGrid();
  callStart=Date.now(); clearInterval(timerInt);
  timerInt=setInterval(()=>{ const s=Math.floor((Date.now()-callStart)/1000); $("timer").textContent=String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0"); },1000);
}
function addSelfTile(){
  const t=document.createElement("div"); t.className="tile you"; t.id="tile-self";
  const v=document.createElement("video"); v.autoplay=true; v.muted=true; v.playsInline=true; v.srcObject=localStream;
  t.appendChild(v);
  t.insertAdjacentHTML("beforeend",'<div class="nm">You</div>');
  $("videoGrid").appendChild(t);
  if(!camOn) t.classList.add("audio-only");
}
function addTile(id, name){
  if(!inCall) return;
  const entry=peers[id]; if(!entry || entry.el) return;
  const t=document.createElement("div"); t.className="tile"; t.id="tile-"+id;
  const v=document.createElement("video"); v.autoplay=true; v.playsInline=true;
  t.appendChild(v);
  t.insertAdjacentHTML("beforeend",'<div class="ph"><div class="av">'+initials(name)+'</div></div>');
  t.insertAdjacentHTML("beforeend",'<div class="nm">'+escapeHtml(name)+'</div>');
  t.insertAdjacentHTML("beforeend",'<div class="connecting">connecting…</div>');
  entry.el=t;
  $("videoGrid").appendChild(t);
  layoutGrid();
}
function attachRemote(id, stream){
  const entry=peers[id]; if(!entry) return;
  if(!entry.el) addTile(id, entry.name);
  if(!entry.el) return;
  entry.gotStream=true;
  const v=entry.el.querySelector("video"); v.srcObject=stream;
  const c=entry.el.querySelector(".connecting"); if(c) c.style.display="none";
  const sync=()=>{ const has=stream.getVideoTracks().some(tr=>tr.enabled && tr.readyState==="live"); const ph=entry.el.querySelector(".ph"); if(ph) ph.style.display=has?"none":"flex"; };
  sync();
  stream.getVideoTracks().forEach(tr=>{ tr.onmute=sync; tr.onunmute=sync; tr.onended=sync; });
}
function layoutGrid(){
  const n=$("videoGrid").children.length;
  let cols=1; if(n>1) cols=2; if(n>4) cols=3;
  $("videoGrid").style.gridTemplateColumns="repeat("+cols+",1fr)";
  $("videoGrid").style.gridTemplateRows="repeat("+Math.ceil(n/cols)+",minmax(0,1fr))";
}

/* ============================================================
   CHAT (data channels)
   ============================================================ */
function setupDC(pin, dc){
  dc.onopen = ()=>{ addToRecents(pin, (peers[pin]||{}).name); };
  dc.onmessage = e=>{ try{ const d=JSON.parse(e.data); addChatMsg(d.name, d.text, false); }catch(_){} };
}
function broadcastChat(text){ const p=JSON.stringify({ name:me.name, text }); for(const id in peers){ const dc=peers[id].dc; if(dc && dc.readyState==="open"){ try{ dc.send(p); }catch(e){} } } }
function addChatMsg(name, text, mine){
  const log=$("chatLog");
  const d=document.createElement("div"); d.className="msg "+(mine?"me":"them");
  d.innerHTML=(mine?"":'<div class="au">'+escapeHtml(name)+'</div>')+escapeHtml(text);
  log.appendChild(d); log.scrollTop=log.scrollHeight;
  if(!mine && !$("chatPanel").classList.contains("open")){ unread++; const b=$("chatBadge"); b.style.display="grid"; b.textContent=unread; }
}
function addSysMsg(text){ const log=$("chatLog"); const d=document.createElement("div"); d.className="msg sys"; d.textContent=text; log.appendChild(d); log.scrollTop=log.scrollHeight; }
function sendChat(){ const f=$("chatField"); const text=f.value.trim(); if(!text) return; addChatMsg(me.name,text,true); broadcastChat(text); f.value=""; }

/* ============================================================
   RECENTS
   ============================================================ */
function addToRecents(id, name){
  const ex=recents.find(r=>r.id===id);
  if(!ex){ recents.unshift({ id, name:name||id }); renderRecents(); }
  else if(name && ex.name!==name){ ex.name=name; renderRecents(); }
}
function renderRecents(){
  const list=$("dirList");
  if(!recents.length){ list.innerHTML='<p class="empty-dir">People you call will appear here for quick redial.<br><br>To connect with someone: send them your number, or type theirs on the keypad and hit Call.</p>'; return; }
  list.innerHTML="";
  recents.forEach(r=>{
    const d=document.createElement("div"); d.className="usr";
    d.innerHTML='<div class="av">'+initials(r.name)+'</div><div class="info"><b>'+escapeHtml(r.name)+'</b><span>'+r.id+'</span></div><div class="go">&#8635;</div>';
    d.onclick=()=>{ dialed=r.id; refreshDisplay(); startCall(); };
    list.appendChild(d);
  });
}

/* ============================================================
   CONTROLS
   ============================================================ */
function toggleMic(){ if(!localStream) return; micOn=!micOn; localStream.getAudioTracks().forEach(t=>t.enabled=micOn); $("micBtn").classList.toggle("off",!micOn); }
function toggleCam(){ if(!localStream) return; camOn=!camOn; localStream.getVideoTracks().forEach(t=>t.enabled=camOn); $("camBtn").classList.toggle("off",!camOn); const s=$("tile-self"); if(s) s.classList.toggle("audio-only",!camOn); }
function toggleChat(){ const p=$("chatPanel"); p.classList.toggle("open"); if(p.classList.contains("open")){ unread=0; $("chatBadge").style.display="none"; $("chatField").focus(); } }
function openAddPad(){ const a=$("addpad"); a.classList.toggle("open"); if(a.classList.contains("open")) $("addInput").focus(); }
function closeAddPad(){ $("addpad").classList.remove("open"); $("addInput").value=""; }
async function addToCall(){
  const pin=$("addInput").value.trim();
  if(!/^\d{6}$/.test(pin)){ toast("Enter a 6-digit number.",true); return; }
  if(pin===me.pin || peers[pin]){ toast("Already in the call.",true); return; }
  if(Object.keys(peers).length>=5){ toast("Call is full (6 people max).",true); return; }
  try{ await ensureMedia(); }catch(e){ return; }
  sendWS({ type:"invite", to:pin });
  toast("Inviting "+pin+"…"); closeAddPad();
}
function hangUp(){
  sendWS({ type:"leave" });
  for(const id in peers){ try{ peers[id].pc.close(); }catch(e){} if(peers[id].el) peers[id].el.remove(); }
  for(const id in peers) delete peers[id];
  inCall=false; roomId=null; clearInterval(timerInt);
  $("chatLog").innerHTML=""; $("chatPanel").classList.remove("open"); unread=0; $("chatBadge").style.display="none";
  if(localStream){ localStream.getTracks().forEach(t=>t.stop()); localStream=null; micOn=true; camOn=true; $("micBtn").classList.remove("off"); $("camBtn").classList.remove("off"); }
  show("lobby"); renderRecents();
}

/* ============================================================
   WIRE UP
   ============================================================ */
$("joinBtn").onclick=register;
$("nameInput").addEventListener("keydown",e=>{ if(e.key==="Enter") register(); });
$("copyBtn").onclick=()=>{ navigator.clipboard.writeText(me.pin).then(()=>toast("Number copied")).catch(()=>toast(me.pin)); };
$("shareUrl").onclick=()=>{ const u=$("shareUrl").textContent; navigator.clipboard.writeText(u).then(()=>toast("Invite link copied")).catch(()=>toast(u)); };
$("backKey").onclick=()=>{ dialed=dialed.slice(0,-1); refreshDisplay(); };
$("callBtn").onclick=startCall;
$("acceptBtn").onclick=acceptInvite;
$("declineBtn").onclick=declineInvite;
$("micBtn").onclick=toggleMic;
$("camBtn").onclick=toggleCam;
$("chatBtn").onclick=toggleChat;
$("chatClose").onclick=toggleChat;
$("addBtn").onclick=openAddPad;
$("addGo").onclick=addToCall;
$("hangBtn").onclick=hangUp;
$("chatSend").onclick=sendChat;
$("chatField").addEventListener("keydown",e=>{ if(e.key==="Enter") sendChat(); });
$("addInput").addEventListener("keydown",e=>{ if(e.key==="Enter") addToCall(); });
document.addEventListener("keydown",e=>{
  if(!$("lobby").classList.contains("active")) return;
  if(/^[0-9]$/.test(e.key)) pushDigit(e.key);
  else if(e.key==="Backspace"){ dialed=dialed.slice(0,-1); refreshDisplay(); }
  else if(e.key==="Enter" && /^\d{6}$/.test(dialed)) startCall();
});
window.addEventListener("beforeunload",()=>{ sendWS({ type:"leave" }); });

/* boot */
$("boot").classList.add("hidden");
connectWS();
$("nameInput").focus();
