# 🕵️‍♂️ Noctisai

![Version](https://img.shields.io/github/package-json/v/IsmailofficialGithub/interview-cracker)
![License](https://img.shields.io/github/license/IsmailofficialGithub/interview-cracker)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

Noctisai is a stealthy, secure, and advanced AI assistant designed for seamless interview and meeting support. It features a completely private architecture with zero-knowledge encryption, stealth display modes, and unique "Ghost User" capabilities for undetectable operation.

## ✨ Key Features

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

### 🆕 New Features
- **Transparent OCR Overlay**: Select any area on your screen to extract text seamlessly using a transparent overlay window. Perfect for extracting questions from uncopiable screens!
- **Cross-Platform Support**: In addition to Windows, we now have comprehensive Linux build support (via `AppImage` and `deb`) including Dockerized CI builds.
- **Advanced Voice Activity Detection (VAD)**: Real-time microphone and system audio capture with highly accurate voice activity detection to save API costs and improve transcriptions.

### 🪟 Window Management
- **Always-On-Top**: Window stays on top of all other applications.
- **Keyboard-Controlled Resizing**: Resize window incrementally without mouse dragging.
- **Keyboard-Controlled Positioning**: Move window precisely with arrow keys.
- **Desktop App Embedding** (Windows): Embed desktop applications within the Noctisai window for seamless integration.

## 🚀 Getting Started

### Installation

1. **Download**: Get the latest binary installer from the [Releases](https://github.com/IsmailofficialGithub/interview-cracker/releases) page. We support Windows (`.exe`) and Linux (`.AppImage`, `.deb`).
2. **Install**: Run the installer. The app will launch silently.
3. **Setup**:
   - Create a master password (cannot be recovered if lost - minimum 12 characters).
   - Configure your API keys (OpenAI, Groq, or compatible providers) in **Settings > AI Accounts**.

### Usage Guide

#### Core Shortcuts
- **Show/Hide App**: `Ctrl+Alt+H`
- **Ghost Type Clipboard**: `Ctrl+Alt+V`
- **OCR Selection Overlay**: `Ctrl+Alt+O`
- **Quit App**: `Ctrl+Alt+Q`

#### Window Management
- **Increase/Decrease Size**: `Ctrl+Alt+Plus` / `Ctrl+Alt+-`
- **Move Window**: `Ctrl+Alt + Arrow Keys`

#### Voice Modes
- **Mine Mode**: Uses your microphone to transcribe what you say.
- **Yours Mode**: Captures system audio to provide real-time AI context from conversations.

#### Ghost Typer Setup
1. Copy AI-generated code/text to clipboard.
2. Click into the destination window.
3. Press `Ctrl+Alt+V`.
4. Press `ESC` at any time to stop.
Configure WPM and typo likelihood in Settings.

## 🏗️ Architecture & Security

- **Framework**: Built on Electron 28+.
- **Local-Only Storage**: No cloud database. All data resides on your machine.
- **AES-256-GCM Encryption**: All chats and API keys are encrypted at rest with PBKDF2 key derivation.
- **Process Masking & Content Protection**: OS-level protection prevents screenshots and screen recording.
- **Voice Transcription**: OpenAI Whisper API or Groq Whisper.

## 💻 Development & Contribution

We welcome contributions! This is an open-source initiative and we'd love your help to make it better.

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- Windows build tools (for native modules)

### Setup Instructions

```bash
# Clone the repository
git clone https://github.com/IsmailofficialGithub/interview-cracker.git
cd interview-cracker

# Install dependencies
npm install

# Rebuild native modules (Windows)
npm run rebuild

# Run in dev mode
npm run dev
```

### Building the Project

```bash
# Build for Windows
npm run build

# Build for Linux (Native)
npm run build:linux

# Build for Linux (via Docker for Windows users)
npm run build:linux:docker
```

## 🤝 Contributing

We encourage you to contribute to Noctisai! Here are a few ways you can help:
- 🐛 **Report bugs**: Submit an issue if you encounter a problem.
- 💡 **Suggest features**: Open an issue to propose a new feature.
- 🛠️ **Create pull requests**: Fork the repo, make your changes, and submit a PR! Please ensure all code follows the existing style and includes appropriate tests.

## 📄 License

This project is licensed under the [MIT License](LICENSE).

## 💬 Support & Community

For issues, feature requests, or questions, please open an issue on our [GitHub repository](https://github.com/IsmailofficialGithub/interview-cracker/issues). Star ⭐ the repository if you find it helpful!
