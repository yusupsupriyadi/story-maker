import type { LibraryVoice, LibraryVoiceQuery } from './types'

/** ElevenLabs Voice Library (GET /v1/shared-voices): building the request and reading one entry of the reply. */

export const LIBRARY_PAGE_SIZE = 30

export function libraryVoicesPath(q: LibraryVoiceQuery): string {
  const p = new URLSearchParams({
    page_size: String(LIBRARY_PAGE_SIZE),
    page: String(q.page),
    // Voices that narrated the most in the past year lead, so proven voices are on the first page.
    sort: 'usage_character_count_1y',
    // A voice with its own rate charges more credits per character than the user expects from narration.
    include_custom_rates: 'false'
  })
  const search = q.search.trim()
  if (search) p.set('search', search)
  if (q.language) p.set('language', q.language)
  if (q.gender !== 'all') p.set('gender', q.gender)
  return `/v1/shared-voices?${p}`
}

/** The fields of a `voices[]` entry that the app reads. */
export interface RawLibraryVoice {
  public_owner_id: string
  voice_id: string
  name: string
  gender?: string | null
  age?: string | null
  accent?: string | null
  descriptive?: string | null
  use_case?: string | null
  language?: string | null
  description?: string | null
  preview_url?: string | null
  is_added_by_user?: boolean | null
}

const GENDER: Record<string, string> = { male: 'Pria', female: 'Wanita', neutral: 'Netral' }
const AGE: Record<string, string> = { young: 'muda', middle_aged: 'paruh baya', old: 'tua' }
const USE_CASE: Record<string, string> = {
  narrative_story: 'cerita',
  informative_educational: 'edukasi',
  social_media: 'media sosial',
  conversational: 'percakapan',
  characters_animation: 'karakter',
  advertisement: 'iklan',
  entertainment_tv: 'hiburan'
}

const words = (s?: string | null): string => (s ?? '').replace(/_/g, ' ').trim()

export function toLibraryVoice(v: RawLibraryVoice): LibraryVoice {
  const accent = v.accent === 'standard' ? '' : words(v.accent)
  const labels = [
    GENDER[v.gender ?? ''] ?? words(v.gender),
    AGE[v.age ?? ''] ?? words(v.age),
    accent,
    words(v.descriptive),
    USE_CASE[v.use_case ?? ''] ?? words(v.use_case)
  ].filter(Boolean)
  return {
    id: v.voice_id,
    ownerId: v.public_owner_id,
    name: v.name,
    labels: [...new Set(labels)].join(', '),
    description: (v.description ?? '').trim(),
    language: v.language ?? null,
    previewUrl: v.preview_url ?? null,
    added: !!v.is_added_by_user
  }
}
