# Bill AI Desktop

A desktop bill generator with AI-powered chat control:

- **AI Chat Interface**: Control everything through natural language
- **Excel Integration**: Export bills to Excel with formulas
- **Reusable Templates**: Save company/header formats
- **Dynamic Tables**: Manually controlled tables, rows, and columns
- **Excel-like Formulas**: Automatic amount calculations
- **Live Preview**: Printable bill preview
- **OCR Ready**: FastAPI endpoint for future OCR integration

## 🤖 NEW: 100% FREE AI-Powered Chat (Ollama)

Type commands in plain English to control your bill:
- "Change business name to ABC Company"
- "Add a new table for services"
- "Export this bill to Excel"
- "Add 5 rows to the first table"

### 🆓 Completely FREE Option (Recommended!)
Uses **Ollama** for local AI - no API keys, no costs, no internet needed!

See `FREE-AI-READY.md` for the FREE setup guide.

### 💳 Paid Options (Optional)
Also supports OpenAI/Anthropic if you prefer cloud AI.
See `AI-SETUP.md` for paid setup instructions.

## Tech Stack

- Desktop: Electron
- Frontend: React + TypeScript + Vite
- UI: CSS with dashboard-style layout
- Icons: lucide-react
- **AI**: Ollama (FREE local) / OpenAI / Anthropic (paid)
- **Excel**: xlsx, exceljs, openpyxl
- OCR backend: Python FastAPI
- Future OCR: PaddleOCR + OpenCV
- Storage: localStorage (SQLite planned)

## Quick Start

### 🆓 FREE AI Version (Recommended!)

**Just double-click:**
```
START-FREE.bat
```

That's it! No API keys, no setup, completely FREE!

See `FREE-AI-READY.md` for details.

### 💳 Alternative: Paid AI Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure AI (Optional)

Create a `.env` file for OpenAI/Anthropic:

```env
# Get your key from https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-your-key-here
```

Or configure it in the app's chat interface.

### 3. Run the App

```bash
npm run dev
```

This starts both Electron and the development server.

## Run Options

**Browser-only preview:**
```bash
npm run dev:renderer
```
Then open: http://127.0.0.1:5173/

**Backend server** (for OCR when ready):
```bash
npm run backend
```

## Python Backend Setup (Optional)

Only needed for OCR features:

```bash
python -m venv backend\.venv
backend\.venv\Scripts\activate
pip install -r backend\requirements.txt
npm run backend:venv
```

## Features

### ✅ Currently Working
- Manual bill creation with multiple tables
- Excel-like calculations and totals
- Live printable preview
- Local storage persistence
- **AI chat interface**
- **Excel export with formulas**
- Raw image upload (OCR ready)
- Template management

### 🚧 Coming Soon
- Advanced OCR with PaddleOCR
- Template library
- Database storage (SQLite)
- Multi-currency support
- Tax calculations
- Advanced AI automations

## 💡 AI Commands Examples

```
"Change the phone number to +91 9876543210"
"Add a column for Quantity in table 1"
"Set row 2 amount to 15000"
"Duplicate the first table"
"Calculate 18% GST on the total"
"Export to Excel with filename 'invoice-2024.xlsx'"
```

## 📚 Documentation

- **🆓 FREE AI Setup**: See `FREE-AI-READY.md` ⭐ **RECOMMENDED**
- **💳 Paid AI Setup**: See `AI-SETUP.md`
- **Windows Setup**: See `WINDOWS-SETUP.md` (if migrating from Mac)
- **API Docs**: Run backend and visit http://127.0.0.1:8000/docs

## Cost Estimate (AI Features)

### FREE Option (Ollama)
- **Cost**: $0 forever
- **Setup**: Already done!
- **Usage**: Unlimited
- **Privacy**: 100% local

### Paid Options (Optional)
- OpenAI: ~$0.002 per chat message
- Anthropic: ~$0.003 per chat message
- Typical usage: $1-2 per month

## Development

```bash
# Install dependencies
npm install

# Run dev mode
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
bills/
├── frontend/src/          # React frontend
│   ├── components/        # UI components (including AIChat)
│   ├── lib/              # Utilities (AI service, Excel, formulas)
│   ├── data/             # Initial data
│   └── types.ts          # TypeScript types
├── electron/              # Electron main process
├── backend/               # FastAPI OCR backend
├── dist/                  # Frontend build output
└── dist-electron/         # Electron build output
```

## Security

- API keys stored locally (localStorage or .env)
- No data sent to our servers
- Only prompts sent to chosen AI provider
- Use environment variables for production

## License

Private/Proprietary

## Support

For issues or questions, check:
1. `AI-SETUP.md` for AI configuration
2. `WINDOWS-SETUP.md` for Windows setup
3. GitHub Issues (if applicable)
