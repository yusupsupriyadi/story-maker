# Fix Veo video generation (prompt enhancement)

## Summary

The first live ElevenLabs video test failed with "Veo 3 prompt enhancement cannot be disabled" (not charged). Veo requests no longer send `enhance_prompt: false`.

## Changes

- `src/shared/media.ts`: removed the `enhanceSwitch` model flag and the `enhance_prompt` field from video bodies; comment explains why.
- `docs/layanan-ai.md`, `docs/keputusan-teknis.md`: documented the API behavior so the field is not added back.

## Decisions

- Keep the API default for prompt enhancement; the schema lists the field, but the model rejects turning it off.

## Verification

- `node --no-warnings <scratchpad>/check-media.ts` with the Veo body asserting no `enhance_prompt`: failed before the fix, passes after
- `npm run typecheck`, `npm run build`: pass
- Live app test (dev harness, temp data folder): clip video job done in 60 s, Veo 3.1 Fast, 1280x720, 4.0 s, h264, no audio stream; asset provider `elevenlabs`, remoteUrl null
- Live app test earlier: clip image with GPT Image 2.5 Sunburst, 2048x1152 PNG

## Limitations

- Seedream and Seedance were not tested live (they need ElevenLabs approval).

## Follow-up

- none
