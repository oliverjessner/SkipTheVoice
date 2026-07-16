# CLI

The executable is `skipthevoice`; the product name in output is `SkipTheVoice`.

## Command depth

```text
skipthevoice conversations
└── List conversations containing voice messages

skipthevoice conversations <conversation>
└── List that conversation's voice messages

skipthevoice conversations <conversation> <message>
└── Show voice-message details

skipthevoice conversations <conversation> <message> --output
└── Return or create the transcript

skipthevoice conversations <conversation> <message> --markdown
└── Return or create the transcript as Markdown
```

Normal text messages are never displayed or counted.

## Selecting records

Conversation names and message names are matched case-insensitively. Unique partial names are accepted. Multiple matches are reported with a numbered list, and the CLI requires a complete name or stable ID rather than guessing.

A voice message can be selected by:

- its stable `vm_…` ID;
- its optional name;
- its displayed local timestamp, including seconds;
- its stored ISO-8601 timestamp.

## Transcripts

`--output` prints an existing transcript immediately. If none exists, the CLI starts and waits for transcription, reports progress on standard error, and writes only the final transcript to standard output. `--markdown` behaves the same way, which keeps redirected Markdown files clean.

`--force` creates a new transcription instead of reusing an existing one. `--language <language>` supplies an optional language code such as `de`.

```bash
skipthevoice conversations "Muhammed Akman" "vm_a81f" --output
skipthevoice conversations "Muhammed Akman" "vm_a81f" --markdown > message.md
skipthevoice conversations "Muhammed Akman" "vm_a81f" --output --force --language de
```

## Audio and JSON

`--download-audio` copies the original audio to the current directory using a safe filename derived from date, conversation, and stable message ID.

`--json` returns a single machine-readable JSON document and suppresses human progress output.

```bash
skipthevoice conversations "Muhammed Akman" --json
skipthevoice conversations "Muhammed Akman" "vm_a81f" --download-audio
```

Run `skipthevoice --help` for the complete public options list.
