/**
 * Tests for the browser-notifications layer. The DOM `Notification`
 * class is mocked here because the vitest server environment doesn't
 * implement it. We verify:
 *
 *   - `getNotifPermission` returns "unsupported" when the browser
 *     doesn't ship Notification, and the live `Notification.permission`
 *     value when it does.
 *   - `requestNotifPermission` short-circuits on already-granted /
 *     already-denied without prompting again.
 *   - `notify` is suppressed when the document is visible (so we don't
 *     double-feedback while the user is already looking at the page).
 *   - `notify` is suppressed when permission is not "granted".
 *   - `notify` returns `true` and constructs a Notification with the
 *     right shape when the document is hidden + permission granted.
 *   - The notification's `onclick` invokes the supplied handler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Vitest runs in a node environment, so we polyfill the tiny pieces of
   the DOM we depend on. We don't load happy-dom for the whole project
   because most tests are pure node and we don't want the per-test
   environment cost. */
if (typeof document === "undefined") {
  // @ts-expect-error — minimal stand-in for `document.visibilityState`
  globalThis.document = { visibilityState: "hidden" };
}
if (typeof window === "undefined") {
  // @ts-expect-error — needed because the module guards on `typeof window !== 'undefined'`
  globalThis.window = globalThis;
}

// Reset module state between tests so the audio-context singleton
// doesn't leak. We only ever import via dynamic `await import()` so
// each test gets a fresh module instance after `vi.resetModules()`.
async function loadModule() {
  return await import("./notifications");
}

interface MockNotification {
  title: string;
  body?: string;
  tag?: string;
  icon?: string;
  onclick: ((event: Event) => void) | null;
  close: () => void;
}

let constructed: MockNotification[] = [];
let lastClose = vi.fn();

function installNotificationMock(perm: NotificationPermission = "granted") {
  constructed = [];
  lastClose = vi.fn();
  class FakeNotification {
    static permission: NotificationPermission = perm;
    static requestPermission = vi.fn(async () => FakeNotification.permission);
    title: string;
    body?: string;
    tag?: string;
    icon?: string;
    onclick: ((event: Event) => void) | null = null;
    close = lastClose;
    constructor(title: string, init?: NotificationOptions) {
      this.title = title;
      this.body = init?.body;
      this.tag = init?.tag;
      this.icon = init?.icon;
      constructed.push(this as unknown as MockNotification);
    }
  }
  // @ts-expect-error — overriding window/global Notification for test
  globalThis.Notification = FakeNotification;
  return FakeNotification;
}

function uninstallNotificationMock() {
  // @ts-expect-error — clean up global override
  delete globalThis.Notification;
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  vi.resetModules();
  setVisibility("hidden");
});

afterEach(() => {
  uninstallNotificationMock();
});

describe("getNotifPermission", () => {
  it("returns 'unsupported' when Notification global is missing", async () => {
    const mod = await loadModule();
    expect(mod.getNotifPermission()).toBe("unsupported");
  });

  it("returns the live Notification.permission value when supported", async () => {
    installNotificationMock("denied");
    const mod = await loadModule();
    expect(mod.getNotifPermission()).toBe("denied");
  });
});

describe("requestNotifPermission", () => {
  it("returns 'unsupported' when Notification global is missing", async () => {
    const mod = await loadModule();
    expect(await mod.requestNotifPermission()).toBe("unsupported");
  });

  it("short-circuits when already granted (no prompt)", async () => {
    const Fake = installNotificationMock("granted");
    const mod = await loadModule();
    const result = await mod.requestNotifPermission();
    expect(result).toBe("granted");
    expect(Fake.requestPermission).not.toHaveBeenCalled();
  });

  it("short-circuits when already denied (no re-prompt)", async () => {
    const Fake = installNotificationMock("denied");
    const mod = await loadModule();
    const result = await mod.requestNotifPermission();
    expect(result).toBe("denied");
    expect(Fake.requestPermission).not.toHaveBeenCalled();
  });

  it("prompts when permission is default and returns the result", async () => {
    const Fake = installNotificationMock("default");
    Fake.requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    const mod = await loadModule();
    const result = await mod.requestNotifPermission();
    expect(Fake.requestPermission).toHaveBeenCalledTimes(1);
    expect(result).toBe("granted");
  });
});

describe("notify", () => {
  it("returns false when Notification API is unsupported", async () => {
    setVisibility("hidden");
    const mod = await loadModule();
    expect(mod.notify({ title: "hi" })).toBe(false);
  });

  it("returns false when permission is not granted", async () => {
    installNotificationMock("denied");
    setVisibility("hidden");
    const mod = await loadModule();
    expect(mod.notify({ title: "hi" })).toBe(false);
    expect(constructed).toHaveLength(0);
  });

  it("suppresses when the document is visible", async () => {
    installNotificationMock("granted");
    setVisibility("visible");
    const mod = await loadModule();
    expect(mod.notify({ title: "hi" })).toBe(false);
    expect(constructed).toHaveLength(0);
  });

  it("fires when permission granted and document is hidden", async () => {
    installNotificationMock("granted");
    setVisibility("hidden");
    const mod = await loadModule();
    expect(
      mod.notify({
        title: "Khalifa",
        body: "Hello!",
        tag: "thread-7",
        icon: "/icon.png",
      })
    ).toBe(true);
    expect(constructed).toHaveLength(1);
    expect(constructed[0].title).toBe("Khalifa");
    expect(constructed[0].body).toBe("Hello!");
    expect(constructed[0].tag).toBe("thread-7");
    expect(constructed[0].icon).toBe("/icon.png");
  });

  it("attaches an onclick that runs the supplied handler", async () => {
    installNotificationMock("granted");
    setVisibility("hidden");
    const mod = await loadModule();
    const handler = vi.fn();
    expect(mod.notify({ title: "Call", onClick: handler })).toBe(true);
    expect(constructed).toHaveLength(1);
    const n = constructed[0];
    expect(typeof n.onclick).toBe("function");
    n.onclick!({ preventDefault: () => {} } as unknown as Event);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
