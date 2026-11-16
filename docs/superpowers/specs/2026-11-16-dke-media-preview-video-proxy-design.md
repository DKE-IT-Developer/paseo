# DKE Media Preview — pratinjau ringan + progres untuk kartu chat

Tanggal: 2026-11-16 · Lanjutan dari `2026-11-16-dke-media-preview-design.md` · Disetujui user: opsi 3
("indikator progres + pratinjau ringan dibuat di Mac mini").

## Masalah (terukur)

Kartu chat mengirim seluruh file asli lewat RPC per potongan 4 MB. Lewat paseo.dke.dev (Cloudflare
tunnel) satu potongan butuh ±9,8 s (±570 KB/s); video 25 MB ±62 s. Loopback: 20–30 ms per potongan.
Selama transfer kartu hanya menulis "Memuat…", dan request lain di koneksi yang sama ikut antre
(log: file explorer 21 s, `Transport closed`).

## Keputusan

1. **Progres + batal.** `readAllChunks` menerima `onProgress(read, total)` dan `signal: AbortSignal`.
   Kartu menampilkan "Memuat {x} / {y}" (formatSize) dan tombol "Batal".
2. **Pratinjau ringan di server.** Job ffmpeg memakai pola yang sama dengan konversi LibreOffice
   (start/status/cancel/read, cache per `realPath+size+mtime`, `nice -n 10`, satu proses sekaligus,
   timeout, kill grup proses).
   - Video → `mp4` H.264, maks tinggi 540 px, CRF 30, `maxrate 1M`, AAC 96k stereo, `+faststart`.
   - Audio → `mp3` 128 kbps (hanya dipakai bila file asli > `DIRECT_PLAY_MAX_BYTES`).
   - Antrean ffmpeg terpisah dari antrean soffice (satu ffmpeg sekaligus); cache dir sama, nama
     file `<key>.preview.mp4|mp3`, ikut pruneCache yang sama.
3. **Alur kartu (audio/video):**
   - Ukuran ≤ `DIRECT_PLAY_MAX_BYTES` (4 MB): putar file asli seperti sekarang (dengan progres).
   - Lebih besar: "Putar" → "Menyiapkan pratinjau…" (+ Batal) → baca pratinjau dengan progres →
     putar. Di bawah pemutar: "Putar kualitas asli ({ukuran})" memakai jalur asli dengan progres
     (tetap dibatasi `CHAT_CARD_MAX_BYTES`).
   - Native (mobile): sama, audio lewat `playAudio`; video tetap "hanya di web".
4. Konstanta baru di `shared/limits.ts`: `DIRECT_PLAY_MAX_BYTES = 4 MB`, `PREVIEW_TIMEOUT_MS =
180_000`, `PREVIEW_MAX_HEIGHT = 540`.

## Non-goals

- Panel file audio/video (tab Files) tetap memakai `useFileUrl` host; tidak diubah di sini.
- Streaming HTTP/seek parsial dari daemon.

## Risiko

- CPU: ffmpeg per video baru (beberapa detik–puluhan detik) di Mac bersama; dimitigasi `nice`,
  satu proses, cache.
- Pratinjau bisa beda dari asli (resolusi/bitrate lebih rendah) — label "Pratinjau" di kartu.
