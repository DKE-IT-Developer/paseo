# dke-antigravity-usage

Sumber kuota Paseo untuk Antigravity. Membaca `agy -p /quota --output-format json`
(perintah slash, dijawab CLI tanpa memanggil model, 0 token) lalu menampilkan batas mingguan
dan 5 jam per grup model di panel usage Paseo. Login dengan `GEMINI_API_KEY` tidak punya kuota
akun, jadi tidak ditampilkan.

## Pasang / perbarui

```sh
cd /Users/itdke/tools/paseo/dke-plugins/antigravity-usage && npm ci
paseo plugin install /Users/itdke/tools/paseo/dke-plugins/antigravity-usage   # pertama kali
paseo plugin reload dke-antigravity-usage                                     # sesudah mengubah kode
paseo usage --json   # cek: entri "antigravity:default" berstatus available
```

## Uji

```sh
npm test && npx tsc --noEmit
```

Fixture `test/quota.json` adalah output asli `agy` 1.5.13 (tanpa data akun). Bila format
`/quota` berubah di versi agy berikutnya, ganti fixture dan sesuaikan `server/usage.ts`.
