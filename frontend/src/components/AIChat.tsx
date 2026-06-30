import { MessageCircle, Send, Settings, X, Download, Trash2, Image, XCircle } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { AIService, type AIMessage } from "../lib/aiService";
import { executeCommands } from "../lib/aiCommands";
import type { BillTable, HeaderTemplate } from "../types";

type Props = {
  header: HeaderTemplate;
  tables: BillTable[];
  onUpdate: (header: HeaderTemplate, tables: BillTable[]) => void;
};

export function AIChat({ header, tables, onUpdate }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("ai_api_key") || "");
  const [provider, setProvider] = useState<"openai" | "anthropic" | "ollama">(
    () => (localStorage.getItem("ai_provider") as "openai" | "anthropic" | "ollama") || "ollama"
  );
  const [showSettings, setShowSettings] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageName, setSelectedImageName] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const aiServiceRef = useRef<AIService | null>(null);

  useEffect(() => {
    if (provider === "ollama" || apiKey) {
      aiServiceRef.current = new AIService(apiKey || "", provider);
    }
  }, [apiKey, provider]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const saveApiKey = () => {
    localStorage.setItem("ai_api_key", apiKey);
    localStorage.setItem("ai_provider", provider);
    aiServiceRef.current = new AIService(apiKey || "", provider);
    setShowSettings(false);
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file (JPG, PNG, GIF, etc.)");
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert("Image size should be less than 10MB");
      return;
    }

    try {
      const base64 = await AIService.fileToBase64(file);
      setSelectedImage(base64);
      setSelectedImageName(file.name);
    } catch (error) {
      console.error("Error converting image:", error);
      alert("Failed to load image. Please try again.");
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const clearSelectedImage = () => {
    setSelectedImage(null);
    setSelectedImageName("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !selectedImage) || !aiServiceRef.current) return;

    // If we have an image, use vision model
    if (selectedImage) {
      const userMessage: AIMessage = {
        id: Date.now().toString(),
        role: "user",
        content: input.trim() || "What do you see in this image?",
        timestamp: Date.now(),
        image: selectedImage
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      const imageToAnalyze = selectedImage;
      const prompt = input.trim() || "What do you see in this image? Describe it in detail.";
      clearSelectedImage();
      setIsProcessing(true);

      try {
        const response = await aiServiceRef.current.analyzeImage(imageToAnalyze, prompt);

        const assistantMessage: AIMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: response,
          timestamp: Date.now()
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (error) {
        const errorMessage: AIMessage = {
          id: (Date.now() + 2).toString(),
          role: "assistant",
          content: `Error: ${error instanceof Error ? error.message : "Failed to analyze image"}`,
          timestamp: Date.now()
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    // Regular text message
    const userMessage: AIMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsProcessing(true);

    try {
      const result = await aiServiceRef.current.processCommand(
        userMessage.content,
        header,
        tables
      );

      const assistantMessage: AIMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: result.response,
        timestamp: Date.now()
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Execute commands
      if (result.commands && result.commands.length > 0) {
        const { header: newHeader, tables: newTables } = executeCommands(
          result.commands,
          header,
          tables
        );
        onUpdate(newHeader, newTables);
      }
    } catch (error) {
      const errorMessage: AIMessage = {
        id: (Date.now() + 2).toString(),
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : "Something went wrong"}`,
        timestamp: Date.now()
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsProcessing(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    aiServiceRef.current?.clearHistory();
  };

  const exportChat = () => {
    const chatData = JSON.stringify(messages, null, 2);
    const blob = new Blob([chatData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) {
    return (
      <button
        className="aiChatToggle"
        onClick={() => setIsOpen(true)}
        title="Open AI Assistant"
      >
        <MessageCircle size={24} />
        {messages.length > 0 && <span className="badge">{messages.length}</span>}
      </button>
    );
  }

  return (
    <div className="aiChatPanel">
      <div className="aiChatHeader">
        <div>
          <h3>AI Assistant</h3>
          <small>Control your bill with natural language</small>
        </div>
        <div className="aiChatActions">
          <button onClick={exportChat} title="Export chat" disabled={messages.length === 0}>
            <Download size={18} />
          </button>
          <button onClick={clearChat} title="Clear chat" disabled={messages.length === 0}>
            <Trash2 size={18} />
          </button>
          <button onClick={() => setShowSettings(!showSettings)} title="Settings">
            <Settings size={18} />
          </button>
          <button onClick={() => setIsOpen(false)} title="Close">
            <X size={18} />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="aiSettings">
          <label>
            AI Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value as any)}>
              <option value="ollama">🆓 Ollama (FREE - Local)</option>
              <option value="openai">OpenAI (ChatGPT - Paid)</option>
              <option value="anthropic">Anthropic (Claude - Paid)</option>
            </select>
          </label>
          {provider !== "ollama" && (
            <label>
              API Key
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Enter your ${provider === "openai" ? "OpenAI" : "Anthropic"} API key`}
              />
            </label>
          )}
          {provider === "ollama" && (
            <div style={{ padding: "10px", background: "#e8f5e9", borderRadius: "8px", marginBottom: "10px" }}>
              <p style={{ margin: 0, fontSize: "14px", color: "#2e7d32" }}>
                ✅ Using <strong>FREE</strong> local AI (Ollama)
                <br />
                <small style={{ color: "#558b2f" }}>No internet or API key needed!</small>
              </p>
              <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#1565c0" }}>
                📷 <strong>Image analysis available!</strong> Upload images to analyze with Moondream vision model (fast!).
              </p>
            </div>
          )}
          <button className="primaryButton" onClick={saveApiKey}>
            Save Configuration
          </button>
          {provider !== "ollama" && (
            <p className="helpText">
              Don't have an API key?{" "}
              <a
                href={
                  provider === "openai"
                    ? "https://platform.openai.com/api-keys"
                    : "https://console.anthropic.com/"
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                Get one here
              </a>
            </p>
          )}
        </div>
      )}

      <div className="aiChatMessages">
        {messages.length === 0 && (
          <div className="aiWelcome">
            <MessageCircle size={48} />
            <h4>Welcome to AI-Powered Bill Editing</h4>
            <p>Tell me what you want to do with your bill. For example:</p>
            <ul>
              <li>"Change business name to ABC Company"</li>
              <li>"Add a new table for services"</li>
              <li>"Add 5 rows to the first table"</li>
              <li>"Export this to Excel"</li>
            </ul>
            {provider === "ollama" && (
              <div className="visionFeature">
                <Image size={24} />
                <p><strong>NEW!</strong> Upload images for AI analysis using the 📷 button below.</p>
              </div>
            )}
            {provider !== "ollama" && !apiKey && (
              <button className="primaryButton" onClick={() => setShowSettings(true)}>
                <Settings size={17} /> Configure AI First
              </button>
            )}
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`aiMessage ${message.role}`}>
            {message.image && (
              <div className="aiMessageImage">
                <img src={message.image} alt="Uploaded" />
              </div>
            )}
            <div className="aiMessageContent">{message.content}</div>
            <div className="aiMessageTime">
              {new Date(message.timestamp).toLocaleTimeString()}
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="aiMessage assistant">
            <div className="aiMessageContent">
              <span className="typing">{selectedImage ? "Analyzing image..." : "Thinking..."}</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Image Preview */}
      {selectedImage && (
        <div className="imagePreview">
          <img src={selectedImage} alt="Selected" />
          <div className="imagePreviewInfo">
            <span>{selectedImageName}</span>
            <button onClick={clearSelectedImage} title="Remove image">
              <XCircle size={18} />
            </button>
          </div>
        </div>
      )}

      <form className="aiChatInput" onSubmit={handleSubmit}>
        {/* Hidden file input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImageSelect}
          accept="image/*"
          style={{ display: "none" }}
        />
        
        {/* Image upload button - only show for Ollama */}
        {provider === "ollama" && (
          <button
            type="button"
            className="imageUploadBtn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            title="Upload image for analysis (Moondream)"
          >
            <Image size={18} />
          </button>
        )}
        
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            selectedImage
              ? "Ask about this image... (or just send)"
              : provider === "ollama" || apiKey
              ? "Type your command... (e.g., 'Add a new table')"
              : "Configure AI settings first"
          }
          disabled={(provider !== "ollama" && !apiKey) || isProcessing}
        />
        <button
          type="submit"
          disabled={(!input.trim() && !selectedImage) || (provider !== "ollama" && !apiKey) || isProcessing}
          title="Send message"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
