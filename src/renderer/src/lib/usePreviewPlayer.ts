import { useEffect, useRef, useState } from 'react'

/** One voice sample plays at a time, from list rows or the button beside a picker. */
export function usePreviewPlayer(): { playing: string | null; toggle: (id: string, url: string) => void } {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => () => audio.current?.pause(), [])
  return {
    playing,
    toggle: (id, url) => {
      audio.current?.pause()
      if (playing === id) return setPlaying(null)
      const a = new Audio(url)
      a.onended = () => setPlaying(null)
      audio.current = a
      setPlaying(id)
      void a.play().catch(() => setPlaying(null))
    }
  }
}
