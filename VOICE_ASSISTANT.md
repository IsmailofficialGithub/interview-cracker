# Real-Time Voice Assistant

The application now includes a real-time voice AI assistant with two working modes.

## Features

### Two Working Modes

#### 1. SELF MODE (🎤)
- Audio input comes from the user's microphone
- The user is speaking directly
- Continuously listens, understands speech, and generates responses
- Provides short, clear answers
- Responds as soon as transcribed text arrives

#### 2. LISTEN MODE (🔊)
- Audio input comes from system speaker/environment
- Can capture audio from videos, songs, calls, or other people's voices
- Transcribes incoming audio and provides helpful responses
- If audio is noise, music, or irrelevant: "I heard unclear or non-speech audio."
- If audio contains questions or meaningful content: answers conversationally

## Usage

1. **Toggle Mode**: Click the mode button (🎤 SELF or 🔊 LISTEN) in the input area to switch between modes
2. **Start/Stop**: Click the "Start" button (or use the existing listen button) to start/stop the voice assistant
3. **View Status**: The status indicator shows current mode, transcription, and processing state

## Requirements

### API Keys
- **Groq API Key** (preferred): For fast transcription and responses
- **OpenAI API Key** (fallback): For transcription and responses

The assistant automatically uses Groq if available, otherwise falls back to OpenAI.

### System Audio Capture (LISTEN Mode)

**Windows:**
System audio capture on Windows is complex and may require additional setup:

1. **Virtual Audio Cable (VAC)**: Install a virtual audio cable software
2. **OBS Virtual Audio**: Use OBS Studio's virtual audio capture
3. **Microphone Fallback**: Use SELF mode with a microphone positioned near speakers

**Note**: The desktopCapturer API in Electron can capture screen audio, but full system audio capture typically requires virtual audio routing software on Windows.

## How It Works

1. **Audio Capture**: Continuously records audio in 3-second chunks
2. **Transcription**: Each chunk is sent to Whisper API (Groq or OpenAI) for transcription
3. **Speech Detection**: Filters out noise, music, and non-speech audio
4. **AI Response**: Meaningful speech is sent to the AI provider (Groq preferred, OpenAI fallback)
5. **Real-Time Streaming**: Responses stream in real-time as they're generated

## Technical Details

- **Transcription**: Uses Whisper API (Groq `whisper-large-v3-turbo` or OpenAI `whisper-1`)
- **AI Provider**: Uses Groq if available, otherwise OpenAI
- **Streaming**: Real-time response streaming via IPC events
- **Audio Format**: WebM with Opus codec
- **Processing Interval**: 3-second chunks for balance between latency and accuracy

## Troubleshooting

### "No API key configured"
- Configure a Groq or OpenAI API key in Settings
- The assistant requires at least one API key for transcription

### "System audio capture failed"
- On Windows, system audio capture requires virtual audio software
- Use SELF mode with microphone as an alternative
- Ensure desktopCapturer permissions are granted

### "Microphone access denied"
- Grant microphone permissions in browser/system settings
- Check that no other application is using the microphone

### Transcription not working
- Verify API key is valid
- Check internet connection
- Ensure audio is being captured (check status indicator)

## Integration

The voice assistant integrates with:
- Existing chat UI (messages appear in chat)
- AI provider system (uses configured providers)
- Settings panel (respects voice settings)
- Security system (all audio processing is secure)

