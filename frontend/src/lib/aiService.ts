import type { BillTable, HeaderTemplate } from "../types";

export type AIMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  image?: string; // base64 image data (for display purposes)
};

export type AICommand = {
  action: string;
  params: Record<string, any>;
  explanation: string;
};

export class AIService {
  private apiKey: string;
  private provider: "openai" | "anthropic" | "ollama";
  private conversationHistory: AIMessage[] = [];

  constructor(apiKey: string = "", provider: "openai" | "anthropic" | "ollama" = "ollama") {
    this.apiKey = apiKey;
    this.provider = provider;
  }

  async processCommand(
    userPrompt: string,
    currentHeader: HeaderTemplate,
    currentTables: BillTable[]
  ): Promise<{ commands: AICommand[]; response: string }> {
    const systemPrompt = this.buildSystemPrompt(currentHeader, currentTables);
    
    this.conversationHistory.push({
      id: Date.now().toString(),
      role: "user",
      content: userPrompt,
      timestamp: Date.now()
    });

    try {
      const response = await this.callAI(systemPrompt, userPrompt);
      
      this.conversationHistory.push({
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: response.response,
        timestamp: Date.now()
      });

      return response;
    } catch (error) {
      console.error("AI Service Error:", error);
      throw new Error(
        error instanceof Error ? error.message : "Failed to process command"
      );
    }
  }

  private buildSystemPrompt(header: HeaderTemplate, tables: BillTable[]): string {
    return `You are an AI assistant for a bill/invoice editor application. You help users modify their bills through natural language commands.

Current Bill State:
${JSON.stringify({ header, tables }, null, 2)}

Your task:
1. Understand the user's intent
2. Generate JSON commands to modify the bill
3. Explain what you're doing

Available Commands:
- UPDATE_HEADER: { field: "businessName"|"address"|"phone"|"gstNumber", value: string }
- ADD_TABLE: { title: string }
- DELETE_TABLE: { tableIndex: number }
- RENAME_TABLE: { tableIndex: number, newTitle: string }
- ADD_ROW: { tableIndex: number, data?: object }
- DELETE_ROW: { tableIndex: number, rowIndex: number }
- UPDATE_CELL: { tableIndex: number, rowIndex: number, columnId: string, value: string }
- ADD_COLUMN: { tableIndex: number, label: string, kind: "text"|"number" }
- EXPORT_EXCEL: { filename: string }
- CALCULATE: { operation: "gst"|"discount"|"total", params: object }

Response Format (JSON):
{
  "commands": [
    { "action": "UPDATE_HEADER", "params": { "field": "businessName", "value": "ABC Corp" }, "explanation": "Updated business name" }
  ],
  "response": "I've updated the business name to ABC Corp."
}

Be helpful, concise, and accurate. Always explain what changes you're making.`;
  }

  private async callAI(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ commands: AICommand[]; response: string }> {
    if (this.provider === "openai") {
      return this.callOpenAI(systemPrompt, userPrompt);
    } else if (this.provider === "anthropic") {
      return this.callAnthropic(systemPrompt, userPrompt);
    } else {
      return this.callOllama(systemPrompt, userPrompt);
    }
  }

  private async callOpenAI(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ commands: AICommand[]; response: string }> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "OpenAI API request failed");
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content);
  }

  private async callAnthropic(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ commands: AICommand[]; response: string }> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "Anthropic API request failed");
    }

    const data = await response.json();
    const content = data.content[0].text;
    
    // Try to parse JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // Fallback if no JSON found
    return {
      commands: [],
      response: content
    };
  }

  private async callOllama(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ commands: AICommand[]; response: string }> {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama3.2:latest",
        prompt: `${systemPrompt}\n\nUser: ${userPrompt}\n\nAssistant (respond with valid JSON):`,
        stream: false,
        format: "json"
      })
    });

    if (!response.ok) {
      throw new Error("Ollama API request failed. Make sure Ollama is running with: ollama serve");
    }

    const data = await response.json();
    const content = data.response;
    
    try {
      // Try to parse JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      // Fallback: generate a simple response
      return {
        commands: [],
        response: content || "I understood your request. Please try rephrasing for better results."
      };
    } catch (e) {
      return {
        commands: [],
        response: content || "I'm processing that. Could you rephrase your request?"
      };
    }
  }

  getHistory(): AIMessage[] {
    return this.conversationHistory;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  // Vision support using Moondream model (optimized for CPU, much faster than LLaVA)
  async analyzeImage(
    imageBase64: string,
    userPrompt: string = "What do you see in this image? Describe it in detail."
  ): Promise<string> {
    // Remove data URL prefix if present (e.g., "data:image/png;base64,")
    const base64Data = imageBase64.includes(",") 
      ? imageBase64.split(",")[1] 
      : imageBase64;

    try {
      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "moondream:latest",  // Fast, CPU-optimized vision model (1.7GB vs 4.7GB)
          prompt: userPrompt,
          images: [base64Data],
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error("Ollama Vision API request failed. Make sure Ollama is running and moondream model is installed.");
      }

      const data = await response.json();
      return data.response || "I couldn't analyze this image. Please try again.";
    } catch (error) {
      console.error("Vision API Error:", error);
      throw new Error(
        error instanceof Error 
          ? error.message 
          : "Failed to analyze image. Make sure Ollama is running with moondream model."
      );
    }
  }

  // Helper to convert File to base64
  static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  }

  // Scanner AI: process natural language commands against the current table rows
  async scannerCommand(
    userPrompt: string,
    currentRows: Array<{ sr: number; particulars: string; size: string; rate: number; amount: number }>,
    currentDetails: { date: string; clientName: string; clientAddress: string; subject: string; advance: number; note: string }
  ): Promise<string> {
    const systemPrompt = `You are an AI assistant controlling a bill/invoice table editor.

CURRENT TABLE STATE:
${JSON.stringify(currentRows, null, 2)}

CURRENT BILL DETAILS:
${JSON.stringify(currentDetails, null, 2)}

FORMULAS (always apply these):
- quantity = parseSize(size) (if size is provided, set quantity to its calculation)
- amount = quantity * rate
- parseSize handles "10x5" → 50, "10x5x3" → 150, plain "5.50" → 5.50
- total = SUM of all amount values
- balance = total - advance

You must return ONLY a valid JSON object with this exact structure:
{
  "action": "one of: ADD_ROW | UPDATE_ROW | DELETE_ROW | UPDATE_DETAIL | CLEAR_TABLE | ADD_MULTIPLE_ROWS | APPLY_GST | APPLY_DISCOUNT",
  "data": { ... action-specific data ... },
  "reply": "short human-readable confirmation message"
}

ACTION SPECS:

ADD_ROW → add one new row:
{ "action": "ADD_ROW", "data": { "particulars": "item name", "size": "10x5", "rate": 200 }, "reply": "Added row..." }

ADD_MULTIPLE_ROWS → add several rows at once:
{ "action": "ADD_MULTIPLE_ROWS", "data": { "rows": [ {"particulars":"...", "size":"...", "rate": 0}, ... ] }, "reply": "Added N rows..." }

UPDATE_ROW → change fields of a specific row (use 1-based sr number):
{ "action": "UPDATE_ROW", "data": { "sr": 2, "particulars": "new name", "size": "5x3", "rate": 300 }, "reply": "Updated row 2..." }
(only include fields that change, sr is required)

DELETE_ROW → remove a row by sr number:
{ "action": "DELETE_ROW", "data": { "sr": 3 }, "reply": "Deleted row 3..." }

UPDATE_DETAIL → change bill header details:
{ "action": "UPDATE_DETAIL", "data": { "field": "clientName|clientAddress|date|subject|advance|note|showNote|showSignature|proprietorName|showHeader|showDate|showClientDetails|showClientAddress|showGST", "value": "new value" }, "reply": "Updated client name..." }

CLEAR_TABLE → remove all rows:
{ "action": "CLEAR_TABLE", "data": {}, "reply": "Table cleared." }

APPLY_GST → add GST as a new row:
{ "action": "APPLY_GST", "data": { "percent": 18 }, "reply": "Added 18% GST row..." }

APPLY_DISCOUNT → add discount as a negative row:
{ "action": "APPLY_DISCOUNT", "data": { "percent": 10 }, "reply": "Applied 10% discount..." }

RULES:
- Return ONLY the JSON, no markdown, no explanation outside the JSON
- "reply" must always be a short friendly message about what was done
- For numbers always use numeric values not strings
- If you don't understand the request, return: { "action": "UNKNOWN", "data": {}, "reply": "Sorry, I didn't understand. Try: add row for window glass 10x5 rate 200" }`;

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2:latest",
        prompt: `${systemPrompt}\n\nUser command: ${userPrompt}\n\nJSON response:`,
        stream: false,
        format: "json"
      })
    });

    if (!response.ok) throw new Error("Ollama not running. Start it with: ollama serve");

    const data = await response.json();
    return data.response || "{}";
  }
  // Raw Ollama call with a pre-built prompt (used by AIChat for full bill control)
  async rawOllamaCall(fullPrompt: string): Promise<string> {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2:latest",
        prompt: fullPrompt,
        stream: false,
        format: "json"
      })
    });
    if (!response.ok) throw new Error("Ollama not running. Start it with: ollama serve");
    const data = await response.json();
    return data.response || "{}";
  }

  async extractBillFromImage(imageBase64: string): Promise<string> {
    const extractionPrompt = `You are a bill/invoice data extraction expert. Carefully read this bill image (it may be handwritten on paper or a printed document) and extract ALL rows.

The bill typically has these columns:
- Particulars / Item name (the work or material description)
- Size (measurements like "4.4 x 6.8", "6.6 x 5.5", "2.8 x 8.3", "80 RFT" — or blank/dash if not present)
- Quantity (numeric: the calculated area/qty from size, or a direct number)
- Rate (price per unit — a number)
- Amount (total for that row — a number, usually Quantity × Rate)

For handwritten bills: the format is often "Item  Size = Quantity × Rate = Amount" on each line.

Rules:
1. Extract EVERY single row/line item you can read. Do NOT skip any.
2. "particulars": the item name exactly as written (e.g. "Loft", "Cot", "Dressing", "Head Board", "AC Panel", "Door Frame", "Painting Works").
3. "size": the measurement string (e.g. "4.4 x 6.8", "1.10 x 6.8", "6.6 x 6.5"). If blank or "—" or "LS", use "".
4. "quantity": ONLY the numeric value (no units). Examples: "28.77" from "= 28.77 ×", or "1" if it says "1 NOS" or "LS".
5. "rate": clean number (e.g. 350, 525, 275, 475, 150, 300).
6. "amount": clean number (the final amount for that row).
7. If a row says "LS" or "Lump Sum", set size to "LS", quantity to 1, rate to the amount.
8. sr starts at 1 and increments.

Return ONLY valid JSON — no explanation, no markdown fences. Use this exact format:
{"items":[{"sr":1,"particulars":"Loft","size":"4.4 x 6.8","quantity":28.77,"rate":350,"amount":10069},{"sr":2,"particulars":"Cot","size":"6.8 x 4.4","quantity":28.77,"rate":525,"amount":15104}]}`;

    return this.analyzeImage(imageBase64, extractionPrompt);
  }
}
