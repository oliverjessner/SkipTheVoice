# SkipTheVoice CLI

Read WhatsApp voice messages as text from the same local database used by the web application.

## Installation

```bash
brew tap oliverjessner/tap
brew install skipthevoice
```

or:

```bash
npm install --global @skipthevoice/cli
```

Homebrew installs every runtime dependency. The npm build requires Node.js 22+ and Python 3.11–3.14; it includes FFmpeg/ffprobe binaries and prepares the local Python environment when the first transcription is requested. Docker and a separately started Whisper service are not required.

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
