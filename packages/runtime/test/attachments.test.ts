import { describe, expect, it } from "vitest";

import { attachmentIn, type TelegramMessage } from "../src/telegram/api.js";
import { describeCustomer } from "../src/escalation.js";

/**
 * An operator looking at a handover needs to know who wrote and what they
 * sent. A display name is whatever someone typed into their profile, and a
 * photo with no caption used to be dropped before it was recorded at all.
 */

function message(extra: Partial<TelegramMessage>): TelegramMessage {
  return { message_id: 1, chat: { id: 1, type: "private" }, ...extra };
}

describe("attachmentIn", () => {
  it("takes the largest size of a photo, which is the one worth looking at", () => {
    const found = attachmentIn(
      message({
        photo: [
          { file_id: "small", file_size: 900 },
          { file_id: "large", file_size: 90_000 },
        ],
      }),
    );
    expect(found).toEqual({ kind: "photo", fileId: "large", label: "" });
  });

  it("keeps a sticker's emoji, which is the only thing that describes it", () => {
    expect(attachmentIn(message({ sticker: { file_id: "s1", emoji: "🙏" } }))).toEqual({
      kind: "sticker",
      fileId: "s1",
      label: "🙏",
    });
  });

  it("keeps a document's filename", () => {
    expect(
      attachmentIn(message({ document: { file_id: "d1", file_name: "receipt.pdf" } })),
    ).toEqual({ kind: "document", fileId: "d1", label: "receipt.pdf" });
  });

  it("recognises video, voice and audio", () => {
    expect(attachmentIn(message({ video: { file_id: "v" } }))?.kind).toBe("video");
    expect(attachmentIn(message({ voice: { file_id: "o" } }))?.kind).toBe("voice");
    expect(attachmentIn(message({ audio: { file_id: "a" } }))?.kind).toBe("audio");
  });

  it("finds nothing on a plain text message", () => {
    expect(attachmentIn(message({ text: "how much is the milk?" }))).toBeNull();
  });

  it("prefers a photo over a document when a message somehow carries both", () => {
    const found = attachmentIn(
      message({ photo: [{ file_id: "p" }], document: { file_id: "d", file_name: "x.pdf" } }),
    );
    expect(found?.kind).toBe("photo");
  });
});

describe("describeCustomer", () => {
  it("adds the handle, which is the part an operator can act on", () => {
    expect(describeCustomer("Ma Ma", "mama_shop")).toBe("Ma Ma (@mama_shop)");
  });

  it("does not double the at sign if one was already stored", () => {
    expect(describeCustomer("Ma Ma", "@mama_shop")).toBe("Ma Ma (@mama_shop)");
  });

  it("falls back to the name alone when there is no username", () => {
    expect(describeCustomer("Ma Ma", undefined)).toBe("Ma Ma");
    expect(describeCustomer("Ma Ma", "")).toBe("Ma Ma");
    expect(describeCustomer("Ma Ma", "   ")).toBe("Ma Ma");
  });

  it("escapes a name that would otherwise break the message", () => {
    // Telegram rejects the whole message when the HTML does not parse, so a
    // customer called <b> must not be able to silence their own alert.
    expect(describeCustomer("<b>", "a&b")).toBe("&lt;b&gt; (@a&amp;b)");
  });
});
