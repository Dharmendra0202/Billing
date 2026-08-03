// Round-trip helper: embed the editable bill state inside an exported PDF and
// read it back when the PDF is uploaded again. The data is appended after the
// PDF's %%EOF as an ASCII marker line, which PDF viewers ignore, so the file
// still opens and prints normally while remaining fully re-editable in-app.
//
// NOTE: This only works for PDFs downloaded from this app. If the PDF is opened
// and re-saved in another editor, the trailing marker may be stripped.

const MARKER = "%%BILLAI1:";

// Encode any JSON-serialisable state into the marker string (UTF-8 safe).
export function encodeBillMarker(state: unknown): string {
  const json = JSON.stringify(state);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return "\n" + MARKER + b64 + "\n";
}

// Extract and parse the embedded bill state from an uploaded PDF's bytes.
// Returns null if no valid marker is present.
export function extractBillFromPdf(buffer: ArrayBuffer): any | null {
  const bytes = new Uint8Array(buffer);
  // Latin1 decode preserves the ASCII marker + base64 payload byte-for-byte.
  const text = new TextDecoder("latin1").decode(bytes);
  const idx = text.lastIndexOf(MARKER);
  if (idx === -1) return null;

  let end = text.indexOf("\n", idx + MARKER.length);
  if (end === -1) end = text.length;
  const b64 = text.slice(idx + MARKER.length, end).trim();
  if (!b64) return null;

  try {
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}
