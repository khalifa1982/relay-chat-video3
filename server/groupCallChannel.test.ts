/**
 * #116 — an answered GROUP call says Voice or Video in History.
 *
 * A solo row has said so since v2.75 because `call_history.channel` exists;
 * `conference_history` had no such column, so v2.99.77 recorded the absence as
 * deliberate — "printing either would be a guess". This adds the fact rather than
 * the guess.
 *
 * THE ONE THING EVERY ASSERTION HERE PROTECTS: an UNKNOWN channel must render as
 * NOTHING. Every conference logged before the column existed has none, and a party
 * line is joined rather than dialled, so a default would make each of those rows
 * assert a media type nobody recorded — about the reader's own call history.
 */
import { describe, expect, it } from "vitest";
import { translate } from "../client/src/app/i18n";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createRegistry,
  handleMessage,
  snapshotRoom,
  applyHydratedRooms,
  partyLineRoomId,
  type ConferenceEndHook,
  type RelayRegistry,
  type RelaySocket,
  type ResolveDialHook,
} from "./relay";
import { isPersistedRoom, type PersistedRoom } from "./roomStore";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SCHEMA = read("drizzle/schema.ts");
const DB = read("server/v2db.ts");
const RELAY = read("server/relay.ts");
const ROUTERS = read("server/v2routers.ts");
const CORE = read("server/_core/index.ts");
const HISTORY = read("client/src/pages/app/History.tsx");

class FakeConn {
  outbox: unknown[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  constructor() {
    this.socket = { send: (o: unknown) => this.outbox.push(o), close: () => {} };
  }
  setPin = (p: string) => { this.pin = p; };
  asConn() { return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: undefined }; }
}
function register(reg: RelayRegistry, name: string, pin?: string) {
  const c = new FakeConn();
  handleMessage(reg, c.asConn(), { type: "register", name, pin });
  return c;
}
/** Dial with or without video and return the caller's room id. */
function dial(reg: RelayRegistry, video: boolean | undefined) {
  const a = register(reg, "Ann", "111111");
  register(reg, "Ben", "222222");
  handleMessage(reg, a.asConn(), { type: "invite", to: "222222", ...(video === undefined ? {} : { video }) });
  return reg.clients.get("111111")?.roomId ?? null;
}
const flush = () => new Promise((r) => setImmediate(r));

describe("the dial channel is recorded on the room", () => {
  it("a VIDEO dial records video", () => {
    const reg = createRegistry();
    const rid = dial(reg, true);
    expect(reg.roomMeta.get(rid!)?.video).toBe(true);
  });

  it("a VOICE dial records voice — not 'unknown'", () => {
    // The distinction that matters: `false` is a recorded fact, `undefined` is not.
    const reg = createRegistry();
    const rid = dial(reg, false);
    expect(reg.roomMeta.get(rid!)?.video).toBe(false);
  });

  it("a dial with NO video flag is voice, matching the v2.81 voice-first protocol", () => {
    const reg = createRegistry();
    const rid = dial(reg, undefined);
    expect(reg.roomMeta.get(rid!)?.video).toBe(false);
  });
});

describe("it survives a leader change, and its absence stays absent", () => {
  it("snapshot → hydrate round-trips a voice dial as voice", () => {
    // `false` must round-trip as `false`, not vanish into undefined — a truthiness
    // check anywhere in the chain would turn a recorded voice call into an unknown.
    const reg = createRegistry();
    const rid = dial(reg, false);
    const snap = snapshotRoom(reg, rid!)!;
    expect(snap.video).toBe(false);
    const next = createRegistry();
    applyHydratedRooms(next, [snap]);
    expect(next.roomMeta.get(rid!)?.video).toBe(false);
  });

  it("and a video dial as video", () => {
    const reg = createRegistry();
    const rid = dial(reg, true);
    const snap = snapshotRoom(reg, rid!)!;
    expect(snap.video).toBe(true);
    const next = createRegistry();
    applyHydratedRooms(next, [snap]);
    expect(next.roomMeta.get(rid!)?.video).toBe(true);
  });

  it("a record from a not-yet-updated instance hydrates with the channel UNKNOWN", () => {
    const rec: PersistedRoom = {
      roomId: "r-old", members: [{ pin: "555555", name: "Dee" }], hostPin: null, cohosts: [],
      startedAt: 10, answeredAt: null, lastActiveAt: 10, dialedNumber: "222222",
      accepted: false, roster: [["555555", "Dee"]],
    };
    expect(isPersistedRoom(rec)).toBe(true);
    const reg = createRegistry();
    applyHydratedRooms(reg, [rec]);
    expect(reg.roomMeta.get("r-old")!.video).toBeUndefined();
  });

  it("a garbage channel drops the WHOLE record", () => {
    expect(isPersistedRoom({
      roomId: "r-bad", members: [{ pin: "666666", name: "Eve" }], hostPin: null, cohosts: [],
      startedAt: 10, answeredAt: null, lastActiveAt: 10, dialedNumber: null,
      accepted: false, roster: [], video: "yes",
    })).toBe(false);
  });

  it("the snapshot omits the field when unknown, so a party line serializes as before", () => {
    // Bounded by the NEXT declaration rather than a fixed character count — a
    // fixed slice goes stale the moment a comment lands in front of the target
    // (the recurring v2.99.78 fragility).
    const fn = RELAY.slice(
      RELAY.indexOf("export function snapshotRoom"),
      RELAY.indexOf("export function applyHydratedRooms"),
    );
    expect(fn.length).toBeGreaterThan(400);
    expect(fn).toMatch(
      /\.\.\.\(typeof meta\.video === "boolean" \? \{ video: meta\.video \} : \{\}\)/,
    );
  });
});

describe("what the history hook actually receives, end to end", () => {
  /* The hook is assigned on the REGISTRY, exactly as `attachRelay` does — it is NOT
   * a `handleMessage` parameter. Passing it positionally lands it in `onInvite`,
   * whose payload also carries a `video` field (v2.105.18), so the assertions below
   * would have read the INVITE flag and passed without this release existing at all.
   * That is what the first draft of this file did. */
  function collector() {
    const ends: Array<{ video: boolean | null; dialedNumber: string | null }> = [];
    const hook: ConferenceEndHook = (info) => { ends.push({ video: info.video, dialedNumber: info.dialedNumber }); };
    return { ends, hook };
  }

  /** Ring, answer, then hang up both sides so the room reaps and the hook fires. */
  function runCall(video: boolean | undefined) {
    const { ends, hook } = collector();
    const reg = createRegistry();
    reg.onConferenceEnd = hook;
    const a = new FakeConn(); const b = new FakeConn();
    handleMessage(reg, a.asConn(), { type: "register", name: "Ann", pin: "111111" });
    handleMessage(reg, b.asConn(), { type: "register", name: "Ben", pin: "222222" });
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222", ...(video === undefined ? {} : { video }) });
    const rid = reg.clients.get("111111")!.roomId!;
    handleMessage(reg, b.asConn(), { type: "accept", to: "111111", roomId: rid });
    handleMessage(reg, a.asConn(), { type: "leave" });
    handleMessage(reg, b.asConn(), { type: "leave" });
    return ends;
  }

  it("an answered VIDEO call is logged as video", () => {
    const ends = runCall(true);
    expect(ends.length).toBe(1);
    expect(ends[0].dialedNumber).toBe("222222"); // it really is the dialled call
    expect(ends[0].video).toBe(true);
  });

  it("an answered VOICE call is logged as voice — false, not null", () => {
    // This is the case the whole feature exists for: `false` has to survive the
    // room, the roster and the reap as a RECORDED fact, or a voice group call is
    // indistinguishable from one nobody measured.
    const ends = runCall(false);
    expect(ends.length).toBe(1);
    expect(ends[0].video).toBe(false);
  });

  it("a PARTY LINE reports NULL, because a line is joined rather than dialled", async () => {
    // The real production source of "unknown", and the reason a default on the
    // column would be a lie: nobody chose voice or video to get into a line.
    const { ends, hook } = collector();
    const resolver: ResolveDialHook = async (pin) =>
      pin === "555001" ? { partyLine: true, title: "The Fam" } : "identity";
    const reg = createRegistry();
    reg.onConferenceEnd = hook;
    const a = new FakeConn(); const b = new FakeConn();
    handleMessage(reg, a.asConn(), { type: "register", name: "Ann", pin: "111111" });
    handleMessage(reg, b.asConn(), { type: "register", name: "Ben", pin: "222222" });
    handleMessage(reg, a.asConn(), { type: "invite", to: "555001" }, undefined, undefined, undefined, resolver);
    await flush();
    handleMessage(reg, b.asConn(), { type: "invite", to: "555001" }, undefined, undefined, undefined, resolver);
    await flush();
    const rid = partyLineRoomId("555001");
    expect(reg.rooms.get(rid)?.size).toBe(2);             // it really is a two-party line
    expect(reg.roomMeta.get(rid)?.video).toBeUndefined(); // and nothing invented a channel
    handleMessage(reg, a.asConn(), { type: "leave" });
    handleMessage(reg, b.asConn(), { type: "leave" });
    expect(ends.length).toBe(1);
    expect(ends[0].video).toBeNull();
  });
});

describe("it reaches the database as NULL when unknown", () => {
  it("the column is nullable with NO default", () => {
    const col = SCHEMA.slice(SCHEMA.indexOf('"conference_history"'), SCHEMA.indexOf("ConferenceHistory = typeof"));
    expect(col).toMatch(/channel: mysqlEnum\("channel", \["voice", "video"\]\),/);
    // A default would make every pre-column row assert a media type nobody
    // recorded — which is the guess this column exists to replace.
    // Scoped to the channel's OWN line: `[^,]*` spans newlines, so a sweep over the
    // whole table matched `startedAt: timestamp(...).notNull()` further down and
    // failed on correct code.
    const line = col.split("\n").find((l) => l.includes('mysqlEnum("channel"'))!;
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/\.default\(/);
    expect(line).not.toMatch(/notNull/);
  });

  it("the boot migrator adds it, nullable", () => {
    // Anchored on the DDL, not on `table: "conference_history"` — that string
    // occurs FIRST in NUMBER_BEARING_COLUMNS' registry entry, so the slice read a
    // declaration about `dialedNumber` and failed for the wrong reason.
    const i = DB.indexOf("ADD COLUMN `channel` enum('voice','video')");
    expect(i).toBeGreaterThan(-1);
    const m = DB.slice(i - 200, i + 80);
    expect(m).toMatch(/table: "conference_history"/);
    expect(m).toMatch(/column: "channel"/);
    expect(m).not.toMatch(/NOT NULL|DEFAULT/);
  });

  it("the writer maps unknown to NULL, and never to a media type", () => {
    // `== null` rather than a falsy test: `false` is a RECORDED voice call and must
    // not be written as unknown.
    expect(DB).toMatch(
      /channel: input\.video == null \? null : input\.video \? "video" : "voice",/,
    );
  });

  it("the relay reports unknown as null, never as false", () => {
    const fn = RELAY.slice(RELAY.indexOf("reg.onConferenceEnd({"), RELAY.indexOf("reg.onConferenceEnd({") + 700);
    expect(fn).toMatch(/video: meta\.video \?\? null,/);
    expect(fn).not.toMatch(/video: meta\.video \?\? false/);
  });

  it("the hook's type admits null, so a caller cannot forget the third state", () => {
    const t = RELAY.slice(RELAY.indexOf("export type ConferenceEndHook"), RELAY.indexOf("export interface RelayRegistry"));
    expect(t).toMatch(/video: boolean \| null;/);
  });

  it("the one hook caller passes it through", () => {
    const call = CORE.slice(CORE.indexOf("await recordConferenceEnd({"), CORE.indexOf("await recordConferenceEnd({") + 700);
    expect(call).toMatch(/video: info\.video,/);
  });
});

describe("it reaches History, and renders nothing when unknown", () => {
  it("the payload carries it, defaulting to null", () => {
    const q = ROUTERS.slice(ROUTERS.indexOf("        durationSec: r.durationSec,"), ROUTERS.indexOf("        participants: participants.map("));
    expect(q.length).toBeGreaterThan(200);
    expect(q).toMatch(/channel: \(r\.channel \?\? null\) as "voice" \| "video" \| null,/);
  });

  it("the row prints Voice or Video, and an EMPTY STRING for anything else", () => {
    /* The two words are dictionary entries now, so the ternary carries `t(...)` rather than
       the literals. THE PROPERTY IS THE THIRD ARM: a row whose channel was never recorded
       must print NOTHING — #116's whole point is that a NULL column is not a confident
       "Voice" nobody wrote down — and that is what is asserted here alongside the words. */
    expect(HISTORY).toMatch(
      /conf\.channel === "voice" \? ` · \$\{t\("history\.voice"\)\}` : conf\.channel === "video" \? ` · \$\{t\("history\.video"\)\}` : ""/,
    );
    expect(translate("en", "history.voice")).toBe("Voice");
    expect(translate("en", "history.video")).toBe("Video");
  });

  it("the client type keeps it optional, so an older server's payload is fine", () => {
    const t = HISTORY.slice(HISTORY.indexOf("type ConfRow = {"), HISTORY.indexOf("participants: Array<{ identityId"));
    expect(t).toMatch(/channel\?: "voice" \| "video" \| null;/);
  });

  it("the solo row's own channel line is untouched", () => {
    // Parity is the point: both row kinds now say the same thing by the same word,
    // and the solo one has meant "how it was dialled" since v2.75.
    expect(HISTORY).toMatch(
      /call\.channel === "voice" \? ` · \$\{t\("history\.voice"\)\}` : call\.channel === "video" \? ` · \$\{t\("history\.video"\)\}` : ""/,
    );
  });
});
