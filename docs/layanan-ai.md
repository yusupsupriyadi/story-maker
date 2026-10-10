# Layanan AI dan kunci API

Semua panggilan ke layanan luar dilakukan di **proses utama** (`src/main/services/`). Renderer tidak pernah
memegang kunci API.

## Kunci API (BYOK)

Pengguna memasukkan kuncinya sendiri di **Pengaturan › Layanan AI dan kunci**.

- Disimpan di tabel `secrets` setelah dienkripsi dengan Electron `safeStorage`. Di Windows ini memakai DPAPI,
  terikat ke akun Windows pengguna, jadi salinan `studio.db` di komputer lain tidak bisa membuka kuncinya.
- Kunci kriptonya dibuat saat startup (`warmUpEncryption`) supaya tidak hilang kalau aplikasi ditutup paksa tepat
  setelah menyimpan kunci pertama.
- `requireSecret(provider)` melempar error berbahasa Indonesia kalau kunci belum ada.
- `revealSecret` hanya dipanggil tombol "tampilkan kunci" di Pengaturan.
- **Jangan pernah** menulis kunci ke log, pesan error, file, URL, atau mengirimnya ke layanan lain.

| Penyedia (`ApiProvider`) | Dipakai untuk |
|---|---|
| `gemini` | LLM (naskah/visual) dan Gemini TTS |
| `elevenlabs` | TTS, gambar, lembar karakter, video |
| `openrouter`, `groq`, `custom` | LLM lewat API kompatibel OpenAI |

## LLM (`services/llm.ts`, `services/gemini.ts`)

- `generateJson({ system, prompt, schema, name })` memanggil penyedia aktif (`settings.llmProvider` +
  `llmModels[provider]`).
  - Gemini: `@google/genai` dengan `responseJsonSchema` (dan cadangan: skema ditulis di system instruction).
  - Lainnya: `/chat/completions`, dicoba berurutan `json_schema` (strict) → `json_object` → teks biasa, lalu JSON
    diambil dari teks (`extractJson`) untuk model yang tidak mendukung structured output.
- `listModels(source)`: daftar model live dari penyedia, dicache di tabel `cache` dan disegarkan saat basi.
- **Menambah penyedia LLM baru** yang kompatibel OpenAI: tambahkan ke `LlmProvider` dan `ApiProvider`
  (`types.ts`), `LLM_PROVIDERS` (`shared/models.ts`), konfigurasi base URL di `llm.ts`, dan `DEFAULT_SETTINGS.llmModels`.

## TTS

| Penyedia | File | Catatan |
|---|---|---|
| Gemini TTS | `services/gemini.ts` | PCM 24 kHz → WAV; daftar suara dari Voice Library (`listVoices`, cache 24 jam) dengan cadangan statis di `shared/models.ts`; contoh suara bawaan di `renderer/src/assets/voices` |
| ElevenLabs | `services/elevenlabs.ts` | memakai endpoint with-timestamps untuk waktu per kata; tag `<...>` diubah ke `[tag]` untuk model v3, atau ke `<break>` untuk model lama (`toElevenLabsText`) |

Narasi selalu dibuat satu rekaman utuh lalu dipotong. Lihat [alur-produksi.md](alur-produksi.md#4-narasi-srcmainnarrationts).

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
- `gated`: model ByteDance (Seedream, Seedance) baru bisa dipakai setelah ElevenLabs membuka aksesnya. Diberi tag
  `Perlu akses`.

Semua video dimulai dari gambar klip (`start_frame`) dengan `generate_audio: false`. `enhance_prompt` tidak dikirim:
Veo di ElevenLabs gagal kalau peningkatan prompt dimatikan. Model bawaan:
`DEFAULT_IMAGE_MODEL` (`gpt-image-2.5-sunburst`) dan `DEFAULT_VIDEO_MODEL` (`veo-3.1-fast-generate-001`). ID yang
tidak dikenal, misalnya model dari versi lama, jatuh ke model bawaan saat dibaca.

**Menambah model**: tambahkan satu baris `image(...)` atau `video(...)` di `MODELS`, isi field persis seperti di
referensi API, lalu jalankan `npm run typecheck`. Ikon keluarga model diatur di `components/ModelLogo.tsx`.

## Whisper lokal (`src/main/whisper.ts`)

- Biner: `resources/whisper/whisper-cli.exe` + DLL (whisper.cpp, lisensi MIT). Saat ini hanya untuk Windows.
- Model: `ggml-small.bin` (sekitar 488 MB) dari Hugging Face (`ggerganov/whisper.cpp`), diunduh di Pengaturan ke
  `<folder data>\models\whisper`, bisa dijeda dan dilanjutkan (HTTP Range), lalu dicek SHA-256. Untuk pengembangan, `STUDIO_WHISPER_URL` bisa menunjuk salinan lokal.
- Dijalankan di antrean `whisper` (satu per satu). Detail argumennya di [alur-produksi.md](alur-produksi.md#5-caption-akurat-whisper-lokal).

## YouTube (halaman About)

Video tutorial diputar lewat iframe `https://www.youtube.com/embed/<id>`. Sejak 2025 YouTube mewajibkan pemutar
embed mengirim identitas lewat header HTTP Referer (tanpa itu: Error 153). Aplikasi yang memuat halaman dari
`file://` tidak mengirim Referer, jadi `identifyToYouTube()` (`src/main/index.ts`) menambahkan
`Referer: https://id.bangtutorial.bangstory/` (ID aplikasi) hanya untuk permintaan embed. Iframe tanpa
autoplay, supaya putaran dari pengguna terhitung sebagai view.

## Membuka tautan

`app:openExternal` hanya menerima URL `https://` dan membukanya di browser bawaan. Pakai ini untuk semua tautan
ke luar (dokumentasi penyedia, channel YouTube, Suno, dan lainnya).
