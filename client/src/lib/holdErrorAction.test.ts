import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { holdErrorAction } from "./relayClient";

/**
 * TAPPING "MERGE CALLS" COULD END THE CALL YOU WERE ON.
 *
 * `nohold` is the code the client HANGS UP on, and it is right to: `end-active`
 * asks the server to leave the active call and resume the held one, so a refusal
 * means there is nothing left to resume and the hang-up has to be completed
 * (v2.99.36 added the code for exactly that — without it the engine wedged with the
 * camera and mic still captured).
 *
 * The server then sent the SAME code from three more places, all of which mean
 * something else entirely: `swap`, `merge` and `end-held`, where it only ever means
 * "there is no held call". So:
 *
 *   A is in a call with B and has C on hold. C hangs up, and C's room reaps. A taps
 *   Merge. The server answers `nohold`. A's client ends the call with B.
 *
 * `end-held` was the plainest of the three — the user asked to drop the WAITING
 * line and the ACTIVE one went instead — and none of them is a race: a held party
 * hanging up is the ordinary way a held call ends.
 *
 * Driven, because "does the client hang up" is not a question source can answer.
 */
describe("holdErrorAction", () => {
  const inCall = { inCall: true, endActivePending: false };

  it("an end-active with nothing to resume still hangs up", () => {
    // The one case that WANTS it. Losing this brings back the v2.99.36 wedge:
    // inCall stuck true, devices captured, End a permanent no-op.
    expect(holdErrorAction({ code: "nohold", inCall: true, endActivePending: true })).toBe("hangup");
  });

  it("a swap / merge / end-held refusal does NOT hang up", () => {
    // Same code, no end-active in flight — so it cannot be answering one.
    expect(holdErrorAction({ ...inCall, code: "nohold" })).toBe("drop-held");
  });

  it("the server's own distinct code never hangs up, whatever else is going on", () => {
    // Belt and braces across a rolling deploy: even if an end-active happened to be
    // in flight, `holdgone` states which fact it is and is not that one.
    expect(holdErrorAction({ code: "holdgone", inCall: true, endActivePending: false })).toBe("drop-held");
    expect(holdErrorAction({ code: "holdgone", inCall: true, endActivePending: true })).toBe("drop-held");
    expect(holdErrorAction({ code: "holdgone", inCall: false, endActivePending: false })).toBe("drop-held");
  });

  it("leaves every other error to the rest of the handler", () => {
    // Classifying one of these here would swallow the fatal join/reach codes.
    for (const code of ["offline", "gone", "forbidden", "full", "knockfail", "saturated", "", null, undefined]) {
      expect(holdErrorAction({ ...inCall, code }), String(code)).toBe("ignore");
    }
  });

  it("does nothing at all when there is no call to end", () => {
    expect(holdErrorAction({ code: "nohold", inCall: false, endActivePending: true })).toBe("ignore");
  });
});

describe("the two halves of the split are wired up", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const read = (p: string) =>
    fs
      .readFileSync(path.join(ROOT, p), "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");

  it("the server sends `holdgone` from the three informational refusals", () => {
    const relay = read("server/relay.ts");
    expect((relay.match(/code: "holdgone"/g) ?? []).length).toBe(3);
    // …and `nohold` survives at exactly the one site that means hang up.
    expect((relay.match(/code: "nohold"/g) ?? []).length).toBe(1);
    const endActive = relay.slice(relay.indexOf('case "end-active":'), relay.indexOf('case "end-held":'));
    expect(endActive).toMatch(/code: "nohold"/);
  });

  it("the client routes the decision through this function, not an inline test", () => {
    const c = read("client/src/lib/relayClient.ts");
    expect(c).toMatch(/const holdAction = holdErrorAction\(\{/);
    expect(c).toMatch(/endActivePending: endActiveT != null/);
    // The old inline shape must not come back beside it.
    const handler = c.slice(c.indexOf('case "error": {'), c.indexOf('case "error": {') + 4000);
    expect(handler).not.toMatch(/m\.code === "nohold" && inCall/);
  });
});
