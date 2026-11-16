# dke-media-preview

Plugin Paseo privat DKE untuk melihat berkas media langsung di Paseo:

- **Panel Files**: audio (`mp3 wav m4a aac ogg oga flac opus`), video (`mp4 m4v webm mov ogv`),
  PDF, dokumen office (`docx doc odt rtf pptx ppt odp`, dikonversi ke PDF oleh LibreOffice di
  daemon), dan spreadsheet (`xlsx xls ods`, dibaca SheetJS, tiap sheet jadi tab, ada tombol
  "Lihat sebagai PDF").
- **Kartu media di chat**: pesan asisten yang menyebut path absolut atau `~/` ke berkas media
  mendapat kartu di bawahnya. Audio/video punya tombol **Putar**; jenis lain punya tautan
  **Buka di panel**. Teks pesan tidak diubah.

Server plugin hanya membaca berkas di folder workspace mana pun yang terdaftar di daemon, plus
`/tmp`, `/private/tmp`, `~/Downloads`, `~/Desktop`, `~/Documents`. Path dicek dengan `realpath`,
jadi symlink yang keluar dari folder itu ditolak.

## Prasyarat

- Paseo daemon `>= 0.15.0`, macOS.
- LibreOffice di `/opt/homebrew/bin/soffice` (hanya untuk dokumen office).
- Dependensi plugin terpasang di folder plugin (`npm ci`, lihat di bawah). Daemon membundel
  kode klien dengan esbuild dari folder plugin dan `xlsx` tidak dijadikan external, jadi
  `node_modules/xlsx` harus ada di `dke-plugins/media-preview`. `dke-plugins` bukan workspace
  npm root, sehingga `npm ci` di root repo tidak memasangnya.
- Plugin harus aktif secara global di daemon (`"pluginsEnabled": true` di `config.json` daemon;
  bawaannya `false`). Kalau belum, `plugin install` tetap berhasil tetapi status plugin
  `disabled` dan `plugin reload` gagal dengan `Plugins are globally disabled`.

## Pasang ke daemon produksi

Belum dijalankan. Perlu izin pemilik daemon lebih dulu.

```bash
# 1. Pasang dependensi plugin (wajib, sebelum install).
cd /Users/itdke/tools/paseo/dke-plugins/media-preview && npm ci

# 2. Cek plugin aktif secara global di daemon tujuan. `daemon config get` membaca config.json
#    lokal (bawaan ~/.paseo atau $PASEO_HOME; pakai --home untuk home lain), tidak menulis.
paseo daemon config get pluginsEnabled      # harus "value": true
paseo plugin ls                             # plugin lain yang aktif berstatus running
#    Kalau false: `paseo daemon config set pluginsEnabled true` menyimpan dan mencoba
#    menerapkan ke daemon yang berjalan. Ini mengubah daemon bersama; minta izin pemiliknya,
#    dan kalau status masih `disabled` daemon perlu direstart oleh pemiliknya.

# 3. Pasang dan cek.
paseo plugin install /Users/itdke/tools/paseo/dke-plugins/media-preview
paseo plugin ls dke-media-preview           # STATUS running, ENABLED yes
paseo plugin logs dke-media-preview         # harus ada "Plugin ready"
```

Ulangi `npm ci` setiap kali `package-lock.json` plugin berubah, sebelum `plugin reload`.

Daemon tidak perlu direstart. Muat ulang tab web Paseo supaya kode klien plugin terbaca.

## Uji di daemon terisolasi

Jangan sentuh daemon `6767` atau `~/.paseo`. Shell agen Paseo mewarisi `PASEO_HOME`,
`PASEO_PASSWORD`, `PASEO_AGENT_ID`, dan `PASEO_HOSTNAMES` dari daemon produksi; buang dulu,
kalau tidak daemon uji ikut memakai password produksi dan `paseo run` menempel ke workspace
agen pemanggil.

```bash
P="node /Users/itdke/tools/paseo/packages/cli/bin/paseo"
T=$(mktemp -d /tmp/dke-paseo-home-XXXXXX)
CLEAN="env -u PASEO_PASSWORD -u PASEO_HOSTNAMES -u PASEO_AGENT_ID -u PASEO_AGENT_CWD PASEO_HOME=$T"

# 1. Jalankan sekali agar config.json terbentuk, lalu hentikan dan aktifkan plugin.
$CLEAN PASEO_LISTEN=127.0.0.1:6799 PASEO_WEB_UI_ENABLED=true PASEO_RELAY_ENABLED=false \
  PASEO_DICTATION_ENABLED=false PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD=false \
  nohup nice -n 10 $P daemon run --home $T > $T.daemon.log 2>&1 &
# tunggu "Listening on 127.0.0.1:6799" di $T.daemon.log, lalu:
kill "$(python3 -c "import json;print(json.load(open('$T/paseo.pid'))['pid'])")"
python3 - "$T/config.json" <<'PY'
import json, sys
p = sys.argv[1]; c = json.load(open(p))
c["pluginsEnabled"] = True; c["daemon"]["listen"] = "127.0.0.1:6799"
json.dump(c, open(p, "w"), indent=2)
PY
# jalankan ulang perintah daemon run di atas

# 2. Pasang dan cek. Selalu pakai --host, jangan --home (keduanya tidak boleh bersamaan).
(cd /Users/itdke/tools/paseo-media-preview/dke-plugins/media-preview && npm ci)
$CLEAN $P plugin install /Users/itdke/tools/paseo-media-preview/dke-plugins/media-preview --host 127.0.0.1:6799
$CLEAN $P plugin logs dke-media-preview --host 127.0.0.1:6799

# 3. Agen kecil untuk kartu chat (opsional)
$CLEAN $P run --host 127.0.0.1:6799 --provider claude --model haiku --cwd <folder-fixture> \
  "Tanpa tool. Balas persis: \`<folder-fixture>/nada uji.mp3\`"

# 4. Bersihkan
kill "$(python3 -c "import json;print(json.load(open('$T/paseo.pid'))['pid'])")"
nc -z 127.0.0.1 6799 || echo "6799 kosong"
rm -rf "$T" "$T.daemon.log"
```

Buka `http://127.0.0.1:6799`, pilih **Direct connection** dengan host `127.0.0.1` dan port
`6799` tanpa password, lalu **Add project** ke folder fixture.

Uji di Chrome lewat browser-harness memakai tab latar belakang. Tab itu `hidden`, sehingga tab
berkas Paseo berhenti di "Loading file..." dan Chrome menunda pemuatan `<audio>`/`<video>`.
Itu perilaku host dan browser, bukan plugin. Untuk memeriksa panel di tab latar, timpa
`document.visibilityState` lewat `Page.addScriptToEvaluateOnNewDocument`; untuk memastikan
media benar-benar berputar, pakai browser headless (Playwright), yang halamannya `visible`.

## Batas

Semua di `shared/limits.ts`:

| Konstanta                  | Nilai  | Arti                                                    |
| -------------------------- | ------ | ------------------------------------------------------- |
| `CHUNK_BYTES`              | 4 MB   | Ukuran satu potongan baca RPC                           |
| `PANEL_AUTOLOAD_MAX_BYTES` | 300 MB | Di atas ini panel menampilkan tombol **Muat** dulu      |
| `CHAT_CARD_MAX_BYTES`      | 50 MB  | Di atas ini kartu chat tidak memutar, hanya beri tautan |
| `CONVERT_TIMEOUT_MS`       | 60 s   | Konversi LibreOffice dibunuh setelah ini                |
| `CACHE_MAX_BYTES`          | 2 GB   | Batas cache PDF hasil konversi                          |
| `SHEET_MAX_ROWS`           | 5000   | Baris maksimum per sheet yang ditampilkan               |
| `SHEET_MAX_COLS`           | 200    | Kolom maksimum per sheet yang ditampilkan               |
| `SHEET_AUTOLOAD_MAX_BYTES` | 20 MB  | Di atas ini spreadsheet tidak di-parse otomatis         |

Cache konversi ada di `${PASEO_HOME:-~/.paseo}/plugin-cache/dke-media-preview/`. Satu proses
`soffice` berjalan pada satu waktu. Menutup panel atau pindah berkas membuang konversi yang
masih antre; konversi yang sudah berjalan dibiarkan selesai ke cache. Tombol **Batal**
menghentikan konversi apa pun keadaannya.

## Keterbatasan yang diketahui

Hasil uji 16 Nov 2026 di daemon terisolasi 0.15.4:

- Path dengan spasi yang **tidak** dibungkus backtick atau tautan markdown tidak dikenali,
  misalnya `/tmp/a/nada uji.mp3` polos. Agen sering menulis path tanpa backtick.
- Pemutar di kartu chat dan panel memuat seluruh berkas ke memori klien (blob), bukan streaming.

Sesuai rancangan: kartu chat dibuat dari pesan asisten yang sudah selesai, jadi tidak muncul
selama pesan masih di-stream.

## Rollback

```bash
paseo plugin disable dke-media-preview   # matikan, konfigurasi tetap
paseo plugin remove dke-media-preview    # hapus konfigurasi plugin
```

Cache konversi bisa dihapus dengan
`rm -rf ~/.paseo/plugin-cache/dke-media-preview`.
