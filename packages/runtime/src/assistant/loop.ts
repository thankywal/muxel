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
import { addOperatorMessage, askApproval, operatorTranscript, type Approval } from "./store.js";
import { findTool, TOOL_SPECS, type ToolContext } from "./tools.js";

/** How many times the model may call tools before it has to answer. */
const MAX_STEPS = 6;

const SYSTEM = [
  "You are the assistant for the owner of this Muxel deployment. You are talking to the owner,",
  "not to their customers.",
  "",
  "You can read anything in this deployment and you can propose changes. You cannot make a change",
  "yourself: when you call a tool that writes, it is shown to the owner as a card and nothing",
  "happens until they say yes. Say what you are proposing in the same message, in your own words,",
  "so the card is not the first they hear of it.",
  "",
  "Work from what the tools return, never from memory or assumption. If you have not looked, say",
  "you have not looked. If a tool returns nothing, say that rather than filling the gap.",
  "",
  "Business ids are for the tools, not for the owner. Use names when you talk to them.",
  "",
  "Answer in the language the owner writes in. Keep it short: they are reading it on a screen",
  "beside their work, not in a report.",
].join("\n");

export interface AssistantReply {
  readonly text: string;
  readonly approvals: readonly Approval[];
  /** What it looked at on the way, so the owner can see its working. */
  readonly steps: readonly { tool: string; ok: boolean }[];
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
  userId: number,
  question: string,
): Promise<AssistantReply> {
  const businesses = await listBusinesses(env, userId);
  const ctx: ToolContext = { env, userId };
  const messageId = await addOperatorMessage(env, userId, "user", question);

  const history = (await operatorTranscript(env, userId, 20))
    .filter((message) => message.id !== messageId)
    .map((message) => ({ role: message.role, content: message.content }));

  const steps: ChatMessage[] = [];
  const took: { tool: string; ok: boolean }[] = [];
  const approvals: Approval[] = [];
  // Anything at all needs a model to run it, and a deployment with no business
  // has no model chosen. The first one's model is used, which is also the one
  // its customers get, so an owner is never surprised by a different bill.
  const model = businesses[0]?.model ?? env.DEFAULT_MODEL;

  let text = "";
  for (let step = 0; step < MAX_STEPS; step += 1) {
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
        continue;
      }

      if (tool.writes) {
        const approval = await askApproval(env, {
          userId,
          messageId,
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
        continue;
      }

      try {
        const result = await tool.run(ctx, call.args);
        steps.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 6000),
        });
        took.push({ tool: tool.name, ok: true });
      } catch (error) {
        steps.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Failed: ${error instanceof Error ? error.message : "unknown error"}`,
        });
        took.push({ tool: tool.name, ok: false });
      }
    }
  }

  if (text.length === 0) {
    // It ran out of steps without answering. Saying so is better than an empty
    // bubble, and better than inventing a summary of work it did not finish.
    text =
      approvals.length > 0
        ? "I have put the change below for you to look at."
        : "I could not finish that. Ask me again, more narrowly.";
  }

  await addOperatorMessage(env, userId, "assistant", text);
  return { text, approvals, steps: took };
}
