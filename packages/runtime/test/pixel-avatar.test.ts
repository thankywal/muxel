/**
 * The owner's picture is drawn here, from their name.
 *
 * Every avatar service in the world works by being sent who the person is — a
 * name, or a hash of their email. This console is the one place that knows the
 * owner's name at all, and sending it away to get a picture back would put a
 * third party into a path that currently has nobody in it, for decoration.
 *
 * "Random per user" means different between owners, not different between page
 * loads. The drawing is a function of the name, so it is the same after every
 * reload and on every device.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateConsole } from "./console-harness.js";

const { pixelAvatar } = evaluateConsole();
const app = readFileSync(new URL("../../console/public/app.js", import.meta.url), "utf8");

describe("the picture", () => {
  it("is the same one every time for the same owner", () => {
    expect(pixelAvatar("thankywal-bkk")).toBe(pixelAvatar("thankywal-bkk"));
  });

  it("is a different one for a different owner", () => {
    const seen = new Set(
      ["thankywal-bkk", "nandar", "sunrise-bakery", "k-pizza", "Than Kywal's Account", "acme"]
        .map((name) => pixelAvatar(name)),
    );
    expect(seen.size).toBe(6);
  });

  it("is not the same picture in a different colour", () => {
    // Two names that differ only slightly still have to look different, or the
    // whole point of one per owner is lost.
    const a = pixelAvatar("nandar");
    const b = pixelAvatar("nandas");
    expect(a.replace(/hsl\([^)]*\)/g, "")).not.toBe(b.replace(/hsl\([^)]*\)/g, ""));
  });

  it("draws a face rather than noise, by mirroring down the middle", () => {
    const rects = [...pixelAvatar("nandar").matchAll(/x="(\d)" y="(\d)"/g)].map(
      ([, x, y]) => `${x},${y}`,
    );
    expect(rects.length).toBeGreaterThan(0);
    for (const cell of rects) {
      const [x, y] = cell.split(",").map(Number);
      expect(rects, cell).toContain(`${7 - x},${y}`);
    }
  });

  it("is never blank and never solid", () => {
    for (const name of ["a", "thankywal-bkk", "", "Operator", "x".repeat(80)]) {
      const filled = [...pixelAvatar(name).matchAll(/<rect x=/g)].length;
      expect(filled, name).toBeGreaterThan(4);
      expect(filled, name).toBeLessThan(64);
    }
  });

  it("survives a name that would break the markup", () => {
    const out = pixelAvatar('<script>alert(1)</script>');
    expect(out).not.toContain("<script");
  });
});

describe("where it comes from", () => {
  it("is drawn in this file, not fetched from anybody", () => {
    const at = app.indexOf("function pixelAvatar");
    const body = app.slice(at, app.indexOf("function fnv1a"));
    expect(body).not.toMatch(/fetch\(|https?:\/\//);
    // The usual suspects, by name, so adding one is a deliberate act.
    for (const service of ["gravatar", "dicebear", "boringavatars", "ui-avatars"]) {
      expect(app.toLowerCase(), service).not.toContain(service);
    }
  });

  it("hashes the same way in every browser", () => {
    // Not Math.random, and not anything that varies by engine or by run.
    const at = app.indexOf("function fnv1a");
    const body = app.slice(at, at + 400);
    expect(body).toMatch(/0x811c9dc5/);
    expect(app.slice(app.indexOf("function pixelAvatar"), at)).not.toContain("Math.random");
  });

  it("replaced the letter on the badge", () => {
    expect(app).toMatch(/\$\("avatar"\)\.innerHTML = pixelAvatar\(label\)/);
    expect(app).not.toMatch(/\$\("avatar"\)\.textContent/);
  });
});
