/**
 * Authenticated encryption for credentials held at rest.
 *
 * Bot tokens arrive at runtime rather than at deploy time, so they cannot live
 * in Worker secrets. They are sealed with AES-GCM under a per deployment master
 * key and stored as ciphertext in D1. A database export therefore leaks no
 * usable Telegram credential on its own.
 */

import { MuxelError } from "@muxel/core";

const IV_BYTES = 12;
const KEY_BYTES = 32;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function importKey(masterKey: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = decodeBase64(masterKey);
  } catch {
    throw new MuxelError("not_configured", "MASTER_KEY is not valid base64");
  }
  if (raw.length !== KEY_BYTES) {
    throw new MuxelError("not_configured", "MASTER_KEY must decode to 32 bytes", {
      bytes: raw.length,
    });
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Generates a fresh master key for a new deployment. */
export function generateMasterKey(): string {
  const raw = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(raw);
  return encodeBase64(raw);
}

/** Seals a credential, returning `base64(iv) + "." + base64(ciphertext)`. */
export async function seal(masterKey: string, plaintext: string): Promise<string> {
  const key = await importKey(masterKey);
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${encodeBase64(iv)}.${encodeBase64(new Uint8Array(ciphertext))}`;
}

/** Opens a credential produced by {@link seal}. */
export async function open(masterKey: string, sealed: string): Promise<string> {
  const separator = sealed.indexOf(".");
  if (separator <= 0) {
    throw new MuxelError("invalid_input", "sealed value is malformed");
  }
  const key = await importKey(masterKey);
  const iv = decodeBase64(sealed.slice(0, separator));
  const ciphertext = decodeBase64(sealed.slice(separator + 1));
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch {
    // A tag mismatch means the ciphertext was altered or the key rotated.
    throw new MuxelError("unauthorized", "sealed value failed authentication");
  }
  return new TextDecoder().decode(plaintext);
}

/** Returns the lowercase hexadecimal SHA-256 digest of a string. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
