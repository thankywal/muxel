import { describe, expect, it } from "vitest";

import { generateMasterKey, open, seal, sha256Hex } from "../src/crypto.js";

/**
 * Stands in for a bot token.
 *
 * Deliberately not shaped like a real one. Sealing does not care what the bytes
 * are, and a realistic looking value trips secret scanners, which trains people
 * to dismiss those alerts. Please leave it unrealistic.
 */
const TOKEN = "example-credential-for-tests";

describe("seal and open", () => {
  it("round trips a bot token", async () => {
    const key = generateMasterKey();
    const sealed = await seal(key, TOKEN);
    expect(sealed).not.toContain(TOKEN);
    expect(await open(key, sealed)).toBe(TOKEN);
  });

  it("produces a different ciphertext each time", async () => {
    const key = generateMasterKey();
    const first = await seal(key, TOKEN);
    const second = await seal(key, TOKEN);
    expect(first).not.toBe(second);
  });

  it("refuses a ciphertext sealed under another key", async () => {
    const sealed = await seal(generateMasterKey(), TOKEN);
    await expect(open(generateMasterKey(), sealed)).rejects.toThrowError(/failed authentication/);
  });

  it("detects tampering with the ciphertext", async () => {
    const key = generateMasterKey();
    const sealed = await seal(key, TOKEN);
    const [iv, body] = sealed.split(".") as [string, string];
    const flipped = body.startsWith("A") ? `B${body.slice(1)}` : `A${body.slice(1)}`;
    await expect(open(key, `${iv}.${flipped}`)).rejects.toThrowError(/failed authentication/);
  });

  it("rejects a malformed sealed value", async () => {
    await expect(open(generateMasterKey(), "no-separator")).rejects.toThrowError(/malformed/);
  });

  it("rejects a master key of the wrong length", async () => {
    await expect(seal(btoa("too short"), TOKEN)).rejects.toThrowError(/32 bytes/);
  });

  it("round trips text outside the ASCII range", async () => {
    const key = generateMasterKey();
    const value = "မြန်မာစာ ဖြင့် စမ်းသပ်ခြင်း";
    expect(await open(key, await seal(key, value))).toBe(value);
  });
});

describe("generateMasterKey", () => {
  it("produces a distinct 32 byte key each call", () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateMasterKey()));
    expect(keys.size).toBe(100);
    expect(atob([...keys][0] as string)).toHaveLength(32);
  });
});

describe("sha256Hex", () => {
  it("matches the published digest for the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is stable across calls", async () => {
    expect(await sha256Hex("muxel")).toBe(await sha256Hex("muxel"));
  });
});
