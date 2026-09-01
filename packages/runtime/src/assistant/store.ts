/**
 * The owner's conversation, and the changes it is waiting on them for.
 *
 * Deliberately its own pair of tables. `message` is a customer talking to a
 * business; this is the owner talking to the thing that runs the businesses,
 * and folding them together would put an owner's instructions into a transcript
 * the assistant reads back to customers.
 */

import { generateId } from "@muxel/core";
import type { Env } from "../env.js";

const now = (): string => new Date().toISOString();

export interface OperatorMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export async function operatorTranscript(
  env: Env,
  userId: number,
  limit = 40,
): Promise<OperatorMessage[]> {
  const result = await env.DB.prepare(
    "SELECT id, role, content, created_at FROM operator_message WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
  )
    .bind(userId, limit)
    .all<{ id: string; role: string; content: string; created_at: string }>();
  return result.results
    .map((row) => ({
      id: row.id,
      role: row.role as "user" | "assistant",
      content: row.content,
      createdAt: row.created_at,
    }))
    .reverse();
}

export async function addOperatorMessage(
  env: Env,
  userId: number,
  role: "user" | "assistant",
  content: string,
): Promise<string> {
  const id = generateId();
  await env.DB.prepare(
    "INSERT INTO operator_message (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, userId, role, content, now())
    .run();
  return id;
}

export async function clearOperatorTranscript(env: Env, userId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM operator_message WHERE user_id = ?").bind(userId),
    // Anything still waiting refers to a conversation that no longer exists.
    env.DB.prepare("DELETE FROM operator_approval WHERE user_id = ? AND state = 'waiting'").bind(
      userId,
    ),
  ]);
}

export interface Approval {
  id: string;
  messageId: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  state: "waiting" | "approved" | "declined" | "failed";
  result: string;
  createdAt: string;
}

function toApproval(row: {
  id: string;
  message_id: string;
  tool: string;
  args: string;
  summary: string;
  state: string;
  result: string;
  created_at: string;
}): Approval {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(row.args) as Record<string, unknown>;
  } catch {
    // A damaged row still shows what it was for; running it is refused below.
  }
  return {
    id: row.id,
    messageId: row.message_id,
    tool: row.tool,
    args,
    summary: row.summary,
    state: row.state as Approval["state"],
    result: row.result,
    createdAt: row.created_at,
  };
}

export async function askApproval(
  env: Env,
  input: {
    userId: number;
    messageId: string;
    tool: string;
    args: Record<string, unknown>;
    summary: string;
  },
): Promise<Approval> {
  const id = generateId();
  const stamp = now();
  await env.DB.prepare(
    `INSERT INTO operator_approval (id, user_id, message_id, tool, args, summary, state, result, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'waiting', '', ?)`,
  )
    .bind(id, input.userId, input.messageId, input.tool, JSON.stringify(input.args), input.summary, stamp)
    .run();
  return {
    id,
    messageId: input.messageId,
    tool: input.tool,
    args: input.args,
    summary: input.summary,
    state: "waiting",
    result: "",
    createdAt: stamp,
  };
}

export async function listApprovals(env: Env, userId: number, limit = 40): Promise<Approval[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM operator_approval WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
  )
    .bind(userId, limit)
    .all<Parameters<typeof toApproval>[0]>();
  return result.results.map(toApproval).reverse();
}

export async function getApproval(
  env: Env,
  userId: number,
  approvalId: string,
): Promise<Approval | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM operator_approval WHERE id = ? AND user_id = ?",
  )
    .bind(approvalId, userId)
    .first<Parameters<typeof toApproval>[0]>();
  return row === null ? null : toApproval(row);
}

/**
 * Records what happened to a pending change.
 *
 * Only a row that is still waiting can move. A second yes on the same card must
 * not run the same write twice, and the state column is what makes that a fact
 * rather than a race the console has to avoid.
 */
export async function settleApproval(
  env: Env,
  userId: number,
  approvalId: string,
  state: "approved" | "declined" | "failed",
  result: string,
): Promise<boolean> {
  const outcome = await env.DB.prepare(
    "UPDATE operator_approval SET state = ?, result = ?, decided_at = ? WHERE id = ? AND user_id = ? AND state = 'waiting'",
  )
    .bind(state, result.slice(0, 2000), now(), approvalId, userId)
    .run();
  return (outcome.meta?.changes ?? 0) > 0;
}
