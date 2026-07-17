# SkipTheVoice

Read WhatsApp voice messages as text in a local web UI or from the command line.

## Installation

```bash
brew tap oliverjessner/tap
brew install skipthevoice
```

or:

```bash
npm install --global skipthevoice
```

Homebrew installs every runtime dependency. The npm build requires Node.js 22+ and Python 3.11–3.14; it includes FFmpeg/ffprobe binaries and prepares the local Python environment when the first transcription is requested. Docker and a separately started Whisper service are not required.

Start SkipTheVoice without a subcommand to launch the local UI and open it in the default browser:

```bash
skipthevoice
```

The UI runs at `http://localhost:3000` and remains active while the command is running. Press `Ctrl+C` to stop the UI and its local transcription services. All commands with a subcommand continue to use the CLI:

```bash
skipthevoice conversations
skipthevoice conversations "Muhammed Akman"
skipthevoice conversations "Muhammed Akman" "vm_a81f"
```

The first form lists conversations containing voice messages. The second lists the selected conversation's voice messages. The third shows one message's details. Conversations and named messages are matched case-insensitively; IDs are the safest selectors. Ambiguous partial matches are rejected instead of guessed.

Print or create a transcript:

```bash
skipthevoice conversations "Muhammed Akman" "vm_a81f" --output
skipthevoice conversations "Muhammed Akman" "Long message" --output --language de
skipthevoice conversations "Muhammed Akman" "vm_a81f" --output --force
```

Print Markdown suitable for redirection:

```bash
skipthevoice conversations "Muhammed Akman" "vm_a81f" --markdown > voice-message.md
```

Download the original audio into the current directory:

```bash
skipthevoice conversations "Muhammed Akman" "vm_a81f" --download-audio
```

Use `--json` for machine-readable conversation, message, and transcript output. Run `skipthevoice --help` for the complete public interface.
