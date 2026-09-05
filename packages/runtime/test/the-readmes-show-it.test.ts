/**
 * The pictures on the five front pages.
 *
 * The README grew a hero animation and a gallery of five screens, and that
 * gallery was then written four more times in four more languages. Nothing in
 * the build looks at any of it. A renamed file, a screen quietly dropped from
 * one translation, an English alt pasted through into the Japanese table — all
 * three commit cleanly, and all three land as a broken box or a silent gap on
 * the first screen a stranger sees. There is no server of ours that would
 * notice, and there is no support desk behind the front page: it is the whole
 * of the pitch, and it is read once.
 *
 * So these read the five documents against each other and against the
 * directory, structurally rather than by phrase, because four of the five are
 * translations and a sentence pinned in English would pin only English. What
 * is checked is which files are pointed at, in what order, where in the
 * document they sit, whether each one is described for somebody who cannot see
 * it, and what the lot of them weigh.
 *
 * The budget, said out loud here because it is the part the next screenshot
 * has to meet: docs/media may hold one megabyte in total, everything included.
 * The six files there come to about 590 KB, which leaves room for roughly one
 * more animation or a dozen more stills. The deploy button copies this
 * repository wholesale into a stranger's own account, and they pay for the
 * pictures in download time before they have decided they want any of it.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const repoFile = (name: string): URL => new URL(`../../../${name}`, import.meta.url);

const root = (name: string): string => readFileSync(repoFile(name), "utf8");

const READMES = ["README.md", "README.my.md", "README.th.md", "README.ja.md", "README.zh.md"] as const;

/** The page the repository opens on, and the one the other four follow. */
const ENGLISH = "README.md";

const TRANSLATIONS = READMES.filter((name) => name !== ENGLISH);

const MEDIA = "docs/media";

/** One megabyte, as promised in this file's own prose above. */
const MEDIA_BUDGET_BYTES = 1024 * 1024;

/** A picture as the document shows it, and where in the document it shows it. */
interface Picture {
  readonly src: string;
  readonly alt: string;
  readonly at: number;
}

const attribute = (tag: string, name: string): string =>
  (new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? "").replace(/\s+/g, " ").trim();

/**
 * Every `<img>` in a document, in the order it appears. Read as tags rather
 * than as markdown, because that is how all five files write them and because
 * a tag is the only form that carries an `alt` this can insist on.
 */
const picturesIn = (name: string): Picture[] =>
  [...root(name).matchAll(/<img\s[^>]*>/g)].map((match) => ({
    src: attribute(match[0], "src"),
    alt: attribute(match[0], "alt"),
    at: match.index ?? 0,
  }));

/** Where each `##` part of a document begins. Translations keep the marks. */
const headings = (name: string): number[] =>
  [...root(name).matchAll(/^## /gm)].map((match) => match.index ?? 0);

/** What is actually in the directory, ignoring anything git keeps there. */
const mediaDirectory = (): string[] =>
  readdirSync(repoFile(MEDIA))
    .filter((file) => !file.startsWith("."))
    .filter((file) => statSync(repoFile(`${MEDIA}/${file}`)).isFile())
    .sort();

/** A WebP moves when its container carries an ANIM chunk, near the front. */
const moves = (path: string): boolean =>
  readFileSync(repoFile(path)).subarray(0, 64).includes("ANIM");

describe("the pictures a front page points at", () => {
  for (const name of READMES) {
    it(`points inside the repository rather than at somebody's server, in ${name}`, () => {
      // The copy the deploy button imports has to carry its own pictures. A
      // link to a raw file host or a screenshot service renders perfectly here
      // and breaks in the fork, which is the only place it matters.
      for (const picture of picturesIn(name)) {
        expect(picture.src.startsWith(`${MEDIA}/`), `${picture.src} is not under ${MEDIA}/`).toBe(true);
      }
    });

    it(`names a file that is really on disk, in ${name}`, () => {
      // The failure this whole file exists for. A picture that is not there is
      // a broken box on the first screen, and nothing else in the build reads
      // these documents closely enough to say so.
      for (const picture of picturesIn(name)) {
        expect(existsSync(repoFile(picture.src)), `${name} points at a missing ${picture.src}`).toBe(true);
      }
    });
  }
});

describe("the same product, in five languages", () => {
  it("shows every file in the directory on the English page", () => {
    // Both directions at once. A picture nobody shows is dead weight in a
    // repository copied into every owner's account, and a picture named here
    // that never arrived is the broken box again.
    const shown = picturesIn(ENGLISH).map((picture) => picture.src);
    expect(mediaDirectory().length).toBeGreaterThan(0);
    expect([...new Set(shown)].sort()).toEqual(mediaDirectory().map((file) => `${MEDIA}/${file}`));
  });

  for (const name of TRANSLATIONS) {
    it(`shows the same pictures, in the same order, in ${name}`, () => {
      // A translation is the same page in another language, not a shorter one.
      // Dropping a screen is the easy mistake — the table is five rows of
      // near-identical markup — and it leaves a reader in that language with a
      // product missing a capability the English reader was sold.
      expect(picturesIn(name).map((picture) => picture.src)).toEqual(
        picturesIn(ENGLISH).map((picture) => picture.src),
      );
    });
  }
});

describe("the alt text, which for some readers is the whole picture", () => {
  for (const name of READMES) {
    it(`describes every picture rather than leaving one silent, in ${name}`, () => {
      for (const picture of picturesIn(name)) {
        expect(picture.alt, `${picture.src} carries no alt in ${name}`).not.toBe("");
      }
    });

    it(`describes a different screen each time, in ${name}`, () => {
      // Six screens sharing one sentence are five screens nobody was told
      // about, and it reads as a description while being none.
      const spoken = picturesIn(name).map((picture) => picture.alt);
      expect(new Set(spoken).size).toBe(spoken.length);
    });
  }

  it("is written afresh in each language, never pasted through from English", () => {
    // The pictures are the same in all five files; the sentence describing one
    // cannot be. The same string under two languages means a reader was handed
    // a language they did not choose, and it is the one part of a translated
    // gallery that copies without looking wrong.
    for (const picture of picturesIn(ENGLISH)) {
      const spoken = READMES.map(
        (name) => picturesIn(name).find((candidate) => candidate.src === picture.src)?.alt ?? "",
      );
      expect(
        new Set(spoken).size,
        `${picture.src} is described in ${new Set(spoken).size} ways across ${READMES.length} languages`,
      ).toBe(READMES.length);
    }
  });
});

describe("what a stranger sees before scrolling", () => {
  for (const name of READMES) {
    it(`opens on the hero, above the first heading, in ${name}`, () => {
      const pictures = picturesIn(name);
      const parts = headings(name);
      expect(pictures.length).toBeGreaterThan(0);
      expect((pictures[0] as Picture).at).toBeLessThan(parts[0] as number);
    });

    it(`keeps the rest in the first section, before the prose starts, in ${name}`, () => {
      // Showing it comes before explaining it, in every language. A gallery
      // that drifts below the setup instructions is a gallery nobody deciding
      // whether this is for them will ever reach.
      const parts = headings(name);
      for (const picture of picturesIn(name).slice(1)) {
        expect(picture.at, `${picture.src} sits before the first section of ${name}`).toBeGreaterThan(
          parts[0] as number,
        );
        expect(picture.at, `${picture.src} sits after the first section of ${name}`).toBeLessThan(
          parts[1] as number,
        );
      }
    });
  }

  it("gives the hero the movement and leaves the rest still", () => {
    // What the top of the page argues is that a customer gets answered on the
    // shop's own site, by the shop's own price list, with nothing of ours in
    // between. A still of a chat window argues that a chat window exists; the
    // answer arriving is the whole claim, and only motion carries it. Swapping
    // the animation for a still would leave every other assertion here green.
    const [hero, ...gallery] = picturesIn(ENGLISH);
    expect(moves((hero as Picture).src), `${(hero as Picture).src} does not move`).toBe(true);
    for (const picture of gallery) {
      expect(moves(picture.src), `${picture.src} moves`).toBe(false);
    }
  });
});

describe("what the pictures weigh", () => {
  it("keeps docs/media inside one megabyte, every file together", () => {
    // Said in this file's opening prose too, so somebody adding a screenshot
    // meets the number rather than discovering it. The failure message carries
    // what is spent and what is left, because the answer to being over it is
    // usually to re-encode rather than to argue about the budget.
    const files = mediaDirectory();
    const bytes = files.reduce((total, file) => total + statSync(repoFile(`${MEDIA}/${file}`)).size, 0);
    expect(
      bytes,
      `${files.length} files use ${Math.round(bytes / 1024)} KB of the ${MEDIA_BUDGET_BYTES / 1024} KB budget`,
    ).toBeLessThanOrEqual(MEDIA_BUDGET_BYTES);
  });
});
