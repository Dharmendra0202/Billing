# Windows Setup Guide

This project has been prepared for Windows. Follow these steps to get started:

## Prerequisites

### 1. Install Node.js
✅ Already detected - npm is working

### 2. Install Python
❌ Python is not installed. You need to install Python for the OCR backend.

**Install Python:**
- Download from [python.org](https://www.python.org/downloads/)
- During installation, **check "Add Python to PATH"**
- Recommended version: Python 3.11 or higher

To verify installation:
```cmd
python --version
```

## Setup Steps

### Frontend/Desktop Setup
✅ Dependencies already installed!

```cmd
npm install
```

### Backend Setup (After installing Python)

1. Create virtual environment:
```cmd
python -m venv backend\.venv
```

2. Activate virtual environment:
```cmd
backend\.venv\Scripts\activate
```

3. Install Python dependencies:
```cmd
pip install -r backend\requirements.txt
```

## Running the Application

### Option 1: Run Everything Together
```cmd
npm run dev
```
This starts both the Electron app and the Vite dev server.

### Option 2: Run Frontend Only (Browser)
```cmd
npm run dev:renderer
```
Then open: http://127.0.0.1:5173/

### Option 3: Run Backend Only
```cmd
npm run backend
```
Or with virtual environment:
```cmd
npm run backend:venv
```

## What Was Changed from Mac

1. ✅ Removed Mac-specific hidden files (._* files)
2. ✅ Updated `package.json` scripts to use `python` instead of `python3`
3. ✅ Added `backend:venv` script for Windows virtual environment path
4. ✅ Installed Node.js dependencies
5. ⏳ Backend setup pending Python installation

## Project Structure

```
bills/
├── frontend/src/          # React frontend code
├── electron/              # Electron main process
├── backend/               # FastAPI OCR backend
├── dist/                  # Frontend build output
├── dist-electron/         # Electron build output
└── node_modules/          # Node dependencies
```

## Next Steps

1. Install Python if you plan to use the OCR backend
2. Run `npm run dev` to start developing
3. The app uses localStorage for data persistence
4. Check README.md for feature details

## Troubleshooting

### "Python was not found"
- Install Python from python.org
- Make sure to check "Add Python to PATH" during installation
- Restart your terminal/PowerShell after installation

### Port 5173 already in use
- Kill the process using the port or change the port in vite.config.ts

### npm vulnerabilities
- Run `npm audit fix` to fix known security issues
- Review with `npm audit` for details
