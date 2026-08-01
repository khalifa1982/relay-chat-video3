# Crosscheck — every ask, against the code (2026-08-01)

> *"I want you to crosscheck all the history, what things that I ask you. You didn't do it."*
> — and earlier, *"I am posting for you some comments and it's placed, but you don't read it."*

## Method, so you can judge the answer rather than trust it

I extracted **every message you sent** from this session's transcript — 56,235 records, 505 turns,
filtered to **207 that are genuinely yours** (dropping tool output, stop-hook notices, my own
scheduled check-ins, and image placeholders). Then I checked each ask **against the source**, not
against my own notes — because the last time you asked this (2026-07-24, *"Check from my
conversation with you. All the best things that I give you, and you haven't done it"*) I audited
the surface I had already changed, found it matching my notes, and told you your browser was
stale. That was wrong. An audit that only looks where the previous change landed just confirms
itself.

Every "not done" below was verified by reading the code today. Every "done" cites where.

---

## THE HEADLINE: the work is done. It is not delivered.

**PR #132 has been sitting as a DRAFT carrying sixteen releases — v2.106.55 through v2.106.70.**

- 24 commits, 85 files, +8,895 / −865
- CI: **green**, `mergeable_state: clean`
- `main` is still at **v2.106.54**

A draft PR does not merge, and `main` is what auto-deploys. **So none of the following is on your
phone**, which is why it reads as "you didn't do it":

| You asked | Built in | Live? |
|---|---|---|
| Six-digit cap on every PIN box ("don't exceed six digits") | v2.106.63, .65 | **no** |
| Groups out of Messages; group calls in the Groups tab | v2.106.64 | **no** |
| Send as a permanent icon; voice note into the `+` menu | v2.106.65 | **no** |
| Group avatar you pick at creation actually appears | v2.106.66 | **no** |
| Swipe row opaque, one side, stays where you slid it | v2.106.60 | **no** |
| Per-person colour on name + face; reply quote; `@mention` | v2.106.61, .62 | **no** |
| Search by name **or** number in every box | v2.106.70 | **no** |
| Push backend wired to your staged credentials | v2.106.69 | **no** |

**I have taken it out of draft.** It needs one click from you to merge; `main` deploys itself in
60–90 seconds after that.

This is the same pattern you hit on 2026-07-24 (*"I check live website still not showing the
changes"*) and again on 2026-07-31. It is mine to fix, not yours to work around — I should have
marked it ready sixteen releases ago instead of leaving it as a draft while stacking work behind it.

---

## Genuinely NOT done — verified against source today

### 1. Image / video edit tools — absent
> *"whenever you upload image or video you should have edited tools inside these 2 features"*

Verified: no editor exists anywhere in `client/src` (no crop, rotate, trim, or filter UI for an
attachment). Two constraints shape it, so it is a real piece of work rather than a switch: the
upload is **eager** (picking a file uploads it immediately), so an editor means deferring the
upload; and it has to run **before** `processImageForUpload`, because the thumbnail is generated
from the processed image and uploaded first as its own request. `mediaPipeline.ts` cannot be
reused — it is MediaStream→MediaStream, for live call filters.

### 2. Video → voice downgrade — absent
`client/src/lib/relayClient.ts:6115`, `setCam(false)` sets `track.enabled = false` and **never
stops the track**. So turning the camera off mid-call leaves it acquired and the OS camera
indicator lit. `flipCamera` already has the correct pattern (keep the audio tracks, stop the old
video, rebuild the stream) and `replaceVideoEverywhere` already accepts `null`.

### 3. `377537` → `249444` — never executed
> *"Kindly change the number 377537 to 249444"* (2026-07-29)

The mechanism exists (`admin-tool`, `set-number`, which propagates to every contact who saved the
old number inside one transaction). It was never run. It needs **Actions → aws-ops.yml on
`ref: main`**, dry run first, then apply — there is no database route from this sandbox.

### 4. Demo account `demo@demo.demo` / passcode `1122` — built, never run
Same reason and the same one-command fix as (3).

### 5. mediasoup — the client half does not exist
Answering your first question directly: **no, the node structure is not active.** The server side
is real (node registry, per-core `WebRtcServer`, draining, saturation, the deploy action) and the
nodes are launched — but `grep` for mediasoup in `client/src` returns **comments only**, and
`server/relay.ts:2108` says in its own words *"IT CANNOT FIRE TODAY."* Every call today is the
mesh. The remaining work is the browser transport adapter, and the structural blocker is recorded:
`startRelay` is one ~6,540-line closure with no transport seam.

### 6. Design fidelity — in progress, not finished
> *"you matched it about 60%"*

v2.106.61/62 answered board 3c's conversation internals. Its header, composer and typing pill are
on the list, along with the remaining frames. This is task #140 and it is the largest open item.

---

## Checked and already done — so you know I looked

| Ask | Where |
|---|---|
| Typing indicator | `client/src/app/TypingLine.tsx` — names *who*, per-person colour |
| Newest group message rises to the top, unless pinned | `server/v2db.ts:4632` — pinned first, then newest |
| Animated (GIF) avatars | `AvatarPicker`'s "Animated ✨" toggle; survives the pipeline unmodified |
| Guest can set an avatar | `Profile.tsx:758` — not gated on being registered |
| Group photo laundering gate | `assertOwnedAvatarUrl`, both `createGroup` and `setGroupProfile` |
| Automatic capacity | v2.106.54 — registry-driven, drain file, saturation alarm |
| Dial-out shows their photo, status, last call | v2.105.24 |
| Contact PIN after the badge, in green | v2.106.43 |
| LiveKit removed completely | v2.106.52 → .55, including the store app |

**One nicety rather than a gap:** guest onboarding does not *prompt* for an avatar. A guest can set
one from Profile at any time, so nothing is blocked — it is a missing step, not a missing feature.

---

## What only you can do

1. **Merge PR #132.** Sixteen releases, one click, deploys itself.
2. **Run the two admin operations** — Actions → `aws-ops.yml`, **`ref: main`** (any other branch
   fails with a misleading STS error), dry run then apply: the number change, and the demo account.
3. **Call from your phone** once #132 is live. Everything about calling here is Blink-verified in a
   two-browser harness; nobody has placed a call on a real handset, and iOS Safari is untested
   because there is no WebKit build in this sandbox.
