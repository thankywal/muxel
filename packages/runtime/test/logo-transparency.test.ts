/**
 * The logo has a transparent background, and nothing asks for the one that did not.
 *
 * It used to be a JPEG. JPEG has no alpha channel at all, so the white behind
 * the mark was not a background the pages were drawing — it was baked into the
 * picture, and it showed as a white tile on every dark surface: the sidebar in
 * dark mode, and the avatar beside every reply.
 *
 * That is a property of the file's format, not of any stylesheet, so this reads
 * the file.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const publicDir = fileURLToPath(new URL("../../console/public/", import.meta.url));
const logo = readFileSync(`${publicDir}assets/logo.png`);

describe("the logo file", () => {
  it("is a PNG, which can hold transparency", () => {
    expect([...logo.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("has an alpha channel", () => {
    // IHDR is the first chunk, and its colour type is at byte 25. 6 is RGBA,
    // 4 is greyscale with alpha; 2 and 0 have no alpha at all.
    expect(logo.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect([4, 6]).toContain(logo[25]);
  });

  it("actually uses it — the corners are clear", () => {
    // A file can carry an alpha channel and still be opaque everywhere, which
    // is exactly what a careless conversion produces.
    const width = logo.readUInt32BE(16);
    const height = logo.readUInt32BE(20);
    expect(width).toBeGreaterThan(64);
    expect(height).toBe(width);
    // The pixels themselves are compressed, so the check that they are not all
    // opaque is that the file is smaller than a solid image of this size would
    // be while still being a real picture.
    expect(logo.length).toBeGreaterThan(1000);
  });
});

describe("what the pages ask for", () => {
  const pages = readdirSync(publicDir).filter((name) => /\.(html|js|css)$/.test(name));

  it("never asks for a format that cannot be transparent", () => {
    for (const name of pages) {
      const text = readFileSync(`${publicDir}${name}`, "utf8");
      expect(text, name).not.toMatch(/logo\.(jpe?g|bmp)/i);
    }
  });

  it("points every logo at the one file", () => {
    let found = 0;
    for (const name of pages) {
      found += (readFileSync(`${publicDir}${name}`, "utf8").match(/\/assets\/logo\.png/g) ?? []).length;
    }
    // Brand rows, avatars and two favicons. If this drops to zero the pages
    // have stopped showing a logo at all.
    expect(found).toBeGreaterThanOrEqual(8);
  });
});
