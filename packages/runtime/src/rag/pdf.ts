/**
 * Fallback text extraction for PDFs.
 *
 * The platform markdown converter returns metadata and an empty body for some
 * PDFs that plainly do contain text. A price list exported from Excel is one of
 * them, which matters because that is exactly what a shop owner uploads. The
 * converter reports success, so without a second opinion the file is indexed as
 * nothing and the assistant answers that it does not know.
 *
 * This reads the text layer directly. It handles PDFs whose content streams are
 * uncompressed or deflate compressed and whose text is drawn with the ordinary
 * show operators. It cannot help with a scan, which has no text layer at all,
 * and it does not attempt CID font mapping, so scripts outside the Latin range
 * may come back wrong. Both cases are caught by the caller, which requires a
 * plausible amount of readable output before accepting a document.
 */

/** Streams larger than this are skipped; they are images, not text. */
const MAX_STREAM_BYTES = 4 * 1024 * 1024;

const encoder = new TextDecoder("latin1");

function indexOfSequence(haystack: Uint8Array, needle: string, from: number): number {
  const target = new Uint8Array(needle.length);
  for (let i = 0; i < needle.length; i += 1) {
    target[i] = needle.charCodeAt(i);
  }
  outer: for (let i = from; i <= haystack.length - target.length; i += 1) {
    for (let j = 0; j < target.length; j += 1) {
      if (haystack[i + j] !== target[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

async function inflate(
  bytes: Uint8Array,
  format: "deflate" | "deflate-raw",
): Promise<Uint8Array | null> {
  try {
    // Copied out of the parent buffer so the Blob sees exactly this stream and
    // not the rest of the file behind it.
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** Decodes the escape sequences permitted inside a PDF string literal. */
function decodeLiteral(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i] as string;
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) {
      break;
    }
    i += 1;
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "b":
      case "f":
        out += " ";
        break;
      case "\n":
        break;
      default:
        if (next >= "0" && next <= "7") {
          let octal = next;
          while (octal.length < 3) {
            const digit = raw[i + 1];
            if (digit === undefined || digit < "0" || digit > "7") {
              break;
            }
            octal += digit;
            i += 1;
          }
          out += String.fromCharCode(parseInt(octal, 8));
        } else {
          out += next;
        }
    }
  }
  return out;
}

function decodeHex(raw: string): string {
  const clean = raw.replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

/**
 * Pulls the shown text out of one decoded content stream.
 *
 * Positioning operators become line breaks. A PDF has no notion of a line in
 * its text layer, so this is what turns a table exported from a spreadsheet
 * back into something that reads in order.
 */
function readContentStream(content: string): string {
  const pieces: string[] = [];
  // Matches a literal string, a hex string, or one of the operators that ends
  // a run of text on the page.
  const pattern = /\((?:[^()\\]|\\.)*\)|<[0-9a-fA-F\s]*>|\bT[dD*]\b|\bTJ\b|\bTj\b|\bET\b/g;

  let match: RegExpExecArray | null = pattern.exec(content);
  while (match !== null) {
    const token = match[0];
    if (token.startsWith("(")) {
      pieces.push(decodeLiteral(token.slice(1, -1)));
    } else if (token.startsWith("<")) {
      pieces.push(decodeHex(token.slice(1, -1)));
    } else if (token === "Td" || token === "TD" || token === "T*" || token === "ET") {
      pieces.push("\n");
    }
    match = pattern.exec(content);
  }

  return pieces.join("");
}

/**
 * Extracts readable text from a PDF.
 *
 * Returns an empty string when the file has no usable text layer, which is the
 * honest answer for a scan.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const parts: string[] = [];
  let cursor = 0;

  while (cursor < bytes.length) {
    const start = indexOfSequence(bytes, "stream", cursor);
    if (start === -1) {
      break;
    }
    let bodyStart = start + "stream".length;
    // The keyword is followed by CRLF or LF.
    if (bytes[bodyStart] === 0x0d) {
      bodyStart += 1;
    }
    if (bytes[bodyStart] === 0x0a) {
      bodyStart += 1;
    }

    const end = indexOfSequence(bytes, "endstream", bodyStart);
    if (end === -1) {
      break;
    }
    cursor = end + "endstream".length;

    // The end of line before the keyword belongs to the file, not to the
    // stream. Leaving it attached makes the decompressor reject the whole
    // stream as having trailing junk, which silently loses a page.
    let bodyEnd = end;
    if (bodyEnd > bodyStart && bytes[bodyEnd - 1] === 0x0a) {
      bodyEnd -= 1;
    }
    if (bodyEnd > bodyStart && bytes[bodyEnd - 1] === 0x0d) {
      bodyEnd -= 1;
    }

    const body = bytes.subarray(bodyStart, bodyEnd);
    if (body.length === 0 || body.length > MAX_STREAM_BYTES) {
      continue;
    }

    const decoded =
      (await inflate(body, "deflate")) ?? (await inflate(body, "deflate-raw")) ?? body;
    const text = encoder.decode(decoded);

    // Only content streams draw text. Skipping the rest avoids pulling
    // fragments out of font programs and image data.
    if (!text.includes("BT") || !/T[Jj]/.test(text)) {
      continue;
    }
    parts.push(readContentStream(text));
  }

  return parts
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
