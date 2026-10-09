# AI Engagement Engine

Dashboard untuk satu kreator yang ingin memulai dan merawat **percakapan autentik** dengan audiens di YouTube Shorts, Instagram Reels, dan TikTok. Aplikasi ini menganalisis konten, membuat draf komentar pemantik dan balasan dengan Claude, mewajibkan persetujuan manusia sebelum publikasi, lalu mengukur hasilnya, dengan aktivitas kreator dan penonton dihitung terpisah.

Implementasi ini mengikuti `AI_Engagement_Engine_Blueprint` v1.0 (MVP).

> **Batasan.** Sistem ini tidak membuat atau mengoperasikan akun palsu, tidak menyamar sebagai penonton independen, tidak membeli engagement, dan tidak mengakali rate limit, CAPTCHA, atau moderasi. Semua komentar diposting dari akun resmi kreator atau akun tim yang identitasnya jelas, dan hanya setelah disetujui.

## Fitur

| Modul | Isi |
|---|---|
| **Account Connector** | OAuth Google (PKCE + state) untuk YouTube; token AES-256-GCM terenkripsi di server; reconnect/revoke; status izin per kemampuan; akun manual untuk Instagram/TikTok. |
| **AI Content Intelligence** | Claude menganalisis judul/caption/ringkasan/transkrip → ringkasan, tema, hook, momen diskusi, label risiko, dan ≥3 draf komentar pemantik. Balasan disarankan per komentar penonton. Output divalidasi dengan skema Zod (structured outputs). |
| **Guardrails** | Pemeriksaan deterministik setelah output model: penyamaran sebagai penonton (blok), testimoni palsu (blok), data pribadi (blok), batas panjang per platform (blok), klaim belum terverifikasi (peringatan), komentar generik (peringatan). |
| **Unified Comment Inbox** | Komentar penonton lintas platform, triase otomatis (pertanyaan, masukan, positif, perlu ditinjau), pertanyaan belum dijawab di urutan teratas, filter dan pencarian, input manual bila API tidak tersedia. |
| **Approval & Publishing** | `draft → pending_approval → approved → queued → published` (+ `rejected`, `failed`, `manual_action_required`, `cancelled`). Akun penerbit harus dikonfirmasi saat menyetujui. Job publikasi idempoten; fallback salin-teks + tautan. |
| **Engagement Analytics** | Komentar organik per 1.000 views, % komentar dibalas, peserta unik (ID di-hash), balasan antar-penonton, views 24 jam/7 hari, perbandingan pilot (pemantik vs pembanding). |
| **Audit log** | Login, koneksi akun, persetujuan, publikasi, kegagalan, perubahan konfigurasi. Kunci yang mirip rahasia disensor otomatis. |

## Menjalankan secara lokal

Prasyarat: Node.js ≥ 20.9 dan PostgreSQL.

```bash
npm install
cp .env.example .env          # isi SESSION_SECRET, TOKEN_ENCRYPTION_KEY, CRON_SECRET (lihat komentar di file)
npm run db:migrate            # buat skema
npm run db:seed               # data demo (hanya jika MOCK_MODE=true)
npm run dev                   # http://localhost:3000
```

Dengan `MOCK_MODE=true` dan tanpa `ANTHROPIC_API_KEY`, seluruh alur bisa dicoba tanpa kredensial apa pun:

- Masuk dengan kata sandi demo `demo-password-123` (atau `SEED_PASSWORD`).
- YouTube memakai adapter mock. "Publikasi" menghasilkan ID `mock_…` yang diberi label jelas di UI, dan tidak ada yang dikirim ke platform.
- Instagram dan TikTok memakai adapter yang mengembalikan `permission_required` / `unsupported`, jadi alur fallback manual ikut teruji.
- AI memakai generator deterministik berlabel "AI mock".

Tanpa seed, buka `/setup` untuk membuat workspace sendiri.

### Worker latar belakang

Satu *tick* worker memulihkan job yang macet, memproses job publikasi yang jatuh tempo, menyinkronkan akun yang terhubung (konten, komentar, metrik), dan menganonimkan komentar penonton yang melewati masa retensi.

```bash
npm run worker        # loop lokal (WORKER_INTERVAL_SECONDS, default 60)
npm run worker:once   # satu tick
```

Di produksi, panggil endpoint ini dari scheduler (Vercel Cron mengirim header yang sama secara otomatis bila `CRON_SECRET` diatur):

```
POST /api/jobs/run
Authorization: Bearer $CRON_SECRET
```

Antrean juga bisa diproses dari UI: **Persetujuan → Antrean & gagal → Proses antrean sekarang**.

## Variabel lingkungan

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ya | Connection string PostgreSQL |
| `APP_URL` | ya | URL dasar aplikasi (untuk redirect OAuth) |
| `SESSION_SECRET` | ya | ≥32 karakter acak; menandatangani sesi dan menjadi kunci hash ID penonton |
| `TOKEN_ENCRYPTION_KEY` | ya | 32 byte base64; mengenkripsi token OAuth |
| `CRON_SECRET` | produksi | Rahasia untuk `/api/jobs/run` |
| `MOCK_MODE` | – | `true` (default) = data demo + adapter mock |
| `ENABLE_LIVE_PUBLISHING` | – | `false` (default) = draf yang disetujui masuk alur manual. Set `true` hanya setelah endpoint, izin, dan alur persetujuan diuji |
| `ANTHROPIC_API_KEY` | – | Kunci Claude API; tanpa kunci → generator mock |
| `ANTHROPIC_MODEL` | – | Default `claude-opus-5-5` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | untuk YouTube | OAuth client tipe *Web application*; redirect URI `${APP_URL}/api/oauth/youtube/callback` |

Semua rahasia hanya dibaca di server (`src/lib/env.ts`) dan tidak pernah dikirim ke browser atau ditulis ke log.

## Izin API per platform

Akses aktual bergantung pada jenis akun, izin yang disetujui, wilayah, dan status aplikasi. Verifikasi ulang di dokumentasi resmi sebelum mengaktifkan publikasi produksi.

| Platform | Status di MVP | Yang dibutuhkan |
|---|---|---|
| **YouTube** | Adapter penuh (`src/lib/platforms/youtube.ts`): `channels.list`, `playlistItems.list`, `commentThreads.list`, `commentThreads.insert`, `comments.insert`, `videos.list` (statistik) | Google Cloud project dengan YouTube Data API v3 aktif, OAuth consent screen, scope `youtube.readonly` + `youtube.force-ssl`, kuota yang cukup (insert komentar memakan kuota besar) |
| **Instagram** | `permission_required` di semua kemampuan; konten dan komentar dicatat manual | Akun Professional, Meta app dengan izin komentar yang disetujui. Adapter Graph API belum dibangun |
| **TikTok** | `unsupported` untuk manajemen komentar; manual | Verifikasi produk API TikTok yang mendukung komentar organik untuk aplikasi dan akun ini. Display API **tidak** diasumsikan bisa menulis komentar |

Kemampuan yang tidak didukung selalu dilaporkan sebagai `unsupported`/`permission_required`. Adapter tidak pernah melaporkan sukses palsu.

## Keputusan teknis

- **Stack:** Next.js 16 (App Router, Cache Components) + TypeScript, Tailwind CSS 4, PostgreSQL + Prisma 6, Anthropic TypeScript SDK, Vitest.
- **UI:** komponen kecil buatan sendiri bergaya shadcn (`src/components/ui.tsx`) tanpa CLI shadcn, supaya dependensinya minimal.
- **Auth dashboard:** satu kreator per workspace, kata sandi scrypt, sesi cookie HMAC (`httpOnly`, `sameSite=lax`). Setiap halaman dan Server Action memanggil `requireCreator()` dan memeriksa kepemilikan resource.
- **AI:** `client.beta.messages.parse` dengan structured output Zod, effort `medium`, dan server-side refusal fallback (`fallbacks: "default"`). Data ke model dibatasi: hanya judul/caption/ringkasan/transkrip, dan untuk balasan hanya teks komentar (tanpa nama atau ID penulis). Input terlalu panjang ditolak di form, tidak dipotong diam-diam.
- **Idempotensi publikasi:**
  - Satu job per draf (`draftId` unik + `idempotencyKey` unik).
  - Klaim job atomik (`updateMany … where state`), jadi worker paralel tidak bisa mengambil job yang sama.
  - Jika ID komentar platform sudah tercatat, job diselesaikan tanpa memanggil platform lagi.
- **Retry:**
  - Dicoba ulang otomatis (backoff eksponensial 30 detik → maks 1 jam, maks 4 percobaan) hanya bila platform jelas menolak tanpa memproses, misalnya rate limit atau kuota.
  - Error 5xx atau putus jaringan saat menulis **tidak** dicoba ulang otomatis karena komentarnya mungkin sudah terposting.
  - Job yang macet di `running` dipindah ke `failed/unknown_outcome`. Kreator harus mengonfirmasi bahwa komentar belum muncul di platform sebelum mencoba ulang.
- **Penghentian job:** token kedaluwarsa/dicabut, error kebijakan, atau revoke dari UI membatalkan semua job antre untuk akun tersebut.
- **Privasi:** ID penonton disimpan sebagai HMAC, bukan ID mentah. Retensi komentar penonton bisa diatur (default 365 hari); setelah itu teks dan identitas dianonimkan.
- **Analitik:** komentar kreator/tim (termasuk komentar pemantik yang dipublikasikan) disimpan dengan `authorType` tersendiri dan tidak pernah masuk hitungan organik.

## Asumsi yang perlu diverifikasi

1. Scope OAuth `youtube.force-ssl` masih yang dibutuhkan untuk `commentThreads.insert`/`comments.insert`, dan field `snippet.channelId` pada insert thread masih diterima.
2. Biaya kuota YouTube untuk insert komentar dan sinkronisasi tiap 15 menit masih masuk dalam kuota proyek. Sesuaikan `SYNC_INTERVAL_MS` di `src/lib/jobs/runner.ts` bila perlu.
3. Alasan error YouTube yang dipetakan di `mapYouTubeError` (`quotaExceeded`, `commentsDisabled`, `insufficientPermissions`, …) masih sesuai dokumentasi.
4. Instagram: izin dan alur login Meta yang berlaku untuk membaca dan membalas komentar pada media milik akun Professional.
5. TikTok: apakah ada produk API yang mengizinkan manajemen komentar organik untuk aplikasi ini.
6. Ketersediaan model dan fitur Claude (`claude-opus-5-5`, structured outputs, `server-side-fallback-2026-07-01`) di akun Anthropic yang dipakai.
7. Kebijakan retensi data dan privasi sudah ditinjau terhadap ketentuan platform dan regulasi yang berlaku (mis. UU PDP).

## Pengujian

```bash
npm run lint
npm run typecheck
npm test                     # unit test (tanpa database)
TEST_DATABASE_URL=postgresql://…/engagement_test npm run test:integration
```

- **Unit:** state machine, guardrails, OAuth (state, PKCE, error tanpa kebocoran rahasia), adapter YouTube (parsing, body request, pemetaan error), adapter manual, kebijakan retry/backoff, rumus metrik, parser URL, enkripsi token, sesi, hash kata sandi, redaksi audit, generator mock.
- **Integrasi (PostgreSQL asli):** tidak ada publikasi tanpa persetujuan, konfirmasi akun penerbit, blokir guardrail, isolasi antar-kreator, satu job per draf, worker paralel hanya memposting sekali, retry dengan backoff, error tak pasti tidak diulang, fallback manual, penghentian job saat token ditolak, pemulihan job macet, ingest komentar (kreator/tim/penonton + hash ID), anonimisasi retensi.

Database integrasi di-*truncate* di setiap test, jadi pakai database sekali pakai.

## Struktur

```
prisma/schema.prisma          Skema data (blueprint bagian 10)
prisma/seed.ts                Data demo untuk MOCK_MODE
src/app/(auth)/               /setup, /login
src/app/(dashboard)/          Ringkasan, Akun, Konten, Inbox, Persetujuan, Analitik, Audit log
src/app/actions.ts            Server Actions (selalu cek sesi + kepemilikan)
src/app/api/oauth/youtube/    OAuth start & callback
src/app/api/jobs/run/         Endpoint worker terjadwal
src/lib/platforms/            PlatformAdapter + YouTube, manual (IG/TikTok), mock, registry
src/lib/ai/                   Prompt, skema output, panggilan Claude, guardrails
src/lib/drafts/               State machine + layanan approval
src/lib/publishing/           Job publikasi idempoten, kebijakan retry
src/lib/jobs/                 Sinkronisasi, retensi, worker tick
src/lib/analytics/            Rumus metrik & laporan
scripts/worker.ts             Worker lokal
tests/integration/            Test integrasi PostgreSQL
```

## Sebelum produksi

- Jangan aktifkan `ENABLE_LIVE_PUBLISHING=true` sebelum endpoint, izin, kuota, dan alur persetujuan diuji dengan akun YouTube uji.
- Simpan rahasia di secret manager atau environment variables platform hosting, jangan di repository.
- Jalankan `npm run db:deploy` saat deploy, lalu jadwalkan `/api/jobs/run`.
