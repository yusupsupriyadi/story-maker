# Desain: Higgsfield diganti API gambar dan video ElevenLabs

Tanggal: 2026-10-10 · Status: disetujui di percakapan, menunggu review spec

## Tujuan

Higgsfield dihapus total. Gambar klip, lembar karakter, dan video AI dibuat lewat API ElevenLabs
(`POST /v1/flows/image`, `POST /v1/flows/video`) dengan kunci `elevenlabs` yang sama dengan suara narator.
Arsitektur yang ada (antrean job, body request dari katalog model, lanjut polling setelah restart) tetap dipakai.

## Fakta API yang mengikat desain

Sumber: elevenlabs.io/docs/api-reference/flows/image/create, …/flows/video/create,
…/eleven-api/guides/cookbooks/image-and-video, …/eleven-api/guides/how-to/image-and-video/references.

- Auth `xi-api-key`. Butuh paket **Pro ke atas** (`402 paid_plan_required`) dan izin kunci *Image & Video* atau *Flows*.
- Buat: `POST /v1/flows/{image|video}` → `{ id, status: "pending" }`. Status: `GET /v1/flows/{image|video}/{id}` →
  `pending | generating | completed | failed`, plus `content_url` (URL bertanda tangan, berlaku sekitar 1 jam),
  `content_mime_type`, `failure_reason`, `error_message`.
- `failure_reason`: `timeout`, `model_error`, `moderated`, `invalid_parameters`, `dependency_failed`,
  `charging_failed`, `internal_error`. Generation yang gagal tidak ditagih.
- Polling: gambar paling cepat tiap 2 detik, video tiap 10 detik. 429 dibalas dengan backoff.
- Field yang tidak dikenal model **ditolak**, jadi body dibangun per model.
- Referensi gambar: `{ type: "inline_base64", content_base64, mime_type }` (maksimal 25 MB setelah decode;
  jpeg/png/webp/heic/heif), `{ type: "asset", asset_id }`, atau `{ type: "generation", generation_id }`.
- **Tidak ada** endpoint estimasi biaya dan **tidak ada** endpoint pembatalan.
- Model ByteDance (Seedream, Seedance) nonaktif secara bawaan dan butuh persetujuan ElevenLabs (`model_access_denied`).

## Katalog model (`src/shared/media.ts`)

Ditulis tangan dan bertipe, menggantikan `higgsfield.ts` dan `higgsfield-catalog.json`. Semua model di bawah
menerima rasio 16:9 dan 9:16.

Gambar (bawaan: `gpt-image-2.5-sunburst`). Resolusi yang dikirim memakai 2K kalau tersedia, dengan urutan
preferensi `2K`, `1K`. Kualitas GPT `high`.

| id | Nama | Keluarga | Maks referensi | Resolusi | Perlu akses |
|---|---|---|---|---|---|
| gpt-image-2.5-sunburst | GPT Image 2.5 · Sunburst | GPT Image | 10 | 1K, 2K, 4K | – |
| gpt-image-2.5-flare | GPT Image 2.5 · Flare | GPT Image | 10 | 1K, 2K, 4K | – |
| gpt-image-2 | GPT Image 2 | GPT Image | 10 | 1K, 2K, 4K | – |
| gemini-3-pro-image | Nano Banana Pro | Nano Banana | 10 | 1K, 2K, 4K | – |
| gemini-3.1-flash-image | Nano Banana 2 | Nano Banana | 14 | 512, 1K, 2K, 4K | – |
| gemini-3.1-flash-lite-image | Nano Banana 2 Lite | Nano Banana | 14 | (tidak dikirim) | – |
| gemini-2.5-flash-image | Nano Banana | Nano Banana | 5 | (tidak ada) | – |
| bytedance-seedream-5-pro | Seedream 5 Pro | Seedream | 10 | 1K, 2K | ya |
| bytedance-seedream-5-lite | Seedream 5 Lite | Seedream | 10 | 2K, 3K | ya |

Video (bawaan: `veo-3.1-fast-generate-001`). Semua memulai dari gambar klip (`start_frame`), dengan
`generate_audio: false`. Preferensi resolusi `1080p` lalu `720p`, kecuali proyek memilih yang lain.

| id | Nama | Keluarga | Durasi | Resolusi | Perlu akses |
|---|---|---|---|---|---|
| veo-3.1-fast-generate-001 | Veo 3.1 Fast | Veo | 4 / 6 / 8 | 720p, 1080p, 4K | – |
| veo-3.1-generate-001 | Veo 3.1 | Veo | 4 / 6 / 8 | 720p, 1080p, 4K | – |
| bytedance-seedance-v2 | Seedance 2.0 | Seedance | 4–15 | 480p, 720p, 1080p, 4k | ya |
| bytedance-seedance-v2-fast | Seedance 2.0 Fast | Seedance | 4–15 | 480p, 720p | ya |
| bytedance-seedance-v2-mini | Seedance 2.0 Mini | Seedance | 4–15 | 480p, 720p | ya |
| bytedance-seedance-v2.5 | Seedance 2.5 | Seedance | 4–30 | 480p, 720p, 1080p | ya |

Detail body:

- Veo menambah `enhance_prompt: false`.
- Seedance memakai `aspect_ratio: "auto"`: rasio diambil dari gambar awal, yang memang sudah sesuai rasio proyek.
  Ini juga syarat Seedance 2.5 untuk tugas *first frame*.
- Model yang perlu akses diberi tag `Perlu akses`.
- Fungsi publik tetap bernama sama supaya pemanggil hanya berubah sedikit: `getImageModel`, `getVideoModel`,
  `maxRefs`, `promptLimit`, `fitDuration`, `durationLabel`, `resolutionOptions`, `effectiveResolution`, `imageBody`,
  `videoBody`, `videoPrompt`, `NO_MUSIC`, `describeModel`. `hfModelOptions` diganti nama menjadi `mediaModelOptions`.
- `imageBody`/`videoBody` menerima referensi bertipe `ImageRef` (bentuk `inline_base64`), bukan URL.
- Batas prompt tidak didokumentasikan, jadi tetap konservatif: 4000 untuk gambar, 2500 untuk video.
- Model lama yang tidak ada di katalog otomatis jatuh ke model bawaan saat dibaca, baik di pengaturan maupun di
  proyek. Tidak ada penulisan ulang data.

## Main process

- **`src/main/services/elevenMedia.ts`** (baru)
  - Fungsi: `submit(kind, body, signal)`, `waitForResult(kind, id, onTick, signal, timeoutMs)`, dan
    `checkAccess(key)` (memanggil `GET /v1/flows/image?page_size=1`).
  - Polling gambar mulai 2 detik dikali 1,5 sampai 10 detik. Polling video mulai 10 detik sampai 30 detik.
  - Batas waktu 15 menit untuk gambar dan 30 menit untuk video. Gangguan jaringan dicoba ulang sampai 8 kali.
  - `submit` mencoba ulang kalau kena 429 atau 5xx.
  - Error dalam bahasa Indonesia:
    - 401: kunci tidak valid atau tanpa izin *Image & Video*.
    - 402 `paid_plan_required`: butuh paket Pro.
    - 402 lain atau kuota: kredit habis.
    - 403 atau `model_access_denied`: model perlu persetujuan ElevenLabs.
    - 422: pengaturan ditolak, ditambah pesan dari API.
    - `moderated`: ditolak moderasi, ubah prompt.
    - `failure_reason` lain: gagal, ditambah keterangan dari API.
  - Base URL bisa diganti di build pengembangan lewat `STUDIO_ELEVEN_BASE`, yang dipakai bersama oleh klien TTS
    `services/elevenlabs.ts`. Ini menggantikan `STUDIO_HF_BASE`.
- **`generation.ts`**
  - `startHiggsfield`/`finishHiggsfield` menjadi `startMedia`/`finishMedia`, dengan antrean `media` dan
    job `provider: 'elevenlabs'`.
  - `publicUrlFor` diganti `inlineRef(asset)`, yang membaca file lokal lalu mengubahnya ke base64. Error yang jelas
    muncul kalau file lebih dari 25 MB. `referenceUrls` menjadi `referenceImages`.
  - Aset baru: `provider: 'elevenlabs'`, `remoteId` berisi ID generation, `remoteUrl: null`.
  - `resumeJobs` melanjutkan job `elevenlabs` yang punya `remote_id` dan `payload.target`. Job lain, termasuk job
    Higgsfield lama, ditandai gagal.
  - `estimateCredits`, `forgetEstimates`, dan `failedEstimates` dihapus.
- **`jobs.ts`**: antrean `higgsfield` menjadi `media` (3 sekaligus). Pemanggilan `hf.cancelRequest` dihapus;
  batal hanya menghentikan proses di aplikasi.
- **`ipc.ts`**
  - Handler `generate:estimate` dihapus (juga di `shared/api.ts` dan preload), begitu pula cabang tes dan
    pembersihan cache Higgsfield.
  - Tes kunci `elevenlabs` memanggil `testKey` lalu `checkAccess`, dan hasilnya ditambahkan ke pesan, misalnya
    "· gambar & video siap" atau "· gambar & video belum bisa: …". `ok` tetap ditentukan oleh tes TTS.
- **Tipe**: `ApiProvider` tidak lagi memuat `'higgsfield'`. `CreditEstimate` dihapus, begitu pula `credits`,
  `creditUnit`, dan `usd` di `ModelOption` kalau tidak dipakai di tempat lain.
- **Migrasi baru** di akhir `MIGRATIONS`: menghapus baris `secrets` milik `higgsfield` dan cache `estimate:%`
  serta `models:higgsfield`.
- Dihapus: `services/higgsfield.ts`, `shared/higgsfield.ts`, `shared/higgsfield-catalog.json`.

## Renderer

- **Pengaturan › Gambar dan video**
  - Logo dan nama ElevenLabs, `KeyForm` dengan `provider="elevenlabs"`.
  - Petunjuk tentang paket Pro dan izin *Image & Video*, tautan ke halaman kunci API ElevenLabs.
  - Catatan kunci bersama, dua arah: di bagian ini kalau TTS-nya ElevenLabs, dan di bagian TTS.
  - Catatan bawah: jumlah model, label "Perlu akses", dan tempat memilih model.
- **ModelSection**
  - `Cost`, `withCosts`, `useEstimate(s)`, dan `hasKey` dihapus.
  - Ditambah satu kalimat: biaya memakai kredit akun ElevenLabs.
  - Subjudul: "… dari ElevenLabs".
  - Filter tag gambar: Rekomendasi, GPT Image, Nano Banana, Seedream, Perlu akses.
  - Filter tag video: Rekomendasi, Veo, Seedance, Perlu akses.
- **StoryboardStep**: subjudul tab menjadi "ElevenLabs · pakai kredit". State `credits`/`videoCredits`, tanda
  "≈ kr", dan kalimat perkiraan biaya dihapus.
- **ModelPicker**: kolom dan urutan kredit dihapus. `lib/useEstimate.ts` dihapus. `creditLabel` dihapus kalau tidak
  dipakai lagi.
- **Home**: `ok('higgsfield')` menjadi `ok('elevenlabs')`, dengan teks "kunci ElevenLabs" yang memblokir
  "gambar dan video".
- **Inspector**: "Klip ini memakai video dari ElevenLabs."
- **Logo**
  - `ModelLogo`: GPT Image memakai `openai.svg`; Nano Banana dan Veo memakai `providers/gemini.svg`; Seedream dan
    Seedance memakai `bytedance-color.svg`.
  - File logo yang tidak dipakai lagi dihapus. `ProviderLogo` tidak lagi memuat `higgsfield`.
  - Teks merek di halaman Tentang disesuaikan.
- **IdeaStep**: impor pindah ke `@shared/media`.

## Dokumentasi

- Diperbarui: `AGENTS.md` (peta kode, aturan 1), `README.md`, `CHANGELOG.md` (entri "Belum dirilis"), dan
  `docs/README.md`, `arsitektur.md`, `data-model.md`, `alur-produksi.md`, `editor-dan-ekspor.md`, `konvensi.md`,
  `pengembangan.md` (`STUDIO_ELEVEN_BASE`).
- `layanan-ai.md`: bagian Higgsfield ditulis ulang.
- `keputusan-teknis.md`: ditambah alasan memakai `inline_base64`, tanpa estimasi kredit, dan Seedance memakai
  `auto`.
- `masalah-diketahui.md`: ditambah paket Pro, batal tetap ditagih, model yang perlu akses, dan `checkAccess` yang
  mungkin tidak menangkap batas paket.

## Pengujian

- `npm run typecheck` dan `npm run build` harus bersih.
- Grep `higgsfield|Higgsfield|HF_|hfModelOptions|estimate\(` di `src/` dan `docs/` tidak boleh menyisakan pemakaian.
  Pengecualian: catatan sejarah di CHANGELOG, isi `.development-history`, dan string migrasi.
- Uji sungguhan ke API (memakai kredit pengguna) dan dev harness hanya dijalankan atas izin pengguna.

## Di luar cakupan

- Webhook (aplikasi desktop tidak punya endpoint publik), unggahan `POST /v1/assets`, referensi `generation`,
  model lipsync (Creatify Aurora), dan model yang hanya ada di web app ElevenLabs.
