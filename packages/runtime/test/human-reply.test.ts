/**
 * A person's reply, pinned to the act it is.
 *
 * The web console shipped with a send route that only appended a row. The
 * operator took a conversation over, typed an answer, watched it appear in the
 * transcript, and the customer was sent nothing. That failure is invisible from
 * the operator's side, which is what makes it worth a test rather than care.
 *
 * These hold the two halves together: delivery happens before the record, and a
 * failed delivery leaves no record claiming otherwise.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { chatId: number; text: string }[] = [];
const appended: { conversationId: string; content: string }[] = [];
const wires: { messageId: string; wireMessageId: number }[] = [];
let sendBehaviour: "ok" | "throw" = "ok";
let webBot = false;

vi.mock("../src/db/queries.js", () => ({
  conversationForCustomer: vi.fn(async () => ({ id: "conv1", botId: "bot1", chatId: 4242 })),
  getBotById: vi.fn(async () => ({ id: "bot1", tokenCiphertext: "sealed" })),
  appendHumanMessage: vi.fn(async (_env: unknown, input: { conversationId: string; content: string }) => {
    appended.push(input);
    return "msg1";
  }),
  recordWire: vi.fn(async (_env: unknown, input: { messageId: string; wireMessageId: number }) => {
    wires.push(input);
  }),
}));
vi.mock("../src/web/channel.js", () => ({ isWebBot: vi.fn(async () => webBot) }));
vi.mock("../src/secrets.js", () => ({ resolveMasterKey: vi.fn(async () => "key") }));
vi.mock("../src/crypto.js", () => ({ open: vi.fn(async () => "token") }));
vi.mock("../src/telegram/api.js", () => ({
  TelegramClient: class {
    async sendMessage(input: { chatId: number; text: string }) {
      if (sendBehaviour === "throw") throw new Error("chat not found");
      sent.push(input);
      return { message_id: 99 };
    }
  },
}));

const { sendHumanReply } = await import("../src/human-reply.js");

const env = {} as never;
const customer = { id: "c1", businessId: "b1", chatId: 4242 } as never;

beforeEach(() => {
  sent.length = 0;
  appended.length = 0;
  wires.length = 0;
  sendBehaviour = "ok";
  webBot = false;
});

describe("a person answering a customer", () => {
  it("sends to the customer, not only to the transcript", async () => {
    const result = await sendHumanReply(env, { customer, text: "on its way today" });
    expect(result).toMatchObject({ ok: true });
    expect(sent).toEqual([{ chatId: 4242, text: "on its way today" }]);
    expect(appended).toHaveLength(1);
  });

  it("records nothing when the send failed", async () => {
    // The alternative is a transcript that shows an answer the customer never
    // received, and an operator who has no reason to try again.
    sendBehaviour = "throw";
    const result = await sendHumanReply(env, { customer, text: "on its way today" });
    expect(result).toMatchObject({ ok: false, reason: "delivery" });
    expect(appended).toHaveLength(0);
  });

  it("keeps the wire id, so the message can be withdrawn later", async () => {
    await sendHumanReply(env, { customer, text: "hello" });
    expect(wires).toEqual([{ messageId: "msg1", botId: "bot1", chatId: 4242, wireMessageId: 99 }]);
  });

  it("stores without sending for a website visitor, who has no chat to send to", async () => {
    webBot = true;
    const result = await sendHumanReply(env, { customer, text: "hello" });
    expect(result).toMatchObject({ ok: true });
    expect(sent).toHaveLength(0);
    expect(appended).toHaveLength(1);
    // No wire row: there is no message on any other side to reach.
    expect(wires).toHaveLength(0);
  });

  it("escapes the operator's own words rather than sending them as markup", async () => {
    await sendHumanReply(env, { customer, text: "price is <500" });
    expect(sent[0]?.text).toBe("price is &lt;500");
  });
});
