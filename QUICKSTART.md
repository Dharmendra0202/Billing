# Quick Start Guide

Get your AI-powered bill editor running in 5 minutes!

## Step 1: Choose Your AI Provider

Pick ONE option:

### Option A: OpenAI (Recommended)
1. Visit https://platform.openai.com/signup
2. Add a payment method (credit card required)
3. Go to https://platform.openai.com/api-keys
4. Click "Create new secret key"
5. Copy the key (starts with `sk-`)

**Cost**: ~$0.002 per message (~$1-2/month for regular use)

### Option B: Anthropic Claude
1. Visit https://console.anthropic.com/
2. Sign up and add payment method
3. Create an API key
4. Copy the key (starts with `sk-ant-`)

**Cost**: ~$0.003 per message

## Step 2: Configure the App

Create a file named `.env` in the project root:

```env
# Paste your OpenAI key here:
OPENAI_API_KEY=sk-your-actual-key-here

# OR paste your Anthropic key here:
# ANTHROPIC_API_KEY=sk-ant-your-actual-key-here
```

**OR** configure it directly in the app (click Settings in chat).

## Step 3: Run the App

Open PowerShell in the project folder and run:

```powershell
npm run dev
```

Wait for it to start, then the Electron app will open automatically!

## Step 4: Start Using AI

1. Click the blue chat button in the bottom-right corner
2. Type a command, for example:
   - "Change business name to ABC Company"
   - "Add a new table called Services"
   - "Export this to Excel"

That's it! 🎉

## Common Commands

### Update Header
```
"Change business name to XYZ Corp"
"Set GST number to 29ABCDE1234F1Z5"
"Update phone to +91 9876543210"
```

### Manage Tables
```
"Add a new table"
"Delete the second table"
"Rename table 1 to Products"
"Add 5 rows to table 1"
```

### Data Entry
```
"In table 1, add a row with item Laptop and amount 45000"
"Set the amount in row 2 to 15000"
```

### Export
```
"Export this bill to Excel"
"Download as invoice-2024.xlsx"
```

## Troubleshooting

### "API key not configured"
- Make sure you created the `.env` file
- Check that the key is in the right format
- Restart the app after creating `.env`

### Chat button not appearing
- Check the browser console for errors (F12)
- Make sure all npm packages installed: `npm install`

### Backend not starting
- Install Python: Download from python.org
- Run: `python -m venv backend\.venv`
- Then: `backend\.venv\Scripts\activate`
- Then: `pip install -r backend\requirements.txt`

## Need More Help?

- **AI Setup Details**: Read `AI-SETUP.md`
- **Full Documentation**: Read `README.md`
- **Windows Setup**: Read `WINDOWS-SETUP.md`

## Pro Tips

1. **Save Often**: Click the "Save" button to persist your templates
2. **Use Natural Language**: The AI understands context, just talk normally
3. **Be Specific**: "Table 1" or "first table" works better than just "the table"
4. **Undo Available**: Just say "undo the last change"
5. **Export Anytime**: You can export to Excel whenever you want

Enjoy your AI-powered bill editor! 🚀
