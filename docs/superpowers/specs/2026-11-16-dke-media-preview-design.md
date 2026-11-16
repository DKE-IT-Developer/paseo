# DKE Media Preview — plugin Paseo untuk audio, video, PDF, docx, sheet, slide

Tanggal: 2026-11-16 · Basis: Paseo v0.15.4 (fork `DKE-IT-Developer/paseo`, branch `dke/custom`)

## Intent

Web UI Paseo (paseo.dke.dev) saat ini hanya bisa mempratinjau Markdown, HTML, gambar, dan teks.
File biner yang sering dihasilkan atau dipakai agen di DKE — audio, video, PDF, Word, Excel,
PowerPoint — tampil sebagai "Binary preview unavailable", dan di chat hanya muncul sebagai link
teks. User ingin pengalaman mendekati Claude Code desktop: file media bisa diputar/dilihat langsung
di panel file **dan** di chat pane, dari browser.

## Goals

1. Panel file (tab Files) untuk: audio, video, PDF, docx, xlsx, pptx (plus format kantor lama/ODF
   yang LibreOffice bisa baca).
2. Di chat pane: pesan agen yang menyebut path file berjenis di atas menampilkan kartu pratinjau
   (pemutar audio/video, thumbnail/halaman pertama dokumen) di bawah teks pesan; klik kartu membuka
   file di panel penuh.
3. Bekerja di web UI daemon (browser). Desktop/Electron ikut bila gratis.

## Non-goals

- Mengedit dokumen (read-only).
- Pemutaran streaming/seek parsial dari daemon untuk file sangat besar (lihat Constraints).
- Aplikasi mobile native (iOS/Android) — boleh menampilkan pesan "tidak didukung" via
  `DocumentFrame`, tidak dioptimalkan.
- Mengubah kode inti Paseo (`packages/*`).

## Anti-goals (gagal walau "jalan")

- Konversi dokumen yang membuat beban CPU Mac mini bersama melonjak dan mengganggu layanan suara
  real-time (insiden 7 Nov 2026).
- Plugin yang memaksa konflik rebase setiap upgrade upstream.
- Pesan chat yang tampil berbeda/kehilangan format dibanding renderer bawaan, hanya karena ada
  link media di dalamnya.

## Constraints

- **Paseo plugin API** (≥0.13): `addFilePanel`, `useFileUrl`/`useFileBytes`, `DocumentFrame`,
  `Loading`, `addTimelineTransformer`/`addTimelineRenderer`, `Markdown` (client/ui), plugin RPC
  (`defineRpc`, `server.handle`, `useRpc`). Referensi: `public-docs/plugins/reference.md`.
- `useFileUrl` membuat `blob:` dari **seluruh** byte file di browser. Video/audio besar harus
  dibatasi: di atas ambang (usulan 300 MB) panel menampilkan ukuran + tombol "Muat tetap"/unduh,
  bukan memuat otomatis.
- Jangan membangun URL daemon dari `file.path` (dilarang dokumen API).
- Timeline renderer hanya menerima `agentId`, `item`, `theme`, `host`, `layout` — tidak ada
  `PluginFile`. Byte untuk kartu chat diambil lewat RPC plugin di daemon, dengan batas ukuran.
- Transformer chat menggantikan **seluruh** item pesan asisten; replacement harus merender teks
  asli lewat `Markdown` dari `@getpaseo/plugin/client/ui` agar format tetap sama.
- LibreOffice terpasang: `/opt/homebrew/bin/soffice` (LibreOffice.app). Konversi dijalankan
  dengan `nice -n 10`, satu konversi sekaligus (antrean), timeout (usulan 60 s), profil user
  LibreOffice terpisah (`-env:UserInstallation=file://…`) agar tidak bentrok dengan instance GUI.
- **RPC plugin putus di 30 s** (`packages/server/src/server/plugins/runtime.ts:41`) dan tidak bisa
  di-abort dari client (`packages/plugin/src/rpc.ts`). Karena itu konversi memakai pola job:
  `convert.start` → `convert.status` (polling) → `convert.cancel` (membunuh proses soffice) →
  `convert.read`. _Keputusan asisten, dari builder check._
- **Batas frame WebSocket**: paseo.dke.dev = cloudflared → `127.0.0.1:6767` langsung (relay mati),
  batas 100 MB per pesan (`packages/protocol/src/websocket-message-limit.ts`). Byte dari server
  dikirim per potongan (usulan 4 MB per `*.read` chunk), tidak sekaligus. _Keputusan asisten._
- **Aturan plugin melarang elemen HTML** (`public-docs/plugins/reference.md:263`). Pemutar
  audio/video adalah pengecualian sadar: di `layout.platform === "web"` plugin membuat elemen
  `<audio>`/`<video>` lewat `React.createElement` dalam modul khusus web; di native fallback ke
  `DocumentFrame`/pesan "tidak didukung". Plugin ini privat DKE, tidak dipublikasi ke registry.
  _Keputusan asisten:_ `REJECT aturan "no HTML element" — RN tidak punya pemutar media lintas
  platform di SDK plugin — elemen web dijaga platform + fallback native.\*
- Cache hasil konversi di daemon: `${PASEO_HOME:-~/.paseo}/plugin-cache/dke-media-preview/` (SDK tidak
  menyediakan direktori data; baca env, fallback path tetap — _keputusan asisten_) dengan kunci
  `sha256(path + size + mtime)`; batas total cache (usulan 2 GB, LRU).
- **Root yang boleh dibaca RPC** (keputusan user 2026-11-16): direktori workspace/cwd agent **+**
  `/tmp` (juga `/private/tmp`), `~/Downloads`, `~/Desktop`, `~/Documents`. Validasi di server:
  `realpath` harus berada di dalam salah satu root; tolak traversal dan symlink yang keluar root.
  Daftar root tambahan di satu konstanta server. Risiko diterima user: siapa pun yang login ke
  paseo.dke.dev dapat mempratinjau file di folder-folder itu.

## Approaches

|                 | Pendekatan                                                                                                                                                                                                                                  | Trade-off                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **A (dipilih)** | Plugin DKE; docx/pptx dikonversi ke PDF oleh LibreOffice di daemon, ditampilkan via `DocumentFrame`; **xlsx dirender SheetJS di browser** sebagai tabel interaktif; audio/video dengan elemen native browser; PDF langsung `DocumentFrame`. | Fidelity terbaik untuk Word & slide; sheet tetap bisa dijelajah. Biaya: CPU konversi (diredam nice+antrean+cache), buka pertama ±2–5 s. |
| B               | Plugin; semua dirender di browser (docx-preview, SheetJS, lib pptx).                                                                                                                                                                        | Nol CPU server, tetapi render pptx sering rusak; tiga library, hasil tidak konsisten.                                                   |
| C               | Patch kode inti (renderer markdown & catalog file panel).                                                                                                                                                                                   | Integrasi paling mulus, tapi fork inti → konflik setiap upgrade; API plugin sudah cukup.                                                |

User memilih **A dengan variasi sheet (SheetJS)** pada 2026-11-16 atas rekomendasi asisten.

## Desain

### Lokasi & pemasangan

- Kode plugin: `dke-plugins/media-preview/` di repo fork (bukan `plugins/`, yang dibundel sebagai
  bawaan). _Keputusan asisten._
- Dipasang dengan `paseo plugin install /Users/itdke/tools/paseo/dke-plugins/media-preview`;
  manifest `requirements.paseo: ">=0.15.0"`.
- Dependensi plugin (dipasang di direktori plugin): `xlsx` (SheetJS) untuk client. Server tanpa
  dependensi tambahan (Node `child_process`, `crypto`, `fs`).

### Panel file (client)

| Panel id | Ekstensi                                                                   | Render                                                                                                                                  |
| -------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `audio`  | mp3, wav, m4a, aac, ogg, oga, flac, opus, webm(audio)                      | `<audio controls>` dari `useFileUrl` (web); nama file, durasi, ukuran                                                                   |
| `video`  | mp4, m4v, webm, mov, ogv                                                   | `<video controls>` dari `useFileUrl` (web)                                                                                              |
| `pdf`    | pdf                                                                        | `DocumentFrame` (seperti `plugin-examples/pdf-panel`)                                                                                   |
| `office` | docx, doc, odt, rtf, pptx, ppt, odp, key? (tidak; Keynote di luar cakupan) | RPC `convert.toPdf` → PDF base64 → `blob:` → `DocumentFrame`                                                                            |
| `sheet`  | xlsx, xls, ods, csv? (csv sudah teks → tidak diklaim)                      | `useFileBytes` → SheetJS → tabel dengan tab per sheet, header beku, virtualisasi baris; tombol "Lihat sebagai PDF" memakai jalur office |

- Ambang ukuran (audio/video/office/sheet) sebelum memuat otomatis. Di atasnya: info + tombol.
- Keadaan: memuat, mengonversi (dengan progres tak tentu + tombol batal), error konversi (pesan
  dari LibreOffice, tombol coba lagi), file terhapus (`watch` → deleted), format tak didukung
  browser (mis. mov HEVC di Firefox → pesan + unduh).
- Mengikuti token tema dari `theme` prop; tanpa warna hard-coded.

### Server (RPC)

- `convert.start({ path, workspaceId })` → `{ jobId, cached }`; `convert.status({ jobId })`;
  `convert.cancel({ jobId })`; `convert.read({ jobId, offset })` → potongan base64. Validasi path,
  cek cache, antre `nice -n 10 soffice --headless --convert-to pdf --outdir <tmp>`.
- `file.read({ path, agentId, maxBytes })` → `{ base64, mimeType, size }` untuk kartu chat;
  menolak bila melebihi `maxBytes` (kartu lalu hanya menampilkan info + "Buka di panel").
- Root yang diizinkan: direktori workspace/cwd agent diambil via `PaseoApi` (`{ paseo }`), bukan
  dari input client.

### Chat pane (client)

- `addTimelineTransformer({ itemType: "assistant_message" … })` (nama tipe pasti dicek di
  `AgentTimelineItem`): saat `phase === "complete"`, cari path/link file dengan ekstensi di atas
  (reuse pola `assistant-file-links` bila terekspos, kalau tidak regex sederhana untuk path absolut
  dan link markdown). Tidak ada match → `undefined` (pesan asli tak tersentuh). Ada match → satu
  item `dke-media-message` berisi teks asli + daftar file.
- Selama `streaming` → selalu `undefined`, supaya streaming bawaan tidak terganggu.
- **Penggantian pesan diterima user** (2026-11-16, opsi a): pada pesan yang memuat file media,
  link perintah agen dan penanda "pesan dipotong" boleh hilang. Pesan tanpa file media tidak
  disentuh. Opsi yang ditolak: baris terpisah via `timeline.append` dari daemon; patch inti.
- Renderer: `Markdown` (teks asli) + kartu per file: audio/video → pemutar kecil (byte via RPC
  `file.read` per potongan, batas usulan 50 MB); PDF/office/sheet → kartu nama+ikon+ukuran, klik membuka file di
  panel (mekanisme membuka tab dari renderer: cek `navigation`/SDK; bila tidak ada, link file
  markdown bawaan dipakai).

## Diserahkan ke builder

- Nama tipe item asisten dan cara terbaik mendeteksi path (reuse vs regex).
- Cara membuka tab file dari timeline renderer.
- Detail UI kartu & panel (ikuti doktrin `uiux-doctrine` + token tema Paseo).
- Angka ambang ukuran final dan ukuran cache (angka di atas adalah usulan, bukan aturan domain).

## Verifikasi (minimum)

- Uji unit: deteksi path di transformer, validasi path server (traversal/symlink ditolak),
  kunci cache.
- Uji di daemon terisolasi (`PASEO_HOME` sementara, port 6799) sebelum pasang ke daemon produksi.
- Uji mata di browser: satu contoh tiap format, termasuk satu file besar di atas ambang.
- Ukur beban: `uptime` sebelum/sesudah konversi pptx besar.
