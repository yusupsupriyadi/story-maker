import { useEffect, useState } from 'react'
import { Play, Search, Square } from 'lucide-react'
import { LANGUAGES } from '@shared/models'
import type { LibraryVoice, LibraryVoiceQuery } from '@shared/types'
import { Select } from '../../components/Select'
import { Button, Modal, Segmented, Spinner, cx, inputCls } from '../../components/ui'
import { errorText } from '../../lib/format'
import { usePreviewPlayer } from '../../lib/usePreviewPlayer'

const GENDERS: { id: LibraryVoiceQuery['gender']; label: string }[] = [
  { id: 'all', label: 'Semua' },
  { id: 'female', label: 'Wanita' },
  { id: 'male', label: 'Pria' }
]

/**
 * Browse the ElevenLabs Voice Library and pick a narrator. The chosen voice is added to the user's account
 * first, because narration can only use voices that are there.
 */
export function VoiceLibraryDialog({
  language,
  onClose,
  onPick
}: {
  /** The project's language, used as the first language filter. */
  language: string
  onClose: () => void
  onPick: (voice: { id: string; name: string; description: string; previewUrl: string | null }) => void
}) {
  const [text, setText] = useState('')
  const [query, setQuery] = useState<LibraryVoiceQuery>({ search: '', language, gender: 'all', page: 0 })
  const [voices, setVoices] = useState<LibraryVoice[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const player = usePreviewPlayer()

  // Typing waits a moment before searching, so each keystroke does not cost a request.
  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => (q.search === text ? q : { ...q, search: text, page: 0 })), 400)
    return () => clearTimeout(t)
  }, [text])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    window.api.settings
      .libraryVoices(query)
      .then((r) => {
        if (!live) return
        setVoices((prev) => (query.page === 0 ? r.voices : [...prev, ...r.voices]))
        setHasMore(r.hasMore)
      })
      .catch((e) => live && setError(errorText(e)))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [query, retry])

  const pick = async (v: LibraryVoice): Promise<void> => {
    setAdding(v.id)
    setAddError(null)
    try {
      const id = v.added ? v.id : await window.api.settings.addLibraryVoice(v.ownerId, v.id, v.name)
      onPick({ id, name: v.name, description: v.labels, previewUrl: v.previewUrl })
    } catch (e) {
      setAddError(errorText(e))
      setAdding(null)
    }
  }

  const languages = [...LANGUAGES.map((l) => ({ value: l.code, label: l.label })), { value: '', label: 'Semua bahasa' }]

  return (
    <Modal
      open
      onClose={onClose}
      title="Voice Library ElevenLabs"
      subtitle="Cari suara narator dari suara komunitas ElevenLabs. Suara yang kamu pakai ditambahkan ke akun ElevenLabs kamu."
      width={680}
    >
      <div id="voice-library-dialog" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">Cari suara</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Cari nama atau gaya suara"
              className={cx(inputCls, 'h-11 pl-10')}
            />
          </label>
          <Select
            label="Bahasa"
            value={query.language}
            onChange={(l) => setQuery((q) => ({ ...q, language: l, page: 0 }))}
            options={languages}
            className="w-[170px]"
          />
          <Segmented value={query.gender} onChange={(g) => setQuery((q) => ({ ...q, gender: g, page: 0 }))} options={GENDERS} />
        </div>

        {error && (
          <div className="flex items-center gap-3 rounded-xl bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad-ink">
            <span className="flex-1">{error}</span>
            <Button size="sm" onClick={() => setRetry((n) => n + 1)}>
              Coba lagi
            </Button>
          </div>
        )}
        {addError && <p className="rounded-xl bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad-ink">{addError}</p>}

        <div id="voice-library-list" className="scroll-thin -mx-1 flex max-h-[52vh] flex-col overflow-y-auto px-1">
          {voices.map((v) => {
            const on = player.playing === v.id
            return (
              <div key={v.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
                {v.previewUrl ? (
                  <button
                    type="button"
                    aria-label={on ? `Hentikan contoh suara ${v.name}` : `Dengarkan contoh suara ${v.name}`}
                    onClick={() => player.toggle(v.id, v.previewUrl!)}
                    className={cx(
                      'flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors',
                      on ? 'border-accent bg-accent text-white' : 'border-line-2 bg-surface text-ink hover:border-ink-2'
                    )}
                  >
                    {on ? <Square className="size-3.5" fill="currentColor" /> : <Play className="ml-px size-3.5" fill="currentColor" />}
                  </button>
                ) : (
                  <span className="size-9 shrink-0" />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{v.name}</span>
                  <span className="truncate text-[12.5px] text-ink-2">{[v.labels, v.added && 'sudah ada di akunmu'].filter(Boolean).join(' · ')}</span>
                </span>
                <Button size="sm" loading={adding === v.id} disabled={!!adding} onClick={() => void pick(v)}>
                  Pakai suara ini
                </Button>
              </div>
            )
          })}
          {loading && (
            <p className="flex items-center gap-2 py-4 text-sm text-muted">
              <Spinner />
              Memuat suara…
            </p>
          )}
          {!loading && !error && voices.length === 0 && (
            <p className="py-4 text-sm text-muted">Tidak ada suara yang cocok. Coba kata lain atau ubah filter bahasa.</p>
          )}
        </div>

        {hasMore && !loading && (
          <Button className="self-center" onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}>
            Muat lagi
          </Button>
        )}
      </div>
    </Modal>
  )
}
