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
