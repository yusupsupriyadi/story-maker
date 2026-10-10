# Higgsfield → ElevenLabs Image & Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Higgsfield completely and generate clip images, character sheets, and AI videos through the ElevenLabs Image & Video API with the user's existing `elevenlabs` key.

**Architecture:** Keep the existing job pipeline (queue → submit → poll → download → asset, resumable after restart). Swap the provider pieces: a hand-written, typed model catalog in `src/shared/media.ts` builds per-model request bodies; `src/main/services/elevenMedia.ts` talks to `POST/GET /v1/flows/{image|video}`; references and start frames travel as `inline_base64`. Credit estimates and remote cancel disappear because the API has neither.

**Tech Stack:** Electron 3-process app (main/preload/renderer), TypeScript strict, React + Tailwind v4 + Zustand, better-sqlite3, plain `fetch`. No unit-test framework: checks are `npm run typecheck:node`, `npm run typecheck:web`, `npm run build`, a throwaway Node type-stripping script for the pure catalog module, and grep.

**Spec:** `docs/superpowers/specs/2026-10-10-elevenlabs-media-design.md`

## Global Constraints

- API base `https://api.elevenlabs.io`, auth header `xi-api-key`, key provider id `elevenlabs` (shared with TTS). Dev-only override env `STUDIO_ELEVEN_BASE` replaces `STUDIO_HF_BASE`.
- Endpoints: `POST /v1/flows/image`, `POST /v1/flows/video`, `GET /v1/flows/{image|video}/{id}`, key check `GET /v1/flows/image?page_size=1`.
- The API rejects unknown fields: a request body may contain only fields listed for that model in `src/shared/media.ts`.
- References and start frames are `{ type: 'inline_base64', content_base64, mime_type }`, max 25 MB decoded, mime `image/png | image/jpeg | image/webp`.
- Defaults: image `gpt-image-2.5-sunburst`, video `veo-3.1-fast-generate-001`. Video bodies always send `generate_audio: false`; Veo also `enhance_prompt: false`; Seedance sends `aspect_ratio: 'auto'`.
- Polling: image starts at 2 s (×1.5, cap 10 s, timeout 15 min); video starts at 10 s (×1.5, cap 30 s, timeout 30 min).
- `submit` retries only on HTTP 429 (a retried POST after 5xx could start a second, billed generation — this narrows the spec's "429 atau 5xx" on purpose). Polling GETs retry 429/5xx/network errors up to 8 times.
- Job queue name `media`, limit 3. Jobs and assets use `provider: 'elevenlabs'`; asset `remoteId` = generation id, `remoteUrl` = null.
- New DB migration only appended at the END of `MIGRATIONS`.
- UI text Indonesian, casual, "kamu"; code comments/identifiers English, comments explain why. No native `<select>`.
- TypeScript strict with `noUnusedLocals`/`noUnusedParameters`.
- Commits: Conventional Commits in English, NO `Co-Authored-By`/AI attribution, stage only named paths (never `git add -A`/`.`). Other agents may be working in the same tree: never revert files you did not touch.
- Never run a smoke test, dev harness, or a real ElevenLabs request without the user's explicit approval (it spends their credits).

## Review Focus

1. **Old projects and settings with Higgsfield model ids or resolutions** (`kling-video/...`, `2K` video) must open on the ElevenLabs defaults and send only valid fields — pinned by the catalog check script in Task 1 (`getVideoModel('kling-video/v3.0/std/image-to-video')`, `effectiveResolution(veo, '2K')`).
2. **Clip longer or shorter than a model allows** (12 s clip on Veo 4/6/8, 2 s clip on Seedance 4–30) must request the nearest allowed length — pinned in Task 1's check script.
3. **9:16 projects**: Veo must get `aspect_ratio: '9:16'`, Seedance `'auto'`, image models `'9:16'`; no `aspect_ratio` value outside each model's list — pinned in Task 1's check script.
4. **A clip image the user imported in an unsupported format or over 25 MB** must fail with a clear Indonesian message before anything is sent — pinned by Task 3's code (explicit checks in `inlineRef`) and its grep check.
5. **App restarted mid-generation**: a pending `elevenlabs` media job (has `remote_id` and `payload.target`) resumes polling; a pending ElevenLabs TTS job (no `remote_id`) and any leftover Higgsfield job are marked failed — pinned by Task 3's `resumeJobs` code and its grep check.

---

### Task 1: Typed ElevenLabs model catalog (`src/shared/media.ts`)

**Files:**
- Create: `src/shared/media.ts`
- Test (throwaway, not committed): `<scratchpad>/check-media.ts`

**Interfaces:**
- Consumes: `AspectRatio`, `ModelOption` from `src/shared/types.ts` (unchanged).
- Produces: `ImageRef`, `MediaModel`, `ACCESS_TAG`, `IMAGE_MODELS`, `VIDEO_MODELS`, `DEFAULT_IMAGE_MODEL`, `DEFAULT_VIDEO_MODEL`, `getImageModel(id)`, `getVideoModel(id)`, `maxRefs(m)`, `promptLimit(m)`, `fitDuration(m, seconds)`, `durationLabel(m)`, `resolutionOptions(m)`, `effectiveResolution(m, want?)`, `imageBody(m, prompt, aspect, refs: ImageRef[])`, `NO_MUSIC`, `videoPrompt(m, prompt)`, `videoBody(m, prompt, startFrame: ImageRef, seconds, aspect, resolution?)`, `describeModel(m)`, `mediaModelOptions(kind)`. Old → new names: `HfModel`→`MediaModel`, `HF_IMAGE_MODELS`→`IMAGE_MODELS`, `HF_VIDEO_MODELS`→`VIDEO_MODELS`, `hfModelOptions`→`mediaModelOptions`, path `@shared/higgsfield`→`@shared/media`.

- [ ] **Step 1: Write the check script first** (lives in the session scratchpad, never committed). `<scratchpad>` = the session scratchpad directory; `<repo>` = `C:/Users/yusup/project/story-maker`.

```ts
// <scratchpad>/check-media.ts — run with: node <scratchpad>/check-media.ts
import assert from 'node:assert/strict'
import * as m from 'file:///C:/Users/yusup/project/story-maker/src/shared/media.ts'

const ref = { type: 'inline_base64' as const, content_base64: 'AA==', mime_type: 'image/png' }

// Old Higgsfield ids fall back to the defaults.
assert.equal(m.getImageModel('marketing-studio/image/sunburst').id, 'gpt-image-2.5-sunburst')
assert.equal(m.getVideoModel('kling-video/v3.0/std/image-to-video').id, 'veo-3.1-fast-generate-001')
assert.equal(m.getImageModel(null).id, m.DEFAULT_IMAGE_MODEL)

const veo = m.getVideoModel('veo-3.1-generate-001')
const s25 = m.getVideoModel('bytedance-seedance-v2.5')
const fast = m.getVideoModel('bytedance-seedance-v2-fast')

// Durations snap to what each model allows.
assert.equal(m.fitDuration(veo, 12), 8)
assert.equal(m.fitDuration(veo, 5), 6)
assert.equal(m.fitDuration(s25, 2), 4)
assert.equal(m.fitDuration(s25, 31), 30)

// Resolutions: unknown project values fall back; lowest first in pickers.
assert.equal(m.effectiveResolution(veo, '2K'), '1080p')
assert.equal(m.effectiveResolution(veo, '4K'), '4K')
assert.equal(m.effectiveResolution(fast, null), '720p')
assert.deepEqual(m.resolutionOptions(veo), ['720p', '1080p', '4K'])

// Video bodies: only fields the model knows.
const vb = m.videoBody(veo, 'a cat walks', ref, 5, '9:16', '1080p')
assert.deepEqual(Object.keys(vb).sort(), ['aspect_ratio', 'duration_secs', 'enhance_prompt', 'generate_audio', 'model_id', 'prompt', 'resolution', 'start_frame'])
assert.equal(vb.aspect_ratio, '9:16')
assert.equal(vb.generate_audio, false)
assert.equal(vb.enhance_prompt, false)
assert.ok(String(vb.prompt).endsWith(m.NO_MUSIC))
const sb = m.videoBody(s25, 'a cat walks', ref, 5, '9:16', null)
assert.equal(sb.aspect_ratio, 'auto')
assert.equal('enhance_prompt' in sb, false)

// Image bodies: refs capped per model, resolution/quality only where accepted.
const gpt = m.getImageModel('gpt-image-2.5-sunburst')
const ib = m.imageBody(gpt, 'scene', '16:9', Array(12).fill(ref))
assert.equal((ib.images as unknown[]).length, 10)
assert.equal(ib.resolution, '2K')
assert.equal(ib.quality, 'high')
const nb = m.imageBody(m.getImageModel('gemini-2.5-flash-image'), 'scene', '9:16', [])
assert.deepEqual(Object.keys(nb).sort(), ['aspect_ratio', 'model_id', 'prompt'])
const lite = m.imageBody(m.getImageModel('bytedance-seedream-5-lite'), 'scene', '16:9', [ref])
assert.equal(lite.resolution, '2K')

// Picker: default first, gated models tagged.
const opts = m.mediaModelOptions('video')
assert.equal(opts[0].id, m.DEFAULT_VIDEO_MODEL)
assert.ok(opts[0].tags.includes('Rekomendasi'))
assert.ok(opts.find((o) => o.id === 'bytedance-seedance-v2')!.tags.includes(m.ACCESS_TAG))
assert.equal(m.IMAGE_MODELS.length, 9)
assert.equal(m.VIDEO_MODELS.length, 6)

console.log('media catalog: all checks passed')
```

- [ ] **Step 2: Run it to confirm it fails before the module exists**

Run: `node <scratchpad>/check-media.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/shared/media.ts`.

- [ ] **Step 3: Create `src/shared/media.ts`** with exactly the code in "Appendix A" at the end of this plan.

- [ ] **Step 4: Run the check script**

Run: `node <scratchpad>/check-media.ts`
Expected: `media catalog: all checks passed`

- [ ] **Step 5: Typecheck both sides** (the new module is shared by main and renderer)

Run: `npm run typecheck`
Expected: PASS (nothing imports the module yet; the old `higgsfield.ts` still exists).

- [ ] **Step 6: Commit**

```bash
git add src/shared/media.ts
git commit -m "feat(media): add typed ElevenLabs image and video model catalog"
```

---

### Task 2: ElevenLabs Image & Video client (`src/main/services/elevenMedia.ts`)

**Files:**
- Create: `src/main/services/elevenMedia.ts`
- Modify: `src/main/services/elevenlabs.ts:1-7` (export `BASE` with the dev override)

**Interfaces:**
- Consumes: `requireSecret('elevenlabs')` from `src/main/secrets.ts`; `ApiError`, `sleep` from `src/main/services/http.ts`.
- Produces: `MediaKind`, `GenerationStatus`, `Generation`, `submit(kind, body, signal?)`, `getGeneration(kind, id, signal?)`, `waitForResult(kind, id, onTick, signal?, timeoutMs?)`, `checkAccess(key)`; `BASE` exported from `services/elevenlabs.ts`.

- [ ] **Step 1: Export `BASE` with the dev override in `src/main/services/elevenlabs.ts`**

Current (lines 1–7):

```ts
import { isTagToken, toElevenLabsText } from '@shared/speech'
import type { KeyTestResult, ModelOption, VoiceOption, WordTiming } from '@shared/types'
import { getSecret, requireSecret } from '../secrets'
import { getSettings } from '../settings'
import { readError } from './http'

const BASE = 'https://api.elevenlabs.io'
```

Replace with:

```ts
import { app } from 'electron'
import { isTagToken, toElevenLabsText } from '@shared/speech'
import type { KeyTestResult, ModelOption, VoiceOption, WordTiming } from '@shared/types'
import { getSecret, requireSecret } from '../secrets'
import { getSettings } from '../settings'
import { readError } from './http'

// Development builds can point at a local mock (STUDIO_ELEVEN_BASE) so tests never send a real key or spend credits.
export const BASE = (!app.isPackaged && process.env.STUDIO_ELEVEN_BASE) || 'https://api.elevenlabs.io'
```

- [ ] **Step 2: Create `src/main/services/elevenMedia.ts`** with exactly the code in "Appendix B" at the end of this plan.

- [ ] **Step 3: Typecheck the main side**

Run: `npm run typecheck:node`
Expected: PASS.

- [ ] **Step 4: Check the request rules by grep** (the module talks to a paid API, so it is not run here)

Run: `git grep -n "status === 429\|10_000\|30_000\|page_size=1\|paid_plan_required\|model_access_denied" -- src/main/services/elevenMedia.ts`
Expected: hits for the 429-only retry in `submit` (and the 429 message in `friendly`), both polling constants, the key-check path, and both error codes.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/elevenMedia.ts src/main/services/elevenlabs.ts
git commit -m "feat(media): add ElevenLabs image and video API client"
```

---

### Task 3: Main process switches to ElevenLabs

**Files:**
- Modify: `src/main/generation.ts` (Steps 1–6), `src/main/jobs.ts`, `src/main/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/shared/models.ts`, `src/main/secrets.ts`, `src/main/settings.ts`, `src/main/db/index.ts` (Steps 7–14)
- Delete: `src/main/services/higgsfield.ts` (Step 15)

**Interfaces:**
- Consumes: everything Task 1 and Task 2 produce.
- Produces: `generateClipImage`, `generateCharacterSheet`, `generateClipVideo`, `generateMissingImages`, `generateMissingVideos`, `resumeJobs`, `setActiveAsset` keep their signatures; `estimateCredits` and `forgetEstimates` are removed; the `generate.estimate` IPC is removed; queue `'media'`; `ApiProvider` no longer contains `'higgsfield'`.

> This task leaves the renderer temporarily broken (it still imports `@shared/higgsfield` and calls `generate.estimate`). Verify with `npm run typecheck:node` only and do NOT commit; Task 4 ends with the full check and one commit covering Tasks 3 and 4.

- [ ] **Step 1: Replace the imports and the upload helper at the top of `src/main/generation.ts`**

Current (lines 1–8):

```ts
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { estimateWordTimings } from '@shared/captions'
import { stripVoiceTags } from '@shared/speech'
import { getImageModel, getVideoModel, imageBody, maxRefs, promptLimit, videoBody, type HfModel } from '@shared/higgsfield'
import { getStyle } from '@shared/styles'
import type { AspectRatio, Asset, Character, Clip, CreditEstimate, Job, Project, WordTiming } from '@shared/types'
```

Replace with:

```ts
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname } from 'node:path'
import { estimateWordTimings } from '@shared/captions'
import { stripVoiceTags } from '@shared/speech'
import { getImageModel, getVideoModel, imageBody, maxRefs, promptLimit, videoBody, type ImageRef, type MediaModel } from '@shared/media'
import { getStyle } from '@shared/styles'
import type { Asset, Character, Clip, Job, Project, WordTiming } from '@shared/types'
```

Then current:

```ts
  unfinishedJobs,
  updateAssetMeta,
  updateJob
} from './repo'
import { dropCache, getSettings, readCache, writeCache } from './settings'
import { probeDurationMs, probeSize } from './services/audio'
import * as eleven from './services/elevenlabs'
import * as gemini from './services/gemini'
import * as hf from './services/higgsfield'
import { downloadTo, sleep } from './services/http'

const DAY = 24 * 60 * 60 * 1000

```

Replace with:

```ts
  unfinishedJobs,
  updateJob
} from './repo'
import { getSettings } from './settings'
import { probeDurationMs, probeSize } from './services/audio'
import * as eleven from './services/elevenlabs'
import * as media from './services/elevenMedia'
import * as gemini from './services/gemini'
import { downloadTo, sleep } from './services/http'

```

(`updateAssetMeta` was only used by the removed upload cache; `DAY` only by the upload cache and the estimate cache. Confirm with `git grep -n "updateAssetMeta\|DAY" -- src/main/generation.ts` after Step 5: expect no hits.)

- [ ] **Step 2: Replace `publicUrlFor` and `imageProgress`**

Current:

```ts
/** A URL Higgsfield can fetch for a stored asset: its own recent result URL, or a fresh upload. */
async function publicUrlFor(asset: Asset, signal: AbortSignal): Promise<string> {
  if (asset.remoteUrl && asset.provider === 'higgsfield' && Date.now() - asset.createdAt < 6 * DAY) return asset.remoteUrl
  const up = asset.meta.uploadedUrl as string | undefined
  const at = asset.meta.uploadedAt as number | undefined
  if (up && at && Date.now() - at < 0.5 * DAY) return up
  const url = await hf.uploadFile(assetAbsPath(asset.projectId, asset.localPath), signal)
  updateAssetMeta(asset.id, { ...asset.meta, uploadedUrl: url, uploadedAt: Date.now() })
  return url
}

function imageProgress(ctx: TaskCtx, what: string) {
  return (status: hf.HfStatus, elapsed: number): void => {
    if (status === 'queued') ctx.progress(0.12, 'Mengantre di Higgsfield')
    else ctx.progress(0.15 + 0.75 * (1 - Math.exp(-elapsed / 45_000)), what)
  }
}
```

Replace with:

```ts
const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
/** ElevenLabs caps each inline reference at 25 MB after decoding. */
const INLINE_LIMIT = 25 * 1024 * 1024

/**
 * A stored picture as inline request bytes. Inline references need no upload step and are not kept in the
 * user's ElevenLabs storage, so nothing has to be cleaned up afterwards.
 */
async function inlineRef(asset: Asset): Promise<ImageRef> {
  const abs = assetAbsPath(asset.projectId, asset.localPath)
  const ext = extname(abs).toLowerCase()
  const mime = IMAGE_MIME[ext]
  if (!mime) throw new Error(`Format gambar ${ext || 'ini'} belum bisa dikirim ke ElevenLabs. Pakai PNG, JPG, atau WEBP.`)
  const bytes = await readFile(abs)
  if (bytes.length > INLINE_LIMIT) throw new Error('Gambar ini lebih dari 25 MB, terlalu besar untuk ElevenLabs. Pakai gambar yang lebih kecil.')
  return { type: 'inline_base64', content_base64: bytes.toString('base64'), mime_type: mime }
}

function mediaProgress(ctx: TaskCtx, what: string) {
  return (status: media.GenerationStatus, elapsed: number): void => {
    if (status === 'pending') ctx.progress(0.12, 'Mengantre di ElevenLabs')
    else ctx.progress(0.15 + 0.75 * (1 - Math.exp(-elapsed / 45_000)), what)
  }
}
```

- [ ] **Step 3: Replace `referenceUrls` with `referenceImages`**

Current:

```ts
async function referenceUrls(model: HfModel, chars: Character[], signal: AbortSignal): Promise<{ urls: string[]; names: string[] }> {
  const limit = maxRefs(model)
  if (limit === 0) return { urls: [], names: [] }
  await waitForSheets(
    chars.map((c) => c.id),
    signal
  )
  const urls: string[] = []
  const names: string[] = []
  for (const c of chars) {
    const fresh = getCharacter(c.id)
    const sheet = getAsset(fresh.sheetAssetId)
    if (!sheet || urls.length >= limit) continue
    urls.push(await publicUrlFor(sheet, signal))
    names.push(fresh.name)
  }
  return { urls, names }
}
```

Replace with:

```ts
async function referenceImages(model: MediaModel, chars: Character[], signal: AbortSignal): Promise<{ refs: ImageRef[]; names: string[] }> {
  const limit = maxRefs(model)
  if (limit === 0) return { refs: [], names: [] }
  await waitForSheets(
    chars.map((c) => c.id),
    signal
  )
  const refs: ImageRef[] = []
  const names: string[] = []
  for (const c of chars) {
    const fresh = getCharacter(c.id)
    const sheet = getAsset(fresh.sheetAssetId)
    if (!sheet || refs.length >= limit) continue
    refs.push(await inlineRef(sheet))
    names.push(fresh.name)
  }
  return { refs, names }
}
```

- [ ] **Step 4: Replace the Higgsfield finish/start section** (from the `// ---------- finishing a Higgsfield request` comment through the end of `updateJobPayload`)

Current:

```ts
// ---------- finishing a Higgsfield request (also used to resume after a restart) ----------

interface HfPayload {
  target: 'clip-image' | 'sheet' | 'clip-video'
  model: string
  prompt: string
}

async function finishHiggsfield(ctx: TaskCtx, job: Job, requestId: string, payload: HfPayload): Promise<string> {
  const isVideo = payload.target === 'clip-video'
  const result = await hf.waitForResult(
    requestId,
    imageProgress(ctx, isVideo ? 'Membuat video' : payload.target === 'sheet' ? 'Membuat lembar karakter' : 'Membuat gambar'),
    ctx.signal,
    isVideo ? 30 * 60 * 1000 : 15 * 60 * 1000
  )
  const url = isVideo ? result.video?.url : result.images?.[0]?.url
  if (!url) throw new Error('Higgsfield selesai tanpa file hasil')
  ctx.progress(0.93, 'Mengunduh hasil')
  const { bytes, contentType } = await downloadTo(url, ctx.signal)
  const rel = saveFile(job.projectId, isVideo ? 'videos' : 'images', extFromType(contentType, url, isVideo ? '.mp4' : '.png'), bytes)
  const abs = assetAbsPath(job.projectId, rel)
  const size = await probeSize(abs)
  const durationMs = isVideo ? await probeDurationMs(abs).catch(() => null) : null
  const asset = insertAsset({
    projectId: job.projectId,
    clipId: job.clipId,
    characterId: job.characterId,
    kind: isVideo ? 'video' : 'image',
    provider: 'higgsfield',
    model: payload.model,
    prompt: payload.prompt,
    remoteId: requestId,
    remoteUrl: url,
    localPath: rel,
    durationMs,
    width: size?.width ?? null,
    height: size?.height ?? null
  })
```

Replace with:

```ts
// ---------- finishing an ElevenLabs generation (also used to resume after a restart) ----------

interface MediaPayload {
  target: 'clip-image' | 'sheet' | 'clip-video'
  model: string
  prompt: string
}

async function finishMedia(ctx: TaskCtx, job: Job, generationId: string, payload: MediaPayload): Promise<string> {
  const isVideo = payload.target === 'clip-video'
  const result = await media.waitForResult(
    isVideo ? 'video' : 'image',
    generationId,
    mediaProgress(ctx, isVideo ? 'Membuat video' : payload.target === 'sheet' ? 'Membuat lembar karakter' : 'Membuat gambar'),
    ctx.signal
  )
  ctx.progress(0.93, 'Mengunduh hasil')
  const { bytes, contentType } = await downloadTo(result.content_url, ctx.signal)
  const type = contentType || result.content_mime_type || ''
  const rel = saveFile(job.projectId, isVideo ? 'videos' : 'images', extFromType(type, result.content_url, isVideo ? '.mp4' : '.png'), bytes)
  const abs = assetAbsPath(job.projectId, rel)
  const size = await probeSize(abs)
  const durationMs = isVideo ? await probeDurationMs(abs).catch(() => null) : null
  const asset = insertAsset({
    projectId: job.projectId,
    clipId: job.clipId,
    characterId: job.characterId,
    kind: isVideo ? 'video' : 'image',
    provider: 'elevenlabs',
    model: payload.model,
    prompt: payload.prompt,
    remoteId: generationId,
    // content_url is a signed link that expires after about an hour, so it is not worth keeping.
    remoteUrl: null,
    localPath: rel,
    durationMs,
    width: size?.width ?? null,
    height: size?.height ?? null
  })
```

(The rest of the function body — `emit.asset(asset)` through `return asset.id` — stays unchanged.)

Then current:

```ts
function startHiggsfield(job: Job, build: (ctx: TaskCtx) => Promise<{ endpoint: string; body: Record<string, unknown>; payload: HfPayload }>): Job {
  emit.job(job)
  return runJob(job, 'higgsfield', async (ctx) => {
    ctx.progress(0.04, 'Menyiapkan prompt')
    const { endpoint, body, payload } = await build(ctx)
    ctx.progress(0.08, 'Mengirim ke Higgsfield')
    const requestId = await hf.submit(endpoint, body, ctx.signal)
    ctx.setRemote(requestId)
    updateJobPayload(job.id, payload)
    return finishHiggsfield(ctx, job, requestId, payload)
  })
}

function updateJobPayload(jobId: string, payload: HfPayload): void {
```

Replace with:

```ts
function startMedia(job: Job, build: (ctx: TaskCtx) => Promise<{ body: Record<string, unknown>; payload: MediaPayload }>): Job {
  emit.job(job)
  return runJob(job, 'media', async (ctx) => {
    ctx.progress(0.04, 'Menyiapkan prompt')
    const { body, payload } = await build(ctx)
    ctx.progress(0.08, 'Mengirim ke ElevenLabs')
    const generationId = await media.submit(payload.target === 'clip-video' ? 'video' : 'image', body, ctx.signal)
    ctx.setRemote(generationId)
    updateJobPayload(job.id, payload)
    return finishMedia(ctx, job, generationId, payload)
  })
}

function updateJobPayload(jobId: string, payload: MediaPayload): void {
```

- [ ] **Step 5: Switch the three entry points, `resumeJobs`, and drop the estimate code**

Current (in `generateClipImage`):

```ts
  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'image', provider: 'higgsfield' })
  return startHiggsfield(job, async (ctx) => {
    const fresh = getClip(clipId)
    const project = getProject(fresh.projectId)
    const model = getImageModel(project.imageModel)
    const chars = charactersOf(project.id).filter((c) => fresh.characterIds.includes(c.id))
    const refs = await referenceUrls(model, chars, ctx.signal)
    const prompt = clipPrompt(project, fresh, chars, refs.names, promptLimit(model))
    return {
      endpoint: model.id,
      body: imageBody(model, prompt, project.aspectRatio, refs.urls),
      payload: { target: 'clip-image', model: model.id, prompt }
    }
  })
```

Replace with:

```ts
  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'image', provider: 'elevenlabs' })
  return startMedia(job, async (ctx) => {
    const fresh = getClip(clipId)
    const project = getProject(fresh.projectId)
    const model = getImageModel(project.imageModel)
    const chars = charactersOf(project.id).filter((c) => fresh.characterIds.includes(c.id))
    const refs = await referenceImages(model, chars, ctx.signal)
    const prompt = clipPrompt(project, fresh, chars, refs.names, promptLimit(model))
    return {
      body: imageBody(model, prompt, project.aspectRatio, refs.refs),
      payload: { target: 'clip-image', model: model.id, prompt }
    }
  })
```

Current (in `generateCharacterSheet`):

```ts
  const job = insertJob({ projectId: c.projectId, characterId, kind: 'sheet', provider: 'higgsfield' })
  return startHiggsfield(job, async () => {
    const project = getProject(c.projectId)
    const model = getImageModel(project.imageModel)
    const prompt = sheetPrompt(project, getCharacter(characterId))
    return {
      endpoint: model.id,
      body: imageBody(model, prompt, '16:9', []),
```

Replace with:

```ts
  const job = insertJob({ projectId: c.projectId, characterId, kind: 'sheet', provider: 'elevenlabs' })
  return startMedia(job, async () => {
    const project = getProject(c.projectId)
    const model = getImageModel(project.imageModel)
    const prompt = sheetPrompt(project, getCharacter(characterId))
    return {
      body: imageBody(model, prompt, '16:9', []),
```

Current (in `generateClipVideo`):

```ts
  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'video', provider: 'higgsfield' })
  return startHiggsfield(job, async (ctx) => {
    const fresh = getClip(clipId)
    const image = getAsset(fresh.imageAssetId)
    if (!image) throw new Error('Gambar klip tidak ditemukan')
    const project = getProject(fresh.projectId)
    const model = getVideoModel(project.videoModel)
    ctx.progress(0.05, 'Menyiapkan gambar awal')
    const url = await publicUrlFor(image, ctx.signal)
    let prompt =
      fresh.videoPrompt.trim() ||
      `${splitAvoid(fresh.visualPrompt).scene.replace(/\.$/, '')}. Subtle natural motion of the characters and environment, the camera slowly pushes in. Keep the art style of the first frame.`
    if (model.input.mode === 'reference')
      prompt = `Open on the exact scene of the reference image and keep its art style, characters and composition. ${prompt}`
    return {
      endpoint: model.id,
      body: videoBody(model, prompt, url, fresh.durationMs / 1000, project.aspectRatio, project.videoResolution),
```

Replace with:

```ts
  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'video', provider: 'elevenlabs' })
  return startMedia(job, async (ctx) => {
    const fresh = getClip(clipId)
    const image = getAsset(fresh.imageAssetId)
    if (!image) throw new Error('Gambar klip tidak ditemukan')
    const project = getProject(fresh.projectId)
    const model = getVideoModel(project.videoModel)
    ctx.progress(0.05, 'Menyiapkan gambar awal')
    const startFrame = await inlineRef(image)
    const prompt =
      fresh.videoPrompt.trim() ||
      `${splitAvoid(fresh.visualPrompt).scene.replace(/\.$/, '')}. Subtle natural motion of the characters and environment, the camera slowly pushes in. Keep the art style of the first frame.`
    return {
      body: videoBody(model, prompt, startFrame, fresh.durationMs / 1000, project.aspectRatio, project.videoResolution),
```

Every video model starts from the clip image (`start_frame`), so the old "reference mode" prompt prefix is dropped and `prompt` becomes a `const`.

Current (`resumeJobs`):

```ts
/** After a restart, keep polling Higgsfield requests that were already submitted; fail the rest. */
export function resumeJobs(): void {
  for (const row of unfinishedJobs()) {
    const payload = JSON.parse(row.payload_json || '{}') as Partial<HfPayload>
    if (row.provider === 'higgsfield' && row.remote_id && payload.target) {
      const job = getJob(row.id)!
      runJob(job, 'higgsfield', (ctx) => finishHiggsfield(ctx, job, row.remote_id, payload as HfPayload))
    } else {
```

Replace with:

```ts
/**
 * After a restart, keep polling ElevenLabs generations that were already submitted; fail the rest. Narration jobs
 * also use the elevenlabs provider but never get a remote id, and jobs left by the previous image provider fail too.
 */
export function resumeJobs(): void {
  for (const row of unfinishedJobs()) {
    const payload = JSON.parse(row.payload_json || '{}') as Partial<MediaPayload>
    if (row.provider === 'elevenlabs' && row.remote_id && payload.target) {
      const job = getJob(row.id)!
      runJob(job, 'media', (ctx) => finishMedia(ctx, job, row.remote_id, payload as MediaPayload))
    } else {
```

Delete everything from `/** Estimates that failed recently` to the end of the file (the `failedEstimates` map, `estimateCredits`, and `forgetEstimates`), so the file ends with the closing `}` of `setActiveAsset`.

- [ ] **Step 6: Grep check for the Review Focus items owned here**

Run: `git grep -n "higgsfield\|Higgsfield\|hf\.\|HfPayload\|publicUrlFor\|estimateCredits\|forgetEstimates\|updateAssetMeta\|DAY" -- src/main/generation.ts`
Expected: no output.

Run: `git grep -n "INLINE_LIMIT\|IMAGE_MIME\[ext\]\|row.provider === 'elevenlabs' && row.remote_id" -- src/main/generation.ts`
Expected: hits for the 25 MB check, the format check, and the resume condition.

- [ ] **Step 7: Rename the queue and drop the remote cancel in `src/main/jobs.ts`**

Current (top of file):

```ts
import { getJobRaw, updateJob } from './repo'
import { cancelRequest } from './services/higgsfield'

export type QueueName = 'higgsfield' | 'tts' | 'whisper' | 'export'
```

Replace with:

```ts
import { getJobRaw, updateJob } from './repo'

export type QueueName = 'media' | 'tts' | 'whisper' | 'export'
```

Current:

```ts
const LIMITS: Record<QueueName, number> = { higgsfield: 3, tts: 2, whisper: 1, export: 1 }
const running: Record<QueueName, number> = { higgsfield: 0, tts: 0, whisper: 0, export: 0 }
const waiting: Record<QueueName, (() => void)[]> = { higgsfield: [], tts: [], whisper: [], export: [] }
```

Replace with:

```ts
const LIMITS: Record<QueueName, number> = { media: 3, tts: 2, whisper: 1, export: 1 }
const running: Record<QueueName, number> = { media: 0, tts: 0, whisper: 0, export: 0 }
const waiting: Record<QueueName, (() => void)[]> = { media: [], tts: [], whisper: [], export: [] }
```

Current (in `cancelJob`):

```ts
  if (!raw) return
  if (raw.remote_id && raw.provider === 'higgsfield') await cancelRequest(raw.remote_id)
  const ctrl = controllers.get(id)
```

Replace with:

```ts
  if (!raw) return
  // ElevenLabs has no cancel endpoint: aborting only stops the wait, the generation still finishes and is billed.
  const ctrl = controllers.get(id)
```

- [ ] **Step 8: Update imports in `src/main/ipc.ts`**

Current:

```ts
import type {
  ApiProvider,
  AppSettings,
  AspectRatio,
  ExportOptions,
```

Replace with:

```ts
import type {
  ApiProvider,
  AppSettings,
  ExportOptions,
```

Current:

```ts
import {
  estimateCredits,
  forgetEstimates,
  generateCharacterSheet,
```

Replace with:

```ts
import {
  generateCharacterSheet,
```

Current:

```ts
import { clearSecret, keyStatuses, recordCheck, revealSecret, setSecret } from './secrets'
```

Replace with:

```ts
import { clearSecret, getSecret, keyStatuses, recordCheck, revealSecret, setSecret } from './secrets'
```

Current:

```ts
import * as eleven from './services/elevenlabs'
import * as gemini from './services/gemini'
import * as hf from './services/higgsfield'
import * as llm from './services/llm'
```

Replace with:

```ts
import * as eleven from './services/elevenlabs'
import * as media from './services/elevenMedia'
import * as gemini from './services/gemini'
import * as llm from './services/llm'
```

(If `gemini` turns out to be unused in `ipc.ts` after the edit, typecheck will say so; it is used today, so leave it.)

- [ ] **Step 9: Make the ElevenLabs key test also report image & video access (`src/main/ipc.ts`)**

Current:

```ts
async function testProvider(provider: ApiProvider, key?: string): Promise<KeyTestResult> {
  if (provider === 'higgsfield') return hf.testCredentials(key)
  if (provider === 'elevenlabs') return eleven.testKey(key)
  return llm.testLlm(provider, key)
}
```

Replace with:

```ts
async function testProvider(provider: ApiProvider, key?: string): Promise<KeyTestResult> {
  if (provider === 'elevenlabs') {
    const result = await eleven.testKey(key)
    if (!result.ok) return result
    // The same key also makes images and video, which need a Pro plan and the Image & Video permission.
    const blocked = await media.checkAccess(key ?? getSecret('elevenlabs') ?? '')
    return { ...result, message: `${result.message} · ${blocked ? `gambar & video belum bisa: ${blocked}` : 'gambar & video siap'}` }
  }
  return llm.testLlm(provider, key)
}
```

- [ ] **Step 10: Remove the estimate handler and the Higgsfield cache resets (`src/main/ipc.ts`)**

Delete exactly these lines:

```ts
  handle('generate:estimate', (kind: 'image' | 'video', modelId: string, aspect: AspectRatio, seconds?: number, resolution?: string | null) =>
    estimateCredits(kind, modelId, aspect, seconds, resolution)
  )
```

In `settings:setKey`, delete the line:

```ts
    if (provider === 'higgsfield') forgetEstimates()
```

In `settings:clearKey`, delete the line:

```ts
    if (provider === 'higgsfield') forgetEstimates()
```

(Both are identical strings: edit each occurrence, or use replace-all on the line `    if (provider === 'higgsfield') forgetEstimates()\n` → empty.)

- [ ] **Step 11: Remove `estimate` from the API contract (`src/shared/api.ts`) and preload (`src/preload/index.ts`)**

In `src/shared/api.ts`, delete:

```ts
    /** Credits for one image, or one video of about `seconds`, with this model. Null without a working key. */
    estimate(kind: 'image' | 'video', modelId: string, aspect: AspectRatio, seconds?: number, resolution?: string | null): Promise<CreditEstimate | null>
```

and remove `AspectRatio,` and `CreditEstimate,` from the `import type { … } from './types'` list at the top of `src/shared/api.ts` (both are only used by that line — confirm with `git grep -n "AspectRatio\|CreditEstimate" -- src/shared/api.ts`, expect no output afterwards).

In `src/preload/index.ts`, current:

```ts
    cancel: call('generate:cancel'),
    estimate: call('generate:estimate')
  },
```

Replace with:

```ts
    cancel: call('generate:cancel')
  },
```

- [ ] **Step 12: Shared types and comments (`src/shared/types.ts`, `src/shared/models.ts`)**

`src/shared/types.ts` current:

```ts
export type ApiProvider = 'higgsfield' | 'gemini' | 'elevenlabs' | 'openrouter' | 'groq' | 'custom'
```

Replace with:

```ts
export type ApiProvider = 'gemini' | 'elevenlabs' | 'openrouter' | 'groq' | 'custom'
```

Current:

```ts
  /** Higgsfield endpoint ids; null falls back to the app default. */
```

Replace with:

```ts
  /** ElevenLabs model ids; null or an unknown id falls back to the app default. */
```

Current:

```ts
  /** Higgsfield models for new projects: the last ones picked in the Idea step. */
```

Replace with:

```ts
  /** Image and video models for new projects: the last ones picked in the Idea step. */
```

`src/shared/models.ts` — delete the line:

```ts
/** Higgsfield image and video models live in ./higgsfield.ts, generated from the API docs. */
```

and put this line in its place:

```ts
/** ElevenLabs image and video models live in ./media.ts. */
```

- [ ] **Step 13: Providers and settings (`src/main/secrets.ts`, `src/main/settings.ts`)**

`src/main/secrets.ts` current:

```ts
const PROVIDERS: ApiProvider[] = ['higgsfield', 'gemini', 'elevenlabs', 'openrouter', 'groq', 'custom']

export const PROVIDER_NAMES: Record<ApiProvider, string> = {
  higgsfield: 'Higgsfield',
  gemini: 'Google Gemini',
```

Replace with:

```ts
const PROVIDERS: ApiProvider[] = ['gemini', 'elevenlabs', 'openrouter', 'groq', 'custom']

export const PROVIDER_NAMES: Record<ApiProvider, string> = {
  gemini: 'Google Gemini',
```

`src/main/settings.ts` current:

```ts
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, getImageModel, getVideoModel } from '@shared/higgsfield'
```

Replace with:

```ts
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, getImageModel, getVideoModel } from '@shared/media'
```

Current:

```ts
  // Models dropped from the Higgsfield catalog fall back to the defaults.
```

Replace with:

```ts
  // Models no longer in the catalog (including Higgsfield ids from older builds) fall back to the defaults.
```

- [ ] **Step 14: Append the cleanup migration (`src/main/db/index.ts`)**

Current (end of the `MIGRATIONS` array):

```ts
  ALTER TABLE clips ADD COLUMN voice_start_ms INTEGER NOT NULL DEFAULT 0;
  `
]
```

Replace with:

```ts
  ALTER TABLE clips ADD COLUMN voice_start_ms INTEGER NOT NULL DEFAULT 0;
  `,
  // Higgsfield was replaced by ElevenLabs: forget its stored key and the credit estimates cached for it.
  `
  DELETE FROM secrets WHERE provider = 'higgsfield';
  DELETE FROM cache WHERE key LIKE 'estimate:%' OR key = 'models:higgsfield';
  `
]
```

(Both `secrets` and `cache` are created in the first migration, so they exist when this runs.)

- [ ] **Step 15: Delete the Higgsfield client**

Run: `git rm src/main/services/higgsfield.ts`

- [ ] **Step 16: Typecheck the main side and grep it**

Run: `npm run typecheck:node`
Expected: PASS. (`npm run typecheck:web` still fails here — the renderer is switched in Task 4. Do not commit yet.)

Run: `git grep -n -i "higgsfield\|hf\.\|estimateCredits\|forgetEstimates\|STUDIO_HF_BASE" -- src/main src/preload src/shared ':!src/shared/higgsfield.ts' ':!src/shared/higgsfield-catalog.json'`
Expected: only the migration lines in `src/main/db/index.ts` and the "Higgsfield ids from older builds" comment in `src/main/settings.ts`.

---

### Task 4: Renderer switches to ElevenLabs, credit UI removed

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx`, `src/renderer/src/pages/project/ModelSection.tsx` (full rewrite), `src/renderer/src/pages/project/IdeaStep.tsx`, `src/renderer/src/pages/project/StoryboardStep.tsx`, `src/renderer/src/components/ModelPicker.tsx`, `src/renderer/src/components/ModelLogo.tsx` (full rewrite), `src/renderer/src/components/ProviderLogo.tsx`, `src/renderer/src/pages/Home.tsx`, `src/renderer/src/pages/project/editor/Inspector.tsx`, `src/renderer/src/pages/AboutSection.tsx`, `src/renderer/src/lib/format.ts`, `src/shared/types.ts`
- Delete: `src/renderer/src/lib/useEstimate.ts`, `src/shared/higgsfield.ts`, `src/shared/higgsfield-catalog.json`, `src/renderer/src/assets/providers/higgsfield.png`, and 10 model logos (Step 12)

**Interfaces:**
- Consumes: `IMAGE_MODELS`, `VIDEO_MODELS`, `getImageModel`, `getVideoModel`, `fitDuration`, `effectiveResolution`, `resolutionOptions`, `mediaModelOptions` from `@shared/media` (Task 1); `ApiProvider` without `'higgsfield'` and `window.api.generate` without `estimate` (Task 3).
- Produces: `ModelSection({ project, onChange })` (the `clipCount`/`perClip` props are gone); `ModelPicker` without the `footerNote` prop and without credit sorting; `ModelOption` without `credits`/`usd`/`creditUnit`; no `CreditEstimate` type.

UI copy rules for this task: Indonesian, casual, "kamu", short, no hype words, no exclamation marks.

- [ ] **Step 1: Settings — import and the "Gambar dan video" section (`src/renderer/src/pages/Settings.tsx`)**

Current:

```ts
import { HF_IMAGE_MODELS, HF_VIDEO_MODELS } from '@shared/higgsfield'
```

Replace with:

```ts
import { IMAGE_MODELS, VIDEO_MODELS } from '@shared/media'
```

Replace the whole `HiggsfieldSection` function (from `function HiggsfieldSection({ status, onChanged }` to its closing `}` just before `export function Settings()`) with:

```tsx
function MediaSection({ settings, status, onChanged }: { settings: AppSettings; status?: KeyStatus; onChanged: () => void }) {
  return (
    <>
      <SectionTitle icon={<ImageIcon className="size-5" />} title="Gambar dan video" sub="ElevenLabs membuat gambar klip, lembar karakter, dan video AI." />
      <Card>
        <div className="flex items-center gap-3">
          <ProviderLogo id="elevenlabs" />
          <div className="flex flex-1 flex-col">
            <span className="text-base font-bold">ElevenLabs</span>
            <span className="text-[13px] text-ink-2">GPT Image, Nano Banana, Veo, dan Seedance lewat akun ElevenLabs kamu</span>
          </div>
          <StatusBadge status={status} />
        </div>
        <KeyForm
          provider="elevenlabs"
          name="ElevenLabs"
          status={status}
          hint={
            <>
              Gambar dan video butuh paket <strong className="text-ink">Pro</strong> ke atas, dan kuncinya harus punya izin{' '}
              <strong className="text-ink">Image & Video</strong>.
              {settings.defaultTtsProvider === 'elevenlabs' && ' Kunci ini dipakai bersama untuk suara narator ElevenLabs.'}
            </>
          }
          help="Kunci dicek tanpa memakai kredit."
          link="https://elevenlabs.io/app/settings/api-keys"
          linkLabel="Buat kunci di ElevenLabs"
          onChanged={onChanged}
        />
        <p className="flex items-start gap-2.5 border-t border-dashed border-line pt-4 text-[13px] leading-relaxed text-ink-2">
          <Film className="mt-0.5 size-4 shrink-0" />
          <span>
            Ada {IMAGE_MODELS.length} model gambar dan {VIDEO_MODELS.length} model video. Model berlabel{' '}
            <strong className="text-ink">Perlu akses</strong> baru bisa dipakai setelah ElevenLabs membuka aksesnya untuk akunmu. Modelnya dipilih
            per proyek di langkah <strong className="text-ink">Ide cerita</strong>, bagian Model AI.
          </span>
        </p>
      </Card>
    </>
  )
}
```

Current (call site):

```tsx
                <HiggsfieldSection status={statusOf('higgsfield')} onChanged={reload} />
```

Replace with:

```tsx
                <MediaSection settings={settings} status={statusOf('elevenlabs')} onChanged={reload} />
```

- [ ] **Step 2: Settings — shared-key hint in the TTS section**

Current (in `TtsSection`):

```tsx
          hint={provider === 'gemini' && settings.llmProvider === 'gemini' ? 'Kunci ini dipakai bersama dengan penyusun cerita Gemini.' : undefined}
```

Replace with:

```tsx
          hint={
            provider === 'elevenlabs'
              ? 'Kunci ini dipakai bersama untuk gambar dan video.'
              : settings.llmProvider === 'gemini'
                ? 'Kunci ini dipakai bersama dengan penyusun cerita Gemini.'
                : undefined
          }
```

- [ ] **Step 3: Rewrite `src/renderer/src/pages/project/ModelSection.tsx`** (read it first, then replace the whole file with):

```tsx
import type { ReactNode } from 'react'
import { Film, Image as ImageIcon, Move, Users } from 'lucide-react'
import { effectiveResolution, getImageModel, getVideoModel, mediaModelOptions, resolutionOptions } from '@shared/media'
import type { Project } from '@shared/types'
import { ModelLogo } from '../../components/ModelLogo'
import { ModelPicker } from '../../components/ModelPicker'
import { Segmented } from '../../components/ui'

const IMAGE_OPTIONS = mediaModelOptions('image')
const VIDEO_OPTIONS = mediaModelOptions('video')

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line-2 bg-surface p-3">
      <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
        {icon}
        {title}
      </span>
      {children}
    </div>
  )
}

/** Which ElevenLabs models draw and animate this project's clips. */
export function ModelSection({
  project,
  onChange
}: {
  project: Project
  onChange: (patch: { imageModel?: string; videoModel?: string; videoResolution?: string | null }) => void
}) {
  const image = getImageModel(project.imageModel)
  const video = getVideoModel(project.videoModel)
  const resolutions = resolutionOptions(video)
  const resolution = effectiveResolution(video, project.videoResolution)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold">Model AI</span>
        <span className="text-[13px] text-muted">
          {IMAGE_OPTIONS.length} model gambar dan {VIDEO_OPTIONS.length} model video dari ElevenLabs
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card icon={<ImageIcon className="size-4" />} title="Gambar klip">
          <ModelPicker
            value={image.id}
            models={IMAGE_OPTIONS}
            renderIcon={(m) => <ModelLogo family={m.family} />}
            detail="description"
            tagFilters={['Rekomendasi', 'GPT Image', 'Nano Banana', 'Seedream', 'Perlu akses']}
            menuClassName="w-[430px]"
            onChange={(id) => onChange({ imageModel: id })}
          />
          <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-muted">
            <Users className="mt-px size-3.5 shrink-0" />
            Pakai lembar karakter, jadi wajah dan kostum tokoh tetap sama di tiap klip.
          </p>
        </Card>
        <Card icon={<Film className="size-4" />} title="Video AI">
          <ModelPicker
            value={video.id}
            models={VIDEO_OPTIONS}
            renderIcon={(m) => <ModelLogo family={m.family} />}
            detail="description"
            tagFilters={['Rekomendasi', 'Veo', 'Seedance', 'Perlu akses']}
            align="right"
            menuClassName="w-[430px]"
            onChange={(id) => onChange({ videoModel: id })}
          />
          {resolutions.length > 1 ? (
            <div className="flex items-center gap-2.5">
              <span className="shrink-0 text-[12.5px] font-medium text-ink-2">Resolusi</span>
              <Segmented
                size="sm"
                value={resolution ?? resolutions[0]}
                onChange={(v) => onChange({ videoResolution: v })}
                options={resolutions.map((r) => ({ id: r, label: r.toUpperCase() === '4K' || r.toUpperCase() === '2K' ? r.toUpperCase() : r }))}
                className="min-w-0 flex-1"
              />
            </div>
          ) : (
            resolution && <p className="text-[12.5px] text-ink-2">Resolusi {resolution} (satu-satunya pilihan model ini)</p>
          )}
          <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-muted">
            <Move className="mt-px size-3.5 shrink-0" />
            Hanya untuk klip yang kamu jadikan Video AI. Gerak kamera tetap gratis.
          </p>
        </Card>
      </div>
      <p className="text-[12.5px] text-muted">Gambar dan video memakai kredit akun ElevenLabs kamu.</p>
    </div>
  )
}
```

(Every image model in the catalog takes character sheets, so the old "Tanpa lembar karakter" branch and the `maxRefs` import are gone.)

- [ ] **Step 4: IdeaStep — import and the slimmer ModelSection call (`src/renderer/src/pages/project/IdeaStep.tsx`)**

Current:

```ts
import { getImageModel } from '@shared/higgsfield'
```

Replace with:

```ts
import { getImageModel } from '@shared/media'
```

Current:

```tsx
            <ModelSection
              project={project}
              clipCount={clipCount}
              perClip={perClip}
              onChange={(patch) => {
```

Replace with:

```tsx
            <ModelSection
              project={project}
              onChange={(patch) => {
```

(`clipCount` and `perClip` stay in IdeaStep: they are still used for the "Sekitar … klip" line and the summary.)

- [ ] **Step 5: StoryboardStep — drop the credit estimates (`src/renderer/src/pages/project/StoryboardStep.tsx`)**

Current:

```ts
import { effectiveResolution, fitDuration, getImageModel, getVideoModel } from '@shared/higgsfield'
```

Replace with:

```ts
import { effectiveResolution, fitDuration, getVideoModel } from '@shared/media'
```

Current:

```tsx
                { id: 'video', title: 'Video AI', sub: 'Higgsfield · pakai kredit', icon: <Film className="size-[22px]" />, subCls: 'text-ink-2' }
```

Replace with:

```tsx
                { id: 'video', title: 'Video AI', sub: 'ElevenLabs · pakai kredit', icon: <Film className="size-[22px]" />, subCls: 'text-ink-2' }
```

Current:

```tsx
  const [openChar, setOpenChar] = useState<string | null>(null)
  const [credits, setCredits] = useState<number | null>(null)
  const [videoCredits, setVideoCredits] = useState<number | null>(null)
  const [planning, setPlanning] = useState(false)
```

Replace with:

```tsx
  const [openChar, setOpenChar] = useState<string | null>(null)
  const [planning, setPlanning] = useState(false)
```

Delete this block (the image estimate effect):

```tsx
  useEffect(() => {
    if (project)
      void window.api.generate
        .estimate('image', getImageModel(project.imageModel).id, project.aspectRatio)
        .then((e) => setCredits(e?.credits ?? null))
  }, [project?.id, project?.imageModel, project?.aspectRatio])

```

Delete this block (the video estimate memo and effect, from the comment through the effect's closing line):

```tsx
  // Video length follows each clip's voice, so the cost is estimated per video length and summed.
  const videoLengths = useMemo(() => {
    if (!project) return ''
    const model = getVideoModel(project.videoModel)
    return stats.needVideo.map((c) => fitDuration(model, c.durationMs / 1000) ?? 5).join(',')
  }, [stats.needVideo, project?.videoModel])
  useEffect(() => {
    if (!project || !videoLengths) return setVideoCredits(null)
    const lengths = videoLengths.split(',').map(Number)
    const unique = [...new Set(lengths)]
    const model = getVideoModel(project.videoModel).id
    let live = true
    void Promise.all(unique.map((s) => window.api.generate.estimate('video', model, project.aspectRatio, s, project.videoResolution))).then((list) => {
      if (!live) return
      if (list.some((e) => e?.credits == null)) return setVideoCredits(null)
      const bySec = new Map(unique.map((s, i) => [s, list[i]!.credits]))
      setVideoCredits(lengths.reduce((n, s) => n + (bySec.get(s) ?? 0), 0))
    })
    return () => {
      live = false
    }
  }, [videoLengths, project?.aspectRatio, project?.videoResolution])

```

Current (in `makeVideos`):

```tsx
        `Setiap gambar klip dianimasikan dengan ${getVideoModel(project!.videoModel).name}, panjangnya mengikuti suara narasi klip itu.` +
        (videoCredits != null ? ` Perkiraan biaya ${Math.round(videoCredits * 10) / 10} kredit Higgsfield.` : '') +
        ' Klip yang sudah punya video tidak dibuat ulang.',
```

Replace with:

```tsx
        `Setiap gambar klip dianimasikan dengan ${getVideoModel(project!.videoModel).name}, panjangnya mengikuti suara narasi klip itu.` +
        ' Biayanya memakai kredit akun ElevenLabs kamu. Klip yang sudah punya video tidak dibuat ulang.',
```

Current (image button):

```tsx
          Generate {stats.needImg} gambar
          {credits != null && stats.needImg > 0 && (
            <span className="font-normal text-ink-2">≈ {Math.round(credits * stats.needImg * 10) / 10} kr</span>
          )}
        </Button>
```

Replace with:

```tsx
          Generate {stats.needImg} gambar
        </Button>
```

Current (video button):

```tsx
                : `Jadikan ${stats.needVideo.length} video`}
            {stats.videoRunning === 0 && videoCredits != null && stats.needVideo.length > 0 && (
              <span className="font-normal text-white/80">≈ {Math.round(videoCredits * 10) / 10} kr</span>
            )}
          </Button>
```

Replace with:

```tsx
                : `Jadikan ${stats.needVideo.length} video`}
          </Button>
```

Then run `git grep -n "useMemo\|useEffect\|fitDuration" -- src/renderer/src/pages/project/StoryboardStep.tsx`: all three must still have uses besides the import line (`stats` uses `useMemo`, other effects use `useEffect`, the clip card uses `fitDuration`). If one has none, remove it from its import.

- [ ] **Step 6: ModelPicker — remove credit sorting, the credit column, and `footerNote` (`src/renderer/src/components/ModelPicker.tsx`)**

Current:

```ts
import { ArrowDownNarrowWide, ChevronDown, RefreshCw, Search, X } from 'lucide-react'
import type { ModelOption } from '@shared/types'
import { creditLabel, relativeTime, usdLabel } from '../lib/format'
```

Replace with:

```ts
import { ChevronDown, RefreshCw, Search, X } from 'lucide-react'
import type { ModelOption } from '@shared/types'
import { relativeTime } from '../lib/format'
```

Current:

```ts
  menuClassName,
  footerNote,
  renderIcon
```

Replace with:

```ts
  menuClassName,
  renderIcon
```

Current:

```ts
  menuClassName?: string
  /** Extra text in the list footer, e.g. what the listed credits pay for. */
  footerNote?: string
  /** A mark shown before each model name, e.g. its brand logo. */
```

Replace with:

```ts
  menuClassName?: string
  /** A mark shown before each model name, e.g. its brand logo. */
```

Delete the line:

```ts
  const [cheapFirst, setCheapFirst] = useState(false)
```

Current:

```ts
  // Higgsfield lists carry credit estimates (creditUnit marks them); known prices can be sorted cheapest first.
  const priced = models.some((m) => m.credits != null)

  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const list = models.filter((m) => matches(m, words) && tags.every((t) => m.tags.includes(t)))
    if (!cheapFirst) return list
    return [...list].sort((a, b) => (a.credits ?? Infinity) - (b.credits ?? Infinity))
  }, [models, query, tags, cheapFirst])
```

Replace with:

```ts
  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return models.filter((m) => matches(m, words) && tags.every((t) => m.tags.includes(t)))
  }, [models, query, tags])
```

Current:

```ts
  useEffect(() => setActive(0), [query, tags, cheapFirst])
```

Replace with:

```ts
  useEffect(() => setActive(0), [query, tags])
```

Current:

```tsx
            {(allTags.length > 0 || priced) && (
```

Replace with:

```tsx
            {allTags.length > 0 && (
```

Delete this block (the "Termurah dulu" toggle):

```tsx
                {priced && (
                  <button
                    type="button"
                    aria-pressed={cheapFirst}
                    onClick={() => setCheapFirst(!cheapFirst)}
                    className={cx(
                      'ml-auto inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium',
                      cheapFirst ? 'border-ink bg-ink text-paper' : 'border-line-2 text-ink-2 hover:border-ink-2'
                    )}
                  >
                    <ArrowDownNarrowWide className="size-3.5" />
                    Termurah dulu
                  </button>
                )}
```

Delete this block (the credit column in each row):

```tsx
                    {m.creditUnit !== undefined &&
                      (m.credits === undefined ? (
                        <Spinner className="mt-1 size-3.5 text-muted" />
                      ) : m.credits === null ? (
                        <span className="text-muted" title="Higgsfield tidak memberi perkiraan untuk model ini">
                          —
                        </span>
                      ) : (
                        <>
                          <span className="font-mono text-[12.5px] font-semibold text-ink">{creditLabel(m.credits)} kr</span>
                          <span className="font-mono text-muted">{[m.creditUnit, m.usd != null && usdLabel(m.usd)].filter(Boolean).join(' · ')}</span>
                        </>
                      ))}
```

Delete the line:

```tsx
              {footerNote && ` · ${footerNote}`}
```

(`Spinner` stays imported: the loading states still use it.)

- [ ] **Step 7: Remove the estimate hook, credit formatters, and credit types**

Run: `git rm src/renderer/src/lib/useEstimate.ts`

In `src/renderer/src/lib/format.ts`, delete:

```ts
/** Higgsfield credits: whole numbers from 10 up, one decimal below. */
export function creditLabel(n: number): string {
  return (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('id-ID')
}

export function usdLabel(n: number): string {
  return `US$${n.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 })}`
}
```

(and the blank line left above it at the end of the file, so the file ends right after `errorText`).

In `src/shared/types.ts`, delete:

```ts
/** What one Higgsfield request would cost, from the API's estimate endpoint. */
export interface CreditEstimate {
  credits: number
  usd: number | null
}

```

and in `ModelOption`, current:

```ts
  /** Model family, e.g. "Kling", for a brand mark next to the name. */
  family?: string
  /** Higgsfield credits (and dollars) for one request; undefined while unknown, null when it cannot be estimated. */
  credits?: number | null
  usd?: number | null
  /** What the credits pay for, e.g. "10 dtk". */
  creditUnit?: string
}
```

Replace with:

```ts
  /** Model family, e.g. "Veo", for a brand mark next to the name. */
  family?: string
}
```

- [ ] **Step 8: Home, Inspector, About texts**

`src/renderer/src/pages/Home.tsx` current:

```ts
    if (!ok('higgsfield')) issues.push({ what: 'kunci Higgsfield', blocks: 'gambar' })
```

Replace with:

```ts
    if (!ok('elevenlabs')) issues.push({ what: 'kunci ElevenLabs', blocks: 'gambar dan video' })
```

`src/renderer/src/pages/project/editor/Inspector.tsx` current:

```tsx
<p className="text-[13px] text-ink-2">Klip ini memakai video dari Higgsfield.</p>
```

Replace with:

```tsx
<p className="text-[13px] text-ink-2">Klip ini memakai video dari ElevenLabs.</p>
```

`src/renderer/src/pages/AboutSection.tsx` current:

```tsx
        Logo Gemini, OpenRouter, Groq, ElevenLabs, dan Higgsfield adalah merek milik pemiliknya masing-masing, dipakai hanya untuk menandai layanan yang
        terhubung. Ikon penyedia berasal dari LobeHub Icons (lisensi MIT).
```

Replace with:

```tsx
        Logo Gemini, OpenRouter, Groq, ElevenLabs, OpenAI, dan ByteDance adalah merek milik pemiliknya masing-masing, dipakai hanya untuk menandai
        layanan dan model yang terhubung. Ikon penyedia berasal dari LobeHub Icons (lisensi MIT).
```

- [ ] **Step 9: ProviderLogo (`src/renderer/src/components/ProviderLogo.tsx`)**

Current:

```ts
 * Brand marks of the services the app connects to. Gemini, OpenRouter, Groq and ElevenLabs come from
 * LobeHub Icons (MIT); the Higgsfield mark is its official app icon. Logos belong to their owners.
```

Replace with:

```ts
 * Brand marks of the services the app connects to, from LobeHub Icons (MIT). Logos belong to their owners.
```

Current:

```ts
export type ProviderLogoId = 'gemini' | 'openrouter' | 'groq' | 'elevenlabs' | 'higgsfield' | 'custom'
```

Replace with:

```ts
export type ProviderLogoId = 'gemini' | 'openrouter' | 'groq' | 'elevenlabs' | 'custom'
```

Delete the line:

```ts
  higgsfield: { bg: '#D1FE17', src: 'higgsfield.png', inset: 0 },
```

- [ ] **Step 10: Rewrite `src/renderer/src/components/ModelLogo.tsx`** (read it first, then replace the whole file with):

```tsx
import { cx } from './cx'

/**
 * Brand marks for the ElevenLabs image and video model families (from LobeHub Icons, MIT; the marks belong to their
 * owners). Google's Nano Banana and Veo share the Gemini mark; Seedream and Seedance use ByteDance's.
 */
const FILES = import.meta.glob(['../assets/models/*.svg', '../assets/providers/gemini.svg'], { eager: true, import: 'default' }) as Record<string, string>
const file = (path: string): string | undefined => FILES[`../assets/${path}`]

const FAMILY_LOGO: Record<string, { src: string; bg: string; inset: number }> = {
  'GPT Image': { src: 'models/openai.svg', bg: '#FFFFFF', inset: 0.2 },
  'Nano Banana': { src: 'providers/gemini.svg', bg: '#FFFFFF', inset: 0.2 },
  Veo: { src: 'providers/gemini.svg', bg: '#FFFFFF', inset: 0.2 },
  Seedream: { src: 'models/bytedance-color.svg', bg: '#FFFFFF', inset: 0.18 },
  Seedance: { src: 'models/bytedance-color.svg', bg: '#FFFFFF', inset: 0.18 }
}

export function ModelLogo({ family, size = 30, className }: { family?: string; size?: number; className?: string }) {
  const look = family ? FAMILY_LOGO[family] : undefined
  const src = look && file(look.src)
  const inner = Math.round(size * (1 - (look?.inset ?? 0) * 2))
  return (
    <span
      className={cx('flex shrink-0 items-center justify-center overflow-hidden border border-line-2 font-bold text-ink-2', className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26), background: look?.bg ?? '#F3EFE8', fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" draggable={false} style={{ width: inner, height: inner }} className="object-contain" /> : (family ?? '?').slice(0, 1)}
    </span>
  )
}
```

- [ ] **Step 11: Delete the old shared catalog** (nothing imports it after Steps 1–5 and Task 3)

Run: `git grep -n "@shared/higgsfield\|higgsfield-catalog" -- src`
Expected: no output.

Run: `git rm src/shared/higgsfield.ts src/shared/higgsfield-catalog.json`

- [ ] **Step 12: Delete logo files nothing references any more**

Run: `git grep -n -l "alibaba-color\|grok.svg\|hailuo-color\|ideogram.svg\|kling-color\|lightricks.svg\|minimax-color\|pixverse-color\|qwen-color\|recraft.svg\|higgsfield.png" -- src`
Expected: no output.

Run:

```bash
git rm src/renderer/src/assets/providers/higgsfield.png src/renderer/src/assets/models/alibaba-color.svg src/renderer/src/assets/models/grok.svg src/renderer/src/assets/models/hailuo-color.svg src/renderer/src/assets/models/ideogram.svg src/renderer/src/assets/models/kling-color.svg src/renderer/src/assets/models/lightricks.svg src/renderer/src/assets/models/minimax-color.svg src/renderer/src/assets/models/pixverse-color.svg src/renderer/src/assets/models/qwen-color.svg src/renderer/src/assets/models/recraft.svg
```

Expected: `src/renderer/src/assets/models/` keeps only `openai.svg` and `bytedance-color.svg`.

- [ ] **Step 13: Full verification**

Run: `npm run typecheck`
Expected: PASS (both node and web).

Run: `npm run build`
Expected: PASS, output in `out/`.

Run: `node <scratchpad>/check-media.ts`
Expected: `media catalog: all checks passed`

Run: `git grep -n -i "higgsfield\|hfModelOptions\|HF_IMAGE\|HF_VIDEO\|CreditEstimate\|creditLabel\|generate.estimate\|STUDIO_HF_BASE" -- src`
Expected: only the migration lines in `src/main/db/index.ts` and the comment in `src/main/settings.ts`.

- [ ] **Step 14: Commit Tasks 3 and 4 together**

Run `git status` first: other agents may have changed files (for example `package-lock.json`); do not stage those.

Files deleted with `git rm` in Task 3 Step 15 and Task 4 Steps 7, 11, 12 are already staged; do not pass them to `git add` (a missing path makes the whole `git add` fail).

```bash
git add src/main/generation.ts src/main/jobs.ts src/main/ipc.ts src/main/secrets.ts src/main/settings.ts src/main/db/index.ts src/preload/index.ts src/shared/api.ts src/shared/types.ts src/shared/models.ts src/renderer/src/pages/Settings.tsx src/renderer/src/pages/project/ModelSection.tsx src/renderer/src/pages/project/IdeaStep.tsx src/renderer/src/pages/project/StoryboardStep.tsx src/renderer/src/components/ModelPicker.tsx src/renderer/src/components/ModelLogo.tsx src/renderer/src/components/ProviderLogo.tsx src/renderer/src/pages/Home.tsx src/renderer/src/pages/project/editor/Inspector.tsx src/renderer/src/pages/AboutSection.tsx src/renderer/src/lib/format.ts
git diff --cached --stat
git commit -m "feat(media): replace Higgsfield with ElevenLabs image and video generation"
```

---

### Task 5: Documentation, development history, final checks, push

**Files:**
- Modify: `AGENTS.md`, `README.md`, `CHANGELOG.md`, `docs/README.md`, `docs/arsitektur.md`, `docs/data-model.md`, `docs/alur-produksi.md`, `docs/editor-dan-ekspor.md`, `docs/konvensi.md`, `docs/pengembangan.md`, `docs/layanan-ai.md`, `docs/keputusan-teknis.md`, `docs/masalah-diketahui.md`
- Create: `.development-history/2026-10-10-HH-mm-replace-higgsfield-with-elevenlabs.md` (HH-mm = local time when written)

**Interfaces:**
- Consumes: the names shipped in Tasks 1–4 (`src/shared/media.ts`, `src/main/services/elevenMedia.ts`, queue `media`, `STUDIO_ELEVEN_BASE`, `checkAccess`).
- Produces: documentation only.

Docs are Indonesian, plain and factual. Each edit below is an exact replacement of the quoted text. In the
replacement tables, `\|` stands for a literal `|` in the file, and a cell wrapped in double backticks is the text
between them (without the outer backticks and spaces).

- [ ] **Step 1: `AGENTS.md`**

| Current | Replace with |
|---|---|
| `AI menulis naskah dan rencana visual, Higgsfield membuat gambar dan video, Gemini atau ElevenLabs membuat suara` | `AI menulis naskah dan rencana visual, ElevenLabs membuat gambar dan video, Gemini atau ElevenLabs membuat suara` |
| `    generation.ts  gambar/video Higgsfield, lembar karakter, TTS per klip, estimasi kredit` | `    generation.ts  gambar/video ElevenLabs, lembar karakter, TTS per klip` |
| `    services/      klien API: gemini, elevenlabs, higgsfield, llm (OpenAI-compatible), audio, http` | `    services/      klien API: gemini, elevenlabs (suara), elevenMedia (gambar/video), llm (OpenAI-compatible), audio, http` |
| `` `timeline.ts` (potongan suara/musik, kata caption per klip), `overlays.ts`, `higgsfield.ts`. `` | `` `timeline.ts` (potongan suara/musik, kata caption per klip), `overlays.ts`, `media.ts`. `` |

- [ ] **Step 2: `README.md` — single lines**

| Current | Replace with |
|---|---|
| `AI menyusun naskah dan visual, Higgsfield membuat gambar dan video, narator AI mengisi suara,<br>` | `AI menyusun naskah dan visual, ElevenLabs membuat gambar dan video, narator AI mengisi suara,<br>` |
| `- Pilih model gambar dan video Higgsfield per proyek, lengkap dengan perkiraan kredit.` | `- Pilih model gambar dan video ElevenLabs per proyek.` |
| `- Tersedia 14 model gambar dan 34 model video dari Higgsfield.` | `- Tersedia 9 model gambar (GPT Image, Nano Banana, Seedream) dan 6 model video (Veo, Seedance) dari ElevenLabs.` |
| `  - Higgsfield;` | `  - ElevenLabs paket Pro ke atas, untuk gambar dan video;` |
| `- kredit Higgsfield untuk gambar dan video;` | `- kredit ElevenLabs untuk gambar dan video (paket Pro ke atas);` |
| `\| Layanan AI \| Higgsfield, Google Gemini, OpenRouter, Groq, ElevenLabs \|` | `\| Layanan AI \| ElevenLabs, Google Gemini, OpenRouter, Groq \|` |
- [ ] **Step 3: `README.md` — key table, cost answer, Seedream answer**

Current:

```markdown
| [Higgsfield](https://higgsfield.ai) (satu kunci dari tombol **Copy API key**, format `KEY_ID:KEY_SECRET`) | Gambar, lembar karakter, video AI | Ya |
```

Replace with:

```markdown
| [ElevenLabs](https://elevenlabs.io/app/settings/api-keys) (paket Pro ke atas, kunci dengan izin **Image & Video**) | Gambar, lembar karakter, video AI, dan suara narator ElevenLabs | Ya |
```

Delete the row (now covered by the row above):

```markdown
| ElevenLabs | Suara narator dengan waktu per kata yang presisi | Opsional |
```

Current:

```markdown
Perkiraan kredit tiap model Higgsfield ditampilkan sebelum membuat gambar atau video. Perkiraannya diambil dari endpoint `estimate` Higgsfield, yang tidak memakai kredit.
```

Replace with:

```markdown
Aplikasi tidak menampilkan perkiraan kredit karena API ElevenLabs tidak menyediakannya. Biaya tiap model bisa kamu lihat di aplikasi web ElevenLabs sebelum membuat gambar atau video.
```

Current:

```markdown
<summary><b>Kenapa model Seedream tidak ada?</b></summary>

Seedream belum tersedia di API Higgsfield, hanya di aplikasi web mereka. Model bawaannya:
- gambar: GPT Image 2.5 Sunburst;
- video: Kling 3.0 Standard.
```

Replace with:

```markdown
<summary><b>Kenapa model Seedream dan Seedance tidak bisa dipakai?</b></summary>

Model ByteDance (Seedream dan Seedance) dikunci ElevenLabs sampai akunmu disetujui. Selama belum disetujui, pakai model lain. Model bawaannya:
- gambar: GPT Image 2.5 Sunburst;
- video: Veo 3.1 Fast.
```

- [ ] **Step 4: `CHANGELOG.md`**

Current:

```markdown
## [Belum dirilis]

## [1.0.0] - 2026-10-02
```

Replace with:

```markdown
## [Belum dirilis]

### Diubah
- Gambar klip, lembar karakter, dan video AI sekarang dibuat lewat ElevenLabs, memakai kunci yang sama dengan suara
  narator. Butuh paket ElevenLabs Pro ke atas dan kunci dengan izin Image & Video.
- Pilihan model: 9 model gambar (GPT Image, Nano Banana, Seedream) dan 6 model video (Veo, Seedance). Seedream dan
  Seedance baru bisa dipakai setelah ElevenLabs membuka aksesnya. Proyek lama otomatis memakai model bawaan baru.

### Dihapus
- Higgsfield. Kunci Higgsfield yang tersimpan dihapus saat aplikasi diperbarui.
- Perkiraan kredit di pemilih model dan storyboard, karena API ElevenLabs tidak menyediakannya.

## [1.0.0] - 2026-10-02
```

- [ ] **Step 5: `docs/README.md`, `docs/alur-produksi.md`, `docs/editor-dan-ekspor.md`**

| File | Current | Replace with |
|---|---|---|
| `docs/README.md` | `\| [layanan-ai.md](layanan-ai.md) \| LLM, TTS, Higgsfield, Whisper, YouTube embed, kunci API, cara menambah penyedia/model \|` | `\| [layanan-ai.md](layanan-ai.md) \| LLM, TTS, gambar dan video ElevenLabs, Whisper, YouTube embed, kunci API, cara menambah penyedia/model \|` |
| `docs/alur-produksi.md` | `   Lembar karakter (Higgsfield)          Gambar klip (Higgsfield)       Narasi satu rekaman (TTS)` | `   Lembar karakter (ElevenLabs)          Gambar klip (ElevenLabs)       Narasi satu rekaman (TTS)` |
| `docs/editor-dan-ekspor.md` | ``\| `higgsfield.ts` \| body permintaan model, durasi, resolusi \| ModelSection \| generation \|`` | ``\| `media.ts` \| body permintaan model, durasi, resolusi \| ModelSection \| generation \|`` |

("Higgsfield" and "ElevenLabs" are both 10 characters, so the ASCII diagram stays aligned.)

- [ ] **Step 6: `docs/arsitektur.md`**

| Current | Replace with |
|---|---|
| `` \| AI \| Gemini (`@google/genai`), API OpenAI-compatible (OpenRouter, Groq, custom), ElevenLabs, Higgsfield \| `` | `` \| AI \| Gemini (`@google/genai`), API OpenAI-compatible (OpenRouter, Groq, custom), ElevenLabs (suara, gambar, video) \| `` |
| `` \| `generate:*` \| clipImage, clipVideo, clipTts, characterSheet, missingImages, missingVideos, missingTts, narration, syncCaptions, cancel, estimate \| job AI dan estimasi kredit \| `` | `` \| `generate:*` \| clipImage, clipVideo, clipTts, characterSheet, missingImages, missingVideos, missingTts, narration, syncCaptions, cancel \| job AI \| `` |
| ``\| `higgsfield` \| 3 \| gambar, lembar karakter, video \|`` | ``\| `media` \| 3 \| gambar, lembar karakter, video (ElevenLabs) \|`` |
| `` `resumeJobs()` melanjutkan permintaan Higgsfield yang sudah terkirim; job lain yang terputus ditandai gagal. `` | `` `resumeJobs()` melanjutkan polling generation ElevenLabs yang sudah terkirim; job lain yang terputus ditandai gagal. `` |

- [ ] **Step 7: `docs/data-model.md`**

| Current | Replace with |
|---|---|
| ``\| `cache` \| cache bebas (daftar model, estimasi kredit, daftar suara), dengan `updated_at` \|`` | ``\| `cache` \| cache bebas (daftar model, daftar suara), dengan `updated_at` \|`` |
| `model Higgsfield per proyek (null = bawaan aplikasi)` | `model gambar/video ElevenLabs per proyek (null atau ID yang tidak dikenal = bawaan aplikasi)` |
| ``\| `remoteId`, `remoteUrl` \| ID permintaan dan URL hasil di Higgsfield \|`` | ``\| `remoteId`, `remoteUrl` \| ID generation ElevenLabs; `remoteUrl` dikosongkan karena URL hasil hanya berlaku sekitar 1 jam \|`` |

Then current:

```markdown
`meta.uploadedUrl`/`uploadedAt` dipakai untuk menggunakan ulang file yang sudah diunggah ke Higgsfield.

Narasi dianggap
```

Replace with:

```markdown
Narasi dianggap
```

- [ ] **Step 8: `docs/konvensi.md`**

Current:

```markdown
  menjelaskan apa yang terjadi dan apa yang bisa dilakukan, misalnya: "Kredit Higgsfield tidak cukup. Isi ulang
  di dashboard Higgsfield."
```

Replace with:

```markdown
  menjelaskan apa yang terjadi dan apa yang bisa dilakukan, misalnya: "Kredit ElevenLabs tidak cukup. Isi ulang
  atau naikkan paket di ElevenLabs."
```

Current:

```markdown
   ditampilkan. Kunci Higgsfield cukup satu kolom (format `KEY_ID:KEY_SECRET` dari tombol "Copy API key").
```

Replace with:

```markdown
   ditampilkan. Kunci yang dipakai beberapa bagian (Gemini, ElevenLabs) diberi catatan "dipakai bersama".
```

- [ ] **Step 9: `docs/pengembangan.md`**

Current:

```markdown
| `STUDIO_HF_BASE` | base URL Higgsfield tiruan (mock) supaya UI bisa diuji tanpa kredit |
```

Replace with:

```markdown
| `STUDIO_ELEVEN_BASE` | base URL ElevenLabs tiruan (mock) untuk suara, gambar, dan video, supaya UI bisa diuji tanpa kredit |
```

Current:

```markdown
2. Di rencana harness, isi kunci palsu (`{"main":"key","provider":"higgsfield","ok":true}`, juga untuk penyedia
   lain) supaya banner "atur kunci" tidak muncul. Set `STUDIO_HF_BASE=http://127.0.0.1:9` agar aplikasi tidak
   mengirim kunci palsu itu ke Higgsfield.
```

Replace with:

```markdown
2. Di rencana harness, isi kunci palsu (`{"main":"key","provider":"elevenlabs","ok":true}`, juga untuk penyedia
   lain) supaya banner "atur kunci" tidak muncul. Set `STUDIO_ELEVEN_BASE=http://127.0.0.1:9` agar aplikasi tidak
   mengirim kunci palsu itu ke ElevenLabs.
```

- [ ] **Step 10: `docs/layanan-ai.md` — key notes and provider table**

Delete the line:

```markdown
- Mengganti kunci Higgsfield menghapus cache estimasi kredit (`forgetEstimates`).
```

Delete the table row:

```markdown
| `higgsfield` | gambar, lembar karakter, video |
```

Current:

```markdown
| `elevenlabs` | TTS |
```

Replace with:

```markdown
| `elevenlabs` | TTS, gambar, lembar karakter, video |
```

- [ ] **Step 11: `docs/layanan-ai.md` — replace the Higgsfield section**

Replace everything from the line `## Higgsfield (`services/higgsfield.ts`, `shared/higgsfield.ts`)` up to (not including) the next line that starts with `## ` (or the end of the file if there is none) with:

````markdown
## ElevenLabs gambar dan video (`services/elevenMedia.ts`, `shared/media.ts`)

- Memakai kunci `elevenlabs` yang sama dengan TTS, header `xi-api-key`, dan base URL `BASE` dari
  `services/elevenlabs.ts`. Butuh paket Pro ke atas dan kunci dengan izin *Image & Video* (atau *Flows*).
- Alur: `submit(kind, body)` → `POST /v1/flows/{image|video}` mengembalikan `id` → `waitForResult` memanggil
  `GET /v1/flows/{image|video}/{id}` sampai `completed` atau `failed` → hasil diunduh dari `content_url`.
- Jeda polling: gambar mulai 2 detik dan video mulai 10 detik (batas minimum dari ElevenLabs), naik 1,5× sampai 10
  dan 30 detik. Batas waktu 15 menit untuk gambar dan 30 menit untuk video.
- `content_url` adalah URL bertanda tangan yang berlaku sekitar 1 jam, jadi tidak disimpan. `remoteId` aset berisi
  ID generation.
- Lembar karakter dan gambar awal video dikirim sebagai `{ type: "inline_base64", content_base64, mime_type }`
  (PNG, JPG, atau WEBP, maksimal 25 MB). Tidak ada unggahan terpisah dan tidak ada file yang tersimpan di akun
  pengguna.
- `submit` hanya mencoba ulang saat 429. Polling mencoba ulang 429, 5xx, dan gangguan jaringan sampai 8 kali.
- Tidak ada endpoint estimasi biaya dan tidak ada endpoint pembatalan. Membatalkan job hanya menghentikan aplikasi
  menunggu; ElevenLabs tetap menyelesaikan dan menagih generation itu.
- Tes kunci (`settings:setKey`) memanggil `testKey` (TTS), lalu `checkAccess`, yaitu `GET /v1/flows/image?page_size=1`
  yang gratis. Hasilnya ditambahkan ke pesan status kunci.
- Pesan error (`friendly`): kunci tanpa izin (401), `paid_plan_required`, kredit habis (402),
  `model_access_denied`, pengaturan ditolak (422), sibuk (429), server bermasalah (5xx). `failure_reason` dari hasil
  yang gagal (`moderated`, `timeout`, `charging_failed`, `invalid_parameters`, dan lainnya) juga diterjemahkan.
- Untuk pengembangan, `STUDIO_ELEVEN_BASE` bisa diarahkan ke server tiruan (mock) supaya UI bisa diuji tanpa kredit.
  Variabel ini juga berlaku untuk TTS ElevenLabs.

### Katalog model (`src/shared/media.ts`)

Ditulis tangan dari referensi API (`/docs/api-reference/flows/image/create` dan `/flows/video/create` di
elevenlabs.io). API menolak field yang tidak dikenal model, jadi setiap entri mencatat persis apa yang diterima model
itu:

- `refs`: jumlah lembar karakter yang muat di `images` (model gambar).
- `resolutions`, `qualities`: nilai `resolution` dan `quality` yang diterima. Kosong berarti field tidak dikirim.
- `durations`: daftar (`values`) atau rentang (`min`/`max`) `duration_secs` video.
- `autoAspect`: Seedance memakai `aspect_ratio: "auto"`, rasio diambil dari gambar awal.
- `enhanceSwitch`: Veo menerima `enhance_prompt: false`.
- `gated`: model ByteDance (Seedream, Seedance) baru bisa dipakai setelah ElevenLabs membuka aksesnya. Diberi tag
  `Perlu akses`.

Semua video dimulai dari gambar klip (`start_frame`) dengan `generate_audio: false`. Model bawaan:
`DEFAULT_IMAGE_MODEL` (`gpt-image-2.5-sunburst`) dan `DEFAULT_VIDEO_MODEL` (`veo-3.1-fast-generate-001`). ID yang
tidak dikenal, misalnya model dari versi lama, jatuh ke model bawaan saat dibaca.

**Menambah model**: tambahkan satu baris `image(...)` atau `video(...)` di `MODELS`, isi field persis seperti di
referensi API, lalu jalankan `npm run typecheck`. Ikon keluarga model diatur di `components/ModelLogo.tsx`.

````

- [ ] **Step 12: `docs/keputusan-teknis.md`**

Current:

```markdown
### Prompt video selalu melarang musik
Beberapa model video (Veo, Grok, MiniMax) membuat musik sendiri tanpa saklar. Setiap prompt diakhiri `NO_MUSIC`,
dan audio dimatikan lewat parameter kalau modelnya punya. Audio dari file video tidak pernah dipakai di ekspor.
```

Replace with:

```markdown
### Prompt video selalu melarang musik
Model video bisa membuat musik sendiri. Permintaan ke ElevenLabs selalu mengirim `generate_audio: false`, dan setiap
prompt tetap diakhiri `NO_MUSIC` sebagai pengaman kalau ada model yang mengabaikan saklar itu. Audio dari file video
tidak pernah dipakai di ekspor.
```

Append at the end of the file (after its last line, separated by one blank line):

```markdown
### Gambar dan video lewat ElevenLabs, referensi dikirim inline
Higgsfield diganti API Image & Video ElevenLabs supaya satu kunci cukup untuk suara, gambar, dan video. Lembar
karakter dan gambar awal video dikirim sebagai `inline_base64`, bukan diunggah lewat `POST /v1/assets`: tidak ada
langkah unggah, tidak ada URL kedaluwarsa yang perlu dilacak, dan tidak ada file yang memakan kuota penyimpanan akun
pengguna. Batasnya 25 MB per gambar, jauh di atas ukuran gambar 2K.

### Tidak ada perkiraan kredit untuk gambar dan video
API ElevenLabs tidak punya endpoint estimasi biaya, dan biayanya berubah menurut model, resolusi, durasi, dan audio.
Tabel harga buatan sendiri akan cepat usang, jadi aplikasi tidak menampilkan angka kredit. Biaya per model bisa
dilihat di aplikasi web ElevenLabs.

### Seedance memakai `aspect_ratio: "auto"`
Seedance 2.5 selalu memakai `auto` untuk tugas yang dimulai dari gambar awal. Gambar klip sudah dibuat dengan rasio
proyek, jadi semua varian Seedance memakai `auto` agar aturannya sama dan permintaan tidak ditolak.

### Permintaan baru hanya dicoba ulang saat 429
Setiap generation yang sudah dimulai ditagih, dan ElevenLabs tidak mendokumentasikan idempotency key. Mengulang
`POST` setelah 5xx atau koneksi putus bisa memulai generation kedua. Hanya 429 yang dicoba ulang, karena permintaan
itu pasti ditolak sebelum berjalan. Polling (`GET`) aman diulang.
```

- [ ] **Step 13: `docs/masalah-diketahui.md`**

Current:

```markdown
| Tidak semua model sudah diuji langsung | Katalog Higgsfield berisi 48 model; sebagian besar baru diuji lewat body permintaan, belum lewat generate sungguhan. Penyedia LLM selain Gemini juga belum semuanya diuji. | Uji model yang sering dipakai, lalu catat model yang bermasalah. |
```

Replace with:

```markdown
| Tidak semua model sudah diuji langsung | Katalog ElevenLabs (9 model gambar, 6 model video) disusun dari referensi API dan baru diuji lewat body permintaan, belum lewat generate sungguhan. Penyedia LLM selain Gemini juga belum semuanya diuji. | Uji model yang sering dipakai, lalu catat model yang bermasalah. |
| Gambar dan video butuh paket ElevenLabs Pro | Akun di bawah Pro ditolak dengan `paid_plan_required`. Tes kunci memanggil `GET /v1/flows/image` untuk mendeteksinya, tapi belum dipastikan endpoint daftar itu juga dibatasi paket. | Kalau tes kunci bilang siap tapi generate ditolak, ubah `checkAccess` (misalnya cek `tier` dari `/v1/user/subscription`). |
| Batal tidak menghentikan tagihan | API tidak punya endpoint pembatalan, jadi tombol batal hanya membuat aplikasi berhenti menunggu. Generation di ElevenLabs tetap selesai dan ditagih. | Pakai endpoint pembatalan kalau ElevenLabs menambahkannya. |
| Seedream dan Seedance perlu persetujuan | Model ByteDance dikunci sampai ElevenLabs menyetujui akun (`model_access_denied`). | Pesan error sudah menjelaskannya; pengguna memilih model lain atau meminta akses ke ElevenLabs. |
```

- [ ] **Step 14: Development history report**

Create `.development-history/2026-10-10-HH-mm-replace-higgsfield-with-elevenlabs.md` (create the folder if it does not exist; HH-mm = current local time). Fill the Verification lines with the real results from Task 4 Step 13 and Step 15 below; if any differ from "passes", write what happened.

```markdown
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

- `node <scratchpad>/check-media.ts`: passes
- `npm run typecheck`: passes
- `npm run build`: passes
- leftover grep: only the allowed hits

## Limitations

- No live ElevenLabs request was made. Seedream and Seedance need ElevenLabs approval. Cancel does not stop billing.

## Follow-up

- Generate one image and one video with a Pro key, with the user's approval.
```

- [ ] **Step 15: Final leftover grep over the whole repo**

Run: `git grep -n -i "higgsfield\|STUDIO_HF_BASE\|hfModelOptions" -- . ':!docs/superpowers' ':!.development-history'`
Expected hits, and nothing else:
- `CHANGELOG.md`: the new "Dihapus" lines and the historical 1.0.0 entry.
- `docs/keputusan-teknis.md`: the new entry "Higgsfield diganti API Image & Video ElevenLabs …".
- `src/main/db/index.ts`: the cleanup migration.
- `src/main/settings.ts`: the fallback comment.

Fix any other hit in the same style as the steps above.

- [ ] **Step 16: Commit the docs and push**

```bash
git status
git add AGENTS.md README.md CHANGELOG.md docs/README.md docs/arsitektur.md docs/data-model.md docs/alur-produksi.md docs/editor-dan-ekspor.md docs/konvensi.md docs/pengembangan.md docs/layanan-ai.md docs/keputusan-teknis.md docs/masalah-diketahui.md .development-history/
git diff --cached --stat
git commit -m "docs: document ElevenLabs image and video in place of Higgsfield"
git push
```

Expected: `git push` updates `origin/main` with the spec commit and the commits from Tasks 1, 2, 4, and 5. If the push fails (auth, rejected), stop and report it instead of forcing.

---

## Appendix A — `src/shared/media.ts`

```ts
import type { AspectRatio, ModelOption } from './types'

/**
 * Every ElevenLabs model that can draw a clip image or animate one (POST /v1/flows/image and /v1/flows/video).
 * The API rejects fields a model does not know, so each entry lists exactly what that model accepts.
 * Source: elevenlabs.io/docs/api-reference/flows/image/create and /flows/video/create.
 */

/** A picture sent inside a request. Inline bytes need no upload step and leave nothing stored in the workspace. */
export interface ImageRef {
  type: 'inline_base64'
  content_base64: string
  mime_type: string
}

export interface MediaModel {
  id: string
  name: string
  family: string
  kind: 'image' | 'video'
  /** How many character sheets an image model takes in `images`. */
  refs: number
  /** Accepted `resolution` values. Empty when the request leaves resolution to the model. */
  resolutions: string[]
  /** Accepted `quality` values (GPT Image only). */
  qualities: string[]
  durations: { values: number[] } | { min: number; max: number } | null
  /** Seedance reads the frame shape from the start frame instead of an explicit ratio. */
  autoAspect: boolean
  /** Veo rewrites prompts unless `enhance_prompt` is switched off. */
  enhanceSwitch: boolean
  /** ByteDance models stay locked until ElevenLabs approves the workspace. */
  gated: boolean
  tags: string[]
}

export const ACCESS_TAG = 'Perlu akses'

const GPT_25_QUALITY = ['low', 'medium', 'high', 'xhigh', 'max']

function image(id: string, name: string, family: string, refs: number, resolutions: string[], more: Partial<MediaModel> = {}): MediaModel {
  return { id, name, family, kind: 'image', refs, resolutions, qualities: [], durations: null, autoAspect: false, enhanceSwitch: false, gated: false, tags: [family], ...more }
}

function video(id: string, name: string, family: string, durations: MediaModel['durations'], resolutions: string[], more: Partial<MediaModel> = {}): MediaModel {
  return { id, name, family, kind: 'video', refs: 0, resolutions, qualities: [], durations, autoAspect: false, enhanceSwitch: false, gated: false, tags: [family], ...more }
}

const SEEDANCE: Partial<MediaModel> = { autoAspect: true, gated: true }

const MODELS: MediaModel[] = [
  image('gpt-image-2.5-sunburst', 'GPT Image 2.5 · Sunburst', 'GPT Image', 10, ['1K', '2K', '4K'], { qualities: GPT_25_QUALITY, tags: ['GPT Image', '4K'] }),
  image('gpt-image-2.5-flare', 'GPT Image 2.5 · Flare', 'GPT Image', 10, ['1K', '2K', '4K'], { qualities: GPT_25_QUALITY, tags: ['GPT Image', '4K'] }),
  image('gpt-image-2', 'GPT Image 2', 'GPT Image', 10, ['1K', '2K', '4K'], { qualities: ['low', 'medium', 'high'], tags: ['GPT Image', '4K'] }),
  image('gemini-3-pro-image', 'Nano Banana Pro', 'Nano Banana', 10, ['1K', '2K', '4K'], { tags: ['Nano Banana', '4K'] }),
  image('gemini-3.1-flash-image', 'Nano Banana 2', 'Nano Banana', 14, ['512', '1K', '2K', '4K'], { tags: ['Nano Banana', '4K'] }),
  image('gemini-3.1-flash-lite-image', 'Nano Banana 2 Lite', 'Nano Banana', 14, []),
  image('gemini-2.5-flash-image', 'Nano Banana', 'Nano Banana', 5, []),
  image('bytedance-seedream-5-pro', 'Seedream 5 Pro', 'Seedream', 10, ['1K', '2K'], { gated: true, tags: ['Seedream', ACCESS_TAG] }),
  image('bytedance-seedream-5-lite', 'Seedream 5 Lite', 'Seedream', 10, ['2K', '3K'], { gated: true, tags: ['Seedream', ACCESS_TAG] }),
  video('veo-3.1-fast-generate-001', 'Veo 3.1 Fast', 'Veo', { values: [4, 6, 8] }, ['720p', '1080p', '4K'], { enhanceSwitch: true, tags: ['Veo', '4K'] }),
  video('veo-3.1-generate-001', 'Veo 3.1', 'Veo', { values: [4, 6, 8] }, ['720p', '1080p', '4K'], { enhanceSwitch: true, tags: ['Veo', '4K'] }),
  video('bytedance-seedance-v2', 'Seedance 2.0', 'Seedance', { min: 4, max: 15 }, ['480p', '720p', '1080p', '4k'], { ...SEEDANCE, tags: ['Seedance', '4K', ACCESS_TAG] }),
  video('bytedance-seedance-v2-fast', 'Seedance 2.0 Fast', 'Seedance', { min: 4, max: 15 }, ['480p', '720p'], { ...SEEDANCE, tags: ['Seedance', ACCESS_TAG] }),
  video('bytedance-seedance-v2-mini', 'Seedance 2.0 Mini', 'Seedance', { min: 4, max: 15 }, ['480p', '720p'], { ...SEEDANCE, tags: ['Seedance', ACCESS_TAG] }),
  video('bytedance-seedance-v2.5', 'Seedance 2.5', 'Seedance', { min: 4, max: 30 }, ['480p', '720p', '1080p'], { ...SEEDANCE, tags: ['Seedance', ACCESS_TAG] })
]

export const IMAGE_MODELS = MODELS.filter((m) => m.kind === 'image')
export const VIDEO_MODELS = MODELS.filter((m) => m.kind === 'video')

export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-sunburst'
export const DEFAULT_VIDEO_MODEL = 'veo-3.1-fast-generate-001'

/** Unknown ids (e.g. a Higgsfield model saved by an older build) fall back to the default. */
export function getImageModel(id: string | null | undefined): MediaModel {
  return IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS.find((m) => m.id === DEFAULT_IMAGE_MODEL)!
}

export function getVideoModel(id: string | null | undefined): MediaModel {
  return VIDEO_MODELS.find((m) => m.id === id) ?? VIDEO_MODELS.find((m) => m.id === DEFAULT_VIDEO_MODEL)!
}

/** How many character sheets an image model accepts as references. 0 means sheets are not used. */
export function maxRefs(m: MediaModel): number {
  return m.kind === 'image' ? m.refs : 0
}

/** ElevenLabs documents no prompt limit, so these stay conservative. */
export function promptLimit(m: MediaModel): number {
  return m.kind === 'video' ? 2500 : 4000
}

/** The video length to request for a clip: the shortest allowed length that covers it, or the longest. */
export function fitDuration(m: MediaModel, seconds: number): number | null {
  const d = m.durations
  if (!d) return null
  const want = Math.max(1, Math.ceil(seconds))
  if ('values' in d) {
    const values = [...d.values].sort((a, b) => a - b)
    return values.find((v) => v >= want) ?? values[values.length - 1]
  }
  return Math.min(d.max, Math.max(d.min, want))
}

export function durationLabel(m: MediaModel): string | null {
  const d = m.durations
  if (!d) return null
  return 'values' in d ? `${d.values.join(' / ')} dtk` : `${d.min}–${d.max} dtk`
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  return (space > limit * 0.8 ? cut.slice(0, space) : cut).trim()
}

/**
 * The resolution sent to the model: the requested one when the model offers it, else 2K stills (enough room for
 * camera moves) and 1080p video, or the closest the model offers.
 */
function resolutionFor(m: MediaModel, want?: string | null): string | undefined {
  if (want && m.resolutions.includes(want)) return want
  const prefer = m.kind === 'image' ? ['2K', '1K'] : ['1080p', '720p']
  return prefer.find((r) => m.resolutions.includes(r)) ?? m.resolutions[0]
}

/** Resolutions a model offers, lowest first, as picker values. */
export function resolutionOptions(m: MediaModel): string[] {
  const rank = (v: string): number => {
    const k = /^(\d+(?:\.\d+)?)k$/i.exec(v)
    return k ? Number(k[1]) * 1000 : parseInt(v, 10) || 0
  }
  return [...m.resolutions].sort((a, b) => rank(a) - rank(b))
}

/** The resolution a project's videos actually use with this model. */
export function effectiveResolution(m: MediaModel, want?: string | null): string | null {
  return resolutionFor(m, want) ?? null
}

export function imageBody(m: MediaModel, prompt: string, aspect: AspectRatio, refs: ImageRef[]): Record<string, unknown> {
  const body: Record<string, unknown> = { model_id: m.id, prompt: clip(prompt, promptLimit(m)), aspect_ratio: aspect }
  const res = resolutionFor(m)
  if (res) body.resolution = res
  if (m.qualities.includes('high')) body.quality = 'high'
  const limit = maxRefs(m)
  if (limit > 0 && refs.length) body.images = refs.slice(0, limit)
  return body
}

/**
 * Said in every video prompt. Requests already switch generated audio off, but the rule costs little and keeps a
 * soundtrack out if a model ever ignores the switch (see docs/keputusan-teknis.md).
 */
export const NO_MUSIC = 'Silent clip: no background music, no soundtrack, no singing or humming.'

/** The video prompt with the no-music rule, trimmed so the rule itself never gets cut off. */
export function videoPrompt(m: MediaModel, prompt: string): string {
  return `${clip(prompt.trim(), promptLimit(m) - NO_MUSIC.length - 1)} ${NO_MUSIC}`
}

export function videoBody(
  m: MediaModel,
  prompt: string,
  startFrame: ImageRef,
  seconds: number,
  aspect: AspectRatio,
  resolution?: string | null
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model_id: m.id,
    prompt: videoPrompt(m, prompt),
    aspect_ratio: m.autoAspect ? 'auto' : aspect,
    // Narration and music come from the editor; generated sound would be dropped anyway and costs extra.
    generate_audio: false,
    start_frame: startFrame
  }
  const duration = fitDuration(m, seconds)
  if (duration != null) body.duration_secs = duration
  const res = resolutionFor(m, resolution)
  if (res) body.resolution = res
  // The story already describes each shot in detail, so rewriting it would drift from the storyboard.
  if (m.enhanceSwitch) body.enhance_prompt = false
  return body
}

/** What the app will actually request from this model, in words. */
export function describeModel(m: MediaModel): string {
  const access = m.gated && 'perlu akses dari ElevenLabs'
  if (m.kind === 'image') {
    const res = resolutionFor(m)
    return [`pakai lembar karakter (maks ${m.refs})`, res && `hasil ${res}`, access].filter(Boolean).join(' · ')
  }
  // Video resolution is picked per project, next to the model.
  return [durationLabel(m), 'mulai dari gambar klip', access].filter(Boolean).join(' · ')
}

/** Picker rows, the default first with a "Rekomendasi" tag so first-time users have a safe choice. */
export function mediaModelOptions(kind: 'image' | 'video'): ModelOption[] {
  const list = kind === 'image' ? IMAGE_MODELS : VIDEO_MODELS
  const recommended = kind === 'image' ? DEFAULT_IMAGE_MODEL : DEFAULT_VIDEO_MODEL
  return [...list.filter((m) => m.id === recommended), ...list.filter((m) => m.id !== recommended)].map((m) => ({
    id: m.id,
    name: m.name,
    family: m.family,
    description: describeModel(m),
    tags: m.id === recommended ? ['Rekomendasi', ...m.tags] : m.tags
  }))
}
```

---

## Appendix B — `src/main/services/elevenMedia.ts`

```ts
import { requireSecret } from '../secrets'
import { BASE } from './elevenlabs'
import { ApiError, sleep } from './http'

/**
 * ElevenLabs Image & Video (POST /v1/flows/image and /v1/flows/video). A request returns a generation id at once;
 * the result is polled until it completes, then downloaded from a short-lived signed URL.
 */

export type MediaKind = 'image' | 'video'
export type GenerationStatus = 'pending' | 'generating' | 'completed' | 'failed'

export interface Generation {
  id: string
  status: GenerationStatus
  content_url?: string | null
  content_mime_type?: string | null
  failure_reason?: string | null
  error_message?: string | null
}

/** ElevenLabs errors carry a machine code in detail.status next to the human message. */
async function readFailure(res: Response): Promise<{ code: string; message: string }> {
  const text = await res.text().catch(() => '')
  try {
    const d = JSON.parse(text)?.detail
    if (Array.isArray(d)) return { code: '', message: d.map((x) => x?.msg ?? JSON.stringify(x)).join('; ') }
    if (d && typeof d === 'object') return { code: String(d.status ?? d.code ?? ''), message: String(d.message ?? '') }
    if (typeof d === 'string') return { code: '', message: d }
  } catch {
    // not JSON
  }
  return { code: '', message: text.slice(0, 300) || `HTTP ${res.status}` }
}

function friendly(status: number, code: string, message: string): ApiError {
  const said = `${code} ${message}`
  if (/paid_plan_required/i.test(said)) return new ApiError('Gambar dan video ElevenLabs butuh paket Pro ke atas.', status)
  if (/model_access_denied/i.test(said))
    return new ApiError('Model ini belum dibuka untuk akun ElevenLabs kamu. Minta aksesnya ke ElevenLabs atau pilih model lain.', status)
  if (status === 401 || /missing_permissions/i.test(said))
    return new ApiError('Kunci ElevenLabs tidak valid atau belum punya izin Image & Video. Atur izin kuncinya di ElevenLabs.', status)
  if (status === 402 || /quota|credits/i.test(said)) return new ApiError('Kredit ElevenLabs tidak cukup. Isi ulang atau naikkan paket di ElevenLabs.', status)
  if (status === 422) return new ApiError(`ElevenLabs menolak pengaturan ini: ${message || code}`, status)
  if (status === 429) return new ApiError('ElevenLabs sedang sibuk atau batas proses bersamaan akunmu tercapai.', status, true)
  if (status >= 500) return new ApiError(`Server ElevenLabs sedang bermasalah (${status}).`, status, true)
  return new ApiError(`ElevenLabs menolak permintaan: ${message || code || `HTTP ${status}`}`, status)
}

async function call<T>(path: string, init: RequestInit & { key?: string } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'xi-api-key': init.key ?? requireSecret('elevenlabs'),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {})
    }
  })
  if (!res.ok) {
    const f = await readFailure(res)
    throw friendly(res.status, f.code, f.message)
  }
  return (await res.json()) as T
}

/**
 * Starts a generation and returns its id. Only 429 is retried: the request was turned away before anything ran.
 * Retrying after a 5xx could start a second generation, and every started generation is billed.
 */
export async function submit(kind: MediaKind, body: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await call<{ id: string }>(`/v1/flows/${kind}`, { method: 'POST', body: JSON.stringify(body), signal })
      return out.id
    } catch (e) {
      if (e instanceof ApiError && e.status === 429 && attempt < 6 && !signal?.aborted) {
        await sleep(4000 + attempt * 3000, signal)
        continue
      }
      throw e
    }
  }
}

export async function getGeneration(kind: MediaKind, id: string, signal?: AbortSignal): Promise<Generation> {
  return call<Generation>(`/v1/flows/${kind}/${encodeURIComponent(id)}`, { method: 'GET', signal })
}

const FAILURES: Record<string, string> = {
  moderated: 'Ditolak moderasi ElevenLabs. Ubah prompt lalu coba lagi.',
  timeout: 'ElevenLabs kehabisan waktu saat membuat hasil. Coba lagi.',
  charging_failed: 'ElevenLabs gagal memotong kredit. Cek sisa kredit dan paket akunmu.',
  invalid_parameters: 'ElevenLabs menolak pengaturan model ini. Pilih model lain.'
}

/**
 * Polls until the generation finishes. ElevenLabs asks for at least 2 s between image polls and 10 s between
 * video polls, so each kind starts there and backs off.
 */
export async function waitForResult(
  kind: MediaKind,
  id: string,
  onTick: (status: GenerationStatus, elapsedMs: number) => void,
  signal?: AbortSignal,
  timeoutMs = kind === 'video' ? 30 * 60 * 1000 : 15 * 60 * 1000
): Promise<Generation & { content_url: string }> {
  const started = Date.now()
  let delay = kind === 'video' ? 10_000 : 2000
  const cap = kind === 'video' ? 30_000 : 10_000
  let failures = 0
  for (;;) {
    if (Date.now() - started > timeoutMs) throw new Error('ElevenLabs terlalu lama merespons. Coba lagi nanti.')
    let g: Generation
    try {
      g = await getGeneration(kind, id, signal)
      failures = 0
    } catch (e) {
      if (signal?.aborted) throw e
      if (e instanceof ApiError && !e.retryable) throw e
      if (++failures > 8) throw e
      await sleep(delay, signal)
      continue
    }
    onTick(g.status, Date.now() - started)
    if (g.status === 'completed') {
      if (!g.content_url) throw new Error('ElevenLabs selesai tanpa file hasil')
      return { ...g, content_url: g.content_url }
    }
    if (g.status === 'failed') {
      const known = g.failure_reason ? FAILURES[g.failure_reason] : undefined
      if (known) throw new Error(g.error_message ? `${known} (${g.error_message})` : known)
      throw new Error(`ElevenLabs gagal membuat hasil: ${g.error_message || g.failure_reason || 'tanpa keterangan'}`)
    }
    await sleep(delay + Math.random() * 500, signal)
    delay = Math.min(cap, delay * 1.5)
  }
}

/**
 * Whether a key can use Image & Video, without spending credits: listing one past generation needs the same plan
 * and key permission as creating one. Returns null when it can, else the reason in Indonesian.
 */
export async function checkAccess(key: string): Promise<string | null> {
  try {
    await call('/v1/flows/image?page_size=1', { method: 'GET', key })
    return null
  } catch (e) {
    return (e as Error).message
  }
}
```
