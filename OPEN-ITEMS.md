# RELAY — every owner request that is NOT done

Written 2026-07-28 at the owner's request: *"I need a list of all the things you have not done.
Let me know if you passed on something and tell me when you will do it."*

**How this was built.** Not from memory. Every line below was extracted from `todo.md`'s
`NOT DONE` / `STILL OPEN` / `- [ ]` markers and then **re-checked against current source**, because a
stale note is worse than no note. Where the check contradicted the note, the check wins and that is
said. Nothing here is a guess about what the code does.

---

## §0 — I GOT THIS ONE WRONG, TWICE  (corrected 2026-07-29, fixed in v2.105.19)

The first version of this file opened by telling the owner the Profile ask was **already shipped** and
that they were probably looking at a stale bundle. **That was wrong, and the way it was wrong is worth
recording rather than quietly deleting.**

**The ask.** *"the profile icon on the main page … when you click on the right, I told you you remove
this one, and you need to put the rely and the version number of the current built."* It is the top
bar's **avatar menu** — the thing that opens when you tap the icon on the right — whose header showed
the name, the tier badge and the 6-digit PIN.

**Mistake 1 (v2.103.1).** I read *"when you click on the profile remove this one"* as the Profile
**page**, and stripped its hero. Wrong surface. The page was fine.

**Mistake 2 (this file, first draft).** Asked to audit, I checked the surface I had changed, found it
matching my own note, and reported the ask as done — then told the owner their browser was stale. An
audit that only looks where the previous change landed cannot find a change that landed in the wrong
place; it just confirms itself.

**The generalisable lesson, since this will happen again:** a request phrased by **what you tap**
("click on the profile") does not name a screen. Two surfaces fit it, and I picked the one whose
filename matched instead of asking which one.

**Fixed in v2.105.19.**
- The avatar menu's header is now **`RELAY v<version>`** and carries no name, badge or PIN. The top bar
  directly behind the menu still shows all three, which is what makes the removal a de-duplication
  rather than a loss — and a test fails if that strip ever goes away.
- The **Profile page hero is restored byte-for-byte**: name, badge, and the digits in the owner's
  NNN-NNN grouping. The build stamp went back to its footer line.
- The three test pins v2.103.1 had rewritten into their own negations are restored, and one that froze
  the v2.99.10 menu placement is rewritten to the property it was actually for.

### Shipped, listed only so they are not re-raised
| Ask | Shipped in |
| --- | --- |
| Profile page rebuilt as the control centre (barcode, number, badge, status, everything from one place) | v2.99.89 |
| Icons on the Email / Mobile / social rows | v2.99.93 |
| Guest ID expiry notice + countdown | v2.99.93 / v2.100.0 |
| Version number visible on the profile footer, and in the avatar menu | v2.105.19 |
| Story-vs-status vocabulary fixed everywhere | v2.101.0 |
| Real status picker (work / vacation / travel / free / busy, emoji + colour + note) | v2.101.1 |

---

## §1 — NOT DONE, and I own the delay

### 1. ~~The 4-digit group lock~~ — **DONE, v2.105.20**
Shipped exactly to the settled design: a privacy screen and not access control, per-device, reusing
`passcode.ts`'s hashing rather than a second copy, and the thread list redacts a locked group's preview.
Two things the design pass had not anticipated and that the build settled:

- the gate had to replace the **whole conversation view**, header included — otherwise a deep link, a
  notification tap and a reload each needed their own check;
- which put the group's details (where a lock is normally removed) *behind* the gate, so the **app
  passcode had to be accepted at the gate itself**, and it removes the lock rather than unlocking for
  one session. Setting a lock therefore requires an app passcode to exist, because that is the only
  recovery.

No schema change was needed after all — it is localStorage, so nothing is stored server-side.

### 1b. ~~Invite-link audience (guests-only / registered-only / all)~~ — **DONE, v2.105.23**
**I had counted this as done and it was not.** #108's sentence asked for the link *and* an
admin-chosen audience; v2.105.9 built the link and the clause was never implemented. Found by
re-reading the owner's task text against the token rather than against my own notes — the same
failure mode as §0, one step earlier: an audit that checks what I built cannot find what I skipped.

The audience travels in the TOKEN (per-link, so two audiences can be live at once) while the epoch
stays in a column (per-group revocation). An open link keeps the four-segment format byte-for-byte,
so outstanding links survived the deploy. The gate governs admission and not membership, and its
refusal is the one on that endpoint that is named — it is reached only after a fleet-minted
signature verifies, so it leaks nothing.

**#108 IS NOW CLOSED.** Every clause in it has shipped: creator/admin roles and admin-only deletion
(v2.104.0), per-person bubble colours and the clickable sender thumbnail (v2.103.3), day headers
(v2.71, sticky in v2.105.3), the invite link (v2.105.9), group calls with host/co-host seeding
(v2.105.7), add/remove member and the "all users can add" toggle (v2.105.16), the 4-digit lock
(v2.105.20), and the audience (v2.105.23).

### 2. ~~Call-invite / party-line join screen~~ — **DONE, v2.105.25**  (#109)
A shared `/i/<pin>` link now lands on its own screen — what you are joining, its creator, who is
already inside with their badge and how long they have been there, the live count and the created
date — instead of on the keypad with six anonymous digits prefilled.

**ONE DELIBERATE DEVIATION, stated rather than buried.** The ask was "joins the call automatically".
The screen replaces the dial pad, but its Join button is still a real tap, because a link that dials on
arrival is the **M48/M60 hot-mic hole**: microphone permission is per-origin and persists, so one click
would hand a live mic — and the camera, with `?video=1` — to a number the LINK'S AUTHOR chose. M60
found that hole still open through this exact `/i/<pin>` path. One informed tap is the consent.

**And one thing it will not show: another occupant's 6-digit number.** A party line may list who is on
it — it is dial-to-enter, its owner shares it deliberately, and joining shows the same roster from the
inside anyway — but returning everyone's number would make an enumerable endpoint into a harvesting
one, where joining to read the same digits is a visible act. `directory.liveRoom` refuses the same
thing for a call, and now so does this.

**The line's thumbnail is generated, not uploaded.** A deterministic gradient from the line's own
number, so every line has a stable identity with nothing to upload and nothing to moderate. An
uploadable logo is a column plus an editor — say the word if you want it.

### 3. ~~Thread list shows a bare emoji with no context~~ — **DONE, v2.105.29**
**And the reason it was deferred was wrong, which is the finding.** This note said *"adding `meta`
touches the groupwise-max query every client polls"* — it does not. That aggregate
(`MAX(id) GROUP BY conversationId`) selects **two integer columns** and is a separate query, untouched.
The row the projection reads comes from a bare `.select()` over at most a few dozen **primary keys**, and
`meta` was already in it: the disappearing-message guard reads it on the adjacent line. So the deferral
was a performance decision made against a cost that does not exist, and the fix adds **zero** database
work — two booleans derived from data already in hand.

The row now reads `↩ your story · 😂` (or `their`). Deliberately shorter than the bubble's chip, and
**measured** rather than guessed: the preview span is 141px at 320px and 181px at 360px, the chip's own
wording needs 193px — so it would clip the end of the line, i.e. exactly the reaction that varies. This
form needs 118px and fits at every width. The reply-quote line inside a conversation got the same
treatment, since it had the identical gap.

### 4. ~~Voice/video marker on an ANSWERED GROUP call~~ — **DONE, v2.105.28**
The note was right about the cause: `conference_history` had no channel column, so the media type was
genuinely unknown and printing either would have been a guess. One additive nullable enum, plus the dial
flag carried on the room from dial to teardown, and the row now says it.

**Nullable with NO default, deliberately** — unlike `call_history.channel`, which is notNull default
`"video"`. Every conference logged before the column existed has no recorded channel, and a party line is
**joined rather than dialled**, so it never had one either. A default would make each of those rows assert
a media type nobody recorded, about the reader's own call history — which is the guess this column exists
to replace. An unknown channel renders as **nothing**, and that is the property every test here protects.

### 5. ~~History search/grouping only covers the most recent 100 calls~~ — **DONE, v2.106.1**
The note was right that this is a paging change with its own cost, so the cost is where the design went:
**the polled page size is unchanged at 100.** Both queries refetch every 30s for every open History tab,
so raising the default would multiply that traffic for everybody to serve a search almost nobody runs —
the same trade v2.102.2 refused for the thread list's aggregate.

Older pages are fetched only when asked for and then KEPT in component state, deliberately outside the
query cache, so the 30s poll never re-fetches them: paging stays O(1) on the polling cost however far back
somebody goes. Search, the filter counts and per-person grouping all derive from the merged window, so one
change gives all three the longer reach, and a "Load older calls" control says how many are loaded.

**The cursor is an ID, never an offset**, and that is not a preference: this table grows at the TOP, so an
offset silently SKIPS a row whenever a call ends between two pages — precisely the row somebody was paging
to find.

---

### 6. Agora as the primary voice/video transport, LiveKit as fallback  (asked 2026-07-29)
**Premise corrected 2026-07-29.** I first said the fleet was probably on the WebRTC mesh. It is not —
`/api/health` reports `"media":{"livekit":true}`, so **LiveKit Cloud is live** and the three env vars are
in `/home/relay/.env`. Being on LiveKit Cloud also means the region hypothesis is largely closed: they
route regionally.

**Symptom, as reported:** slowness *when voice and video start together*.

**Three hypotheses formed and killed by reading** — recorded so they are not re-raised:
1. the mesh (refuted by `/api/health`);
2. audio unprioritised on the SFU path — `livekit-client` sets `networkPriority: 'high'` itself;
3. our own `audioPreset: speech` overriding that downward — the preset carries no `priority`, so
   `?? 'high'` still applies.

**One real inconsistency found and fixed in v2.105.21:** `degradationPreference: "balanced"` had never
reached the SFU path — v2.99.84 reasoned it out and applied it only inside the mesh-only function. It is a
plausible fit for the reported moment. **It is not claimed as the cause.**

**What v2.105.21 shipped so this stops being guesswork:** a Stats chip in the call bar giving RTT, packet
loss, jitter, publish/receive resolution + fps, throughput, and **whether media is going via a TURN
relay** — one shape for both transports so they are comparable.

**Next step is a reading, not a build.** Turn the Stats chip on, start a call, enable video, and look:
- **`via TURN relay`** → that alone explains it, and **Agora would be equally slow**. Fix is coturn/ICE.
- **RTT > 300ms** on LiveKit Cloud → region or network, again not a vendor problem.
- **publish fps collapsing as video starts** → device/encoder; the new `balanced` preference may already
  have helped.
- **all clean and still slow** → then Agora is the right call and I will build it: a third transport
  adapter beside the mesh and LiveKit paths, server-side token minting, channel mapping off the room id,
  and the SDK as this repo's first npm media dependency.

**Not a coherent option, recorded because it was the original framing:** "Agora on the front end, LiveKit
on the back." Both are complete stacks — client SDK plus media server — and Agora's SDK only talks to
Agora's cloud. Primary/fallback is the version of that idea which works.

### 6. ~~The login screen batch~~ — **DONE, v2.105.26**  (#120–#122)
All three shipped, and two things are worth your eye:

- **Your number appears with the email, but MASKED** (`777-•••`). Showing the whole thing would build an
  unauthenticated email → dialable-number lookup: anybody who has your email address could then call and
  message you on RELAY without you ever giving them your number. The leading group confirms the account
  and is not an address. The residual, stated: three digits narrow an enumeration for somebody who also
  knows your display name. **Say the word and it becomes the whole number, or nothing at all.**
- **The identity section moved above the card and had to be compacted to fit.** Moved as-is it pushed the
  access buttons BELOW THE FOLD on every phone under 390px — measured, 3/6 widths failed. The tiles are
  clamped to one row, the explanatory note is dropped under 400px, and the two bullet cards are gone
  because every line in them was already elsewhere on the screen. 6/6 clean afterwards.

Everything else is as asked: the full-name field, the reserve-and-reveal copy over the matrix reveal that
already worked, a Back button you cannot miss, an existing email refused with the reason named, and one
picker on every waiting screen so you can move between the email code, the passcode and second-device
approval at will — each with a 30-second countdown and a retry.

---

## §2 — NOT DONE, and needs a decision from you first

### 7. ~~A group admin cannot delete another member's group story~~ — **DONE, v2.105.27**  (#118)
An admin viewing a group reel now gets a "Remove as admin" row on a member's slide, confirmed, with copy
naming whose story and which group. Its own capability (`delete-any-story`) rather than a second meaning
for message deletion, and the author's own Delete path is untouched.

### 8. ~~A group story counts against the poster's own 30-active cap~~ — **DONE, v2.105.27**  (#119)
A group story now spends one of THAT GROUP's slots, not one of your personal thirty. Counted per
(author, group) rather than per group, so one member cannot fill the shelf and lock the others out.
**The assumption, stated:** you asked to "add" this point and keeping current behaviour would have been
no action, so I read it as decoupling the caps. If you meant the opposite it is a one-line difference.

### 9. The 34-frame redesign — IN PROGRESS, and ONE frame needs your call

`design_handoff_relay_app` is being built in phases so each one ships tested rather than all
of it landing half-done.

| Phase | What | State |
| --- | --- | --- |
| 1 | The foundation: the live canvas behind every screen, the cycling accent published as `--rb` / `--rb-rgb`, the glass token layer | **DONE, v2.106.0** |
| 2a | The navigation layer: five tabs (`Calls · History · Messages · Groups · Contacts`), the accent pill, and `/app/groups` as the Messages list narrowed to group threads | **DONE, v2.106.2** |
| 2b | The six screens themselves — 1a Dialer, 1b History, 1c Messages, 1d Conversation, 1e Contacts, 1f Profile | next |
| 3 | The call surfaces — 1g Incoming, 1h In-call video, 2a Group call, 2b Voice call, 3a Calling/matrix digits | **blocked on the decision below** |
| 4 | Overlays, sheets and system alerts — 2c–2i, 3b–3d, 4a–4k | after 3 |

**THE DECISION I NEED FROM YOU, and I am not guessing at it.** The handoff says, in bold:
*"Standard call bar — NEVER REDUCED. Every call surface shows the same 6 controls: mute ·
camera · flip · speaker · chat · end."*

**That contradicts something you asked for directly.** In v2.99.39 you told me to REMOVE the
in-call `⋯ More` button and the Diagnostics panel, and Record was folded into the bar as a
labelled chip. So the current bar is deliberately NOT the handoff's six.

Two readings, and they lead to different code:
- **The handoff wins** — the bar becomes exactly those six, and Record moves somewhere else
  (or goes). Speaker and flip already exist; chat already exists.
- **Your removal wins** — I keep today's controls and only restyle them to the board's glass
  circles + red end pill, i.e. the LOOK changes and the SET does not.

I have assumed nothing and built neither. Phase 3 starts the moment you say which.

Two smaller notes on phase 4, so they are not a surprise: **4b contact categories** needs a
`contact.tags` field that does not exist yet, and **4i locked group** needs the group lock to
expose its PIN state to a gate screen — both are additive, both are real work, and I will flag
them again when I reach them.

---

---

## §3 — Parked at your request

- **Agora as the primary transport, LiveKit as fallback** — ON HOLD (your call, 2026-07-29). The
  measurement that would settle it is unchanged and takes thirty seconds: open a call with the v2.105.21
  Stats chip on and read whether media is going **via TURN relay** (a config problem no vendor change
  fixes), whether RTT is over 300ms, or whether publish fps collapses as video starts. Only "all clean
  and still slow" makes Agora the right answer.
- **The Business path on the sign-in page** — not to be discussed for now (your call). It stays a
  "coming soon" panel, which is what the design handoff specifies.
- **iOS and Android app items** — dropped entirely at your request ("forget anything about the apple or
  andriod apps"), including the TestFlight install, the Push Doctor `apns-voip` check and the VoIP
  certificate reissue. The server-side push code stays where it is and needs nothing from anybody.
- **Group-call tiles "looking like they're talking"** — closed. Lips cannot move on a still
  photograph; real movement needs short looping video per tile, i.e. an asset decision. Everything
  achievable without new assets shipped in v2.99.70 / v2.105.16.

---

## §4 — Explicitly closed, recorded so they are not re-raised

- **601-586 identity merge** — the owner said to dismiss it permanently. The recovery mechanism exists
  (`scripts/recover-orphan-identity.mjs`) and the emptiness guard correctly refuses the swap, because
  identity #3 holds 143 rows.
- **Guest → registered by an admin supplying an email** — refused as an account-takeover primitive
  (v2.99.99). v2.105.15 shipped the safe, narrower version: an admin SUGGESTS an address, the guest
  completes it.
- **`register` still accepts an existing address** — kept deliberately; refusing it would create an
  email-existence oracle where none exists.

---

## Never verified on a device (true of everything below, and said plainly)

There is no phone and no MySQL in the build sandbox. So: no group has been locked, no invite link has
been opened on a phone, nobody has watched a party-line roster fill up before joining it, and no
minimised app has been called and watched to ring. Everything is proven by test and by reading; the
device pass is yours.

---

## §N — THE mediasoup CUTOVER: THE VERIFIED GAP LIST  (written 2026-07-31, after v2.106.59)

**How this was built.** A six-dimension audit ran over the four instruction docs the owner
re-uploaded, each dimension read against CURRENT SOURCE and each finding required to name the file,
the line and why it is not shipped. Three of its audio findings were then independently REFUTED by
verifiers — because v2.106.57 closed them one commit earlier, at exactly the sites they named. What
survives is below, with the shipped items pruned.

**Why it is written down.** The cutover is the single largest remaining piece of work in the plan and
it cannot be verified from this sandbox (no reachable mediasoup node, no `mediasoup-client`). A list
that has been checked against source is worth more than re-deriving it later, and the two structural
blockers in it are not obvious.

**THE TWO STRUCTURAL BLOCKERS, stated first because they change the order of the work.**

1. **There is no transport adapter pattern in the client. There never was one.** The mediasoup doc
   §1 says "Transport adapter pattern already exists in the codebase — mediasoup becomes an
   additional adapter, not a replacement of the abstraction." That premise is false: `startRelay` is
   a single ~6,540-line closure with ~280 nested functions, so a transport cannot be a separate
   file without a real module boundary being created first. The deleted hosted-SFU path was
   branches inside that closure, not an adapter.
2. **The party size / group-ness problem is solved (v2.106.59) but the ROOM still carries no
   transport.** `PersistedRoom` has no `transport`/`voip` field, so a chosen assignment cannot
   survive a leader change — `transportForHydratedRoom` can only ever answer "mesh". That is
   correct-by-design today and becomes a gap the moment a room is really placed on a node.


### mediasoup client adapter + transport-abstraction seam (doc section 3 and the "point a client at mediasoup or mesh by flag" constraint)

- **The doc's premise is false: there is NO transport adapter pattern in the client. There never was one.**  _(large)_
- **There is no mediasoup client anywhere — not the dependency, not a module, not an import.**  _(large)_
- **relayClient.ts has no module boundary at all: startRelay is a single 6,540-line closure with 280 nested functions, so a transport cannot be a separate file.**  _(large)_
- **No flag path exists from server to client — the wire protocol carries no transport field and the client reads no selector.**  _(medium)_
- **The stats COLLECTOR is mesh-only, so the section-3 "both transports" requirement is half-shipped: the shape is agnostic, the collection is not.**  _(small)_
- **The rescue harness the doc cites as already-existing was deleted with the SFU.**  _(medium)_


### mediasoup SFU server/signaling layer (doc §2.1, 2.2, 2.3, 2.4, 2.6)

- ~~Nothing in the signaling path selects a node — `planRoomTransport` has zero callers~~ —
  **PARTLY CLOSED by v2.106.59**: `relay.ts` now calls it once, through `planDialTransport`, for
  the group-saturation refusal. It reads the decision and does not yet ACT on the assignment, so
  the remaining gap is narrower: the plan's `voip` is computed and discarded.  _(medium)_
- **RoomMeta and PersistedRoom carry no node assignment, so transportForHydratedRoom can only ever answer "mesh"**  _(medium)_
- **No client handshake relay: none of the node's 11 ops is reachable from a signaling message**  _(large)_
- **No producer registry and no newProducer fan-out — consume() requires a producerId nobody publishes**  _(large)_
- **No transport is advertised to the client on any frame** — and note the client half now exists
  in one direction only: v2.106.59 put `parties` on the invite, so the wire is no longer
  completely one-way.  _(small)_
- **No pauseConsumer op, so "forward only the loudest 4–8 speakers" cannot be actuated**  _(small)_
- **No per-participant teardown: only whole-room close, and the node records no owner for a transport**  _(medium)_
- **Nothing calls closeRoom when a room ends**  _(small)_
- **No ICE-restart op on the node**  _(small)_
- **Transports are created without SCTP, so the SFU path has no data channel — in-call chat has no equivalent**  _(medium)_
- **stats returns transport stats only — no producer or consumer stats**  _(small)_
- **No layer-switching decision or reporting exists — setPreferredLayers has no caller and no feedback**  _(medium)_
- **Simulcast encodings are passed through unvalidated; the only bitrate ceiling is per-transport, not per-layer**  _(small)_
- **No node→app event channel at all — everything asynchronous is discarded or poll-only**  _(large)_
- **ICE servers cannot be zone-ordered: iceServers() takes no AZ and no per-relay AZ is configured anywhere**  _(medium)_
- **No AZ is known for the initiating participant, so rankNodes' preferAz has no producer**  _(small)_
- **No node-failure detection or room reassignment for a media reason**  _(medium)_
- **The participant cap is one number; transportCap() is unused**  _(small)_


### Voice/video mode API (doc: "one call system, two media profiles")

- **video → voice downgrade does not exist** — nothing stops the camera track while keeping audio.
- **Mode is not tracked as call state**, so there is no in-call mode indicator and nothing to toggle.
- **No UI control for a mode switch** — the only in-call video affordance is enable/disable.
- **No named `upgradeToVideo` / `downgradeToVoice`**, and the upgrade is unreachable programmatically.
- **Two dial entries rather than the doc's one**, and the option shape is an inverted optional boolean
  (`{voice:true}` rather than `{mode:'video'}`).
- **The incoming side's mode choice is not on the web handle**, while the native engine exposes it.

**Note on that last set:** the doc's `startCall(peerOrRoom, {mode})` shape is a rename of behaviour
that mostly exists (v2.106.44 made voice mode real and measured). What genuinely does not exist is the
DOWNGRADE and the mode as observable state. The rename should ride the cutover rather than precede it,
since the doc's own requirement is that the API "behave identically on both transports" — which cannot
be checked while there is only one.

### What the cutover needs that this sandbox cannot supply

- A reachable media node, to exercise the handshake at all. `voip-node/` has no `node_modules` here,
  so the agent cannot even typecheck locally.
- `mediasoup-client` installed — deliberately removed in v2.106.34 because nothing imported it, and it
  returns in the increment that actually does.
- The `relayClient.ts` module boundary (blocker 1 above), which is a refactor of the live call path and
  should not share a release with anything else.

