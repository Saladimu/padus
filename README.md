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
jspdf.umd.min.js      Pustaka jsPDF 2.5.1 (UMD) untuk cetak PDF di perangkat
html2canvas.min.js    Pustaka html2canvas-pro 1.5.8 (UMD) untuk capture area cetak
favicon.png           Ikon tab (32x32)
choir-icon-128.png    Logo header (128px, PNG fallback)
choir-icon-128.webp   Logo header (128px, WebP - digunakan bila didukung)
choir-icon.png        Logo sumber asli 512x512
appsscript/code.gs    Backend Google Apps Script
appsscript/readme.md  Panduan deploy backend
```

## Caching (Service Worker)

`sw.js` meng-cache aset statis (CSS, JS termasuk `jspdf.umd.min.js` dan `html2canvas.min.js`, ikon, logo, halaman utama) agar aplikasi terbuka cepat pada kunjungan berikutnya dan tetap bisa diakses saat offline. Strategi: **network-first** untuk navigasi halaman (selalu mengambil versi terbaru saat online), **cache-first** untuk aset statis. Cache diberi versi (`choir-absensi-v3` saat ini); versi lama otomatis dibersihkan saat aktivasi, dan jumlah entri dibatasi agar cache tetap cukup besar namun tidak membengkak. Saat menambah aset baru (misal pustaka JS), daftarkan di `CORE_ASSETS` dan naikkan versi cache agar perangkat (termasuk APK) memuat versi baru.

## Fitur

- **Absensi dua tahap**: verifikasi identitas, lalu submit jenis latihan, catatan, dan disclaimer.
- **Login dengan Student ID atau Nama**: verifikasi mencocokkan kolom ID **atau** Nama (case-insensitive) + PIN.
- **Cegah absensi ganda**: siswa yang sudah tercatat absen hari ini otomatis diblokir.
- **Pengaturan Admin**: kunci kata sandi, ganti kata sandi, atur URL backend, dan **Test Koneksi** (action `ping`).
- **Laporan Absensi**: rekap absensi per tanggal (action `report`), termasuk daftar **siswa yang tidak hadir** (nama, ID, kelas).
- **Daftar Siswa**: melihat data siswa dari sheet `STUDENTS` (action `students`, PIN tidak ditampilkan).
- **Cetak / PDF**: tombol **Print** pada Laporan Absensi dan Daftar Siswa — dialog print browser di desktop, atau pembuatan PDF klien (html2canvas-pro + jsPDF) di perangkat Android/APK.
- **Mode Maintenance tersembunyi**: klik logo tengah 5x untuk menyalakan/mematikan mode perawatan. Saat ON, muncul jendela kecil merah berkedip "We're Getting Things Ready" dan input Student ID/PIN dinonaktifkan. Status disimpan di backend (global untuk semua perangkat).
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

Modal **Laporan Absensi** dan **Daftar Siswa** memiliki tombol **Print** yang mencetak atau menyimpan laporan ke PDF dalam dua mode:

1. **Desktop / browser biasa**: memicu dialog print browser (`window.print()`), sehingga pengguna dapat mencetak ke printer atau menyimpan ke PDF.
2. **Perangkat Android (WebView/APK)**: `window.print()` tidak didukung di WebView (no-op), sehingga aplikasi otomatis beralih ke **pembuatan PDF di sisi klien** — area cetak di-capture dengan `html2canvas-pro` lalu disusun menjadi PDF A4 dengan `jsPDF`. Hasil PDF disimpan lewat **Web Share API** (sheet berbagi Android, pilih "Save to Files"/Drive) bila didukung, dengan fallback ke unduhan blob (`<a download>`); keduanya memerlukan dukungan APK terhadap share/unduhan. Deteksi dilakukan lewat `userAgent` (`isAndroidEnvironment()`) dan memeriksa ketersediaan kedua pustaka.

- Saat mencetak, seluruh elemen aplikasi disembunyikan dan hanya area cetak (kop + tabel) yang ditampilkan (`@media print` di `src/input.css`). Pada mode PDF perangkat, kelas `body.pdf-report` / `body.pdf-students` menampilkan area cetak di layar agar bisa di-capture (html2canvas tidak membaca `@media print`).
- Aturan `table-layout: fixed` + `word-break: break-word` untuk tabel cetak diletakkan **di luar** `@media print` (CSS biasa) sehingga tetap berlaku saat capture html2canvas.
- Hasil cetak laporan juga memuat bagian **Siswa yang tidak hadir :** di bawah tabel absensi.
- Header tabel dicetak rata tengah (`text-align:center`).
- Halaman memakai margin `1cm` dengan footer nomor halaman otomatis **"Hal: X/Y"** (`@page` + `@bottom-center`); pada PDF perangkat, konten tinggi lebih dari satu halaman A4 otomatis dipecah (sliding per halaman).
- Judul dokumen (`document.title`) sementara diubah menjadi `Absensi+<tanggal>` (laporan) atau `Students+<tanggal>` (daftar siswa) agar nama file PDF yang disimpan lebih deskriptif (di desktop, dikembalikan setelah pencetakan selesai).

## Pengaturan Admin (Settings)

Klik ikon roda gigi di pojok kanan atas untuk membuka **Pengaturan Admin**:

- **Keamanan**: seluruh pengaturan dilindungi kata sandi (default `00000`, tidak ditampilkan di halaman web). Bisa diganti lewat menu "Ganti Kata Sandi" setelah membuka kunci.
- **Koneksi Google Sheets**: simpan URL Aplikasi Web Google Apps Script (`/exec`) di menu ini. URL tersimpan di `localStorage` dan dipakai aplikasi; jika kosong, aplikasi memakai URL bawaan `GAS_WEB_APP_URL`. Tombol **Test Koneksi** memanggil action `ping` pada backend.
- **Laporan Absensi**: masukkan tanggal untuk menampilkan rekap data absensi hari itu (nama, ID, kelas, jenis latihan, waktu, status) langsung di layar. Di bawahnya tampil daftar **Siswa yang tidak hadir :** (nomor, nama diurutkan ascending, ID, kelas) yang dihitung dari siswa berstatus `ACTIVE` tanpa catatan absensi pada tanggal tersebut. Tombol **Print** mencetak/menyimpan laporan ke PDF dengan kop "LAPORAN ABSENSI PADUAN SUARA" dan header tabel di tengah. Submenu ini terkunci sampai kata sandi dimasukkan.
- **Daftar Siswa**: menampilkan seluruh siswa dari sheet `STUDENTS` (nama, ID, kelas, status Aktif/Nonaktif; PIN tidak ditampilkan), diurutkan berdasarkan nama. Tombol **Print** mencetak/menyimpan daftar ke PDF dengan kop "DAFTAR SISWA PADUAN SUARA". Submenu ini terkunci sampai kata sandi dimasukkan.
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
| `verify` | Verifikasi `id` (Student ID **atau** Nama) + `pin` terhadap sheet `STUDENTS`. Mengembalikan nama, ID, dan kelas. Jika siswa sudah tercatat absen hari ini, menyertakan `already: true` + `record`. |
| `submit` | Validasi ulang identitas, cek duplikasi per hari, lalu menulis baris ke sheet `ATTENDANCE`. |
| `ping` | Uji koneksi backend (`{ success: true }`); dipakai menu **Test Koneksi**. |
| `report` | Rekap absensi untuk tanggal tertentu (`date` format `yyyy-MM-dd`), diurutkan berdasarkan timestamp. Menyertakan `absent`: daftar siswa berstatus `ACTIVE` yang belum absen (nama diurutkan ascending, ID, kelas). |
| `maintenance` | Membaca status mode maintenance global. Jika field `value` (boolean) disertakan, menyimpan status tersebut. Nilai tersimpan di Script Properties sehingga berlaku untuk semua perangkat. |
| `students` | Daftar siswa dari sheet `STUDENTS` (tanpa PIN), diurutkan berdasarkan nama. |

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
- **Cetak ke PDF**: tombol **Print** pada modal Laporan Absensi dan Daftar Siswa dengan area cetak khusus (`@media print`), header tabel rata tengah, margin `1cm`, dan footer nomor halaman **"Hal: X/Y"** (`@page` + `counter`).
- **Cetak di Android/APK**: `window.print()` tidak berfungsi di Android WebView, sehingga ditambahkan fallback pembuatan PDF klien (`html2canvas-pro` capture + `jsPDF` A4 dengan pemecahan halaman otomatis). Kedua pustaka (UMD) dimuat via `<script defer>` di `index.html`, didaftarkan di `CORE_ASSETS` service worker, dan aturan tabel cetak dipindah ke CSS biasa agar tetap berlaku saat capture canvas. 
