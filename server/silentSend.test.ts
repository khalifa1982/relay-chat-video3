/**
 * SILENT SEND (QW-6, v2.107.57) — press-and-hold the send button and the message
 * delivers normally but its push arrives WITHOUT a sound: the far end sees it, isn't
 * interrupted by it.
 *
 * The behaviour lives in the push transports (Expo drops the sound, APNs omits
 * `aps.sound`) and in the send path threading the flag through. The transports do
 * network I/O, so this pins the sound decision at the source and pins the wiring that
 * carries `silent` end to end. House style: codeOnly()-stripped source, so a pin can
 * never pass on a comment.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./testing/codeOnly";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const routers = codeOnly(read("./v2routers.ts"));
const webPush = codeOnly(read("./webPush.ts"));
const expo = codeOnly(read("./expoPush.ts"));
const apns = codeOnly(read("./apnsAlert.ts"));
const messages = codeOnly(read("../client/src/pages/app/Messages.tsx"));
const msgDict = read("../client/src/app/dict/messages.ts");

const hasBilingualKey = (src: string, key: string, prefix: string): boolean => {
  const at = src.indexOf(`"${key}":`);
  if (at < 0) return false;
  const rest = src.slice(at + key.length);
  const nextKey = rest.indexOf(`"${prefix}`, 3);
  const entry = nextKey > 0 ? rest.slice(0, nextKey) : rest.slice(0, 400);
  return /\ben:/.test(entry) && /\bar:/.test(entry);
};

/* ─────────────────── server: the flag is accepted and threaded ─────────────────── */

describe("QW-6 — send accepts a silent flag in its closed meta shape", () => {
  it("adds `silent` to the meta schema (a literal true, like voicemail)", () => {
    const at = routers.indexOf("send: publicProcedure");
    const proc = routers.slice(at, at + 2200);
    expect(proc).toMatch(/silent: z\.literal\(true\)\.optional\(\)/);
  });

  it("passes silent through to the offline new-message push", () => {
    const at = routers.indexOf("send: publicProcedure");
    // The new-message push block is well past the schema.
    const proc = routers.slice(at, at + 9000);
    expect(proc).toMatch(/kind: "message",[\s\S]{0,220}silent: input\.meta\?\.silent === true/);
  });

  it("never silences a call ring (silent is a message concern only)", () => {
    // The call push builders don't carry a silent flag; the only silent site is the
    // message push. A spot check: the voicemail push (which wakes the device on
    // purpose) does not opt into silent.
    const at = routers.indexOf('kind: "voicemail"');
    const block = routers.slice(at, at + 300);
    expect(block).not.toMatch(/silent:/);
  });
});

/* ─────────────────── transports: sound is actually dropped ─────────────────── */

describe("QW-6 — the push payload carries silent to the transports", () => {
  it("PushPayload has an optional silent field", () => {
    expect(webPush).toMatch(/silent\?: boolean/);
  });

  it("Expo sends sound:null for a silent message, default otherwise, never for a call", () => {
    expect(expo).toMatch(/sound: payload\.silent && !isCall \? null : \("default" as const\)/);
    // and webPush hands the flag to the Expo sender
    expect(webPush).toMatch(/sendExpoPush\([\s\S]{0,200}silent: p\.silent === true/);
  });

  it("APNs omits aps.sound for a silent message", () => {
    expect(apns).toMatch(/\.\.\.\(alert\.silent \? \{\} : \{ sound: "default" \}\)/);
    // and webPush hands the flag to the APNs sender
    expect(webPush).toMatch(/sendApnsAlert\([\s\S]{0,200}silent: p\.silent === true/);
  });
});

/* ─────────────────── client: long-press → silent, with the guard ─────────────────── */

describe("QW-6 — the composer long-press", () => {
  it("send() takes an optional silent flag and merges it into meta", () => {
    expect(messages).toMatch(/async function send\(opts\?: \{ silent\?: boolean \}\)/);
    // meta merges expire and silent; silent is a literal true.
    expect(messages).toMatch(/const silent = opts\?\.silent === true/);
    expect(messages).toMatch(/silent \? \{ silent: true as const \} : \{\}/);
  });

  it("arms a hold timer on pointer-down and fires a silent send", () => {
    expect(messages).toMatch(/silentHoldTimer/);
    expect(messages).toMatch(/void send\(\{ silent: true \}\)/);
    // 500ms hold
    expect(messages).toMatch(/\}, 500\)/);
  });

  it("the trailing click after a hold is swallowed (no double-send)", () => {
    expect(messages).toMatch(/if \(silentHoldFired\.current\) \{[\s\S]{0,120}return;/);
  });

  it("cancels the hold if the pointer is released or slides off", () => {
    expect(messages).toMatch(/onPointerUp=\{/);
    expect(messages).toMatch(/onPointerLeave=\{/);
  });

  it("only arms the hold when there is something to send", () => {
    const at = messages.indexOf("onPointerDown={() => {");
    const handler = messages.slice(at, at + 500);
    expect(handler).toMatch(/if \(!text\.trim\(\) && !pendingUpload && pendingAlbum\.length === 0\) return;/);
  });

  it("confirms a silent send to the sender with a toast", () => {
    expect(messages).toMatch(/if \(silent\) toast\.success\(t\("msg\.sentSilently"\)\)/);
  });
});

/* ─────────────────── dictionary ─────────────────── */

describe("QW-6 — dictionary keys are bilingual", () => {
  it("hold hint + sent-silently confirmation exist in en+ar", () => {
    expect(hasBilingualKey(msgDict, "msg.sendHoldHint", '"msg.')).toBe(true);
    expect(hasBilingualKey(msgDict, "msg.sentSilently", '"msg.')).toBe(true);
  });
});
