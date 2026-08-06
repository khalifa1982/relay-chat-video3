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
| QW-3 | Starred messages | star action + starred filter view |
| QW-4 | Message editing + "edited" label | server `editMessage` + bubble marker |
| QW-5 | Text formatting bold/italic/strike/mono | renderer first, composer hints after |
| QW-6 | Silent send | long-press send → no sound at the far end |
| QW-7 | Group description | photo exists; add the text field |
| QW-8 | Pinned messages inside a chat | banner at top, admin-gated in groups |
| QW-9 | Read-receipt / typing privacy toggles | settings + server respect |
| QW-10 | GIF picker | search-backed, rides the attachment sheet |
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
