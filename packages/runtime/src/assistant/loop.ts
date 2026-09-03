/**
 * The owner's assistant: a tool calling loop that never writes on its own.
 *
 * Reads run the moment the model asks for them, because looking something up
 * changes nothing and asking permission to look would make the thing useless.
 * Writes are not run at all. Each one becomes a card describing exactly what
 * would change, and the owner's yes is what runs it.
 *
 * That is not a policy the loop applies; it is a property of each tool, so a
 * tool added later cannot arrive without one. See assistant/tools.ts.
 */

import { converse, type ChatMessage } from "../ai/gateway.js";
import type { Env } from "../env.js";
import { listBusinesses } from "../db/queries.js";
import {
  addOperatorMessage,
  approvalsByMessage,
  askApproval,
  attachApprovals,
  attachToMessage,
  attachmentsByIds,
  attachmentsFor,
  chatTranscript,
  recordPrompt,
  recordSteps,
  recordUsageFor,
  type Approval,
} from "./store.js";
import { ASK_OWNER, findTool, TOOL_SPECS, type ToolContext } from "./tools.js";
import { resolveTarget, summaryFor } from "./target.js";
import { documentDataConfigured } from "../rag/nutrient.js";
import { webSearchConfigured } from "../web-search.js";

/** How many times the model may call tools before it has to answer. */
const MAX_STEPS = 6;

/**
 * What the assistant is allowed to say Muxel is.
 *
 * Without this it answered questions about the product from whatever it had
 * absorbed about chatbots in general, which is how an owner ends up being told
 * about a dashboard that does not exist or a plan they cannot buy. Every line
 * here is a fact about this codebase, and a claim that stops being true is a
 * line to change rather than a line to soften.
 */
function aboutMuxel(capability: Capabilities): string {
  return [
  "About the product you are part of, so you can answer questions about it:",
  "",
  "Muxel answers an owner's customers on Telegram and through a chat widget on their website. It",
  "runs entirely inside the owner's own Cloudflare account — Workers, D1, KV and Vectorize — which",
  "is why there is no Muxel account to sign up for and no server of ours between a customer and",
  "their data. The console at app.muxel.site is a page of files; it talks to the owner's own",
  "deployment directly from their browser.",
  "",
  "A business is one agent: one set of material, one voice, and the channels it answers on. It",
  "answers from what the owner gave it and nothing else — a price list, uploaded documents (PDF,",
  "Word, Excel, text), notes, the business profile, and rules the owner wrote. All of that becomes",
  "one searchable body of knowledge, and it is rebuilt the moment anything is added or edited.",
  "",
  "When an agent meets a question it cannot answer from that material, it does not guess. It hands",
  "the conversation to a person, and it shows up in the console under Customers, on the Waiting",
  "tab. The owner can take the conversation over and reply themselves.",
  "",
  "The models are Cloudflare Workers AI models, chosen by the owner per business and per",
  "conversation. Cloudflare's free plan includes 10,000 neurons a day, which is what the cost line",
  "under each of your answers is counting against.",
  "",
  "The console has Overview, Agents, Businesses and Customers, with Settings, Channels, Logs and",
  "Diagnostics behind the owner's badge at the bottom of the left rail. Updates are a button in",
  "Settings; the deployment pulls the new version into the owner's own repository itself.",
  "",
  "Two things reach outside this deployment, and only when the owner has added their own key for",
  "them under Settings. Neither is on the path that answers customers: both are yours, here, with",
  "the owner. What each one is:",
  "",
  capability.webSearch
    ? "  web_search is on. It returns live results from the web — pages, what things sell for and "
      + "who sells them, and businesses on the map. That is the web talking, not this business: say "
      + "which you are repeating, and name the source when you quote a price."
    : "  web_search is off, because no SerpApi key has been added. You cannot look anything up on "
      + "the web. If they want that, tell them where the key goes: Settings, Web search.",
  "",
  capability.documentData
    ? "  read_document_data is on. It reads an uploaded file as structured rows with a confidence "
      + "for each, so you can tell the owner which rows to look at hardest. It saves nothing: every "
      + "row still becomes a card they tap."
    : "  read_document_data is off, because no Nutrient DWS key has been added. You can still read "
      + "documents as text with search_knowledge. If they want the structured reading, tell them "
      + "where the key goes: Settings, Document data.",
  "",
  "What Muxel does not do: it does not send email, it does not take payments, and it reaches",
  "nothing outside this deployment beyond the two above. If you are asked for something in that",
  "list, say plainly that it is not something Muxel does.",
  ].join("\n");
}

/**
 * What this deployment can actually do right now.
 *
 * Read once per turn and handed to both the prompt and nothing else, because
 * the tools read the same vault themselves. One question — is the key there —
 * asked in one place, so the prompt cannot promise what the tool refuses.
 */
export interface Capabilities {
  readonly webSearch: boolean;
  readonly documentData: boolean;
}

function systemPrompt(capability: Capabilities): string {
  return [
  "You are the assistant for the owner of this Muxel deployment. You are talking to the owner,",
  "not to their customers.",
  "",
  aboutMuxel(capability),
  "",
  "You can read anything in this deployment and you can propose changes. You cannot make a change",
  "yourself: when you call a tool that writes, it appears under your message as a card with a Do it",
  "button, and nothing happens until the owner taps it. Say what you are proposing in the same",
  "message, in your own words, so the card is not the first they hear of it.",
  "",
  "Never ask them to reply \"yes\". Typing yes does nothing — the button on the card is the only",
  "thing that runs a change. Say \"tap Yes below\" or nothing at all; the card speaks for itself.",
  "",
  "After a message of yours that proposed something, there is a note in square brackets saying what",
  "became of it. It is this deployment's bookkeeping, not the owner's words and not yours: read it,",
  "never repeat it, and never write anything in that shape yourself. If something is still waiting,",
  "the owner has not tapped the button yet: tell them where it is, and do not propose it again. If",
  "it says the owner approved it, it is done — do not propose it a second time, and do not ask them",
  "to confirm it again.",
  "",
  // The old wording here was "propose one thing at a time when one depends on
  // another", and a small model read the first half and dropped the condition:
  // asked for six prices for a business that already existed, it proposed two
  // and said it would do the rest once those were approved. Six round trips for
  // a job the owner asked for once, and Yes to all never appears for one card.
  // The condition goes first now, and the default is stated as the default.
  "Propose everything the owner asked for, in the same message. Six prices are six cards and one",
  "Yes to all. Proposing one and waiting for it is not caution, it is five more round trips for",
  "something they asked for once.",
  "",
  "The exception is a change that needs another one to have happened first, and there is only one",
  "of those: a price belongs to a business, so the business has to exist before you can add prices",
  "to it. Propose the business, wait until the note says the owner approved it, and only then",
  "propose what goes in it. Nothing else waits for anything.",
  "",
  "Work from what the tools return, never from memory or assumption. If you have not looked, say",
  "you have not looked. If a tool returns nothing, say that rather than filling the gap.",
  "",
  "Business ids are for the tools, not for the owner. Use names when you talk to them.",
  "",
  "When the owner asks for something that takes several pieces — making an agent, setting one up,",
  "connecting it to Telegram — do it with them rather than asking for everything at once. Call",
  "ask_owner for the one thing you need next, with choices when the answer is one of a few, and",
  "wait. Then the next thing. Do not ask for something you can look up, do not ask twice for the",
  "same thing, and do not ask for anything that is optional unless they want to give it.",
  "",
  "Making an agent is: its name, then anything they want it to know about itself, then where it",
  "answers. It answers on their website from the moment it exists; Telegram is the part that has",
  "to be added, and connect_telegram opens a field for the token in their console — you never see",
  "a token and must never ask them to type one to you.",
  "",
  "Once it exists, the same rules apply as to anything else you change: a price, a rule, a note or",
  "a setting is a card they say yes to, and you say what you are proposing in your own words in",
  "the same message.",
  "",
  "The owner can send you files. When they do, the message says what arrived and read_file gives",
  "you the text of one, by name. Read it before you say anything about it. Where it goes is a",
  "change like any other: add_file_to_business puts it into one business's knowledge and pulls any",
  "price list out of it, and prices you can see in the file can be proposed one card each with",
  "save_price. Which of those they want, ask them — a menu they sent to talk about is not a menu",
  "they want filed.",
  "",
  "Answer in the language the owner writes in. Keep it short: they are reading it on a screen",
  "beside their work, not in a report.",
  ].join("\n");
}

/**
 * What the loop is doing, as it does it.
 *
 * Reported at the moment it happens rather than summarised at the end, because
 * a tool loop takes several seconds and the owner is watching a still screen
 * for all of them. Every one of these is an event that occurred; none is a
 * guess about what is coming next.
 */
export type LoopEvent =
  | { readonly type: "status"; readonly label: string }
  /**
   * A tool, when it starts and again when it lands.
   *
   * `ok` is null while it is running. Reading a file or indexing one takes
   * seconds during which nothing used to appear, because a step was only
   * reported once it had finished — so the slowest part of a turn was the part
   * with nothing on screen.
   */
  | { readonly type: "step"; readonly tool: string; readonly ok: boolean | null }
  | { readonly type: "text"; readonly text: string };

/**
 * Something the turn ends on that is not an answer.
 *
 * A question, or a field only the owner may type into. Both stop the loop: the
 * model has said what it needs, and nothing more can happen until a person
 * supplies it. Carried out separately from the text so the console can draw it
 * as the thing to do next rather than as another paragraph.
 */
export type Prompt =
  | { readonly kind: "question"; readonly question: string; readonly choices: readonly string[] }
  | { readonly kind: "telegram_token"; readonly businessId: string };

/**
 * What happened to the changes one turn proposed, in a line the model can read.
 *
 * Appended to the turn's own words rather than sent as a separate message,
 * because it is a fact about that turn: the model said this, and this is what
 * came of it.
 */
export function outcomeNote(approvals: readonly Approval[]): string {
  if (approvals.length === 0) return "";
  const said = approvals.map((approval) => {
    const what = approval.summary || approval.tool;
    if (approval.state === "approved") return `${what} — the owner approved this and it is done`;
    if (approval.state === "declined") return `${what} — the owner said no`;
    if (approval.state === "failed") return `${what} — approved but it failed: ${approval.result}`;
    return `${what} — still waiting for the owner to tap Yes on the card`;
  });
  return `\n\n[Not from the owner. What became of what you proposed in the message above: ${said.join("; ")}]`;
}

/**
 * The files sent with one turn, in a line the model can read.
 *
 * Names and sizes only. The text of a file is read with read_file, when the
 * model decides it needs it: a menu is four thousand characters, and putting
 * every file ever sent into every turn's history would be paid for on every
 * message afterwards.
 */
export function fileNote(files: readonly { filename: string; chars: number }[]): string {
  if (files.length === 0) return "";
  const said = files.map((file) => `${file.filename} (${file.chars} characters of text)`);
  return `\n\n[Not from the owner. Files sent with the message above, readable with read_file: ${said.join("; ")}]`;
}

export interface AssistantReply {
  readonly text: string;
  readonly approvals: readonly Approval[];
  /** What it looked at on the way, so the owner can see its working. */
  readonly steps: readonly { tool: string; ok: boolean }[];
  /** What the whole turn asked the model for, every step of it included. */
  readonly usage: { model: string; inputTokens: number; outputTokens: number };
  /** What the turn is waiting on the owner for, when it is waiting on anything. */
  readonly prompt: Prompt | null;
}

/**
 * Answers one message from the owner.
 *
 * Every read is executed and fed back so the model can use what it found. Every
 * write is parked. The loop ends when the model answers in words, or when it
 * has taken as many steps as it is allowed.
 */
export async function ask(
  env: Env,
  input: {
    userId: number;
    chatId: string;
    question: string;
    model: string;
    /**
     * Who is asking.
     *
     * "owner" is somebody typing, and what they typed goes into the transcript
     * as theirs. "console" is this deployment starting a turn on its own,
     * which it does after the owner answers a card: there the question is an
     * instruction nobody said out loud, so it is given to the model and not
     * written down as words the owner used.
     */
    asked?: "owner" | "console";
    /**
     * Files the owner sent with this message.
     *
     * Uploaded before the message exists, and bound to it here. The text is not
     * put into the transcript: a menu is four thousand characters and the
     * transcript is what the owner reads. The model is told what arrived and
     * reads what it needs with read_file.
     */
    files?: readonly string[];
    /** Called as the loop works, when someone is watching. */
    onEvent?: (event: LoopEvent) => void;
  },
): Promise<AssistantReply> {
  const { userId, chatId, question } = input;
  const say = input.onEvent ?? (() => undefined);
  const businesses = await listBusinesses(env, userId);
  // Asked once for the whole turn. The prompt has to say which of the two
  // outside capabilities exist, and saying it wrong in either direction costs
  // the owner a turn: promised and refused, or denied and available.
  const [webSearch, documentData] = await Promise.all([
    webSearchConfigured(env),
    documentDataConfigured(env),
  ]);
  const system = systemPrompt({ webSearch, documentData });
  const ctx: ToolContext = { env, userId, chatId };
  const attached = await attachmentsByIds(env, userId, input.files ?? []);
  const messageId =
    input.asked === "console"
      ? ""
      : await addOperatorMessage(env, { chatId, userId, role: "user", content: question });
  // Bound to the turn they were sent with, so the thread can draw them under
  // the right message and a later turn can see they were sent at all.
  if (messageId !== "") await attachToMessage(env, userId, attached.map((file) => file.id), messageId, chatId);

  // This chat only. One flat transcript carried yesterday's argument about
  // delivery into today's question about refunds.
  // What it said, and what became of what it asked for. Without the second half
  // the model could not tell an approved change from one it had never made, so
  // an owner who replied "yes" got the same proposal a second time.
  const decided = await approvalsByMessage(env, chatId);
  // What was sent, turn by turn. Without it "add the menu I sent you" in the
  // next message names a file the model has never heard of, because the text
  // was never in the transcript and the filename was mentioned once.
  const sent = await attachmentsFor(env, chatId);
  // The note is a turn of its own, not a postscript inside the model's message.
  //
  // Concatenated, it read as something the assistant had written, and a small
  // model did the obvious thing: it copied the format. An owner was shown
  // "[What you proposed in this message: Price: Cappuccino at 5.00 -> Shwe
  // Coffee Shop - the owner approved this and it is done]" as part of the
  // answer, which is this deployment's bookkeeping printed in the reply.
  //
  // It comes from the owner's side now, because that is whose news it is: they
  // are the one who tapped, or did not.
  const history = (await chatTranscript(env, chatId, 20))
    .filter((message) => message.id !== messageId)
    .flatMap((message) => {
      const note = `${fileNote(sent[message.id] ?? [])}${outcomeNote(decided[message.id] ?? [])}`;
      return note === ""
        ? [{ role: message.role, content: message.content }]
        : [
            { role: message.role, content: message.content },
            { role: "user" as const, content: note.trim() },
          ];
    });

  // What the model is asked, which is the owner's words plus what came with
  // them. The transcript keeps the words alone: the note is this deployment's
  // bookkeeping, and an owner reading their own message back should find what
  // they typed.
  const asking =
    attached.length === 0
      ? question
      : `${question.length === 0 ? "The owner sent this and said nothing with it." : question}${fileNote(attached)}\n\nRead them with read_file before you answer about them. `
        + `To put one into a business's knowledge, and pull any price list out of it, propose `
        + `add_file_to_business.`;

  const steps: ChatMessage[] = [];
  const took: { tool: string; ok: boolean }[] = [];
  const approvals: Approval[] = [];
  // The model is the chat's own, chosen by the owner in the picker. A chat that
  // predates the picker falls back to what its customers already get, so nobody
  // is surprised by a different bill.
  const model = input.model.length > 0 ? input.model : (businesses[0]?.model ?? env.DEFAULT_MODEL);

  let text = "";
  let prompt: Prompt | null = null;
  /** Whether this turn has already been told it called nothing. Once only. */
  let asked = false;
  /**
   * Everything the model has said this turn, in the order it said it.
   *
   * A turn is several rounds and the model speaks on most of them: what it is
   * about to look at, what it found, what it is proposing and why. All of that
   * used to be overwritten by the next round — only the first sentence and the
   * last one survived, and both arrived together at the end. The owner watched
   * a still screen for ten seconds and then read a conclusion whose reasons had
   * been deleted.
   *
   * They are kept here, sent the moment each one is said, and stored joined, so
   * the live turn and the one reopened tomorrow are the same words.
   */
  const words: string[] = [];
  // Every step of the loop is a call, and the owner pays for all of them. One
  // number for the turn, not for the last leg of it.
  const spent = { model, inputTokens: 0, outputTokens: 0 };
  for (let step = 0; step < MAX_STEPS; step += 1) {
    say({ type: "status", label: step === 0 ? "Thinking" : "Working" });
    const turn = await converse(env, {
      model,
      system: `${system}\n\nThe businesses here: ${
        businesses.length === 0
          ? "none yet."
          : businesses.map((business) => `${business.name} (id ${business.id})`).join(", ")
      }`,
      history,
      userMessage: asking,
      businessId: businesses[0]?.id ?? "operator",
      tools: TOOL_SPECS,
      steps,
      maxOutputTokens: 900,
    });

    spent.inputTokens += turn.inputTokens ?? 0;
    spent.outputTokens += turn.outputTokens ?? 0;

    text = turn.text.trim();
    // Said once, and said now.
    //
    // Every round that speaks adds to the turn, and the words go out on the
    // wire immediately rather than waiting for the turn to finish. A repeat is
    // not added twice: the round that is told it called nothing is invited to
    // "say the same thing again", and taking it at its word would print the
    // sentence twice.
    if (text.length > 0 && !words.includes(text)) {
      words.push(text);
      say({ type: "text", text });
    }
    if (turn.toolCalls.length === 0) {
      // Nothing was called. On the first round that means the model has looked
      // at nothing and changed nothing, and it has just written the only thing
      // the owner will see.
      //
      // Which is how "I'll add those six prices to Shwe Coffee Shop for you.
      // Tap Yes below to confirm." reached an owner with no cards under it and
      // nothing written. The turn read as done because the model had stopped
      // talking, and stopping is exactly what a model does after it promises.
      //
      // Nothing here reads the prose. There is no way to tell a promise from an
      // answer by looking at words, and guessing at it in English would fail in
      // Burmese the same afternoon. What the system knows for certain is what
      // was called, which was nothing, so that is what it says back. One round,
      // once per turn: a turn that genuinely needs no tool says the same thing
      // again and is believed the second time.
      if (asked) break;
      asked = true;
      steps.push({ role: "assistant", content: turn.text, tool_calls: undefined });
      steps.push({
        role: "user",
        content:
          "You called nothing, so nothing has been looked at and nothing has been proposed. The "
          + "owner can only see the message above, and if it said you would change something, that "
          + "is now untrue: a card is the only thing that changes anything. Do it now with the "
          + "tools, all of it, or if this really was an answer that needed no tool, say the same "
          + "thing again and it will be sent.",
      });
      say({ type: "status", label: "Working" });
      continue;
    }

    steps.push({ role: "assistant", content: turn.text, tool_calls: (turn.raw as { tool_calls?: unknown })?.tool_calls });

    // Whether this round did nothing but put changes in front of the owner.
    let proposedOnly = true;
    for (const call of turn.toolCalls) {
      const tool = findTool(call.name);
      if (tool === undefined) {
        // Named back rather than ignored, so the model can correct itself
        // instead of asking for the same missing thing again.
        steps.push({
          role: "tool",
          tool_call_id: call.id,
          content: `No tool called ${call.name}. Available: ${TOOL_SPECS.map((t) => t.name).join(", ")}`,
        });
        took.push({ tool: call.name, ok: false });
        say({ type: "step", tool: call.name, ok: false });
        proposedOnly = false;
        continue;
      }

      if (tool.writes) {
        // A change is to something, and the something has to exist before the
        // change can be a card. A business the model is creating in this same
        // message does not exist yet, whatever id it has put on the change: so
        // once a creation has been proposed, nothing else that names a business
        // is proposed until the owner has said yes to it. The prompt says this
        // in words; twenty prices landed on the wrong shop anyway.
        const target = await resolveTarget(env, userId, call.args);
        const creating = approvals.find((a) => a.tool === "create_business");
        const refused =
          target.kind === "missing"
            ? target.message
            : target.kind === "business" && creating !== undefined
              ? `Not proposed. You proposed creating a business in this same message, and it has no id `
                + `until the owner says yes, so a change that names a business now would go to a different `
                + `one: this one named "${target.name}". Tell the owner to tap Yes on the new business first, `
                + `and propose what goes in it in your next message, once it exists.`
              : "";
        if (refused !== "") {
          proposedOnly = false;
          steps.push({ role: "tool", tool_call_id: call.id, content: refused });
          took.push({ tool: tool.name, ok: false });
          say({ type: "step", tool: tool.name, ok: false });
          continue;
        }
        // The same change is not proposed twice in one turn.
        //
        // Asked for six prices, the owner got twelve cards, each item on two
        // identical rows; asked for one, two. The model was proposing them,
        // reading "Not done" as a failure, and proposing them again. The
        // wording is fixed below, and this is the part that does not depend on
        // the model reading it: the turn already holds what it has proposed,
        // and an identical tool with identical arguments is the same change.
        const same = approvals.find(
          (held) => held.tool === tool.name && JSON.stringify(held.args) === JSON.stringify(call.args),
        );
        if (same !== undefined) {
          steps.push({
            role: "tool",
            tool_call_id: call.id,
            content:
              `Already proposed in this message, as "${same.summary}". There is one card for it and `
              + "the owner has not answered yet. Do not propose it again; say what is on the cards.",
          });
          took.push({ tool: tool.name, ok: true });
          continue;
        }
        const approval = await askApproval(env, {
          userId,
          tool: tool.name,
          args: call.args,
          // The card says what, and to which. "Price: Batch Brew at $4.00" was
          // approved for the wrong shop because nothing on it said which shop.
          summary: summaryFor(tool.summarise?.(call.args) ?? tool.name, target),
        });
        approvals.push(approval);
        // The model is told plainly that nothing has happened. Telling it the
        // change was made would have it report a success to the owner that has
        // not occurred, which is the failure this whole design is against.
        //
        // It used to open with "Not done.", which a small model read as a
        // failure and answered by calling the same tool again. Nothing has
        // happened either way; what changed is that the sentence now says what
        // did happen first, and that trying again is the wrong move.
        steps.push({
          role: "tool",
          tool_call_id: call.id,
          content:
            "Proposed. It is on a card in front of the owner now, waiting for them to tap Yes, and "
            + "it has not been made yet. This call succeeded and calling it again would only make a "
            + "second card for the same thing. Tell them what you are proposing and why, and do not "
            + "say it has been made.",
        });
        took.push({ tool: tool.name, ok: true });
        say({ type: "step", tool: tool.name, ok: true });
        continue;
      }

      // A question ends the turn. There is nothing to run and nothing to
      // approve: the model has said what it needs, and the owner's reply is the
      // next turn's question.
      if (tool.name === ASK_OWNER) {
        prompt = {
          kind: "question",
          question: String(call.args.question ?? "").slice(0, 400),
          choices: (Array.isArray(call.args.choices) ? call.args.choices : [])
            .filter((choice): choice is string => typeof choice === "string")
            .slice(0, 5)
            .map((choice) => choice.slice(0, 60)),
        };
        took.push({ tool: tool.name, ok: true });
        say({ type: "step", tool: tool.name, ok: true });
        break;
      }

      // A bot token is the owner's to type, into a field, in their own browser.
      // Routing it through the model would put a credential in a transcript
      // that this deployment reads back to itself on every later turn.
      if (tool.name === "connect_telegram") {
        say({ type: "step", tool: tool.name, ok: null });
        try {
          await tool.run(ctx, call.args);
          prompt = { kind: "telegram_token", businessId: String(call.args.business_id ?? "") };
          took.push({ tool: tool.name, ok: true });
          say({ type: "step", tool: tool.name, ok: true });
          break;
        } catch (error) {
          steps.push({
            role: "tool",
            tool_call_id: call.id,
            content: `Failed: ${error instanceof Error ? error.message : "unknown error"}`,
          });
          took.push({ tool: tool.name, ok: false });
          say({ type: "step", tool: tool.name, ok: false });
          continue;
        }
      }

      // Said before it runs. A read of a long file, or an index write, is the
      // several seconds in the middle of a turn that used to show nothing.
      say({ type: "step", tool: tool.name, ok: null });
      try {
        const result = await tool.run(ctx, call.args);
        // A read hands back something the model has not seen yet, so the turn
        // cannot end on this round however much it has already said.
        proposedOnly = false;
        steps.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 6000),
        });
        took.push({ tool: tool.name, ok: true });
        say({ type: "step", tool: tool.name, ok: true });
      } catch (error) {
        steps.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Failed: ${error instanceof Error ? error.message : "unknown error"}`,
        });
        took.push({ tool: tool.name, ok: false });
        say({ type: "step", tool: tool.name, ok: false });
        proposedOnly = false;
      }
    }
    if (prompt !== null) break;

    // A round that did nothing but put changes in front of the owner, and said
    // what it was putting there, has finished the turn.
    //
    // A write returns nothing to reason about: it becomes a card and waits for
    // a person. So the round after it had no result to read, and what a small
    // model did with the empty round was propose everything a second time. Six
    // prices came back as twelve cards. It also doubled the tokens: a turn is
    // five thousand of prefill a round, and the second round bought nothing.
    //
    // Only when it said something. A round that proposed silently still needs
    // one more, because the owner has to be told what the cards are.
    if (proposedOnly && turn.toolCalls.length > 0 && text.length > 0) break;
  }

  if (words.length === 0) {
    // It ran out of steps without saying anything at all. Saying so is better
    // than an empty bubble, and better than inventing a summary of work it did
    // not finish.
    const fallback =
      prompt?.kind === "question"
        ? prompt.question
        : approvals.length > 0
          ? "I have put the change below for you to look at."
          : prompt !== null
            ? "I need one thing from you below."
            : "I could not finish that. Ask me again, more narrowly.";
    words.push(fallback);
    say({ type: "text", text: fallback });
  }

  // One record. The transcript used to keep the last round's text while the
  // wire carried the first round's as well, so the turn on screen and the same
  // turn reopened tomorrow were different messages.
  text = words.join("\n\n");
  const answerId = await addOperatorMessage(env, {
    chatId,
    userId,
    role: "assistant",
    content: text,
  });
  // Kept, so reopening the chat tomorrow still shows what it looked at. Not
  // fatal if it fails: the answer is the thing the owner asked for.
  // Filed against the answer, not swallowed on failure: an approval with no
  // message is one the owner can be told about and cannot reach.
  await attachApprovals(env, approvals.map((approval) => approval.id), answerId);
  await recordSteps(env, answerId, took).catch(() => undefined);
  await recordUsageFor(env, answerId, spent).catch(() => undefined);
  if (prompt !== null) await recordPrompt(env, answerId, { ...prompt }).catch(() => undefined);
  return {
    text,
    approvals: approvals.map((approval) => ({ ...approval, messageId: answerId })),
    steps: took,
    usage: spent,
    prompt,
  };
}
