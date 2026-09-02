# Absensi Ekskul Paduan Suara

Aplikasi web absensi ekstrakurikuler Paduan Suara. Frontend berupa satu halaman HTML statis yang terhubung ke backend Google Apps Script (`appsscript/`) yang menulis data ke Google Sheets.

## Struktur Proyek

```
index.html            Halaman utama aplikasi (HTML semantik: header/main/footer)
app.js                Logika aplikasi (dimuat dengan <script defer>; SW didaftarkan di sini)
Absensi.md            Panduan penggunaan (dirender di modal Bantuan)
styles.css            CSS Tailwind hasil build (minified)
src/input.css         Sumber CSS (Tailwind v4 + custom styles) untuk rebuild
sw.js                 Service worker (cache aset agar akses cepat & offline)
favicon.png           Ikon tab (32x32)
choir-icon-128.png    Logo header (128px, PNG fallback)
choir-icon-128.webp   Logo header (128px, WebP - digunakan bila didukung)
choir-icon.png        Logo sumber asli 512x512
appsscript/code.gs    Backend Google Apps Script
appsscript/readme.md  Panduan deploy backend
```

## Caching (Service Worker)

`sw.js` meng-cache aset statis (CSS, JS, `Absensi.md`, ikon, logo, halaman utama) agar aplikasi terbuka cepat pada kunjungan berikutnya dan tetap bisa diakses saat offline. Strategi: **network-first** untuk navigasi halaman (selalu mengambil versi terbaru saat online), **cache-first** untuk aset statis. Cache diberi versi (`choir-absensi-v6`); versi lama otomatis dibersihkan saat aktivasi, varian aset `app.js`/`styles.css` yang sudah tidak dipakai ikut dihapus (cache tetap ramping), dan jumlah entri dibatasi (100).

Karena aset statis memakai strategi cache-first, setiap rilis memakai **cache-busting berbasis tanggal** pada `app.js` dan `styles.css` (contoh `?v=20260831`) agar browser mengambil file versi terbaru — URL baru = cache miss = unduh ulang, lalu di-cache. Bila ada beberapa deploy dalam satu hari, tambahkan akhiran (contoh `?v=20260831b`, `?v=20260831c`). Jangan pernah memakai tanggal lama lagi (risiko cache basi).

Saat deploy, selain mengganti `?v=` di `index.html`, perbarui juga `ASSET_VERSION` di `sw.js` (harus sama dengan versi `app.js`/`styles.css`) dan naikkan `CACHE_NAME` (mis. `choir-absensi-v7`) agar cache lama klien dibersihkan saat SW aktif. Service worker didaftarkan dengan `updateViaCache: 'none'` sehingga pemeriksaan pembaruan SW tidak terhalang cache HTTP browser. `CORE_ASSETS` di `sw.js` meng-precache file ber-`?v=` terkini, sehingga versi rilis langsung tersedia tanpa menunggu unduhan pertama.

## Fitur

- **Absensi dua tahap**: verifikasi identitas, lalu submit jenis latihan, catatan, dan disclaimer.
- **Login dengan Student ID atau Nama**: verifikasi mencocokkan kolom ID **atau** Nama (case-insensitive) + PIN.
- **Cegah absensi ganda**: siswa yang sudah tercatat absen hari ini otomatis diblokir.
- **Pengaturan Admin**: kunci kata sandi, ganti kata sandi, atur URL backend, rentang **Tahun ekskul padus** (MM-YYYY) yang membatasi laporan, dan **Test Koneksi** (action `ping`). Pengaturan terkunci otomatis setelah 5 menit tanpa aktivitas.
- **Laporan Absensi**: rekap absensi per tanggal (action `report`), termasuk daftar **siswa yang tidak hadir** (nama, ID, kelas). Setiap baris ditandai nomor urut (1, 2, 3, ...).
- **Daftar Siswa**: melihat data siswa dari sheet `STUDENTS` (action `students`, PIN tidak ditampilkan). Ada **filter Status** (dropdown `Aktif`/`Nonaktif`/`Semua`, default Aktif) yang berlaku untuk tampilan layar **dan** hasil cetak/PDF. Pilihan **Semua** mengelompokkan siswa berdasarkan status (Aktif/Nonaktif) dengan total siswa per kelompok, diurutkan berdasarkan nama. Setiap siswa ditandai nomor urut dan memiliki tombol **Riwayat** untuk melihat riwayat absensinya (action `history`).
- **Rate-limit login**: 5 kali percobaan verifikasi gagal pada identitas yang sama memblokir percobaan selama 5 menit (plus pengaman global untuk mencegah brute-force massal).
- **Cetak / PDF**: tombol **Print** pada Laporan Absensi, Daftar Siswa, dan modal Riwayat Absensi untuk mencetak atau menyimpan ke PDF lewat dialog print browser.
- **Mode Maintenance tersembunyi**: klik logo tengah 5x untuk menyalakan/mematikan mode perawatan (fitur ini dapat **dinonaktifkan** lewat sakelar "Klik 5x Logo" di submenu Ganti Kata Sandi Admin). Saat ON, muncul jendela kecil merah berkedip "We're Getting Things Ready", input Student ID/PIN dinonaktifkan, dan ikon Pengaturan Admin di header ikut dikunci. Status disimpan di backend (global untuk semua perangkat).
- **Ikon pada tombol**: setiap tombol aksi dilengkapi ikon SVG inline (mis. printer untuk **Print**, gembok untuk kunci/buka kunci, kunci kecil untuk Ganti Kata Sandi, jam untuk **Riwayat**) agar tampilan aplikasi lebih informatif.
- **Bantuan / Panduan**: tombol ikon `?` di kiri atas membuka modal berisi panduan penggunaan yang dirender dari `Absensi.md` (Markdown) lewat renderer Markdown ringan di `app.js`.
- **Tombol refresh**: memuat ulang aplikasi langsung dari header.

## Cara Kerja

1. Siswa memasukkan **Student ID atau Nama** dan PIN di `index.html`.
2. Frontend memanggil backend Apps Script (POST) dengan action `verify`. Backend mencocokkan Student ID **atau** Nama (case-insensitive) + PIN terhadap sheet `STUDENTS`.
3. Jika valid, siswa memilih jenis latihan, mencentang disclaimer, lalu submit (action `submit`).
4. Backend menulis baris absensi ke sheet `ATTENDANCE`, mencegah duplikat per hari per siswa.

### Pencegahan Absensi Ganda

- Pada tahap `verify`, backend memeriksa riwayat absensi hari ini (`getTodayRecord()`). Jika siswa sudah tercatat, respons menyertakan `already: true` beserta `record` (tanggal, jenis latihan, remark), lalu frontend menampilkan modal **Pemberitahuan** dan menghentikan alur.
- Pada tahap `submit`, `submitAttendance()` memeriksa ulang duplikasi sebagai pengaman tambahan terhadap race condition (bersama `LockService`).

## Cetak / PDF (Print)

Modal **Laporan Absensi**, **Daftar Siswa**, dan **Riwayat Absensi** memiliki tombol **Print** yang memicu dialog print browser (`window.print()`), sehingga pengguna dapat mencetak atau menyimpan ke PDF.

- Saat mencetak, seluruh elemen aplikasi disembunyikan dan hanya area cetak (kop + tabel) yang ditampilkan (`@media print` di `src/input.css`). Hasil cetak laporan juga memuat bagian **Siswa yang tidak hadir :** di bawah tabel absensi.
- Header tabel dicetak rata tengah (`text-align:center`).
- Halaman memakai margin `1cm` dengan footer nomor halaman otomatis **"Hal: X/Y"** (`@page` + `@bottom-center`).
- Hasil cetak **Riwayat Absensi** dikelompokkan per bulan dengan baris judul bulan (contoh "Agustus 2026 &mdash; 5 kali hadir") dan kolom: No, Tanggal, Jam, Jenis, Note, Status (kolom Jam dan Status dibuat sempit). Di bagian bawah (footnote) ada ringkasan **"- Summary Absensi Siswa -"** yang memuat total kehadiran per bulan (Bulan + Tahun) dan total keseluruhan, dengan font kecil (10px) dan posisi rapat rata kanan.
- Judul dokumen (`document.title`) sementara diubah menjadi `Absensi+<tanggal>` (laporan), `Students+<tanggal>` (daftar siswa), atau `History+<nama siswa>` (riwayat) agar nama file PDF yang disimpan lebih deskriptif, lalu dikembalikan setelah pencetakan selesai.

## Pengaturan Admin (Settings)

Klik ikon roda gigi di pojok kanan atas untuk membuka **Pengaturan Admin**:

- **Keamanan**: seluruh pengaturan dilindungi kata sandi (default `00000`, tidak ditampilkan di halaman web). Setelah terbuka, pengaturan otomatis **terkunci kembali setelah 5 menit tanpa aktivitas** (klik/ketik di dalam menu akan me-reset penghitung). Ganti kata sandi dilakukan lewat submenu **Ganti Kata Sandi Admin**.
- **Ganti Kata Sandi Admin**: submenu tersendiri di bagian paling bawah menu Pengaturan (tepat sebelum **Setup Backend**) dengan latar peringatan merah (alert). Berisi form kata sandi saat ini, kata sandi baru (minimal 4 karakter), dan konfirmasi. Submenu ini juga memuat sakelar **Klik 5x Logo (Mode Maintenance)** untuk menyalakan/mematikan mode maintenance tersembunyi (disimpan di `localStorage`, default aktif). Keduanya terkunci sampai kata sandi admin dimasukkan.
- **Koneksi Google Sheets**: simpan URL Aplikasi Web Google Apps Script (`/exec`) di menu ini. URL tersimpan di `localStorage` dan dipakai aplikasi; jika kosong, aplikasi memakai URL bawaan `GAS_WEB_APP_URL`. Tombol **Test Koneksi** memanggil action `ping` pada backend.
- **Tahun ekskul padus**: atur rentang tahun ekskul dalam format **MM-YYYY** (`Awal ekskul (MM-YYYY)` dan `Akhir ekskul (MM-YYYY)`), disimpan di `localStorage`. Semua laporan mengikuti rentang ini: **Laporan Absensi** menolak tanggal di luar rentang, dan **Riwayat Absensi** hanya menampilkan kehadiran dalam rentang (termasuk total per bulan dan ringkasan cetak). Kosongkan salah satu atau keduanya untuk menonaktifkan batasan.
- **Laporan Absensi**: masukkan tanggal untuk menampilkan rekap data absensi hari itu (nama, ID, kelas, jenis latihan, waktu, status) langsung di layar, setiap baris dengan nomor urut. Tanggal di masa depan (melebihi hari ini) ditolak. Di bawahnya tampil daftar **Siswa yang tidak hadir :** (nomor, nama diurutkan ascending, ID, kelas) yang dihitung dari siswa berstatus `ACTIVE` tanpa catatan absensi pada tanggal tersebut. Tombol **Print** mencetak/menyimpan laporan ke PDF dengan kop "LAPORAN ABSENSI PADUAN SUARA" dan header tabel di tengah. Submenu ini terkunci sampai kata sandi dimasukkan.
- **Daftar Siswa**: menampilkan siswa dari sheet `STUDENTS` (nama, ID, kelas, status Aktif/Nonaktif; PIN tidak ditampilkan), diurutkan berdasarkan nama, setiap siswa dengan nomor urut. Terdapat **filter Status** (dropdown `Aktif`/`Nonaktif`/`Semua`, default Aktif) yang memfilter tampilan dan cetak. Dengan filter **Semua**, siswa dikelompokkan per status (baris judul "Aktif (N siswa)" / "Nonaktif (N siswa)") dan diurutkan berdasarkan nama; pengelompokan yang sama juga diterapkan pada hasil cetak/PDF. Tombol **Print** mencetak/menyimpan daftar ke PDF dengan kop "DAFTAR SISWA PADUAN SUARA". Setiap siswa memiliki tombol **Riwayat** untuk membuka modal **Riwayat Absensi** (dikelompokkan per bulan, total kehadiran per bulan, nomor urut kehadiran, dan tombol **Print**). Submenu ini terkunci sampai kata sandi dimasukkan.
- **Setup Backend**: membuka panduan deploy backend.

## Setup Backend (Google Apps Script)

1. Buka Google Sheets tempat data disimpan.
2. Buat sheet dengan nama `STUDENTS` (kolom: ID, Nama, Kelas, PIN, Status) dan `ATTENDANCE` (kolom: Timestamp, Tanggal, ID, Nama, Kelas, Jenis, Remark, Status).
3. Buka **Ekstensi > Apps Script**, salin isi `appsscript/code.gs`.
4. **Terapkan > Penerapan Baru**, pilih **Aplikasi Web** (Execute as: Me, Access: Anyone).
5. Salin URL Aplikasi Web ke variabel `GAS_WEB_APP_URL` di `app.js`.

### Backend Actions (API)

Backend `appsscript/code.gs` menerima POST JSON dengan field `action`. Daftar action:

| Action | Deskripsi |
|--------|-----------|
| `verify` | Verifikasi `id` (Student ID **atau** Nama) + `pin` terhadap sheet `STUDENTS`. Mengembalikan nama, ID, dan kelas. Jika siswa sudah tercatat absen hari ini, menyertakan `already: true` + `record`. Dilindungi **rate-limit**: 5 percobaan gagal per identitas memicu blokir 5 menit (CacheService). |
| `submit` | Validasi ulang identitas, cek duplikasi per hari, lalu menulis baris ke sheet `ATTENDANCE`. |
| `ping` | Uji koneksi backend (`{ success: true }`); dipakai menu **Test Koneksi**. |
| `report` | Rekap absensi untuk tanggal tertentu (`date` format `yyyy-MM-dd`), diurutkan berdasarkan timestamp. Tanggal yang melebihi hari ini ditolak. Menyertakan `absent`: daftar siswa berstatus `ACTIVE` yang belum absen (nama diurutkan ascending, ID, kelas). |
| `maintenance` | Membaca status mode maintenance global. Jika field `value` (boolean) disertakan, menyimpan status tersebut. Nilai tersimpan di Script Properties sehingga berlaku untuk semua perangkat. |
| `students` | Daftar siswa dari sheet `STUDENTS` (tanpa PIN), diurutkan berdasarkan nama. |
| `history` | Riwayat absensi per siswa (`id`). Mengembalikan data siswa (nama, kelas) + daftar kehadiran (tanggal, jenis, catatan, status, timestamp) terbaru di atas. Dipakai tombol **Riwayat** pada modal Daftar Siswa. Ditampilkan dikelompokkan per bulan dengan total kehadiran per bulan, diurutkan menaik per bulan, dan nomor urut kehadiran per bulan. |

Dokumentasi detail ada di `appsscript/readme.md`.

### Catatan Keamanan PIN

- PIN baru dianggap sebagai hash SHA-256 (64 karakter hex) jika memenuhi pola hex 64 digit.
- PIN lama (plaintext) tetap berfungsi sebagai kompatibilitas mundur.
- Untuk bermigrasi ke hash: ganti nilai di kolom PIN sheet `STUDENTS` dengan hasil hash. Anda bisa memakai fungsi berikut di Apps Script untuk menghasilkan hash:

```javascript
function migratePinHash(studentId, pin) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('STUDENTS');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().trim().toUpperCase() === String(studentId).toUpperCase()) {
      sheet.getRange(i + 1, 4).setValue(hashPin(pin));
      return 'PIN berhasil di-hash.';
    }
  }
  return 'Student ID tidak ditemukan.';
}
```

## Rebuild CSS

`styles.css` adalah hasil build dari `src/input.css` menggunakan Tailwind v4 CLI. Tailwind memindai class pada `index.html` **dan** `app.js` (dideklarasikan lewat `@source "../app.js"` di `src/input.css`), jadi pastikan kedua file tersebut ikut dipindai sebelum build. Jika mengubah class Tailwind atau custom style, jalankan ulang:

```bash
# Sumber CSS ada di src/input.css; output ke styles.css
NODE_PATH=$(npm root -g) node "$(npm root -g)/@tailwindcss/cli/dist/index.mjs" -i src/input.css -o styles.css --minify
```

## Audit & Optimisasi yang Sudah Diterapkan

- **Tailwind Play CDN dihapus** -> diganti `styles.css` hasil build (lebih cepat, tidak render-blocking).
- **Script inline besar diekstrak** ke `app.js` (~40KB) dan dimuat dengan `<script defer>` di `<head>`, sehingga halaman langsung ter-render tanpa menunggu skrip besar selesai di-parse; pendaftaran Service Worker juga dipindah ke bagian atas `app.js`.
- **HTML semantik**: struktur memakai `<header>`, `<main>`, dan `<footer>`, serta hierarki heading diperbaiki (`h1` -> `h2` -> `h3`); `bg-gray-50` ditambahkan pada `<body>`.
- **Modal Bantuan**: tombol `?` di header membuka panduan yang dirender dari `Absensi.md` (Markdown) memakai renderer Markdown ringan tanpa pustaka eksternal.
- **Google Fonts non-blocking** + `preconnect`.
- **Logo diperkecil** dari 512x512 / 38KB menjadi 128px WebP (5KB) + fallback PNG (13KB).
- **Favicon 32x32** dibuat dari logo.
- **Meta tag tambahan**: `description` dan `theme-color`.
- **`code.gs`**: PIN di-hash (dengan fallback plaintext), validasi `type` di backend, validasi panjang input, `console.error` di catch, serta `const` untuk variabel yang tidak berubah.
- **`code.gs`**: verifikasi mendukung Student ID **atau** Nama (case-insensitive); pencegahan absensi ganda dua lapis (`getTodayRecord()` saat `verify` + `matchesToday()` saat `submit`) yang menangani sel berformat tanggal maupun teks; action baru `ping`, `report`, dan `students`.
- **Cetak ke PDF**: tombol **Print** pada modal Laporan Absensi, Daftar Siswa, dan Riwayat Absensi dengan area cetak khusus (`@media print`), header tabel rata tengah, margin `1cm`, dan footer nomor halaman **"Hal: X/Y"** (`@page` + `counter`). Hasil cetak Riwayat dilengkapi ringkasan per bulan + total kehadiran di footnote.
- **Riwayat Absensi**: tampilan dikelompokkan per bulan dengan total kehadiran per bulan ("N kali hadir"), nomor urut kehadiran per bulan (menaik), tombol **Print** (nama file PDF `History+<nama siswa>`), dan daftar siswa / laporan absensi memakai nomor urut sebagai penanda baris.
- **Filter Status di Daftar Siswa**: dropdown `Aktif`/`Nonaktif`/`Semua` (default Aktif) memfilter tampilan layar dan hasil cetak/PDF. Pilihan **Semua** mengelompokkan siswa per status (Aktif &mdash; hijau, Nonaktif &mdash; merah) dengan total per kelompok, diurutkan berdasarkan nama; pada cetak muncul baris judul grup. Tombol **Riwayat** tetap memakai indeks data asli sehingga selalu membuka riwayat siswa yang benar walau daftar difilter.
- **Cache-busting berbasis tanggal**: `?v=YYYYMMDD` pada `app.js` dan `styles.css` agar rilis baru selalu terunduh walau service worker memakai cache-first.
- **Ikon SVG pada tombol**: semua tombol aksi memakai ikon SVG inline (Heroicons) yang konsisten dengan tombol header, mis. printer untuk **Print**, gembok terbuka/tertutup untuk Buka Kunci/Kunci, wifi untuk **Test Koneksi**, kunci untuk **Ganti Kata Sandi**, jam untuk **Riwayat**, dst.
- **Submenu Ganti Kata Sandi Admin**: form ganti kata sandi dipindah dari blok Keamanan ke submenu tersendiri di bagian paling bawah menu Pengaturan (sebelum **Setup Backend**) dengan latar peringatan merah (alert) dan header merah.
- **Sakelar Klik 5x Logo**: pengaturan baru di submenu Ganti Kata Sandi Admin untuk menyalakan/mematikan mode maintenance tersembunyi (5x klik logo tengah), tersimpan di `localStorage` (kunci `logoMaintenance`).
- **Kunci otomatis Pengaturan**: 5 menit tanpa aktivitas di menu Pengaturan akan otomatis mengunci kembali (timer 5 menit di-reset oleh klik/input/change/keydown di dalam menu).
- **Mode maintenance mengunci ikon Pengaturan**: saat mode maintenance aktif, ikon Pengaturan Admin di header dinonaktifkan (`disabled` + `pointer-events-none`) dan `toggleSettingsModal()` memblokir pembukaan.
