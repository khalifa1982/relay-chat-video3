import { describe, it, expect } from "vitest";
import { keyInOwnerNamespace } from "./v2db";

/**
 * The ownership gate for attachments.register (+ /api/v2/upload thumbKey): a
 * client-supplied storage key may only claim ownership within the caller's OWN
 * upload namespace. Without it, a client could `register` a stranger's key and
 * the storage proxy — which trusts uploadedByIdentityId — would serve the
 * victim's bytes. Pure logic, so pinned directly.
 */
describe("keyInOwnerNamespace — attachment ownership gate", () => {
  it("accepts a key in the caller's own namespace", () => {
    expect(keyInOwnerNamespace("relay-chat/42/1700_ab_photo.jpg", 42)).toBe(true);
    expect(keyInOwnerNamespace("relay-chat/42/nested/ok..name.png", 42)).toBe(true); // ".." in filename is legal
  });

  it("REJECTS a key in another identity's namespace (ownership forgery)", () => {
    expect(keyInOwnerNamespace("relay-chat/7/secret.jpg", 42)).toBe(false);
    // trailing slash in ownerNs blocks the "420 starts-with 42" prefix attack
    expect(keyInOwnerNamespace("relay-chat/420/x.jpg", 42)).toBe(false);
  });

  it("REJECTS traversal segments, non-namespaced, and empty keys", () => {
    expect(keyInOwnerNamespace("", 42)).toBe(false);
    expect(keyInOwnerNamespace("relay-chat/42/../7/secret.jpg", 42)).toBe(false);
    expect(keyInOwnerNamespace("relay-chat/42/./x", 42)).toBe(false);
    expect(keyInOwnerNamespace("random/key.jpg", 42)).toBe(false);
    expect(keyInOwnerNamespace("relay-chat/42x/y.jpg", 42)).toBe(false);
  });

  it("honors an optional S3 bucket prefix (R2/MinIO/custom S3_PREFIX)", () => {
    expect(keyInOwnerNamespace("myprefix/relay-chat/42/x.jpg", 42, "myprefix/")).toBe(true);
    expect(keyInOwnerNamespace("myprefix/relay-chat/7/x.jpg", 42, "myprefix/")).toBe(false);
    // a key already in the bare owner namespace is valid regardless of the prefix
    expect(keyInOwnerNamespace("relay-chat/42/x.jpg", 42, "myprefix/")).toBe(true);
  });
});
