/**
 * Running a change the owner approved, and nothing else.
 *
 * The tool that would have run is looked up again here rather than trusted from
 * the card, so a row that names a tool this build no longer has fails plainly
 * instead of doing something else. The row moves out of `waiting` first: a
 * second yes on the same card must not run the same write twice, and that is a
 * fact in the database rather than something the console has to avoid.
 */

import { recordEvent } from "../db/queries.js";
import type { Env } from "../env.js";
import type { After } from "../products.js";
import { businessIdIn } from "./target.js";
import { chatOfApproval, getApproval, settleApproval, type Approval } from "./store.js";
import { findTool, type ToolContext } from "./tools.js";

/**
 * The owner's own answer, written to the deployment's log.
 *
 * A tap is the one thing on this product that changes anything, so it is the
 * one thing the activity panel should be full of. The card's own summary is
 * used, because it is the sentence the owner read before they tapped.
 */
async function note(
  env: Env,
  approval: Approval,
  kind: string,
  extra = "",
): Promise<void> {
  const businessId = businessIdIn(approval.args as Record<string, unknown>);
  await recordEvent(env, {
    ...(businessId.length > 0 ? { businessId } : {}),
    kind,
    detail: `${approval.summary || approval.tool}${extra === "" ? "" : ` — ${extra}`}`,
  });
}

export type Decision =
  | { ok: true; state: "approved" | "declined"; message: string }
  | { ok: false; message: string };

export async function decide(
  env: Env,
  userId: number,
  approvalId: string,
  yes: boolean,
  after?: After,
): Promise<Decision> {
  const approval = await getApproval(env, userId, approvalId);
  if (approval === null) return { ok: false, message: "That change is not one of yours." };
  if (approval.state !== "waiting") {
    return { ok: false, message: `That was already ${approval.state}.` };
  }

  if (!yes) {
    await settleApproval(env, userId, approvalId, "declined", "");
    await note(env, approval, "change_declined").catch(() => undefined);
    return { ok: true, state: "declined", message: "Left as it was." };
  }

  const tool = findTool(approval.tool);
  if (tool === undefined || !tool.writes) {
    await settleApproval(env, userId, approvalId, "failed", "That change is no longer something this deployment can do.");
    return { ok: false, message: "That change is no longer something this deployment can do." };
  }

  // Claimed before it runs. If two yeses arrive together only one wins the
  // update, and the loser is told it was already decided rather than running a
  // second copy of the same write.
  const claimed = await settleApproval(env, userId, approvalId, "approved", "");
  if (!claimed) return { ok: false, message: "That was already decided." };

  // The conversation the card is in, because a change that files a sent file
  // finds it by the name the owner used, and a name belongs to a conversation.
  const chatId = (await chatOfApproval(env, userId, approvalId)) ?? "";
  const ctx: ToolContext = { env, userId, after, chatId };
  try {
    await tool.run(ctx, approval.args);
    await env.DB.prepare("UPDATE operator_approval SET result = ? WHERE id = ?")
      .bind("Done.", approvalId)
      .run();
    await note(env, approval, "change_made").catch(() => undefined);
    return { ok: true, state: "approved", message: "Done." };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    // Marked failed rather than left as approved. An approved row that did not
    // run is a change the owner believes they made.
    await env.DB.prepare(
      "UPDATE operator_approval SET state = 'failed', result = ? WHERE id = ?",
    )
      .bind(detail.slice(0, 2000), approvalId)
      .run();
    await note(env, approval, "change_failed", detail).catch(() => undefined);
    return { ok: false, message: detail };
  }
}
