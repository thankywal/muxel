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
  deleteDocument: vi.fn(async () => []),
  deleteProduct: vi.fn(async () => undefined),
  forgetCustomer: vi.fn(async () => undefined),
  forgetFacts: vi.fn(async () => undefined),
  getOperatorLocale: vi.fn(async () => "en"),
  getAgentSetting: vi.fn(async () => ({ rememberCustomers: true })),
  saveAgentSetting: vi.fn(async () => ({ rememberCustomers: false })),
  listRules: vi.fn(async () => []),
  listNotes: vi.fn(async () => []),
  saveNote: vi.fn(async () => []),
  deleteNote: vi.fn(async () => []),
  saveRule: vi.fn(async () => []),
  deleteRule: vi.fn(async () => []),
  setBotEnabled: vi.fn(async () => undefined),
  RULE_KINDS: ["faq", "escalation", "delivery", "payment", "refund", "other"],
  getProfile: vi.fn(async () => ({ kind: "", about: "", address: "", mapUrl: "", phone: "", email: "", website: "", facebook: "", hours: "" })),
  saveProfile: vi.fn(async () => ({ kind: "bakery", about: "", address: "", mapUrl: "", phone: "", email: "", website: "", facebook: "", hours: "" })),
  renameBusiness: vi.fn(async () => undefined),
  listFacts: vi.fn(async () => []),
  listHandovers: vi.fn(async () => []),
  previousPrompt: vi.fn(async () => null),
  putConsoleBot: vi.fn(async () => undefined),
  setBusinessPrompt: vi.fn(async () => undefined),
  setCustomerNote: vi.fn(async () => undefined),
  setCustomerStage: vi.fn(async () => undefined),
  setOperatorLocale: vi.fn(async () => undefined),
  endHandover: vi.fn(async () => undefined),
  findOperator: vi.fn(async () => ({ telegramUserId: 1, role: "owner" as const })),
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
  getSecret: vi.fn(async () => null),
  hasSecret: vi.fn(async () => false),
  putSecret: vi.fn(async () => undefined),
}));
vi.mock("../src/cloudflare/access.js", () => ({
  cloudflareAccess: vi.fn(async () => ({ token: "t", accountId: "acc123", name: "Test Account" })),
  forgetAccess: vi.fn(async () => undefined),
}));
vi.mock("../src/db/insights.js", () => ({
  channelSplit: vi.fn(async () => ({ telegram: 3, web: 1 })),
  customersPage: vi.fn(async () => ({ customers: [], total: 0 })),
  lastActivity: vi.fn(async () => new Map()),
  recentConversations: vi.fn(async () => []),
  search: vi.fn(async () => ({ businesses: [], customers: [], messages: [] })),
  unaidedShare: vi.fn(async () => new Map()),
  usageSeries: vi.fn(async () => [
    { day: "2026-08-31", messages: 2, inputTokens: 10, outputTokens: 5 },
    { day: "2026-09-01", messages: 4, inputTokens: 20, outputTokens: 9 },
  ]),
}));
vi.mock("../src/web/self-update.js", () => ({
  runSelfUpdate: vi.fn(async () => ({ ok: true, message: "done" })),
  sourceRepoFor: vi.fn(async () => "thankywal/muxel-demo"),
  SOURCE_REPO_KEY: "system:source_repo",
}));
vi.mock("../src/db/migrate.js", () => ({ currentVersion: vi.fn(async () => 10), TARGET_VERSION: 10 }));
vi.mock("../src/products.js", () => ({
  productsView: vi.fn(async () => [
    { key: "p1", name: "Cake", price: "450", description: "", source: "prices.pdf", edited: false },
  ]),
  saveProductEntry: vi.fn(async () => undefined),
}));
vi.mock("../src/rag/extract.js", () => ({
  OWNER_UPDATES_FILENAME: "Owner updates (console)",
  markExtractionPending: vi.fn(async () => undefined),
  pendingExtractions: vi.fn(async () => []),
  runExtraction: vi.fn(async () => undefined),
}));
vi.mock("../src/rag/ingest.js", () => ({
  ingestDocument: vi.fn(async () => ({ documentId: "d1", chunkCount: 3, searchable: true })),
  removeDocument: vi.fn(async () => undefined),
  syncNotes: vi.fn(async () => undefined),
  GENERATED_DOCUMENTS: ["Owner updates (console)", "Notes (console)"],
  NOTES_FILENAME: "Notes (console)",
}));
vi.mock("../src/updates.js", () => ({ versionStatus: vi.fn(async () => ({ running: "1", latest: "1", behind: false })) }));
const chat = { id: "k1", title: "What is waiting?", model: "m1", updatedAt: "2026-09-01T00:00:00.000Z" };
vi.mock("../src/assistant/store.js", () => ({
  listChats: vi.fn(async () => [{ id: "k1", title: "What is waiting?", model: "m1", updatedAt: "z" }]),
  getChat: vi.fn(async (_env: unknown, _user: unknown, id: string) =>
    id === "k1" ? { id: "k1", title: "What is waiting?", model: "m1", updatedAt: "z" } : null,
  ),
  createChat: vi.fn(async () => ({ id: "k2", title: "New", model: "m1", updatedAt: "z" })),
  setChatModel: vi.fn(async () => undefined),
  deleteChat: vi.fn(async () => undefined),
  chatTranscript: vi.fn(async () => [
    { id: "om1", role: "assistant", content: "Two.", createdAt: "z" },
  ]),
  stepsFor: vi.fn(async () => ({ om1: [{ tool: "list_waiting", ok: true }] })),
  promptsFor: vi.fn(async () => ({})),
  usageFor: vi.fn(async () => ({
    om1: { model: "m1", inputTokens: 1200, outputTokens: 180 },
  })),
  listApprovals: vi.fn(async () => []),
  titleFrom: (text: string) => text.slice(0, 52),
}));
vi.mock("../src/assistant/loop.js", () => ({
  ask: vi.fn(async () => ({ text: "Two are waiting.", approvals: [], steps: [] })),
}));
vi.mock("../src/assistant/decide.js", () => ({
  decide: vi.fn(async () => ({ ok: true, message: "done" })),
}));
vi.mock("../src/cloudflare/allowance.js", () => ({
  allowanceNow: vi.fn(async () => ({ neuronsToday: 2400, perDay: 10_000, rate: { m1: 0.5 }, problem: null })),
  neuronsFor: (a: { rate: Record<string, number> }, u: { model: string; inputTokens: number; outputTokens: number }) =>
    a.rate[u.model] === undefined ? null : Math.round((u.inputTokens + u.outputTokens) * a.rate[u.model]),
}));
vi.mock("../src/cloudflare/account.js", () => ({
  accountName: vi.fn(async () => "Than Kywal's Account"),
}));

let operator: string | null = "u1";
vi.mock("../src/web/console.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  operatorFor: vi.fn(async () => operator),
}));

const { handleConsoleApi } = await import("../src/web/console-api.js");

const env = {
  STATE: { get: async () => "https://x.workers.dev", put: async () => undefined },
  // Only /me reads the database directly; everything else goes through a query.
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ label: "Than" }) }) }) },
} as never;

// The Worker hands the router `url.pathname`, so the query string is on the
// request and not on the path. Passing it in both places here would test a
// shape the router never sees.
const call = (method: string, path: string, body?: unknown) =>
  handleConsoleApi(
    env,
    new Request(`https://x.workers.dev/admin/api${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    }),
    path.split("?")[0] ?? path,
  );

/** Exactly the list in packages/console/public/app.js. */
const BROWSER_CALLS: [string, string, unknown?][] = [
  ["GET", "/overview"],
  ["GET", "/models"],
  ["GET", "/system"],
  ["GET", "/me"],
  ["GET", "/agents"],
  ["GET", "/channels"],
  ["GET", "/customers?page=1&size=20"],
  ["GET", "/conversations"],
  ["GET", "/events?limit=100"],
  ["GET", "/search?q=cake"],
  ["GET", "/inbox"],
  ["GET", "/diagnostics"],
  ["GET", "/locale"],
  ["PUT", "/locale", { locale: "en" }],
  ["GET", "/skills"],
  ["GET", "/businesses/b1/agent"],
  ["PATCH", "/businesses/b1/features", { rememberCustomers: false }],
  ["GET", "/businesses/b1/rules"],
  ["POST", "/businesses/b1/rules", { kind: "delivery", content: "60 THB in Bangkok" }],
  ["DELETE", "/businesses/b1/rules/r1"],
  ["GET", "/businesses/b1/profile"],
  ["PUT", "/businesses/b1/profile", { address: "12 Sukhumvit" }],
  ["GET", "/businesses/b1/prompt"],
  ["PUT", "/businesses/b1/prompt", { prompt: "be brief" }],
  ["POST", "/businesses/b1/prompt/undo"],
  ["POST", "/businesses/b1/skill", { id: "nope" }],
  ["GET", "/businesses/b1/knowledge"],
  ["GET", "/businesses/b1/notes"],
  ["POST", "/businesses/b1/notes", { title: "Parking", body: "Three spaces." }],
  ["DELETE", "/businesses/b1/notes/n1"],
  ["GET", "/businesses/b1/documents"],
  ["POST", "/businesses/b1/documents"],
  ["DELETE", "/businesses/b1/documents/d1"],
  ["GET", "/customers/c1"],
  ["PATCH", "/customers/c1", { note: "regular" }],
  ["DELETE", "/customers/c1/facts"],
  ["DELETE", "/customers/c1"],
  ["POST", "/console-bot"],
  ["GET", "/businesses"],
  ["POST", "/businesses", { name: "Sunrise" }],
  ["GET", "/businesses/b1"],
  ["PATCH", "/businesses/b1", { model: "m1" }],
  ["DELETE", "/businesses/b1"],
  ["GET", "/businesses/b1/customers"],
  ["GET", "/businesses/b1/products"],
  ["POST", "/businesses/b1/products", { name: "Cake" }],
  ["PATCH", "/businesses/b1/products/p1", { price: "9" }],
  ["DELETE", "/businesses/b1/products/p1"],
  ["POST", "/businesses/b1/rescan"],
  ["GET", "/conversations/c1"],
  ["POST", "/conversations/c1/takeover"],
  ["POST", "/conversations/c1/release"],
  ["POST", "/conversations/c1/send", { text: "hello" }],
  ["DELETE", "/conversations/c1"],
  ["PATCH", "/messages/m1", { text: "changed" }],
  ["DELETE", "/messages/m1"],
  ["DELETE", "/secrets/github_token"],
  ["POST", "/update"],
  ["PUT", "/source-repo", { repo: "a/b" }],
  ["PUT", "/secrets/cloudflare_token", { token: "cf-token" }],
  ["DELETE", "/secrets/cloudflare_token"],
  ["GET", "/assistant"],
  ["GET", "/assistant?chat=k1"],
  ["POST", "/assistant", { text: "what is waiting?" }],
  ["PATCH", "/assistant/chats/k1", { model: "m1" }],
  ["DELETE", "/assistant/chats/k1"],
  ["POST", "/assistant/approvals/a1", { yes: true }],
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

  it("keeps one meaning for `customers`, so the card can print it", async () => {
    // The detail response spreads the card and then adds lists. Naming a list
    // `customers` overwrote the count with an array, and the console drew
    // "[object Object]" in the place a number belonged.
    const body = (await (await call("GET", "/businesses/b1")).json()) as Record<string, unknown>;
    expect(typeof body.customers).toBe("number");
    expect(Array.isArray(body.recentCustomers)).toBe(true);
    expect(Array.isArray(body.products)).toBe(true);
    expect(Array.isArray(body.documents)).toBe(true);
  });

  it("does not let the customer list swallow one customer", async () => {
    // /customers had no length guard, so /customers/c1 matched the list route
    // and handed back a page of everybody. The person's own record, their note
    // and what the agent remembers were all unreachable behind a table.
    const body = (await (await call("GET", "/customers/c1")).json()) as Record<string, unknown>;
    expect(body).toHaveProperty("customer");
    expect(body).toHaveProperty("facts");
    expect(body).not.toHaveProperty("total");
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
