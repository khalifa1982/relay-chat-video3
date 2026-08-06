# RELAY iOS — VoIP push + CallKit spec (for the iOS app developer)

**Goal:** make a RELAY call ring the user's iPhone with the real full-screen
incoming-call screen **even when the app is closed or the phone is locked.**

The web app inside the WebView is already built for this. It will (a) capture the
device's VoIP token when the native side hands it over, and (b) accept an
"answer"/"decline" signal back from the OS call screen. **Nothing needs to change
on the web side.** The remaining work is native iOS, described below, plus one
server credential (see §6 — without it, nothing rings, so read that first).

The current RELAY iOS shell is a WebView wrapper that loads
`https://your-chat.io/app`. This spec adds the native ringing layer around it.

---

## 0. TL;DR of what to build

1. Register with **PushKit** for VoIP pushes; get the VoIP token.
2. Hand that token to the web page (two accepted formats — §2).
3. When a VoIP push arrives, **immediately** report an incoming call to
   **CallKit** using the push payload (§3, §4). *This is mandatory on iOS 13+:
   if you receive a VoIP push and do NOT report a call, iOS kills the app and
   blocks future VoIP pushes.*
4. When the user taps **Answer** / **Decline** on the OS call screen, foreground
   the WebView and tell the web app which call and which action (§5).

Capabilities needed in Xcode: **Push Notifications**, **Background Modes → Voice
over IP**, and **Background Modes → Remote notifications**.

---

## 1. PushKit registration

Register for VoIP pushes on launch (in `AppDelegate` / your app's startup),
**not** lazily — the token must be available before the first call.

```swift
import PushKit

final class VoipManager: NSObject, PKPushRegistryDelegate {
    static let shared = VoipManager()
    private let registry = PKPushRegistry(queue: .main)

    func start() {
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]   // triggers didUpdate below
    }

    // Called by iOS with the VoIP token (and on rotation).
    func pushRegistry(_ registry: PKPushRegistry,
                      didUpdate pushCredentials: PKPushCredentials,
                      for type: PKPushType) {
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        // token is a LOWERCASE HEX string, e.g. "9f86d081884c7d659a2f...".
        // Hand it to the web page (see §2). Store it so we can re-send on every
        // foreground and when the WebView finishes loading.
        VoipTokenStore.shared.set(token)
    }

    func pushRegistry(_ registry: PKPushRegistry,
                      didInvalidatePushTokenFor type: PKPushType) {
        VoipTokenStore.shared.clear()
    }
}
```

**Token format the web app requires (important):** the value delivered in §2
must be the **pure-hex** device token — `[0-9a-fA-F]`, 64 chars on classic
devices (up to ~100 on newer iOS), **even length**. The hex-join above produces
exactly this. Do **not** base64 it, do **not** wrap it, do **not** send Apple's
`Data` description (`<...>`), and do **not** send an Expo/FCM-style token here.
The page validates the shape and silently ignores anything that isn't hex, so a
wrong format fails invisibly.

---

## 2. Delivering the VoIP token to the web page

The web app listens for the token in **two** formats and accepts **either** — use
whichever is easiest in your WebView setup. Send it **every time** you have a
token AND the page is loaded (on first load, on every app foreground, and on
token rotation). The page de-duplicates, so re-sending the same token is free.

Declare the kind as **`"apns-voip"`** so the server stores it as the ring-only
VoIP transport.

### Format A — `postMessage` (recommended for a WKWebView)

Evaluate this in the page's JS context (e.g. `webView.evaluateJavaScript(...)`),
or post it from a `WKScriptMessageHandler` bridge:

```js
window.postMessage(JSON.stringify({
  type: "SET_PUSH_TOKEN",
  token: "<lowercase-hex-voip-token>",
  kind: "apns-voip"
}));
```

(A raw JSON string is expected here — RN/WKWebView bridges stringify. An
already-parsed object is also accepted.)

### Format B — `relay:native` CustomEvent

If it's simpler to dispatch a DOM event:

```js
window.dispatchEvent(new CustomEvent('relay:native', {
  detail: { type: 'pushToken', kind: 'apns-voip', token: '<lowercase-hex-voip-token>' }
}));
```

Both are equivalent. Pick one. The web app takes the token, registers it with
the RELAY server, and from then on the server can send this device a VoIP push.

> Practical note: send the token again once the WebView reports it finished
> loading (`didFinish navigation`). A token that arrives before the page's JS is
> ready would otherwise be dropped until the next foreground.

---

## 3. The push payload the server sends (what you receive)

When someone calls this user and the phone isn't actively connected, the RELAY
server sends a VoIP push (`apns-push-type: voip`, topic
`com.app.relaymobile.voip`) whose payload is a **flat dictionary of string
values**. The fields you care about:

| Key          | Example              | Meaning                                            |
|--------------|----------------------|----------------------------------------------------|
| `type`       | `incoming_call`      | `incoming_call` to ring, `call_cancel` to stop     |
| `kind`       | `incoming-call`      | Same discriminator, legacy spelling (`call-cancel`)|
| `callId`     | `r-abc123` (room id) | **The call's identity.** Echo it back on answer.   |
| `roomId`     | `r-abc123`           | Same value as `callId` (the signaling room).       |
| `mode`       | `voice` or `video`   | Call type — set CallKit `hasVideo` from this.      |
| `callerName` | `Ahmed`              | Display on the CallKit screen.                     |
| `callerAvatar`| `https://…` or `""` | Optional caller image URL; empty string if none.   |
| `callerPin`  | `777701`             | Caller's number (legacy field, still sent).        |
| `video`      | `1` or `0`           | Legacy boolean-as-string mirror of `mode`.         |
| `ts`         | `1730500000000`      | Send time, ms since epoch.                          |

> All values are strings (VoIP/APNs + FCM share one payload builder and FCM
> forbids non-string values). Read `mode` for voice-vs-video; `callId` **is** the
> room id — there is no separate call identifier.

The exact top-level shape delivered to `didReceiveIncomingPushWith` is the JSON
dictionary above under the payload's `dictionaryPayload` (or nested under an
`aps`/data envelope depending on how you inspect it — log the full
`payload.dictionaryPayload` on the first integration and read `type`, `callId`,
`mode`, `callerName`).

### `call_cancel`

If `type == "call_cancel"` (or `kind == "call-cancel"`), the caller hung up or
someone else answered. Look up the ongoing CallKit call by `callId` and **end
it** (`CXEndCallAction` / `provider.reportCall(with:endedAt:reason:.remoteEnded)`)
so the ring stops. A cancel carries only `callId` — no name/avatar.

---

## 4. Reporting the call to CallKit (mandatory, immediately)

```swift
func pushRegistry(_ registry: PKPushRegistry,
                  didReceiveIncomingPushWith payload: PKPushPayload,
                  for type: PKPushType,
                  completion: @escaping () -> Void) {
    let data = payload.dictionaryPayload
    let kind = (data["type"] as? String) ?? (data["kind"] as? String) ?? ""
    let callId = (data["callId"] as? String) ?? (data["roomId"] as? String) ?? ""

    if kind == "call_cancel" || kind == "call-cancel" {
        endCall(callId: callId)            // stop an existing ring
        completion()
        return
    }

    let callerName = (data["callerName"] as? String) ?? "RELAY call"
    let isVideo = (data["mode"] as? String) == "video" || (data["video"] as? String) == "1"

    // MUST report BEFORE completion() returns, on the SAME run of this callback.
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: callerName)
    update.hasVideo = isVideo
    update.localizedCallerName = callerName

    // Use a STABLE UUID derived from callId so answer/cancel refer to the same call.
    let uuid = deterministicUUID(from: callId)
    provider.reportNewIncomingCall(with: uuid, update: update) { error in
        completion()   // call completion() only after reporting
    }

    // Remember callId <-> uuid so the CallKit delegate can echo callId back (§5).
    CallRegistry.shared.map(uuid: uuid, callId: callId, video: isVideo)
}
```

Set up the `CXProvider` once with a config (ringtone, `supportsVideo`, etc.) and
keep a `CXCallController` for actions. Standard CallKit boilerplate applies.

> **Do not** await a network request before `reportNewIncomingCall`. Report from
> the push payload alone. The web app / server does the actual connecting; CallKit
> only needs the payload fields.

---

## 5. Answer / Decline → tell the web app

When the user acts on the OS call screen, your `CXProviderDelegate` fires
`CXAnswerCallAction` or `CXEndCallAction`. Translate that into a signal the web
app understands. There are two cases depending on whether the WebView is alive.

Look up the `callId` for the action's `action.callUUID` from the map you stored
in §4.

### Case A — app was already running (WebView alive)

Foreground the app and dispatch a `relay:native` CustomEvent into the page:

```js
// ANSWER:
window.dispatchEvent(new CustomEvent('relay:native', {
  detail: { type: 'callAnswered', callId: '<callId>', mode: 'voice' }   // or 'video'
}));

// DECLINE / hang up:
window.dispatchEvent(new CustomEvent('relay:native', {
  detail: { type: 'callDeclined', callId: '<callId>' }
}));
```

- `type` must be exactly `callAnswered`, `callDeclined`, or `callEndedNative`.
- `callId` must be the room id from the push (§3).
- `mode` is `voice` or `video` (only used on answer; defaults to voice if absent).

For `CXAnswerCallAction`: call `action.fulfill()` **after** the WebView is
foregrounded and the event is dispatched, so media can start.

### Case B — app was killed, the push woke it (cold start)

There is no page yet to receive an event. Instead, **load the WebView at the app
URL with these query parameters**, and the web app will pick up the intent as
soon as it boots (it consumes it once, so a stale URL can't re-answer later):

```
https://your-chat.io/app?nativeCall=<callId>&action=answer&mode=voice
```

- `nativeCall=<callId>` — the room id from the push (required).
- `action=answer` **or** `action=decline` (any other value is ignored — don't
  default it).
- `mode=voice` or `mode=video` (optional).

So the cold-start flow is: VoIP push → report CallKit call → user taps Answer →
your app launches/loads the WebView at the URL above → the web app auto-answers
that specific call.

> Keep the CallKit call alive across the launch until the web app has taken over;
> the server holds the ring redeliverable for ~70s, which is the window you have.

---

## 6. SERVER-SIDE PREREQUISITE — read this, or none of the above will ring

I checked the RELAY production server. **APNs VoIP is not deliverable yet** — the
server is missing the Apple signing key, so even a perfectly-registered device
token cannot be pushed to. Specifically, the production config has:

- `APNS_KEY_ID` ✅ set
- `APNS_TEAM_ID` ✅ set
- `APNS_VOIP_TOPIC` ✅ set, and `APNS_ENV=production`
- **`APNS_P8_KEY` ❌ MISSING** (the actual `.p8` VoIP auth key) — and no
  certificate pair either.

Because the signing key is absent, the server currently reports VoIP push as
**not configured** and sends nothing. **This must be fixed in parallel** with the
iOS work, or the feature will look broken no matter how correct the app is.

What's needed on the server (whoever manages the RELAY backend / its `.env`):

- **`APNS_P8_KEY`** — the contents of the Apple **VoIP Services `.p8` auth key**
  (an "Apple Push Notification service key" created in the Apple Developer
  portal, with **APNs** enabled). It may be the inline PEM (the whole
  `-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----` block) or a path to
  the file. The `APNS_KEY_ID` already set must be the Key ID of THIS key.
- Confirm **`APNS_TEAM_ID`** is the 10-char Apple Team ID.
- The topic is expected to be **`com.app.relaymobile.voip`** (bundle id +
  `.voip`). If the app's real bundle id differs, set `APNS_BUNDLE_ID` to the app
  bundle id (the server appends `.voip`) or set `APNS_VOIP_TOPIC` to the exact
  VoIP topic. **The bundle id in Xcode must match this**, or Apple rejects the
  push with `DeviceTokenNotForTopic`.
- `APNS_ENV` is currently `production`. A token registered by a **development /
  sandbox** build won't work against the production APNs host — so either test
  with a TestFlight/App Store build, or set `APNS_ENV=sandbox` while testing
  with a debug build. (Dev token + prod host = `DeviceTokenNotForTopic`, a common
  early false alarm.)

Alternative to the `.p8`: a VoIP **Services certificate** can be used instead via
`APNS_VOIP_CERT_PEM` + `APNS_VOIP_KEY_PEM`, but the `.p8` auth-key route is
simpler (one key, no expiry, serves every topic) and the other env vars are
already set for it — so just add `APNS_P8_KEY`.

---

## 7. How to verify end-to-end

1. Server: add `APNS_P8_KEY`, redeploy. (The RELAY health/diagnostics will then
   report `apnsVoip: true` / `apnsVoipMode: "token"`.)
2. App: build with the VoIP capabilities, register PushKit, deliver the token
   (§2). Confirm the token was accepted — after it's delivered, the user's RELAY
   account should show a registered VoIP push subscription server-side.
3. Lock the phone. From another account, call this user.
4. Expected: the iPhone shows the full-screen CallKit incoming-call screen with
   the caller's name. Tapping Answer connects the call in the RELAY app; the
   caller, who was held on "Reaching their phone…", flips to a live call.
5. Hang up from the caller before answering → the CallKit screen dismisses
   (that's the `call_cancel` push, §3).

---

## 8. Quick reference — the exact contracts

- **Token to page (A):** `window.postMessage(JSON.stringify({ type:"SET_PUSH_TOKEN", token:"<hex>", kind:"apns-voip" }))`
- **Token to page (B):** `dispatchEvent(new CustomEvent('relay:native',{ detail:{ type:'pushToken', kind:'apns-voip', token:'<hex>' }}))`
- **Token format:** lowercase hex, 64–100 chars, even length. No base64, no wrapping.
- **Incoming payload keys:** `type`(`incoming_call`|`call_cancel`), `callId`(=`roomId`), `mode`(`voice`|`video`), `callerName`, `callerAvatar`, `callerPin`, `ts`.
- **Answer to page (alive):** `dispatchEvent(new CustomEvent('relay:native',{ detail:{ type:'callAnswered', callId:'<id>', mode:'voice'|'video' }}))`
- **Decline to page (alive):** same event, `type:'callDeclined'` (or `'callEndedNative'` to end an ongoing one).
- **Answer to page (cold start):** load `https://your-chat.io/app?nativeCall=<id>&action=answer&mode=voice`
- **APNs send facts:** `apns-push-type: voip`, topic `com.app.relaymobile.voip`, priority high, ~70s expiry.
- **Server env still needed:** `APNS_P8_KEY` (the `.p8` VoIP auth key). Everything else is set.
