# DKE Media Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugin Paseo privat DKE yang menampilkan audio, video, PDF, docx/pptx (via LibreOffice → PDF), dan xlsx (tabel SheetJS) di panel file web UI, plus kartu media di chat.

**Architecture:** Satu plugin di `dke-plugins/media-preview/` (client + server). Server (subprocess daemon) memegang validasi path, baca file per potongan, dan antrean konversi LibreOffice ber-cache. Client mendaftarkan file panel dan timeline transformer/renderer; elemen `<audio>/<video>` dan `URL.createObjectURL` hanya di modul `.web.tsx`.

**Tech Stack:** TypeScript, React Native (Web), `@getpaseo/plugin` 0.15.4, Zod, Vitest, SheetJS (`xlsx`), Node `child_process`/`fs`/`crypto`, LibreOffice `soffice --headless`.

**Spec:** `docs/superpowers/specs/2026-11-16-dke-media-preview-design.md`

## Global Constraints

- Manifest: `{"id":"dke-media-preview","requirements":{"paseo":">=0.15.0"}}`.
- Modul hanya di `client/`, `server/`, `shared/` (aturan bundler plugin); root hanya `index.client.tsx`, `index.server.ts`, manifest, package/tsconfig.
- Kode inti Paseo (`packages/*`) tidak diubah.
- Root baca yang diizinkan: direktori semua workspace (`PaseoWorkspace.directory` dari `paseo.workspaces.list()`) + `/tmp`, `/private/tmp`, `~/Downloads`, `~/Desktop`, `~/Documents`. Dicek dengan `realpath`.
- Konstanta (satu file `shared/limits.ts`): `CHUNK_BYTES = 4 * 1024 * 1024`, `PANEL_AUTOLOAD_MAX_BYTES = 300 * 1024 * 1024`, `CHAT_CARD_MAX_BYTES = 50 * 1024 * 1024`, `CONVERT_TIMEOUT_MS = 60_000`, `CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024`, `SHEET_MAX_ROWS = 5000`.
- Ekstensi (`shared/kinds.ts`): audio `mp3 wav m4a aac ogg oga flac opus`; video `mp4 m4v webm mov ogv`; pdf `pdf`; office `docx doc odt rtf pptx ppt odp`; sheet `xlsx xls ods`.
- Konversi: `nice -n 10 /opt/homebrew/bin/soffice --headless -env:UserInstallation=file://<cacheDir>/lo-profile --convert-to pdf --outdir <tmpdir> <file>`; maksimal satu proses sekaligus.
- Cache: `${PASEO_HOME ?? ~/.paseo}/plugin-cache/dke-media-preview/`.
- Setiap RPC < 30 s (batas runtime); kerja panjang = job + polling.
- Warna/jarak dari `theme` prop; tanpa nilai hard-coded. Teks UI dalam Bahasa Indonesia.
- Mac bersama: build/tes dengan `nice -n 10`; jalankan hanya file tes yang diubah (`npx vitest run <file> --bail=1`); **jangan restart/menyentuh daemon 6767** — uji di daemon terisolasi port 6799.

## Review Focus

1. Nama file dengan spasi, unicode, atau tanda kurung (di chat dan di nama output soffice) → tetap ditemukan dan dikonversi. Tes: Task 1 (`resolveAllowedPath`), Task 3 (`converts file with spaces`), Task 6 (`finds paths with spaces in backticks`).
2. Dua tab membuka pptx yang sama bersamaan → satu konversi, keduanya dapat hasil. Tes: Task 3 (`dedupes concurrent jobs`).
3. File berubah setelah dikonversi → konversi ulang, bukan hasil basi. Tes: Task 3 (`cache key changes with mtime`).
4. Symlink di dalam root yang menunjuk ke luar root → ditolak. Tes: Task 1 (`rejects symlink escaping root`).
5. Dokumen rusak/berpassword membuat soffice gagal atau menggantung → error terbaca, proses dibunuh saat timeout/batal. Tes: Task 3 (`timeout kills process`, `reports converter failure`).

---

### Task 1: Scaffold plugin + penjaga path

**Files:**

- Create: `dke-plugins/media-preview/` (via `node packages/cli/bin/paseo plugin init /Users/itdke/tools/paseo/dke-plugins/media-preview`, lalu hapus contoh greeting)
- Create: `dke-plugins/media-preview/shared/limits.ts`, `shared/kinds.ts`, `server/paths.ts`
- Test: `dke-plugins/media-preview/server/paths.test.ts`

**Interfaces:**

- Produces: `fileKind(path: string): MediaKind | null` dengan `type MediaKind = "audio" | "video" | "pdf" | "office" | "sheet"`; `EXTENSIONS: Record<MediaKind, readonly string[]>`; konstanta di Global Constraints.
- Produces: `allowedRoots(workspaceDirs: string[], home: string): string[]`; `resolveAllowedPath(path: string, roots: string[]): Promise<string>` → realpath, atau melempar `PathNotAllowedError`.

- [ ] **Step 1: Tes gagal** — `paths.test.ts` dengan direktori sementara:
  - `resolves file inside root` → mengembalikan realpath.
  - `resolves file with spaces and unicode` (`"rapat (final) é.docx"`).
  - `rejects ../ traversal` → `PathNotAllowedError`.
  - `rejects symlink escaping root` (symlink di root → file di luar) → `PathNotAllowedError`.
  - `allowedRoots includes tmp, private tmp, Downloads, Desktop, Documents and workspace dirs`.
  - `fileKind("A.MP3") === "audio"`, `fileKind("x.csv") === null`.
- [ ] **Step 2:** `cd dke-plugins/media-preview && npx vitest run server/paths.test.ts --bail=1` → FAIL (modul belum ada).
- [ ] **Step 3:** Implementasikan; root juga di-`realpath` (`/tmp` → `/private/tmp`), cek prefix dengan pemisah `path.sep`.
- [ ] **Step 4:** Tes PASS; `npx tsc --noEmit -p .` bersih.
- [ ] **Step 5:** Commit `feat(dke-media-preview): scaffold plugin dan penjaga path`.

### Task 2: RPC baca file per potongan

**Files:**

- Create: `shared/rpc.ts`, `server/read.ts`, `client/read-chunks.ts`; Modify: `index.server.ts`
- Test: `server/read.test.ts`, `client/read-chunks.test.ts`

**Interfaces:**

- Consumes: `resolveAllowedPath`, `allowedRoots`, `CHUNK_BYTES`.
- Produces RPC (`defineRpc`):
  - `fileStat` name `dke-media.file.stat`: in `{ path }` → out `{ size: number, mtimeMs: number, mimeType: string }`.
  - `fileRead` name `dke-media.file.read`: in `{ path, offset: number }` → out `{ base64: string, nextOffset: number, eof: boolean }` (maks `CHUNK_BYTES`).
- Produces server: `createReadHandlers(getRoots: () => Promise<string[]>)` → `{ stat, read }`; `index.server.ts` mendaftarkan dengan `getRoots` dari `paseo.workspaces.list()` + `os.homedir()`.
- Produces client: `readAllChunks(call: (offset: number) => Promise<{base64: string; nextOffset: number; eof: boolean}>, maxBytes: number, size: number): Promise<Uint8Array>` — menolak dengan `TooLargeError` bila `size > maxBytes`.

- [ ] **Step 1: Tes gagal** — `read.test.ts`: `reads 9 MB file in 3 chunks` (offset 0, 4 MiB, 8 MiB; chunk terakhir `eof: true`); `stat returns mime audio/mpeg for .mp3`; `read outside roots throws`. `read-chunks.test.ts`: `reassembles chunks byte-exact`; `rejects TooLargeError before first call`.
- [ ] **Step 2:** Jalankan kedua file → FAIL.
- [ ] **Step 3:** Implementasi (`fs.open` + `read` posisi; mime dari ekstensi via peta kecil di `shared/kinds.ts`).
- [ ] **Step 4:** PASS + typecheck.
- [ ] **Step 5:** Commit `feat(dke-media-preview): RPC baca file per potongan`.

### Task 3: Antrean konversi LibreOffice + cache

**Files:**

- Create: `server/convert.ts`, `server/cache.ts`; Modify: `shared/rpc.ts`, `index.server.ts`
- Test: `server/convert.test.ts`, `server/cache.test.ts`

**Interfaces:**

- Consumes: `resolveAllowedPath`, `CONVERT_TIMEOUT_MS`, `CACHE_MAX_BYTES`, `CHUNK_BYTES`.
- Produces: `cacheKey(realPath: string, size: number, mtimeMs: number): string` (sha256 hex); `pruneCache(dir: string, maxBytes: number): Promise<void>` (hapus PDF dengan atime terlama sampai ≤ max).
- Produces: `class ConversionQueue { constructor(opts: { cacheDir: string; runConverter: (input: string, outDir: string, signal: AbortSignal) => Promise<void>; timeoutMs: number }); start(realPath: string): Promise<{ jobId: string; cached: boolean }>; status(jobId: string): { state: "queued" | "running" | "done" | "error" | "cancelled"; error?: string; size?: number }; cancel(jobId: string): void; pdfPath(jobId: string): string }`. `jobId` = cache key (dedupe alami).
- Produces: `runSoffice(input, outDir, signal)` — spawn sesuai Global Constraints, `signal` → `kill("SIGKILL")` pada grup proses; gagal bila exit ≠ 0 atau PDF tidak ada (stderr dalam pesan).
- Produces RPC: `dke-media.convert.start` `{ path }` → `{ jobId, cached }`; `dke-media.convert.status` `{ jobId }` → status di atas; `dke-media.convert.cancel` `{ jobId }` → `{}`; `dke-media.convert.read` `{ jobId, offset }` → bentuk sama dengan `fileRead`.

- [ ] **Step 1: Tes gagal** (converter palsu yang menulis PDF dummy / menunggu / gagal):
  - `cache hit returns cached true without running converter`.
  - `dedupes concurrent jobs` — dua `start` sama → converter dipanggil sekali.
  - `cache key changes with mtime`.
  - `runs one conversion at a time` — job kedua `queued` selama job pertama `running`.
  - `timeout kills process` — converter menunggu signal; setelah `timeoutMs` status `error`, signal aborted.
  - `cancel aborts running job` → `cancelled`.
  - `reports converter failure` → `error` dengan pesan stderr.
  - `pruneCache keeps total under max, oldest first`.
  - Integrasi nyata (lewati kecuali `RUN_SOFFICE=1`): `converts file with spaces` — docx kecil bernama `"Laporan Q3 (rev).docx"` dibuat dengan `soffice --convert-to docx` dari `.txt` → PDF ada, diawali `%PDF`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementasi. Nama output soffice = basename tanpa ekstensi + `.pdf` di `outDir` sementara; pindahkan ke `<cacheDir>/<key>.pdf`. Panggil `pruneCache` setelah tiap konversi selesai.
- [ ] **Step 4:** PASS; lalu sekali `RUN_SOFFICE=1 nice -n 10 npx vitest run server/convert.test.ts -t "converts file with spaces"` PASS; catat `uptime` sebelum/sesudah.
- [ ] **Step 5:** Commit `feat(dke-media-preview): antrean konversi LibreOffice ber-cache`.

### Task 4: Panel audio, video, PDF

**Files:**

- Create: `client/media-element.web.tsx`, `client/media-element.tsx` (fallback native: `DocumentFrame`), `client/panels/media-panel.tsx`, `client/panels/pdf-panel.tsx`, `client/size-gate.tsx`, `client/autoload.ts`; Modify: `index.client.tsx`
- Test: `client/autoload.test.ts`

**Interfaces:**

- Consumes: `EXTENSIONS`, `PANEL_AUTOLOAD_MAX_BYTES`.
- Produces: `shouldAutoLoad(size: number, max: number): boolean`; `<MediaElement kind="audio" | "video" url={string} theme={PluginTheme} />`; `<SizeGate size={number} max={number} onLoad={() => void} theme />` (teks: "File ini {ukuran}. Muat untuk diputar?" + tombol "Muat").
- Panel: `addFilePanel` id `audio` (title "Audio", icon `Music`), `video` ("Video", `Film`), `pdf` ("PDF", `FileText`). Sumber byte = `useFileUrl(file)` (file workspace), dipanggil hanya setelah gate lolos.

- [ ] **Step 1:** Tes gagal `autoload.test.ts`: `shouldAutoLoad(300 MiB, 300 MiB) === true`, `shouldAutoLoad(300 MiB + 1, 300 MiB) === false`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi; `media-element.web.tsx` memakai `React.createElement("audio"|"video", { src, controls: true, preload: "metadata", style })` — komentar `// REJECT plugin no-HTML rule — lihat spec`.
- [ ] **Step 4:** PASS + typecheck (`lib` DOM hanya lewat `/// <reference lib="dom" />` di file `.web.tsx` itu saja).
- [ ] **Step 5:** Commit `feat(dke-media-preview): panel audio, video, PDF`.

### Task 5: Panel office dan sheet

**Files:**

- Create: `client/panels/office-panel.tsx`, `client/blob-url.web.ts`, `client/blob-url.ts` (native: tulis tidak didukung → pesan), `client/panels/sheet-panel.tsx`, `client/sheet/parse.ts`; Modify: `index.client.tsx`, `package.json` (dep `xlsx`)
- Test: `client/sheet/parse.test.ts`, `client/panels/office-state.test.ts`

**Interfaces:**

- Consumes: RPC Task 2 & 3, `readAllChunks`, `SHEET_MAX_ROWS`.
- Produces: `toBlobUrl(bytes: Uint8Array, mime: string): string` (web) ; `parseWorkbook(bytes: Uint8Array, maxRows: number): { sheets: { name: string; rows: string[][]; truncated: boolean }[] }`.
- Produces: `officeReducer(state, event)` — state `idle | converting | loading | ready | error | cancelled`; event dari polling status (interval 1 s).
- Office panel ("Dokumen", icon `FileText`): start → poll status → read chunks → `toBlobUrl(..., "application/pdf")` → `DocumentFrame`. Saat `converting`: "Mengonversi dokumen…" + tombol "Batal" (`convert.cancel`). Error: pesan + "Coba lagi".
- Sheet panel ("Spreadsheet", icon `Sheet`): `useFileBytes` → `parseWorkbook` → tab per sheet (Pressable) + `FlatList` baris, baris pertama sebagai header sticky; bila `truncated`: "Menampilkan 5.000 baris pertama". Tombol "Lihat sebagai PDF" memakai alur office.

- [ ] **Step 1: Tes gagal:** `parseWorkbook` atas xlsx 2 sheet yang dibuat dengan `XLSX.utils.book_new` di tes → nama & sel benar; `truncates at maxRows`; `officeReducer`: `done → loading`, `error` membawa pesan, `cancel` dari `converting → cancelled`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS + typecheck.
- [ ] **Step 5:** Commit `feat(dke-media-preview): panel office (LibreOffice) dan sheet (SheetJS)`.

### Task 6: Kartu media di chat

**Files:**

- Create: `client/chat/find-paths.ts`, `client/chat/transform.ts`, `client/chat/media-message.tsx`, `shared/media-message.ts` (schema Zod); Modify: `index.client.tsx`
- Test: `client/chat/find-paths.test.ts`, `client/chat/transform.test.ts`

**Interfaces:**

- Consumes: `fileKind`, RPC `fileStat`/`fileRead`, `readAllChunks`, `CHAT_CARD_MAX_BYTES`, `MediaElement`, `toBlobUrl`.
- Produces: `findMediaPaths(text: string): { path: string; kind: MediaKind }[]` — path absolut (`/…`, `~/…`) di teks biasa, di backtick, dan target link markdown `[x](/a/b.mp3)` / `file://`; unik, urutan kemunculan; abaikan URL `http(s)`.
- Produces: transformer `{ id: "media-message", query: { itemType: "assistant_message" } }` — `phase === "streaming"` → `undefined`; tanpa match → `undefined`; ada match → `{ items: [{ type: "plugin", kind: "dke-media-message", version: 1, data: { text, files } }] }`.
- Renderer `dke-media-message` v1: `<Markdown>{data.text}</Markdown>` lalu kartu per file. Audio/video: stat → bila ≤ `CHAT_CARD_MAX_BYTES` tombol "Putar" (baru membaca byte saat ditekan) → `MediaElement`; selain itu/terlalu besar: kartu nama + ukuran + link markdown ke path (pakai `Markdown` agar handler link file inti membuka panel). Path ditolak server → kartu "Tidak bisa dibaca (di luar folder yang diizinkan)".

- [ ] **Step 1: Tes gagal** `find-paths.test.ts`: `finds absolute path in prose`; `finds paths with spaces in backticks` (`` `/tmp/rapat final.mp3` ``); `finds markdown link target`; `ignores https URLs`; `dedupes`; `returns [] for csv`. `transform.test.ts`: `streaming returns undefined`; `no media returns undefined`; `complete with media returns one dke-media-message item carrying original text`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS + typecheck.
- [ ] **Step 5:** Commit `feat(dke-media-preview): kartu media di chat`.

### Task 7: Uji terisolasi lalu pasang

**Files:**

- Create: `dke-plugins/media-preview/README.md` (pasang, uji, batas, rollback)

- [ ] **Step 1:** Daemon terisolasi: `T=$(mktemp -d); PASEO_HOME=$T PASEO_LISTEN=127.0.0.1:6799 PASEO_WEB_UI_ENABLED=true nice -n 10 node packages/cli/bin/paseo daemon run &`; `node packages/cli/bin/paseo --host 127.0.0.1:6799 plugin install /Users/itdke/tools/paseo/dke-plugins/media-preview`; `paseo --host 127.0.0.1:6799 plugin logs dke-media-preview` → `Plugin ready`, tanpa stderr.
- [ ] **Step 2:** Uji mata di browser (`http://127.0.0.1:6799`, browser-harness): buka satu file tiap jenis (mp3, mp4, pdf, docx, pptx, xlsx) + satu video > 300 MB (gate muncul) + satu pesan agen berisi path mp3 (kartu muncul, teks pesan sama). Lampirkan screenshot; jalankan uji juling pada panel office & kartu chat.
- [ ] **Step 3:** Hentikan daemon uji, `rm -rf $T`, pastikan port 6799 kosong.
- [ ] **Step 4:** **Minta izin user**, lalu pasang ke daemon produksi: `paseo plugin install /Users/itdke/tools/paseo/dke-plugins/media-preview` (tanpa restart daemon); cek `paseo plugin logs dke-media-preview`.
- [ ] **Step 5:** Commit `docs(dke-media-preview): README pemasangan dan uji`.
