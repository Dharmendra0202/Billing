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

  // Extract structured bill data from image - with your exact column structure
  async extractBillFromImage(imageBase64: string): Promise<string> {
    const extractionPrompt = `You are a bill data extractor. Look at this bill/invoice image carefully and extract every row of data.

The table in this bill has these columns:
- Particulars (item name/description)
- Size (measurements like length x width, or just a size value)
- Rate (price per unit)
- Amount (total for that item = size * rate)

Extract ALL rows you can see. Number them starting from 1.

Return ONLY this exact JSON, nothing else:
{
  "items": [
    {
      "sr": 1,
      "particulars": "exact item name from image",
      "size": "exact size value like 10x12 or 5.50",
      "rate": 150,
      "amount": 1650
    },
    {
      "sr": 2,
      "particulars": "next item name",
      "size": "size value",
      "rate": 200,
      "amount": 2000
    }
  ],
  "total": 3650,
  "advance": 0,
  "balance": 3650
}

Important rules:
1. sr starts from 1 and increments by 1 for each row
2. If size is not visible, put "1"
3. If rate is not visible, put the amount value
4. amount = size * rate (as a number)
5. Extract EVERY row, do not skip any
6. Return ONLY valid JSON, no explanation text`;

    return this.analyzeImage(imageBase64, extractionPrompt);
  }
}
