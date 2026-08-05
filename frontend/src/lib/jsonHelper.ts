// Robust JSON parser for AI responses. Handles:
// - Plain JSON arrays: [{...}, {...}]
// - JSON objects: {...}
// - JSON embedded in markdown code fences: ```json ... ```
// - JSON preceded/followed by explanation text
// - Partial/truncated JSON (best effort)
export function safeParseJSON(str: string): any {
  const trimmed = str.trim();

  // Strip markdown code fences if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const clean = fenceMatch ? fenceMatch[1].trim() : trimmed;

  // Try direct parse first (handles both arrays and objects cleanly)
  try { return JSON.parse(clean); } catch {}

  // Find the first [ or { to locate the start of JSON
  const firstBracket = clean.indexOf("[");
  const firstBrace = clean.indexOf("{");

  // Determine if it starts with an array or object
  let startIdx: number;
  let isArray: boolean;
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    startIdx = firstBracket;
    isArray = true;
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
    isArray = false;
  } else {
    throw new Error("AI response did not contain JSON.");
  }

  // Balanced-bracket extraction
  const openChar = isArray ? "[" : "{";
  const closeChar = isArray ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < clean.length; i++) {
    const ch = clean[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === openChar || ch === "{" || ch === "[") depth++;
    if (ch === closeChar || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        const candidate = clean.substring(startIdx, i + 1);
        try { return JSON.parse(candidate); } catch {}
        break;
      }
    }
  }

  // Fallback: try to find any JSON array or object via regex
  const arrayMatch = clean.match(/\[[\s\S]*\]/);
  if (arrayMatch) { try { return JSON.parse(arrayMatch[0]); } catch {} }

  const objMatch = clean.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }

  // Last resort: the AI sometimes returns multiple JSON objects separated by
  // newlines (not wrapped in an array). Collect them into an array.
  const objects: any[] = [];
  const objRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  let m: RegExpExecArray | null;
  while ((m = objRegex.exec(clean)) !== null) {
    try { objects.push(JSON.parse(m[0])); } catch {}
  }
  if (objects.length > 0) return objects;

  throw new Error("Could not parse valid JSON from AI response.");
}
