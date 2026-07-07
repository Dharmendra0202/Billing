export function safeParseJSON(str: string): any {
  const firstBrace = str.indexOf("{");
  if (firstBrace === -1) {
    throw new Error("AI response did not contain a JSON block.");
  }
  
  let depth = 0;
  for (let i = firstBrace; i < str.length; i++) {
    if (str[i] === "{") {
      depth++;
    } else if (str[i] === "}") {
      depth--;
      if (depth === 0) {
        const jsonCandidate = str.substring(firstBrace, i + 1);
        try {
          return JSON.parse(jsonCandidate);
        } catch (e) {
          // Continue scanning if parsing fails (could be false matching brace in strings)
        }
      }
    }
  }
  
  // Fallback 1: non-greedy regex
  const match = str.match(/\{[\s\S]*?\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (e) {}
  }
  
  // Fallback 2: greedy regex
  const greedyMatch = str.match(/\{[\s\S]*\}/);
  if (greedyMatch) {
    return JSON.parse(greedyMatch[0]);
  }
  
  throw new Error("Could not parse valid JSON from AI response.");
}
