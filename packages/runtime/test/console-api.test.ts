/**
 * Every door the browser knocks on, proved to open.
 *
 * The console lays itself out from this API, so a path the router does not
 * recognise is not a broken button, it is a blank page. The browser's own call
 * list is replayed here against the real router, because reading the two files
 * side by side is exactly the check that let six wrong signatures through when
 * this file was first written.
 */
import { describe, expect, it, vi } from "vitest";

const business = { id: "b1", name: "Sunrise", model: "m1", locale: "en", createdAt: "2026-01-01T00:00:00Z" };
const customer = { id: "c1", businessId: "b1", chatId: 7, displayName: "Dara", username: "dara", messageCount: 3, lastSeen: "2026-01-01T00:00:00Z" };

vi.mock("../src/db/queries.js", () => ({
  appendHumanMessage: vi.fn(async () => "m1"),
  canAccessBusiness: vi.fn(async () => true),
  conversationForCustomer: vi.fn(async () => ({ id: "conv1", botId: "bot1", chatId: 7 })),
  createBot: vi.fn(async () => ({})),
  createBusiness: vi.fn(async () => business),
  createProduct: vi.fn(async () => "p1"),
  deleteBusiness: vi.fn(async () => undefined),
  deleteConversationById: vi.fn(async () => undefined),
  deleteMessageRow: vi.fn(async () => undefined),
  deleteProduct: vi.fn(async () => undefined),
  endHandover: vi.fn(async () => undefined),
  getBusiness: vi.fn(async () => business),
  getConsoleBot: vi.fn(async () => null),
  getCustomer: vi.fn(async () => customer),
  getHandover: vi.fn(async () => null),
  getMessageRow: vi.fn(async () => ({ id: "m1", conversationId: "conv1", businessId: "b1", role: "assistant", content: "hi", createdAt: "2026-01-01T00:00:00Z" })),
  listBots: vi.fn(async () => []),
  listBusinesses: vi.fn(async () => [business]),
  listCustomers: vi.fn(async () => [customer]),
  listDocuments: vi.fn(async () => []),
  listEvents: vi.fn(async () => []),
  listProducts: vi.fn(async () => []),
  takeOverConversation: vi.fn(async () => undefined),
  todayUsage: vi.fn(async () => ({ messages: 0, inputTokens: 0, outputTokens: 0 })),
  todayUsageAll: vi.fn(async () => ({ messages: 0, inputTokens: 0, outputTokens: 0 })),
  transcript: vi.fn(async () => []),
  updateBusinessModel: vi.fn(async () => undefined),
  updateMessageContent: vi.fn(async () => undefined),
  wireFor: vi.fn(async () => null),
}));
vi.mock("../src/web/channel.js", () => ({
  createChannel: vi.fn(async () => ({ id: "ch1" })),
  getChannelForBusiness: vi.fn(async () => null),
  updateChannel: vi.fn(async () => undefined),
}));
vi.mock("../src/human-reply.js", () => ({
  clientForBot: vi.fn(async () => null),
  sendHumanMedia: vi.fn(async () => ({ ok: true, messageId: "m1" })),
  sendHumanReply: vi.fn(async () => ({ ok: true, messageId: "m1" })),
}));
vi.mock("../src/web/secrets-vault.js", () => ({
  clearSecret: vi.fn(async () => undefined),
  hasSecret: vi.fn(async () => false),
  putSecret: vi.fn(async () => undefined),
}));
vi.mock("../src/web/self-update.js", () => ({ runSelfUpdate: vi.fn(async () => ({ ok: true, message: "done" })) }));
vi.mock("../src/updates.js", () => ({ versionStatus: vi.fn(async () => ({ running: "1", latest: "1", behind: false })) }));

let operator: string | null = "u1";
vi.mock("../src/web/console.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  operatorFor: vi.fn(async () => operator),
}));

const { handleConsoleApi } = await import("../src/web/console-api.js");

const env = { STATE: { get: async () => "https://x.workers.dev" } } as never;

const call = (method: string, path: string, body?: unknown) =>
  handleConsoleApi(
    env,
    new Request(`https://x.workers.dev/admin/api${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    }),
    path,
  );

/** Exactly the list in packages/console/public/app.js. */
const BROWSER_CALLS: [string, string, unknown?][] = [
  ["GET", "/overview"],
  ["GET", "/models"],
  ["GET", "/system"],
  ["GET", "/businesses"],
  ["POST", "/businesses", { name: "Sunrise" }],
  ["GET", "/businesses/b1"],
  ["PATCH", "/businesses/b1", { model: "m1" }],
  ["DELETE", "/businesses/b1"],
  ["GET", "/businesses/b1/customers"],
  ["GET", "/businesses/b1/products"],
  ["POST", "/businesses/b1/products", { name: "Cake" }],
  ["DELETE", "/businesses/b1/products/p1"],
  ["GET", "/conversations/c1"],
  ["POST", "/conversations/c1/takeover"],
  ["POST", "/conversations/c1/release"],
  ["POST", "/conversations/c1/send", { text: "hello" }],
  ["DELETE", "/conversations/c1"],
  ["PATCH", "/messages/m1", { text: "changed" }],
  ["DELETE", "/messages/m1"],
  ["DELETE", "/secrets/github_token"],
  ["POST", "/update"],
];

describe("the console data API", () => {
  it("answers every path the browser asks for", async () => {
    operator = "u1";
    const notFound: string[] = [];
    for (const [method, path, body] of BROWSER_CALLS) {
      const response = await call(method, path, body);
      if (response.status === 404) notFound.push(`${method} ${path}`);
    }
    expect(notFound).toEqual([]);
  });

  it("refuses every one of them without a token", async () => {
    operator = null;
    for (const [method, path, body] of BROWSER_CALLS) {
      const response = await call(method, path, body);
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    operator = "u1";
  });

  it("gives Home the card fields it draws, not a bare business row", async () => {
    operator = "u1";
    const body = (await (await call("GET", "/overview")).json()) as {
      businesses: Record<string, unknown>[];
      totals: Record<string, number>;
    };
    // The card shows a business name, a channel and a number. A missing field
    // is a card with a blank in it, which reads as a broken deployment.
    expect(body.businesses[0]).toMatchObject({
      id: "b1",
      name: "Sunrise",
      usage: { messages: 0 },
      customers: 1,
    });
    expect(body.businesses[0]).toHaveProperty("telegram");
    expect(body.businesses[0]).toHaveProperty("web");
    expect(body.businesses[0]).toHaveProperty("modelLabel");
    expect(body.totals).toMatchObject({ businesses: 1, customers: 1 });
  });

  it("says whether a delete reached the chat, rather than implying it did", async () => {
    // wireFor returns null here, so there is no copy to withdraw. The answer
    // has to say so: the operator is the only one who can see the difference.
    const body = (await (await call("DELETE", "/messages/m1?scope=everyone")).json()) as {
      scope: string;
      onWire: boolean;
    };
    expect(body).toMatchObject({ scope: "everyone", onWire: false });
  });

  it("answers a preflight with no body", async () => {
    const response = await call("OPTIONS", "/overview");
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });
});
