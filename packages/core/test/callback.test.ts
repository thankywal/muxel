import { describe, expect, it } from "vitest";

import {
  CALLBACK_DATA_MAX_BYTES,
  callbackByteLength,
  callbackRefKey,
  decodeCallback,
  encodeCallback,
  encodeCallbackRef,
  isCallbackRef,
  tryEncodeCallback,
} from "../src/callback.js";
import { isMuxelError } from "../src/errors.js";

describe("encodeCallback", () => {
  it("produces a versioned payload", () => {
    expect(encodeCallback("biz", ["a1b2c3"])).toBe("1:biz:a1b2c3");
  });

  it("encodes an action with no arguments", () => {
    expect(encodeCallback("home")).toBe("1:home");
  });

  it("round trips through decodeCallback", () => {
    const encoded = encodeCallback("docdel", ["k3m9", "7"]);
    expect(decodeCallback(encoded)).toEqual({ action: "docdel", args: ["k3m9", "7"] });
  });

  it("rejects arguments containing the separator", () => {
    expect(() => encodeCallback("biz", ["a:b"])).toThrowError(/letters, digits/);
  });

  it("rejects an empty action", () => {
    expect(() => encodeCallback("")).toThrowError(/must not be empty/);
  });

  it("throws once the payload exceeds the Telegram limit", () => {
    const oversized = "x".repeat(CALLBACK_DATA_MAX_BYTES);
    expect(() => encodeCallback("act", [oversized])).toThrowError(/exceeds the Telegram size limit/);
  });
});

describe("tryEncodeCallback", () => {
  it("returns null instead of throwing when the payload is too large", () => {
    const oversized = "y".repeat(CALLBACK_DATA_MAX_BYTES);
    expect(tryEncodeCallback("act", [oversized])).toBeNull();
  });

  it("returns a payload that is at most the documented limit", () => {
    // Longest realistic menu payload: action plus two full length identifiers.
    const encoded = tryEncodeCallback("docview", ["0123456789abcdef", "0123456789abcdef"]);
    expect(encoded).not.toBeNull();
    expect(callbackByteLength(encoded as string)).toBeLessThanOrEqual(CALLBACK_DATA_MAX_BYTES);
  });
});

describe("decodeCallback", () => {
  it("rejects an empty payload", () => {
    expect(() => decodeCallback("")).toThrowError(/empty/);
  });

  it("rejects an unknown version", () => {
    expect(() => decodeCallback("9:home")).toThrowError(/unsupported callback version/);
  });

  it("rejects a payload with no action", () => {
    expect(() => decodeCallback("1")).toThrowError(/missing an action/);
  });

  it("rejects payloads larger than the limit even when well formed", () => {
    const raw = `1:act:${"z".repeat(CALLBACK_DATA_MAX_BYTES)}`;
    expect(() => decodeCallback(raw)).toThrowError(/exceeds the Telegram size limit/);
  });

  it("rejects hostile argument content", () => {
    expect(() => decodeCallback("1:act:../../etc/passwd")).toThrowError(/letters, digits/);
  });

  it("counts multi byte characters by their encoded length", () => {
    // A Burmese label would blow the budget long before it hits 64 characters.
    expect(callbackByteLength("မင်္ဂလာပါ")).toBeGreaterThan("မင်္ဂလာပါ".length);
  });

  it("surfaces failures as MuxelError so callers can branch on the code", () => {
    try {
      decodeCallback("9:home");
      expect.unreachable("decodeCallback should have thrown");
    } catch (error) {
      expect(isMuxelError(error)).toBe(true);
      expect(isMuxelError(error) && error.code).toBe("invalid_input");
    }
  });
});

describe("callback references", () => {
  it("round trips a storage key", () => {
    const encoded = encodeCallbackRef("q7wd2mn4");
    const decoded = decodeCallback(encoded);
    expect(isCallbackRef(decoded)).toBe(true);
    expect(callbackRefKey(decoded)).toBe("q7wd2mn4");
  });

  it("refuses to read a key from a plain callback", () => {
    expect(() => callbackRefKey(decodeCallback("1:home"))).toThrowError(/not a storage reference/);
  });
});
