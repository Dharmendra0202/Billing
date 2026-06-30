# AI Chat Setup Guide

Your bill editor now has AI-powered chat capabilities! Control everything through natural language.

## 🤖 Choose Your AI Provider

You need to choose ONE of these options:

### Option 1: OpenAI (ChatGPT) - Recommended
- **Cost**: Pay-as-you-go (~$0.002 per request)
- **Quality**: Excellent
- **Setup**:
  1. Go to https://platform.openai.com/signup
  2. Add payment method (requires credit card)
  3. Create API key at https://platform.openai.com/api-keys
  4. Copy the key (starts with `sk-`)

### Option 2: Anthropic (Claude) - Alternative
- **Cost**: Pay-as-you-go (~$0.003 per request)
- **Quality**: Excellent
- **Setup**:
  1. Go to https://console.anthropic.com/
  2. Sign up and add payment method
  3. Create API key
  4. Copy the key (starts with `sk-ant-`)

### Option 3: Local/Free Option (Coming Soon)
- Use Ollama for free local AI
- No API key needed
- Lower quality but free

## 🔑 Configure API Key

### Method 1: Environment Variable (Recommended)
Create a file `.env` in the project root:

```env
# Choose ONE:
OPENAI_API_KEY=sk-your-key-here
# OR
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### Method 2: Direct in App
You can enter the API key directly in the chat interface (stored in browser only).

## 💡 Example Prompts

Once configured, you can use natural language commands:

### Bill Editing
- "Change business name to ABC Company"
- "Set GST number to 29ABCDE1234F1Z5"
- "Update phone number to +91 9876543210"

### Table Management
- "Add a new table called Services"
- "Add 5 rows to the first table"
- "Delete the second table"
- "Rename Table 1 to Product Details"

### Data Entry
- "In the first table, add a row with item 'Laptop' and amount 45000"
- "Set the amount in row 2 to 15000"
- "Add columns for Quantity and Rate to table 1"

### Calculations
- "Calculate total with 18% GST"
- "Add a discount of 10% to the grand total"
- "Show me the sum of all amounts"

### Excel Operations
- "Export this bill to Excel"
- "Download as .xlsx file"
- "Create Excel with formulas"

### Advanced
- "Duplicate the first table"
- "Sort table 1 by amount descending"
- "Clear all data but keep the structure"

## 🚀 Usage

1. Start your app: `npm run dev`
2. Click the chat icon in the sidebar
3. Type your command and press Enter
4. The AI will understand and make the changes automatically

## 💰 Cost Estimate

- **OpenAI GPT-4**: ~$0.002 per message
- **Claude**: ~$0.003 per message
- Average user: ~$1-2 per month for regular usage

## 🔒 Security

- API keys stored locally (never sent to our servers)
- Only your prompts and bill data sent to AI provider
- Use environment variables for production

## ❓ Troubleshooting

### "API key not configured"
- Check `.env` file exists and has the correct key format
- Restart the app after creating `.env`

### "Invalid API key"
- Verify the key is copied correctly (no extra spaces)
- Check if the key is active in your AI provider dashboard

### "Rate limit exceeded"
- You've hit your usage limit
- Add payment method or wait for the limit to reset

## 📚 Need Help?

The chat understands context, so you can:
- Ask questions: "How do I add GST calculation?"
- Request help: "Show me how to export to Excel"
- Undo: "Undo the last change"
