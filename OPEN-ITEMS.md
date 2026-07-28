# RELAY — every owner request that is NOT done

Written 2026-07-28 at the owner's request: *"I need a list of all the things you have not done.
Let me know if you passed on something and tell me when you will do it."*

**How this was built.** Not from memory. Every line below was extracted from `todo.md`'s
`NOT DONE` / `STILL OPEN` / `- [ ]` markers and then **re-checked against current source**, because a
stale note is worse than no note. Where the check contradicted the note, the check wins and that is
said. Nothing here is a guess about what the code does.

**One thing to check before reading further:** several items the owner reports as missing are
implemented and deployed. The Profile hero is the clearest case, and there is a built-in diagnostic
for it — see §0.

---

## §0 — Reported missing, but SHIPPED (so probably a stale bundle)

### The profile page: "remove the first name, badge and pin number"
**Status: DONE in v2.105.18-era code, deployed.** Verified in `client/src/pages/app/Profile.tsx`
today: the hero renders no name, no `RoleBadge` and no digits. `formatPin` survives there only inside
an `aria-label` (a screen reader must be told which number the button concerns) and as the subtitle of
the deeper "My number" row — not in the hero.

**HOW TO TELL WHICH BUNDLE YOU ARE LOOKING AT.** v2.103.1 put the build number in the exact space the
name used to occupy. So on the Profile page:

- you see **`RELAY v2.105.x`** → you have the current bundle and the change is present;
- you see **your name + badge + 6 digits** → you are on a bundle older than v2.103.1. Hard-refresh
  (or, in the app shell, force-quit and reopen).

If it still shows the name on a confirmed-current build, that is a real regression and I want a
screenshot with that version string in it.

### Also shipped, in case these are the ones being looked for
| Ask | Shipped in |
| --- | --- |
| Profile page rebuilt as the control centre (barcode, number, badge, status, everything from one place) | v2.99.89 |
| Icons on the Email / Mobile / social rows | v2.99.93 |
| Guest ID expiry notice + countdown | v2.99.93 / v2.100.0 |
| Version number visible on the profile | v2.103.1 |
| Story-vs-status vocabulary fixed everywhere | v2.101.0 |
| Real status picker (work / vacation / travel / free / busy, emoji + colour + note) | v2.101.1 |

---

## §1 — NOT DONE, and I own the delay

### 1. The 4-digit group lock  (#108, last piece of the group screenshot batch)
Confirmed absent: no `groupLock` / `lockPin` / `groupPasscode` anywhere in `server/`, `client/src/` or
`drizzle/`. Not started.

Design already settled (from the earlier pass, so this is ready to build):
- it is a **privacy screen, not access control** — anyone with the group open in another tab still has
  the data, so it must not pretend to be a permission;
- per-device, reusing `client/src/app/passcode.ts`'s salted-SHA-256 hashing rather than a second copy;
- **the thread list must stop showing a locked group's preview**, or the lock leaks exactly what it
  is meant to cover.

Size: one additive nullable column, no new dependency. **Next up when you say go.**

### 2. Call-invite / party-line join screen  (#109)
No dedicated screen exists (`client/src/pages/app/` has none). Was deliberately sequenced behind group
roles, which are now done (v2.104.0 / v2.105.7 / v2.105.16) — so nothing blocks it any more.

### 3. Thread list shows a bare emoji with no context
A one-tap status reaction arrives in the inbox as a floating emoji with nothing saying what it was
about. `statusReplyOf` exists and the CONVERSATION renders the chip correctly (v2.99.80); the **thread
list** does not, because `listThreads` projects `{lastMessageBody, lastMessageKind}` and no `meta`.
Confirmed today at `server/v2routers.ts:1613`.

Not free: adding `meta` touches the groupwise-max query every client polls. Deliberately deferred as a
performance decision, not forgotten.

### 4. Voice/video marker on an ANSWERED GROUP call
Confirmed: `conference_history` has **no channel column** (checked `drizzle/schema.ts` today), so for a
group call the media type is genuinely unknown and printing either would be a guess. Solo rows show it
because `call_history.channel` exists. Needs one additive column plus a writer.

### 5. History search/grouping only covers the most recent 100 calls
Both call payloads are capped at 100 rows server-side, so an older call cannot be found however good
the matcher is. Raising it is a paging change with its own cost — flagged rather than quietly bundled
into the search work (v2.99.96, v2.99.98).

---

## §2 — NOT DONE, and needs a decision from you first

### 6. Group-call tiles on the landing page: "make them look like they're talking"
Asked twice. **Lips cannot move on a still photograph** — the ten tiles are stock stills with faces at
different scales, so a mouth overlay lands on a houseplant in one and a keyboard in another. What v2.99.70
and v2.105.16 DID ship is everything that can be done without new assets: a coherent rotating
active-speaker ring, voice-shaped level meters, sub-pixel per-tile drift, and a nod — with repainting
animations measured 4 → 0 on a phone.

Real lip movement needs **short looping video per tile**, i.e. an asset decision, not code. My note
records you later saying to drop it; say the word if you want it back on the list.

### 7. The Business path on the sign-in page
The design handoff specifies it as a "coming soon" panel, so nothing is wired behind it. Needs you to
say what Business accounts actually do.

### 8. A group admin cannot delete another member's group story
A separate capability nobody has asked for; the story expires in 24h regardless. Named in v2.105.6 as a
deliberate omission rather than an oversight.

### 9. A group story counts against the poster's own 30-active cap
The honest reading (the cost is per-post whoever it is addressed to), but flagged in case you disagree.

---

## §3 — Owner-side, nothing in this repo can do it

10. **iOS ring on a locked phone** — needs the TestFlight build installed, then `/app/admin` →
    Push Doctor showing a device kind of **`apns-voip`** rather than `apns`. That single row is the proof
    PushKit minted a token. Build #33 is uploaded and processing.
11. **The VoIP certificate should be reissued** — the key crossed a chat channel, so it must be treated
    as compromised once ringing is confirmed working.
12. **Firebase/APNs credentials** live only in `/home/relay/.env`; nothing here can read or set them.

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

There is no phone, no MySQL and no Xcode in the build sandbox. So: no group has been locked, no story
deleted by an admin, no handset has rung, and no minimised app has been called and watched to ring.
Everything is proven by test and by reading; the device pass is yours.
