/**
 * Domain types shared between the deployed runtime and the command line tool.
 *
 * A deployment belongs to exactly one operator. Within that deployment the
 * operator may run any number of businesses, and each business may own any
 * number of bots. Every record therefore carries a `businessId`, and storage
 * layers partition on it.
 */

/** Telegram numeric account identifier of a person authorised to administer. */
export type TelegramUserId = number;

export interface Business {
  readonly id: string;
  readonly name: string;
  /** Language tag used for generated replies, for example "my" or "en". */
  readonly locale: string;
  readonly systemPrompt: string;
  /** Route or model string passed through to the inference gateway. */
  readonly model: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type BotRole = "admin" | "reply";

export interface Bot {
  readonly id: string;
  readonly businessId: string;
  readonly role: BotRole;
  /** Telegram username without the leading at sign. */
  readonly username: string;
  /** Path segment the Telegram webhook posts to. */
  readonly webhookPath: string;
  readonly enabled: boolean;
  readonly createdAt: string;
}

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

export interface BusinessDocument {
  readonly id: string;
  readonly businessId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly objectKey: string;
  readonly status: DocumentStatus;
  readonly chunkCount: number;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KnowledgeChunk {
  readonly id: string;
  readonly businessId: string;
  readonly documentId: string;
  readonly ordinal: number;
  readonly text: string;
}

export interface RetrievedChunk extends KnowledgeChunk {
  readonly score: number;
  readonly source: string;
}

export interface ChatTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** Resolved configuration for a single inference call. */
export interface InferenceRequest {
  readonly model: string;
  readonly system: string;
  readonly history: readonly ChatTurn[];
  readonly userMessage: string;
  readonly maxOutputTokens: number;
}

export interface InferenceResult {
  readonly text: string;
  readonly model: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

/**
 * An item entered by hand rather than uploaded.
 *
 * Products exist alongside files because a file can only be replaced whole. A
 * price that changes should not require re-uploading a catalogue.
 */
export interface Product {
  readonly id: string;
  readonly businessId: string;
  readonly name: string;
  readonly price: string;
  readonly description: string;
  readonly createdAt: string;
}

export type CustomerStage = "new" | "lead" | "customer" | "blocked";

export interface Customer {
  readonly id: string;
  readonly businessId: string;
  readonly telegramUserId: number;
  readonly chatId: number;
  readonly displayName: string;
  readonly username: string;
  readonly stage: CustomerStage;
  readonly tags: string;
  readonly note: string;
  readonly messageCount: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

/**
 * A durable fact about a customer, distilled from what they have said.
 *
 * Facts are short and self contained so that the whole set for one customer can
 * be dropped into a prompt without a retrieval step.
 */
export interface CustomerFact {
  readonly id: string;
  readonly fact: string;
  readonly createdAt: string;
}

/** Usage counters surfaced to the operator through the admin interface. */
export interface UsageSnapshot {
  readonly businessId: string;
  readonly windowStart: string;
  readonly messages: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly documents: number;
  readonly chunks: number;
}
