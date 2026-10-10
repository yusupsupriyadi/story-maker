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
