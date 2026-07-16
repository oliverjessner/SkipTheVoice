# WhatsApp and Baileys

The implementation pins the legitimate `@whiskeysockets/baileys@7.0.0-rc13` package, whose manifest points to `WhiskeySockets/Baileys`. It supports multi-file credential state per user/connection, QR login, pairing codes, credential updates, connection updates, `messages.upsert`, and `messaging-history.set`.

Only normalized messages with `audioMessage.ptt === true` and `fromMe !== true` are imported. No text, captions, quoted messages, or unrelated metadata is stored. Credentials use mode `0700` directories outside `public`, never enter API output, and must be encrypted or protected with volume encryption in production. Historical sync is best effort because WhatsApp does not guarantee full history to linked clients.

Contact names are resolved from synchronized address-book names, verified business names, WhatsApp notify/user names, and message `pushName`, in that order. Phone numbers or WhatsApp identifiers are shown only when WhatsApp supplies no human-readable name. LID and phone-number aliases are linked through message alternates and Baileys' persisted Signal mapping so later contact events update previously imported messages.

Profile pictures are fetched from WhatsApp with `profilePictureUrl` after connection, contact sync, and message import, then stored as refreshable remote URLs. WhatsApp privacy settings can make a picture unavailable; the web interface deliberately falls back to initials in that case.
