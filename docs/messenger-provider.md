# Messenger provider

`MessengerProvider` defines connect, disconnect, status, voice synchronization, and media download independently of any UI. General audio, API, and CLI code does not depend on WhatsApp payloads. Future providers must perform the same ownership and narrow-content guarantees; Telegram and Signal are intentionally not implemented.
