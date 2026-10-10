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
