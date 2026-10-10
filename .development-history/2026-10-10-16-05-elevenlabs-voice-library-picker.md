# Pick narrator voices from the ElevenLabs Voice Library

## Summary

The ElevenLabs voice picker in the Idea step gets a "Cari di Voice Library" dialog: search community voices by text, language, and gender, play previews, and use one for the project (it is added to the user's ElevenLabs account first).

## Changes

- `src/shared/voiceLibrary.ts`, `src/shared/types.ts`: request path builder and response mapping (Indonesian labels); `LibraryVoice*` types.
- `src/main/services/elevenlabs.ts`: `searchLibraryVoices` (GET /v1/shared-voices), `addLibraryVoice` (POST /v1/voices/add/{owner}/{voice}) with a voice-slot-full message.
- `src/main/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`: `settings:libraryVoices`, `settings:addLibraryVoice`.
- `src/renderer/src/pages/project/VoiceLibraryDialog.tsx`, `IdeaStep.tsx`, `lib/usePreviewPlayer.ts`: dialog, picker button, shared preview player.
- `CHANGELOG.md`, `docs/layanan-ai.md`: documented.

## Decisions

- Sort by past-year usage and hide custom-rate voices; voices already in the account are used by id without adding again (live check: same voice_id).

## Verification

- `node --no-warnings <scratchpad>/check-voice-library.ts`: failed before the module existed, passes after
- `npm run typecheck`, `npm run build`: pass
- Live read-only API run: Indonesian + female filter (30/1278, all match), page 1 has no overlap, no custom rates, search works, invalid add rejected with HTTP 400 and no account change

## Limitations

- UI not run here by request; the user tests it. Adding a real voice was not exercised (it uses a voice slot).

## Follow-up

- none
