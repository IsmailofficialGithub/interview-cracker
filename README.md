# Noctisai

Noctisai is a stealthy, secure, and advanced AI assistant designed for seamless interview and meeting support. It features a completely private architecture with zero-knowledge encryption, stealth display modes, and unique "Ghost User" capabilities for undetectable operation.

## Key Features

### 🛡️ Privacy & Stealth
- **Undetectable Presence**: Hidden from the taskbar, task manager (process masking), and screen sharing tools (Zoom, Teams, OBS).
- **Zero-Knowledge Encryption**: All chats and API keys are encrypted locally using AES-256-GCM. We never see your data.
- **Content Protection**: Native OS-level protection prevents screenshots and screen recording of the app window.
- **Global Stealth Shortcut**: Toggle visibility instantly with `Ctrl+Alt+H` (configurable).
- **Stealth Browser**: Built-in tabbed browser that opens links in-app, preventing unexpected external browser windows.
- **Screen Sharing Detection**: Automatically hides sensitive UI elements when screen sharing is detected.

### 🤖 Advanced AI Assistance
- **Multi-Model Support**: Integrated with OpenAI (GPT-4/3.5), Groq (Llama 3, Mixtral), and OpenAI-compatible APIs (Ollama, etc.).
- **Real-Time Voice Transcription**: 
  - **Mine Mode**: Transcribe your own voice using your microphone.
  - **Yours Mode**: Captures system audio (meetings/interviews) for real-time AI context using Whisper (OpenAI or Groq).
- **Multiple Chat Contexts**: Create separate chat sessions with custom context for different scenarios (interviews, meetings, coding, etc.).
- **Ghost Typer (Humanizer)**:
  - Physically simulates human typing to paste answers into code editors (HackerRank, LeetCode) or docs.
  - Includes variable typing speed and "fat finger" algorithm (mistakes & corrections) to bypass copy-paste detection.
  - Usage: Copy text -> Click target -> Press `Ctrl+Alt+V`.
  - Configurable WPM, mistake chance, and shortcuts.

### 🪟 Window Management
- **Always-On-Top**: Window stays on top of all other applications.
- **Keyboard-Controlled Resizing**: Resize window incrementally without mouse dragging.
- **Keyboard-Controlled Positioning**: Move window precisely with arrow keys.
- **Desktop App Embedding** (Windows): Embed desktop applications within the Noctisai window for seamless integration.

## Installation

1. **Download**: Get the latest `.exe` installer from the releases page.
2. **Install**: Run the installer. The app will launch silently.
3. **Setup**:
   - Create a master password (cannot be recovered if lost - minimum 12 characters).
   - Configure your API keys (OpenAI, Groq, or compatible providers) in **Settings > AI Accounts**.

## Usage Guide

### Keyboard Shortcuts

#### Core Shortcuts
- **Show/Hide App**: `Ctrl+Alt+H` (Default)
  - *Fallback: `Ctrl+Shift+H` or `Ctrl+Alt+Shift+H` if primary fails*
- **Ghost Type Clipboard**: `Ctrl+Alt+V` (Default)
  - *Stops immediately if you press `ESC`*
  - *Fallback: `Ctrl+Alt+Shift+V` or `Ctrl+Shift+V` if primary fails*
- **Quit App**: `Ctrl+Alt+Q` (Default)
  - *Fallback: `Ctrl+Alt+Shift+Q` or `Ctrl+Shift+Q` if primary fails*
- **DevTools**: `F12` or `Ctrl+Shift+I` (Development mode)

#### Window Management Shortcuts
- **Increase Window Size**: `Ctrl+Alt+Plus` (or `Ctrl+Alt+=`)
  - Increases window size by 50px in both dimensions
- **Decrease Window Size**: `Ctrl+Alt+-` (minus key)
  - Decreases window size by 50px in both dimensions
- **Move Window Left**: `Ctrl+Alt+Left Arrow`
- **Move Window Right**: `Ctrl+Alt+Right Arrow`
- **Move Window Up**: `Ctrl+Alt+Up Arrow`
- **Move Window Down**: `Ctrl+Alt+Down Arrow`

> **Note**: If a shortcut fails to register (e.g., already used by another app), the system will automatically try fallback shortcuts. Check the console output to see which shortcuts are active.

### Voice Modes

- **Mine Mode** (`MINE` button): 
  - Uses your microphone to transcribe what you say
  - Perfect for dictating responses or asking questions
  - Transcriptions appear in the chat automatically

- **Yours Mode** (`YOURS` button):
  - Captures system audio (what others are saying in a meeting/interview)
  - Provides real-time AI context from conversations
  - Great for getting help during live interviews or meetings

### Ghost Typer

1. Copy AI-generated code/text to clipboard.
2. Click into the destination window (e.g., Coding test editor, document).
3. Press `Ctrl+Alt+V`.
4. The app will "type" the text for you at your configured WPM.
5. Press `ESC` at any time to stop.

**Configuration** (in Settings):
- **WPM**: Words per minute (default: 60)
- **Mistake Chance**: Percentage chance of typos (default: 5%)
- **Max Mistakes**: Maximum consecutive mistakes before correction (default: 1)

### Chat Management

- **New Chat**: Click the "Chats" button → "+ New Chat"
  - Optionally provide a chat name and context
  - Context helps the AI understand the conversation better
- **Switch Between Chats**: Use the Chats sidebar to switch between different conversations
- **Edit Chat**: Right-click a chat in the sidebar to edit its name or context

### Settings

Access settings via the **Settings** button in the top-right corner:

- **AI Accounts**: Configure API keys for different providers
- **Shortcuts**: Customize keyboard shortcuts
- **Ghost Typer**: Adjust typing speed and mistake settings
- **Privacy**: Configure security and stealth options

## Security Architecture

- **Local-Only Storage**: No cloud database. All data resides on your machine.
- **AES-256-GCM Encryption**: All chats and API keys are encrypted at rest.
- **Memory Protection**: Sensitive keys are cleared from memory when the app is locked or closed.
- **Process Masking**: Runs as a background process to avoid detection.
- **Content Protection**: OS-level protection prevents screenshots and screen recording.
- **Screen Sharing Detection**: Automatically hides sensitive UI when screen sharing is active.

## Troubleshooting

### Shortcuts Not Working

If shortcuts fail to register, the app will automatically try fallback shortcuts. Check the console output to see which shortcuts are active. Common causes:

- **Another application is using the shortcut**: The app will try fallback shortcuts automatically
- **Windows permissions**: Run the app as administrator if shortcuts still don't work
- **Shortcut format**: The app converts shortcuts automatically (e.g., `Ctrl` → `CommandOrControl`)

### Voice Assistant Not Working

- **Microphone permissions**: Ensure the app has microphone permissions
- **System audio (Yours Mode)**: Requires screen sharing permissions on some systems
- **API key**: Ensure your OpenAI or Groq API key is configured correctly

### Window Not Staying on Top

- The window automatically re-applies "always on top" every 2 seconds
- If it still doesn't work, try hiding and showing the window again (`Ctrl+Alt+H`)

### Cache Errors

Cache errors in the console are usually harmless and don't affect functionality. They occur when Electron tries to access cache files that are locked by the system.

## Development

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- Windows build tools (for native modules)

### Setup

```bash
# Install dependencies
npm install

# Rebuild native modules (Windows)
npm run rebuild

# Run in dev mode
npm run dev

# Build for Windows
npm run build
```

### Project Structure

```
src/
├── main/           # Electron main process
│   ├── main.js     # Main entry point
│   ├── ipc-handlers.js
│   └── ...
├── renderer/       # Electron renderer process (UI)
│   ├── renderer.js
│   ├── renderer-bundle.js
│   └── ui/         # UI components
├── preload/        # Preload scripts (bridge)
└── security/       # Encryption and security modules
```

### Building Native Modules

The app includes native Windows modules for window management. To rebuild:

```bash
cd native
node-gyp rebuild
```

## Technical Details

- **Framework**: Electron 28+
- **Encryption**: AES-256-GCM with PBKDF2 key derivation
- **AI Providers**: OpenAI API, Groq API, OpenAI-compatible APIs (Ollama, etc.)
- **Voice Transcription**: OpenAI Whisper API or Groq Whisper
- **Platform**: Windows (primary), macOS/Linux (partial support)

## License

MIT

## Contributing

Contributions are welcome! Please ensure all code follows the existing style and includes appropriate tests.

## Support

For issues, feature requests, or questions, please open an issue on the GitHub repository.
