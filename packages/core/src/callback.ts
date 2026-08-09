/**
 * Codec for Telegram inline keyboard callback payloads.
 *
 * The Bot API caps `callback_data` at 64 bytes. A menu driven admin interface
 * runs into that ceiling quickly, so this module defines a compact wire format
 * and a spill mechanism for payloads that cannot fit.
 *
 * Wire format:
 *
 *     1:<action>[:<arg>]*
 *
 * A payload that would exceed the limit is written to durable storage by the
 * caller and replaced with a reference:
 *
 *     1:#:<key>
 *
 * Callback data arrives from the client and is therefore untrusted. Decoding
 * validates the shape and character set, and never evaluates or reflects the
 * raw bytes.
 */

import { invalidInput } from "./errors.js";

/** Maximum size of `callback_data` accepted by the Telegram Bot API. */
export const CALLBACK_DATA_MAX_BYTES = 64;

/** Version prefix, bumped when the wire format changes incompatibly. */
export const CALLBACK_VERSION = "1";

/** Action reserved for payloads that spilled to durable storage. */
export const CALLBACK_REF_ACTION = "#";

const SEPARATOR = ":";
const TOKEN_PATTERN = /^[A-Za-z0-9_.]+$/;

export interface Callback {
  readonly action: string;
  readonly args: readonly string[];
}

/** Returns the UTF-8 byte length of a callback payload. */
export function callbackByteLength(data: string): number {
  return new TextEncoder().encode(data).length;
}

/** Reports whether a payload fits within the Telegram limit. */
export function fitsInline(data: string): boolean {
  return callbackByteLength(data) <= CALLBACK_DATA_MAX_BYTES;
}

function assertToken(value: string, field: string): void {
  if (value.length === 0) {
    throw invalidInput(`${field} must not be empty`, { field });
  }
  if (!TOKEN_PATTERN.test(value)) {
    throw invalidInput(
      `${field} may only contain letters, digits, underscore and period`,
      { field, value },
    );
  }
}

function serialise(action: string, args: readonly string[]): string {
  return [CALLBACK_VERSION, action, ...args].join(SEPARATOR);
}

/**
 * Encodes a callback payload, returning `null` when it exceeds the Telegram
 * limit. Callers that receive `null` should persist the payload and use
 * {@link encodeCallbackRef} instead.
 */
export function tryEncodeCallback(action: string, args: readonly string[] = []): string | null {
  assertToken(action, "action");
  args.forEach((arg, index) => assertToken(arg, `args[${index}]`));
  const encoded = serialise(action, args);
  return fitsInline(encoded) ? encoded : null;
}

/**
 * Encodes a callback payload.
 *
 * @throws MuxelError with code `invalid_input` when the payload cannot fit.
 */
export function encodeCallback(action: string, args: readonly string[] = []): string {
  const encoded = tryEncodeCallback(action, args);
  if (encoded === null) {
    throw invalidInput("callback payload exceeds the Telegram size limit", {
      action,
      bytes: callbackByteLength(serialise(action, args)),
      limit: CALLBACK_DATA_MAX_BYTES,
    });
  }
  return encoded;
}

/** Encodes a reference to a payload held in durable storage. */
export function encodeCallbackRef(key: string): string {
  assertToken(key, "key");
  const encoded = serialise(CALLBACK_REF_ACTION, [key]);
  if (!fitsInline(encoded)) {
    throw invalidInput("callback reference key is too long", { key });
  }
  return encoded;
}

/**
 * Decodes a callback payload received from Telegram.
 *
 * @throws MuxelError with code `invalid_input` for any payload that does not
 *   match the expected version, shape or character set.
 */
export function decodeCallback(raw: string): Callback {
  if (raw.length === 0) {
    throw invalidInput("callback payload is empty");
  }
  if (callbackByteLength(raw) > CALLBACK_DATA_MAX_BYTES) {
    throw invalidInput("callback payload exceeds the Telegram size limit", {
      bytes: callbackByteLength(raw),
      limit: CALLBACK_DATA_MAX_BYTES,
    });
  }

  const parts = raw.split(SEPARATOR);
  const version = parts[0];
  if (version !== CALLBACK_VERSION) {
    throw invalidInput("unsupported callback version", { version });
  }

  const action = parts[1];
  if (action === undefined || action.length === 0) {
    throw invalidInput("callback payload is missing an action");
  }
  if (action !== CALLBACK_REF_ACTION) {
    assertToken(action, "action");
  }

  const args = parts.slice(2);
  args.forEach((arg, index) => assertToken(arg, `args[${index}]`));

  return { action, args };
}

/** Reports whether a decoded callback points at durable storage. */
export function isCallbackRef(callback: Callback): boolean {
  return callback.action === CALLBACK_REF_ACTION;
}

/** Extracts the storage key from a reference callback. */
export function callbackRefKey(callback: Callback): string {
  if (!isCallbackRef(callback)) {
    throw invalidInput("callback is not a storage reference", { action: callback.action });
  }
  const key = callback.args[0];
  if (key === undefined) {
    throw invalidInput("callback reference is missing a key");
  }
  return key;
}
