# RELAY feature roadmap — combined & code-verified (2026-08-07)

Owner brief: take the WhatsApp / WhatsApp Business list (PDF part 1) plus the
Telegram / Signal set (part 2, from knowledge until the PDF arrives), merge into
ONE list, **cross-check every line against the codebase before calling it a
gap**, then build everything: quick → medium → big.

The cross-check mattered. Sixteen candidate "gaps" turned out to already exist —
each confirmed by grep against `client/` + `server/` + `shared/`, not memory:

## Already built (verified, no work needed)

reply/quote (`draft.replyToId`) · reactions (`shared/reactions.ts`) · @mentions
(`shared/mentions.ts`) · typing indicators (rows + in-chat) · last-seen buckets
(`shared/profileFields.ts`) · read receipts + group read-by + ✓/✓✓ on rows ·
profile avatars (incl. animated) · group photos · view-once + screenshot
detection · expiring messages (`expireSecondsKey`) · file attachments (kind
`file`) · albums (`shared/albumRules.ts`) · voice notes + EN⇄AR transcripts ·
**video circles** (`VideoRecordSheet`, `lib/videoNote`) · drafts store · link
previews · per-thread mute · archive · **thread pinning** (server-backed
`t.pinned`, v2.103.0) · **forwarding** (Forward picker) · search (incl. group
title/number/saved-name) · stories + status replies + group stories ·
**notes-to-self** (`isNotes` category) · voicemail · party lines ·
hold/swap/merge · screen share · **call background-blur + face filters**
(MediaPipe segmentation in `mediaPipeline.ts`) · **group invite links**
(`InviteLinkSection`, `joinGroupByInvite`) · knock approval · host roles ·
**locked/hidden groups** with preview redaction (v2.105.20) · QR number share
(`ShareNumber.tsx`) · dark mode · ar/en with RTL · multi-device + device
approval.

## Wave 1 — quick wins (days each; ▶ = in this branch)

| # | Feature | Notes |
|---|---------|-------|
| QW-1 ▶ | Voice playback speed 1×/1.5×/2× | global setting, chained runs inherit it |
| QW-2 ▶ | Draft indicator on thread rows | quiet italic; lock- and active-row-aware |
| QW-3 ▶ | Starred messages | per-user bookmarks; menu toggle, bubble marker, cross-chat Starred view |
| QW-4 ▶ | Message editing + "edited" label | `messages.edit` proc + inline editor + bubble marker; sender/text/live-only |
| QW-5 ▶ | Text formatting bold/italic/strike/mono | renderer shipped (`shared/messageFormat` parser + linkify); composer hints deferred |
| QW-6 ▶ | Silent send | long-press send → delivers, but the push has no sound (Expo `sound:null` + APNs omits sound) |
| QW-7 ▶ | Group description | photo exists; add the text field |
| QW-8 ▶ | Pinned messages inside a chat | banner at top, admin-gated in groups |
| QW-9 ▶ | Read-receipt / typing privacy toggles | settings + server respect |
| QW-10 ▶ | GIF picker | search-backed, rides the attachment sheet |
| QW-11 | Per-contact ringtones | variants of the synthesized motif (`shared/ringtone.ts`) |
| QW-12 | Screenshot-block toggle | mobile repo (FLAG_SECURE), ships in 1.0.44 |

## Wave 2 — medium (a week-ish each)

Polls + quiz mode · call links (join by URL) · scheduled messages +
send-when-online · message-request inbox for strangers · chat folders ·
in-chat translation ar⇄en (Gemini path exists for transcripts) · chat lock for
DMs + secret code (groups already lock) · wallpapers / per-chat themes ·
location sharing (static, then live) · silence unknown callers · report flow ·
chat export/backup · media auto-download + storage manager · edit sent
media/captions · face-blur tool in the media editor · multi-account switching.

## Wave 3 — big builds (multi-week)

Channels / broadcast lists · communities · sticker platform + custom packs ·
secret chats (per-chat E2E + self-destruct + no-forward) with safety-number
verification · SFU return to lift the 6-person call cap · bots / public API ·
forum topics in groups · party-line livestreaming (RTMP in, unlimited viewers) ·
built-in proxy support for blocked networks · AI assistant in chats · passkeys.

## Skip (owner-agreed)

Phone-number registration / SMS OTP (the 6-digit identity IS the product) ·
Meta 3D avatars · FB/IG cross-posting · payments · Telegram-style premium
tiers · games platform · nearby-people.

## Apple App Store compliance (v2.107.52 + v2.107.54 — DONE)

The June rejection (build 21) was content/metadata, not code quality. Every
guideline blocker that needed real code is now built, tested, and live:

- **5.1.1(v) account deletion** — `identity.deleteMyAccount` reuses the full
  erase-cascade with the self-guard inverted (actingId=null), tears down the
  session, and is fronted by a Profile card behind a type-your-number confirm.
- **1.2 UGC safety** — the full set of precautions:
  - **Reporting** — `content_reports` table + `identity.reportContent` (fails
    loud, refuses self-reports, snapshots the text so a report survives an
    unsend) + admin `listReports`/`resolveReport` for the 24h window. A **Report**
    item sits in the message menu with a reason picker.
  - **Blocking** — per-contact block already existed.
  - **Remove own posts** — unsend / admin-remove already existed.
  - **(v2.107.54) Terms + no-tolerance gate** — the guest sign-up path gates on
    a real "I agree" checkbox stating zero tolerance, linking to a new
    `/guidelines` page (the acceptable-use terms, report/block/remove how-to, and
    a 24h enforcement commitment).
  - **(v2.107.54) Content filter** — `shared/contentFilter.ts` masks unambiguous
    slurs/exploitation terms on the BROADCAST surfaces (profile name + status
    note, story text, group name + note, party-line title). NOT private messages.
  - **(v2.107.54) In-app report contact** — the report dialog shows a
    `report@<host>` address alongside the reason buttons.

The mic purpose string (5.1.1(ii)) was already fixed in build 43. Remaining
items are NOT code — done in App Store Connect before resubmitting: **demo login**
must work, the **age rating** must declare user-generated content, **fresh
screenshots** of the current build, and a **screen recording** of the delete flow
in the review Notes. Then a new build must be submitted.

## Infrastructure rider (approved with "build everything")

Self-deploy so releases stop depending on GitHub Actions: a pull-poller on each
box plus an env-gated authenticated deploy endpoint (`DEPLOY_TOKEN`; endpoint
returns 403 until the token exists in `/home/relay/.env`). Code rides this
branch; arming needs one ops run when Actions cooperates.

## Ground rules learned building this

1. **Grep before building** — sixteen "gaps" already existed.
2. Colors carry one meaning each (accent=unread, green=online, amber=mute);
   new markers take the quiet treatment.
3. Every feature lands with test pins in the suite; mobile edits get a local
   `expo export` before any EAS build.
