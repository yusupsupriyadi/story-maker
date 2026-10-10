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
  /** ByteDance models stay locked until ElevenLabs approves the workspace. */
  gated: boolean
  tags: string[]
}

export const ACCESS_TAG = 'Perlu akses'

const GPT_25_QUALITY = ['low', 'medium', 'high', 'xhigh', 'max']

function image(id: string, name: string, family: string, refs: number, resolutions: string[], more: Partial<MediaModel> = {}): MediaModel {
  return { id, name, family, kind: 'image', refs, resolutions, qualities: [], durations: null, autoAspect: false, gated: false, tags: [family], ...more }
}

function video(id: string, name: string, family: string, durations: MediaModel['durations'], resolutions: string[], more: Partial<MediaModel> = {}): MediaModel {
  return { id, name, family, kind: 'video', refs: 0, resolutions, qualities: [], durations, autoAspect: false, gated: false, tags: [family], ...more }
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
  video('veo-3.1-fast-generate-001', 'Veo 3.1 Fast', 'Veo', { values: [4, 6, 8] }, ['720p', '1080p', '4K'], { tags: ['Veo', '4K'] }),
  video('veo-3.1-generate-001', 'Veo 3.1', 'Veo', { values: [4, 6, 8] }, ['720p', '1080p', '4K'], { tags: ['Veo', '4K'] }),
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
  // enhance_prompt stays at its default: ElevenLabs fails Veo generations that switch prompt enhancement off,
  // even though the schema lists the field.
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
