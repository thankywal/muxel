/**
 * Running a change the owner approved, and nothing else.
 *
 * The tool that would have run is looked up again here rather than trusted from
 * the card, so a row that names a tool this build no longer has fails plainly
 * instead of doing something else. The row moves out of `waiting` first: a
 * second yes on the same card must not run the same write twice, and that is a
 * fact in the database rather than something the console has to avoid.
 */

import type { Env } from "../env.js";
import { getApproval, settleApproval } from "./store.js";
import { findTool, type ToolContext } from "./tools.js";

export type Decision =
  | { ok: true; state: "approved" | "declined"; message: string }
  | { ok: false; message: string };

export async function decide(
  env: Env,
  userId: number,
  approvalId: string,
  yes: boolean,
): Promise<Decision> {
  const approval = await getApproval(env, userId, approvalId);
  if (approval === null) return { ok: false, message: "That change is not one of yours." };
  if (approval.state !== "waiting") {
    return { ok: false, message: `That was already ${approval.state}.` };
  }

  if (!yes) {
    await settleApproval(env, userId, approvalId, "declined", "");
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

  const ctx: ToolContext = { env, userId };
  try {
    await tool.run(ctx, approval.args);
    await env.DB.prepare("UPDATE operator_approval SET result = ? WHERE id = ?")
      .bind("Done.", approvalId)
      .run();
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
    return { ok: false, message: detail };
  }
}
