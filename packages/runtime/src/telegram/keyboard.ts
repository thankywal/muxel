/**
 * Inline keyboard construction with automatic overflow handling.
 *
 * Callers describe buttons in terms of an action and its arguments. When a
 * payload would breach the 64 byte ceiling the builder parks it in KV and
 * substitutes a short reference, so a caller never has to reason about the
 * limit at the call site.
 */

import {
  encodeCallbackRef,
  generateShortId,
  tryEncodeCallback,
  type Callback,
} from "@muxel/core";

import type { Env } from "../env.js";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "./api.js";

/** Lifetime of a spilled payload. Menus are transient, so an hour is ample. */
const SPILL_TTL_SECONDS = 3600;

const SPILL_PREFIX = "cb:";

export interface ButtonSpec {
  readonly text: string;
  readonly action: string;
  readonly args?: readonly string[];
}

/**
 * Builds an inline keyboard, spilling oversized payloads into KV.
 *
 * @param rows Buttons grouped into rows, rendered in the order supplied.
 */
export async function buildKeyboard(
  env: Env,
  rows: readonly (readonly ButtonSpec[])[],
): Promise<InlineKeyboardMarkup> {
  const built = await Promise.all(
    rows.map(async (row) =>
      Promise.all(
        row.map(async (spec): Promise<InlineKeyboardButton> => {
          const args = spec.args ?? [];
          const inline = tryEncodeCallback(spec.action, args);
          if (inline !== null) {
            return { text: spec.text, callback_data: inline };
          }
          const key = generateShortId();
          await env.STATE.put(
            `${SPILL_PREFIX}${key}`,
            JSON.stringify({ action: spec.action, args }),
            { expirationTtl: SPILL_TTL_SECONDS },
          );
          return { text: spec.text, callback_data: encodeCallbackRef(key) };
        }),
      ),
    ),
  );
  return { inline_keyboard: built };
}

/**
 * Resolves a spilled callback back to its action and arguments.
 *
 * Returns `null` when the reference has expired, which happens when a user
 * presses a button on a menu older than the spill lifetime.
 */
export async function resolveSpilled(env: Env, key: string): Promise<Callback | null> {
  const stored = await env.STATE.get(`${SPILL_PREFIX}${key}`);
  if (stored === null) {
    return null;
  }
  const parsed = JSON.parse(stored) as { action: string; args: string[] };
  return { action: parsed.action, args: parsed.args };
}

/** Convenience helper for a single row of buttons. */
export function row(...buttons: ButtonSpec[]): readonly ButtonSpec[] {
  return buttons;
}
