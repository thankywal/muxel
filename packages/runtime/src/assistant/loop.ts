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
  chatTranscript,
  recordPrompt,
  recordSteps,
  recordUsageFor,
  type Approval,
} from "./store.js";
import { ASK_OWNER, findTool, TOOL_SPECS, type ToolContext } from "./tools.js";

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
const ABOUT_MUXEL = [
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
  "What Muxel does not do: it does not browse the web, it does not send email, it does not take",
  "payments, and it has no access to anything outside this deployment. If you are asked for",
  "something in that list, say plainly that it is not something Muxel does.",
].join("\n");

const SYSTEM = [
  "You are the assistant for the owner of this Muxel deployment. You are talking to the owner,",
  "not to their customers.",
  "",
  ABOUT_MUXEL,
  "",
  "You can read anything in this deployment and you can propose changes. You cannot make a change",
  "yourself: when you call a tool that writes, it appears under your message as a card with a Do it",
  "button, and nothing happens until the owner taps it. Say what you are proposing in the same",
  "message, in your own words, so the card is not the first they hear of it.",
  "",
  "Never ask them to reply \"yes\". Typing yes does nothing — the button on the card is the only",
  "thing that runs a change. Say \"tap Yes below\" or nothing at all; the card speaks for itself.",
  "",
  "Every message you sent before is followed by a note in square brackets saying what became of",
  "what it proposed. Read it. If something is still waiting, the owner has not tapped the button",
  "yet: tell them where it is, and do not propose it again. If it says the owner approved it, it is",
  "done — do not propose it a second time, and do not ask them to confirm it again.",
  "",
  "Propose one thing at a time when one depends on another. A price belongs to a business, so the",
  "business has to exist before you can add prices to it: propose the business, wait until the note",
  "says it was approved, and only then propose what goes in it.",
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
  "Answer in the language the owner writes in. Keep it short: they are reading it on a screen",
  "beside their work, not in a report.",
].join("\n");

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
  | { readonly type: "step"; readonly tool: string; readonly ok: boolean }
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
  return `\n\n[What you proposed in this message: ${said.join("; ")}]`;
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
    /** Called as the loop works, when someone is watching. */
    onEvent?: (event: LoopEvent) => void;
  },
): Promise<AssistantReply> {
  const { userId, chatId, question } = input;
  const say = input.onEvent ?? (() => undefined);
  const businesses = await listBusinesses(env, userId);
  const ctx: ToolContext = { env, userId };
  const messageId = await addOperatorMessage(env, { chatId, userId, role: "user", content: question });

  // This chat only. One flat transcript carried yesterday's argument about
  // delivery into today's question about refunds.
  // What it said, and what became of what it asked for. Without the second half
  // the model could not tell an approved change from one it had never made, so
  // an owner who replied "yes" got the same proposal a second time.
  const decided = await approvalsByMessage(env, chatId);
  const history = (await chatTranscript(env, chatId, 20))
    .filter((message) => message.id !== messageId)
    .map((message) => ({
      role: message.role,
      content: message.content + outcomeNote(decided[message.id] ?? []),
    }));

  const steps: ChatMessage[] = [];
  const took: { tool: string; ok: boolean }[] = [];
  const approvals: Approval[] = [];
  // The model is the chat's own, chosen by the owner in the picker. A chat that
  // predates the picker falls back to what its customers already get, so nobody
  // is surprised by a different bill.
  const model = input.model.length > 0 ? input.model : (businesses[0]?.model ?? env.DEFAULT_MODEL);

  let text = "";
  let prompt: Prompt | null = null;
  // Every step of the loop is a call, and the owner pays for all of them. One
  // number for the turn, not for the last leg of it.
  const spent = { model, inputTokens: 0, outputTokens: 0 };
  for (let step = 0; step < MAX_STEPS; step += 1) {
    say({ type: "status", label: step === 0 ? "Thinking" : "Working" });
    const turn = await converse(env, {
      model,
      system: `${SYSTEM}\n\nThe businesses here: ${
        businesses.length === 0
          ? "none yet."
          : businesses.map((business) => `${business.name} (id ${business.id})`).join(", ")
      }`,
      history,
      userMessage: question,
      businessId: businesses[0]?.id ?? "operator",
      tools: TOOL_SPECS,
      steps,
      maxOutputTokens: 900,
    });

    spent.inputTokens += turn.inputTokens ?? 0;
    spent.outputTokens += turn.outputTokens ?? 0;

    text = turn.text.trim();
    if (turn.toolCalls.length === 0) break;

    steps.push({ role: "assistant", content: turn.text, tool_calls: (turn.raw as { tool_calls?: unknown })?.tool_calls });

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
        continue;
      }

      if (tool.writes) {
        const approval = await askApproval(env, {
          userId,
          tool: tool.name,
          args: call.args,
          summary: tool.summarise?.(call.args) ?? tool.name,
        });
        approvals.push(approval);
        // The model is told plainly that nothing has happened. Telling it the
        // change was made would have it report a success to the owner that has
        // not occurred, which is the failure this whole design is against.
        steps.push({
          role: "tool",
          tool_call_id: call.id,
          content:
            "Not done. This change needs the owner's approval and is now waiting for it. "
            + "Tell them what you are proposing and why, and do not say it has been made.",
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

      try {
        const result = await tool.run(ctx, call.args);
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
      }
    }
    if (prompt !== null) break;
  }

  if (text.length === 0) {
    // It ran out of steps without answering. Saying so is better than an empty
    // bubble, and better than inventing a summary of work it did not finish.
    text =
      prompt?.kind === "question"
        ? prompt.question
        : approvals.length > 0
          ? "I have put the change below for you to look at."
          : prompt !== null
            ? "I need one thing from you below."
            : "I could not finish that. Ask me again, more narrowly.";
  }

  say({ type: "text", text });
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
