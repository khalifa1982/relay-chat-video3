import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EMPTY_ALERT_PREFS,
  MAX_ALERT_IDS,
  REDACTED_BODY,
  REDACTED_TITLE,
  alertPrefsAreEmpty,
  conversationOfPushTag,
  normalizeAlertPrefs,
  parseAlertPrefs,
  pushDisposition,
} from "../shared/alertPrefs";

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
/** Prose in these files quotes the very constructs under test. */
const codeOnly = (src: string) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");

/**
 * v2.107.8 GAVE THE OS THE NOTIFICATION, AND WITH IT ALL THREE DEVICE SWITCHES.
 *
 * Do Not Disturb, per-conversation mute and the group lock are per-device settings
 * enforced in `client/public/sw.js`, which reads a Cache Storage mirror of them. That
 * was sufficient for exactly as long as the service worker was the only thing that
 * could raise an OS-level alert.
 *
 * To make message notifications appear on the native shells, v2.107.8 attached an FCM
 * `notification` block and began sending Expo pushes. Both are rendered by the
 * operating system with no app code and no worker. So from that release, on a phone:
 *
 *   • DND silenced nothing,
 *   • a muted conversation buzzed anyway,
 *   • and a LOCKED group's message appeared on the lock screen — naming the sender
 *     and, since the same release put the body in the banner, quoting the text.
 *
 * The last one is the sharp end: the lock's entire purpose is that the content does
 * not appear on a screen somebody else is looking at.
 */

describe("the disposition rule mirrors the service worker's", () => {
  const prefs = (over: Partial<typeof EMPTY_ALERT_PREFS>) => ({ ...EMPTY_ALERT_PREFS, ...over });

  it("a ring is never dropped, whatever the device says", () => {
    // Missing a call is worse than an unwanted buzz, and it is the one alert that
    // cannot be caught up on later.
    expect(
      pushDisposition({ kind: "incoming-call", tag: "relay-call", prefs: prefs({ dnd: true }) }),
    ).toBe("send");
  });

  it("DND drops every other kind, including ones added later", () => {
    for (const kind of ["message", "missed-call", "voicemail", "contact-online", "something-new"]) {
      expect(pushDisposition({ kind, tag: "", prefs: prefs({ dnd: true }) }), kind).toBe("drop");
    }
  });

  it("mute is message-only — it must not silence a missed call from the same person", () => {
    const p = prefs({ muted: [42] });
    expect(pushDisposition({ kind: "message", tag: "relay-msg-42", prefs: p })).toBe("drop");
    expect(pushDisposition({ kind: "missed-call", tag: "relay-msg-42", prefs: p })).toBe("send");
    expect(pushDisposition({ kind: "voicemail", tag: "relay-msg-42", prefs: p })).toBe("send");
  });

  it("a locked conversation is REDACTED, not dropped", () => {
    // A privacy screen has no business losing the message.
    expect(
      pushDisposition({ kind: "message", tag: "relay-msg-7", prefs: prefs({ locked: [7] }) }),
    ).toBe("redact");
  });

  it("mute outranks lock when a conversation is both", () => {
    const p = prefs({ muted: [7], locked: [7] });
    expect(pushDisposition({ kind: "message", tag: "relay-msg-7", prefs: p })).toBe("drop");
  });

  it("an unattributable message is never suppressed on a guess", () => {
    const p = prefs({ muted: [1], locked: [2] });
    for (const tag of ["", "relay", "relay-msg-", "relay-msg-x", null, undefined]) {
      expect(pushDisposition({ kind: "message", tag, prefs: p }), String(tag)).toBe("send");
    }
  });

  it("a device that has never synced suppresses nothing", () => {
    for (const raw of [null, undefined, "", "not json", "[]", "null", "42"]) {
      const p = parseAlertPrefs(raw as string | null);
      expect(p, String(raw)).toEqual(EMPTY_ALERT_PREFS);
      expect(pushDisposition({ kind: "message", tag: "relay-msg-9", prefs: p })).toBe("send");
    }
  });

  it("the tag rule is the SAME regex the worker uses", () => {
    // Two spellings of "which chat is this" is how the two halves come to disagree
    // about what to redact.
    const sw = read("client/public/sw.js");
    const m = /\/\^relay-msg-\(\\d\+\)\$\//.exec(sw);
    expect(m, "the worker's convOf regex changed shape").not.toBeNull();
    expect(conversationOfPushTag("relay-msg-1234")).toBe(1234);
    expect(conversationOfPushTag("relay-msg-1234x")).toBeNull();
    expect(conversationOfPushTag("xrelay-msg-1")).toBeNull();
  });

  it("the redacted copy is byte-identical to the worker's", () => {
    const sw = read("client/public/sw.js");
    expect(sw).toContain(`"${REDACTED_BODY}"`);
    expect(sw).toContain(`hide ? "${REDACTED_TITLE}"`);
  });
});

describe("normalizing what a device reports", () => {
  it("keeps only positive integer ids, deduped", () => {
    const p = normalizeAlertPrefs({ dnd: 1, muted: [3, 3, -1, 0, 2.5, "4", null, 7], locked: "x" });
    expect(p.muted).toEqual([3, 7]);
    expect(p.locked).toEqual([]);
    // `dnd` is a strict boolean: a truthy 1 must not turn the phone silent.
    expect(p.dnd).toBe(false);
  });

  it("bounds each list rather than refusing the whole sync", () => {
    const many = Array.from({ length: MAX_ALERT_IDS + 50 }, (_, i) => i + 1);
    expect(normalizeAlertPrefs({ muted: many }).muted).toHaveLength(MAX_ALERT_IDS);
  });

  it("survives the shapes a client can actually send", () => {
    for (const bad of [null, undefined, 42, "x", [], true]) {
      expect(normalizeAlertPrefs(bad), String(bad)).toEqual(EMPTY_ALERT_PREFS);
    }
  });

  it("the empty record is stored as NULL, so the column reads as it always did", () => {
    expect(alertPrefsAreEmpty(EMPTY_ALERT_PREFS)).toBe(true);
    expect(alertPrefsAreEmpty({ dnd: false, muted: [1], locked: [] })).toBe(false);
    expect(alertPrefsAreEmpty({ dnd: true, muted: [], locked: [] })).toBe(false);
  });

  it("round-trips through the column", () => {
    const p = normalizeAlertPrefs({ dnd: true, muted: [2, 4], locked: [9] });
    expect(parseAlertPrefs(JSON.stringify(p))).toEqual(p);
  });
});

/* ── the wiring, pinned at source: there is no MySQL here ─────────────────── */

describe("the sender applies it to the transports the OS renders", () => {
  const PUSH = codeOnly(read("server/webPush.ts"));

  it("FCM and Expo are both partitioned before sending", () => {
    expect(PUSH).toMatch(/const fcm = partition\("fcm"\)/);
    expect(PUSH).toMatch(/const expo = partition\("expo"\)/);
    expect(PUSH).toMatch(/if \(d === "drop"\) continue;/);
    expect(PUSH).toMatch(/\(d === "redact" \? redacted : normal\)\.push\(s\.endpoint\)/);
  });

  it("the redacted batch carries neither the sender nor the text", () => {
    const red = PUSH.slice(PUSH.indexOf("const redactedPayload"));
    expect(red.slice(0, 200)).toMatch(/title: REDACTED_TITLE/);
    expect(red.slice(0, 200)).toMatch(/body: REDACTED_BODY/);
  });

  it("both batches are counted, not just the last one", () => {
    // `=` here would report the redacted batch's count as the whole delivery.
    expect(PUSH).toMatch(/fcmDelivered \+= r\.delivered/);
    expect(PUSH).toMatch(/expoDelivered \+= r\.sent/);
    expect(PUSH).not.toMatch(/fcmDelivered = r\.delivered/);
    expect(PUSH).not.toMatch(/expoDelivered = r\.sent/);
  });

  it("the FCM branch reads the batch's OWN payload, not the outer one", () => {
    // The redacted batch shares the block; a leftover `payload.title` there would
    // send the real name to a locked device while claiming to have redacted it.
    const fcmBlock = PUSH.slice(
      PUSH.indexOf("const fcm = partition"),
      PUSH.indexOf('subs = subs.filter(s => s.kind !== "fcm")'),
    );
    expect(fcmBlock).not.toMatch(/payload\.title/);
    expect(fcmBlock).not.toMatch(/payload\.body/);
    expect(fcmBlock).toMatch(/title: p\.title/);
  });

  it("Web Push is deliberately left to the worker", () => {
    // Not a gap: the worker has the same rule from Cache Storage, and a second
    // enforcement point here would be a second thing to keep in step.
    const tail = PUSH.slice(PUSH.indexOf("const body = JSON.stringify(payload)"));
    expect(tail).not.toMatch(/dispositionOf|partition\(/);
  });

  it("APNs VoIP is untouched — a ring carries no banner to redact", () => {
    const voip = PUSH.slice(PUSH.indexOf('subs.filter(s => s.kind === "apns-voip")'));
    expect(voip.slice(0, 400)).not.toMatch(/redact/);
  });
});

describe("the row it reads, and who may write it", () => {
  const DB = codeOnly(read("server/v2db.ts"));
  const ROUTERS = codeOnly(read("server/v2routers.ts"));

  it("the column exists in the schema and is added to live databases", () => {
    expect(read("drizzle/schema.ts")).toMatch(/alertPrefs: text\("alertPrefs"\)/);
    expect(DB).toMatch(
      /table: "push_subscriptions", column: "alertPrefs", ddl: "ADD COLUMN `alertPrefs` text"/,
    );
  });

  it("the sender actually selects it", () => {
    const list = DB.slice(DB.indexOf("export async function listPushSubscriptions"));
    expect(list.slice(0, 900)).toMatch(/alertPrefs: pushSubscriptions\.alertPrefs/);
  });

  it("a write is scoped to the caller's OWN subscription", () => {
    // Endpoint alone was enough to act on somebody else's row once (v2.99.49), and
    // DND on a stranger's row would silence every message notification they get.
    const fn = DB.slice(DB.indexOf("export async function setPushAlertPrefs"));
    const body = fn.slice(0, fn.indexOf("export async function listPushSubscriptions"));
    expect(body).toMatch(/eq\(pushSubscriptions\.identityId, input\.identityId\)/);
    expect(body).toMatch(/eq\(pushSubscriptions\.endpoint, input\.endpoint\.slice\(0, 500\)\)/);
  });

  it("the mutation requires an identity and bounds its input", () => {
    const proc = ROUTERS.slice(ROUTERS.indexOf("setAlertPrefs: publicProcedure"));
    const body = proc.slice(0, proc.indexOf("unsubscribe: publicProcedure"));
    expect(body).toMatch(/requireIdentity\(ctx\)/);
    expect(body).toMatch(/\.max\(MAX_ALERT_IDS\)/);
    expect(body).toMatch(/normalizeAlertPrefs\(input\)/);
  });

  it("an empty record is stored as NULL", () => {
    const fn = DB.slice(DB.indexOf("export async function setPushAlertPrefs"));
    expect(fn.slice(0, 1200)).toMatch(/alertPrefsAreEmpty\(input\.prefs\) \? JSON\.stringify\(input\.prefs\) : null/);
  });
});

describe("the page keeps the row current", () => {
  const SW = codeOnly(read("client/src/app/swPrefs.ts"));
  const ENGINE = codeOnly(read("client/src/pages/../app/RelayEngine.tsx"));

  it("one notification drives BOTH mirrors", () => {
    // A per-writer duty is what the worker mirror already learned not to rely on:
    // a third caller forgets, and the stale copy names somebody in a locked chat.
    expect(SW).toMatch(/export function onAlertPrefsChanged/);
    const sync = SW.slice(SW.indexOf("export function syncAlertPrefsToSw"));
    expect(sync).toMatch(/writeAlertPrefsToSw\(prefs\)/);
    expect(sync).toMatch(/prefListeners\.forEach/);
  });

  it("a throwing subscriber cannot cost the worker its copy", () => {
    const sync = SW.slice(SW.indexOf("export function syncAlertPrefsToSw"));
    expect(sync.indexOf("writeAlertPrefsToSw(prefs)")).toBeLessThan(sync.indexOf("prefListeners"));
    expect(sync).toMatch(/try \{/);
  });

  it("the engine syncs on registration, not only on the next change", () => {
    // A device whose switches were set before the token arrived would otherwise stay
    // unsuppressed until the user happened to toggle something.
    expect(ENGINE).toMatch(/const rememberNativeEndpoint = \(endpoint: string\) =>/);
    const fn = ENGINE.slice(ENGINE.indexOf("const rememberNativeEndpoint"));
    expect(fn.slice(0, 500)).toMatch(/pushAlertPrefs\.current\(readAlertPrefs\(\)\)/);
  });

  it("it tracks every native endpoint, not just the newest", () => {
    // An old row stays live until the server evicts it; leaving it unsynced is what
    // lets a muted chat keep buzzing.
    expect(ENGINE).toMatch(/const nativeEndpoints = useRef<Set<string>>\(new Set\(\)\)/);
    expect(ENGINE).toMatch(/nativeEndpoints\.current\.forEach/);
  });

  it("a ring-only VoIP row is not tracked — it has no banner to suppress", () => {
    expect(ENGINE).toMatch(/if \(kind !== "apns-voip"\) rememberNativeEndpoint\(endpoint\)/);
  });

  it("both native registration paths record their endpoint", () => {
    // The FCM path and the WebView bridge — the two places a native token is
    // registered. The definition is `= (endpoint…`, so it is not a call.
    const calls = ENGINE.match(/rememberNativeEndpoint\(/g) ?? [];
    expect(calls.length).toBe(2);
    expect(ENGINE).toMatch(/pushSubscribe\.mutate\(\{ endpoint: token, kind: "fcm" \}\);\s*\n\s*rememberNativeEndpoint\(token\);/);
  });
});
