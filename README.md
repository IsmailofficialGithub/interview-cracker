# Noctisai

Noctisai is a stealthy, secure, and advanced AI assistant designed for seamless interview and meeting support. It features a completely private architecture with zero-knowledge encryption, stealth display modes, and unique "Ghost User" capabilities for undetectable operation.

## Key Features

### 🛡️ Privacy & Stealth
- **Undetectable Presence**: Hidden from the taskbar, task manager (process masking), and screen sharing tools (Zoom, Teams, OBS).
- **Zero-Knowledge Encryption**: All chats and API keys are encrypted locally using AES-256-GCM. We never see your data.
- **Content Protection**: Native OS-level protection prevents screenshots and screen recording of the app window.
- **Global Stealth Shortcut**: Toggle visibility instantly with `Ctrl+Alt+H` (configurable).
- **Stealth Browser**: Built-in tabbed browser that opens links in-app, preventing unexpected external browser windows.

### 🤖 Advanced AI Assistance
- **Multi-Model Support**: Integrated with OpenAI (GPT-4/3.5) and Groq (Llama 3, Mixtral) for lightning-fast responses.
- **Real-Time Voice Transcription**: 
  - **Mine Mode**: Transcribe your own voice.
  - **Yours Mode**: Transcribe system audio (meetings/interviews) accurately using Whisper (OpenAI or Groq).
- **Ghost Typer (Humanizer)**:
  - Physically simulates human typing to paste answers into code editors (HackerRank, LeetCode) or docs.
  - Includes variable typing speed and "fat finger" algorithm (mistakes & corrections) to bypass copy-paste detection.
  - Usage: Copy text -> Click target -> Press `Ctrl+Alt+V`.
  - Configurable WPM and shortcuts.

## Installation

1. **Download**: Get the latest `.exe` installer from the releases page.
2. **Install**: Run the installer. The app will launch silently.
3. **Setup**:
   - Create a master password (cannot be recovered if lost).
   - Configure your API keys (OpenAI or Groq) in **Settings > AI Accounts**.

## Usage Guide

### Shortcuts
- **Show/Hide App**: `Ctrl+Alt+H` (Default)
- **Ghost Type Clipboard**: `Ctrl+Alt+V` (Default)
  - *Note: Stops immediately if you press `ESC`.*
- **Quit App**: `Ctrl+Alt+Q` (Default)
- **DevTools**: `F12` (if authorized)

### Voice Modes
- **Mine Mode**: Uses your microphone to transcribe what you say.
- **Yours Mode**: Captures system audio (what others are saying in a meeting) for real-time AI context.

### Ghost Typer
1. Copy AI-generated code/text.
2. Click into the destination window (e.g., Coding test editor).
3. Press `Ctrl+Alt+V`.
4. The app will "type" the text for you at your configured WPM.

## Security Architecture
- **Local-Only**: No cloud database. All data resides on your machine.
- **Memory Protection**: Sensitive keys are cleared from memory when locked.
- **App Mask**: Runs as a background process to avoid detection.

## Development

```bash
# Install dependencies
npm install

# Run in dev mode (hot reload)
npm run dev

# Build for Windows
npm run build
```

## License
MIT