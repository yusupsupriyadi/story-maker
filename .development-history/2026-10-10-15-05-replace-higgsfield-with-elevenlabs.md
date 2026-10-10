# Replace Higgsfield with ElevenLabs image and video

## Summary

Clip images, character sheets, and AI videos now use the ElevenLabs Image & Video API with the existing `elevenlabs` key. Higgsfield, credit estimates, and remote cancel are gone.

## Changes

- `src/shared/media.ts`: typed catalog of 9 image and 6 video models and per-model request bodies.
- `src/main/services/elevenMedia.ts`: submit, poll, key access check, Indonesian errors.
- `src/main/generation.ts`, `jobs.ts`, `ipc.ts`, `db/index.ts`: queue `media`, inline references, resume, cleanup migration.
- Renderer: Settings "Gambar dan video" uses the ElevenLabs key; credit UI removed; new model logos.
- Docs: AGENTS.md, README.md, CHANGELOG.md, docs/*.

## Decisions

- Inline base64 references instead of asset uploads; `submit` retries only on 429.

## Verification

- `node --no-warnings <scratchpad>/check-media.ts` (catalog bodies, durations, resolutions, old-id fallback): passes
- `npm run typecheck`: passes
- `npm run build`: passes
- leftover grep: only CHANGELOG history, the new decision entry, the cleanup migration, and two fallback comments

## Limitations

- No live ElevenLabs request was made. Seedream and Seedance need ElevenLabs approval. Cancel does not stop billing.

## Follow-up

- Generate one image and one video with a Pro key, with the user's approval.
