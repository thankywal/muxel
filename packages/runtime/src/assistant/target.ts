/**
 * Which business a proposed change is to, settled before it becomes a card.
 *
 * Two approved prices were found on the wrong business. The owner had asked
 * for a new shop and its price list in one message; the model proposed the
 * shop and, in the same message, twenty prices against the only business id it
 * had, which was a different shop. The cards read "Price: Batch Brew at $4.00"
 * with no business on them, the owner said yes, and the new shop's price list
 * stayed empty while the old one gained two items. In another conversation the
 * assistant then read the new shop and reported, correctly, that it had no
 * prices.
 *
 * Nothing had lied and nothing had checked. reachable() asked only whether the
 * owner may touch a business, which for an owner is any id at all, existing or
 * not. So a change is bound to its business here, at proposal time:
 *
 *   - a business that does not exist cannot be proposed against, and the model
 *     is told so in words it can act on;
 *   - a business that does exist lends its name to the card, so the owner is
 *     approving a change *to something*, and can see when it is the wrong
 *     something.
 *
 * The prompt already said "the business has to exist before you can add prices
 * to it". The model did not do as it was told, and a rule the system only says
 * is not a rule. This is the system saying it.
 */
import { canAccessBusiness } from "../db/queries.js";

import type { Env } from "../env.js";

export type Target =
  /** The tool does not act on a business. */
  | { readonly kind: "none" }
  /** A business the owner can see, and what it is called. */
  | { readonly kind: "business"; readonly id: string; readonly name: string }
  /** Nothing to propose against, and the words for the model. */
  | { readonly kind: "missing"; readonly message: string };

/** The business id a tool call names, if it names one. */
export function businessIdIn(args: Record<string, unknown>): string {
  const id = args.business_id;
  return typeof id === "string" ? id.trim() : "";
}

export async function resolveTarget(
  env: Env,
  userId: number,
  args: Record<string, unknown>,
): Promise<Target> {
  if (!("business_id" in args)) return { kind: "none" };
  const id = businessIdIn(args);
  if (id.length === 0) {
    return { kind: "missing", message: "Which business? Give its id from list_businesses. Nothing was proposed." };
  }
  // Existence first, then access. Access alone said yes to every id an owner
  // typed, including ones that were never a business.
  const row = await env.DB.prepare("SELECT name FROM business WHERE id = ?")
    .bind(id)
    .first<{ name: string }>();
  if (row === null || !(await canAccessBusiness(env, userId, id))) {
    return {
      kind: "missing",
      message:
        "There is no business with that id, so nothing was proposed. Use list_businesses for the "
        + "ids that exist. If you have just proposed creating this business, it has no id until the "
        + "owner says yes: tell them to tap Yes on the business first, and propose what goes in it "
        + "in your next message, once it exists.",
    };
  }
  return { kind: "business", id, name: row.name };
}

/** The card's sentence, with the business it is to. */
export function summaryFor(summary: string, target: Target): string {
  return target.kind === "business" ? `${summary} → ${target.name}` : summary;
}
