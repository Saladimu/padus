# Panduan Penggunaan — Administrator

**Aplikasi Absensi Ekskul Paduan Suara · SMA Kemurnian II**

Panduan ini untuk **guru pembimbing / operator / pengurus** yang mengelola aplikasi absensi: membuka menu admin, laporan, daftar siswa, backup, mode maintenance, sampai setup backend Google Sheets.

---

## 1. Ringkasan Sistem

| Komponen | Keterangan |
|----------|------------|
| **Frontend** | Halaman web statis (HTML/JS/CSS + service worker/PWA) yang dibuka siswa & admin |
| **Backend** | Google Apps Script (`appsscript/code.gs`) yang di-deploy sebagai **Aplikasi Web** |
| **Database** | Google Sheets dengan sheet **`STUDENTS`** (data siswa) dan **`ATTENDANCE`** (data absensi) |

Alur data: siswa verifikasi + submit → frontend memanggil backend (action `verify`/`submit`) → backend menulis ke sheet `ATTENDANCE`. Menu admin memakai action `report`, `students`, `history`, `ping`, `maintenance`, `backup`, `backuplist`.

Dokumentasi teknis backend ada di [`appsscript/readme.md`](appsscript/readme.md) dan [`README.md`](README.md).

---

## 2. Membuka Menu Admin (Pengaturan)

Ikon roda gigi **tersembunyi** agar tidak dibuka siswa.

1. **Ketuk logo tengah (bulat) 5 kali berturut-turut** (cepat — jeda antar ketukan maksimal ±1,5 detik).
2. Ikon **roda gigi (Pengaturan Admin)** muncul di header kanan atas.
3. Ketuk ikon tersebut, lalu **masukkan kata sandi admin**.
   - **Kata sandi bawaan: `00000`** — *segera ganti* setelah pertama kali masuk (lihat [Bagian 9](#9-ubah-kata-saidi--mode-maintenance)).
4. Untuk **menyembunyikan** ikon lagi (dan menutup modal pengaturan): **ketuk logo tengah 5 kali** sekali lagi. Ikon juga **tersembunyi otomatis** setelah 5 menit tanpa aktivitas (lihat tabel di bawah).

### Pengaman menu admin

| Mekanisme | Keterangan |
|-----------|------------|
| **Kunci 3× salah** | 3 kali salah kata sandi → form terkunci **5 menit** (hitungan mundur tampil di layar; reload tidak melewati kunci) |
| **Auto-lock 5 menit** | Setelah **5 menit tanpa aktivitas**, pengaturan **terkunci otomatis** dan **ikon roda gigi ikut disembunyikan** (modal pengaturan tertutup). Setiap aktivitas (klik/ketik/gulir/sentuh) — termasuk di modal Laporan/Riwayat/Daftar Siswa — tetap dihitung dan menyegarkan timer, jadi sesi tidak terkunci saat sedang bekerja |
| **Ikon gigi auto-hilang** | Bila ikon gigi sudah tampil (5 ketuk logo) tetapi belum dibuka/di-unlock, ikon **tersembunyi otomatis** setelah 5 menit tanpa aktivitas. Tampilkan lagi dengan 5 ketuk logo |
| **Kunci manual** | Tombol **Kunci** di dalam menu untuk mengunci segera (ikon tetap tampil, lalu ikut tersembunyi otomatis bila dibiarkan) |

> ⚠️ **Penting — sifat kata sandi & URL backend:** keduanya disimpan **per perangkat/per browser** (localStorage), bukan di server. Mengganti kata sandi di HP **tidak** mengubah kata sandi di laptop. Ganti kata sandi di **setiap perangkat admin** yang dipakai, dan pastikan URL backend tersimpan benar di tiap perangkat.

---

## 3. Menu Pengaturan — Ikhtisar

Setelah terbuka, menu Pengaturan berisi (dari atas):

1. **Buka Kunci / Kunci** — status keamanan menu
2. **Koneksi Google Sheets** *(accordion)* — URL backend + Test Koneksi
3. **Tahun ekskul padus** — batas rentang laporan (ON/OFF)
4. **Laporan Absensi** — rekap per tanggal + siswa tidak hadir
5. **Daftar Siswa** — data sheet `STUDENTS`
6. **Backup Data** *(accordion)* — backup sheet bertanggal
7. **Ubah password/Maintenance** *(accordion)* — ganti kata sandi + mode maintenance
8. **Setup Backend** — panduan deploy Google Apps Script

Tanda *(accordion)* = header dapat diklik untuk membuka/menutup isinya. Saat menu terkunci, semua bagian otomatis tertutup.

---

## 4. Koneksi Google Sheets

Mengatur URL backend aplikasi untuk **perangkat ini**.

1. Buka bagian **Koneksi Google Sheets** (klik headernya bila tertutup).
2. Isi **URL Aplikasi Web** Google Apps Script (berakhir dengan `/exec`).
3. Tekan **Test Koneksi** — memanggil action `ping`. Sukses bila status koneksi menyala hijau.
4. Tekan **Simpan**.

Bila URL kosong, aplikasi memakai URL bawaan yang tertanam di `app.js`. Untuk memindah ke backend/spreadsheet baru: deploy ulang Apps Script (Bagian 10) → simpan URL baru di sini di setiap perangkat admin.

---

## 5. Tahun Ekskul Padus

Membatasi **semua laporan, riwayat, dan peek** pada rentang tahun ekskul (misal Juli 2025 – Juni 2026).

1. Buka bagian **Tahun ekskul padus**.
2. Sakelar **ON** untuk mengaktifkan batas, **OFF** untuk menampilkan semua data tanpa batas.
3. Isi **Awal ekskul** dan **Akhir ekskul** dengan format **`MM-YYYY`** (contoh: `07-2025` dan `06-2026`).
4. Tekan **Simpan**.

Efek saat aktif:

- Riwayat Absensi siswa hanya menampilkan kehadiran di dalam rentang.
- Peek laporan hari ini mengikuti rentang yang sama.
- Hasil cetak/PDF diberi catatan kaki: `Tahun ekskul: Jul-2025 s/d Jun-2026`.

Di awal tahun ajaran/periode ekskul baru, perbarui rentang ini agar laporan bersih.

---

## 6. Laporan Absensi

Rekap kehadiran per tanggal.

1. Buka **Laporan Absensi**, pilih **tanggal** (tidak bisa tanggal mendatang), lalu **Lihat Data**.
2. Layar menampilkan:
   - **Daftar siswa tercatat** (bernomor urut): nama, lencana status **Hadir** (hijau) / **Izin** (kuning), ID | Kelas, jenis latihan, catatan, dan waktu log. Setiap baris punya tombol **Riwayat** (ikon jam) untuk membuka riwayat siswa tersebut.
   - **Siswa yang tidak hadir : N** — daftar siswa berstatus aktif yang belum absen pada tanggal itu (kuning), lengkap dengan **catatan absensi terakhirnya** sebelum tanggal laporan, ditandai `📅->` diikuti tanggal **DD-Mon** (mis. `05-Sep`), jam `(HH:MM)`, dan jenis/catatan terakhir — berguna untuk mengetahui kapan terakhir kali siswa tersebut hadir. Jika tidak ada catatan, tampil `📅-> -`.
3. **Print** — mencetak laporan (termasuk daftar tidak hadir + kolom **Terakhir Hadir**) atau menyimpan sebagai **PDF** lewat dialog print browser (pilih "Save as PDF"). Waktu pada cetak diformat **HH:MM AM/PM**. Catatan kaki memuat rentang tahun ekskul.

### Peek laporan hari ini (tanpa buka menu admin)

**Ketuk tanggal di bawah judul** "ABSENSI PADUAN SUARA" di halaman utama — modal ringkas berisi siapa saja yang sudah tercatat hari ini (nama, ID | Kelas, jam log-in, tanda **(Izin)** oranye, tombol **Riwayat**). Tersedia tombol **refresh** di kiri-atas modal untuk memuat ulang paksa. Praktis dipakai guru saat latihan berlangsung. Riwayat yang dibuka dari peek **tanpa tombol Print**.

Di halaman utama juga tampil **banner berjalan (marquee)** bertuliskan **"N siswa sudah absensi"** — jumlah siswa yang sudah tercatat hari ini, diperbarui otomatis. Teks bergerak pelan **kiri ke kanan** dan **berhenti saat disentuh kursor/jari**, lalu lanjut lagi setelah dilepas. Banner hanya tampil bila sudah ada yang absen.

---

## 7. Daftar Siswa

Melihat data siswa dari sheet `STUDENTS` (**PIN tidak ditampilkan**).

1. Buka **Daftar Siswa** → **Lihat Daftar Siswa**.
2. **Filter Status** (dropdown):
   - **Aktif** *(default)* — hanya siswa `ACTIVE`
   - **Nonaktif** — siswa nonaktif
   - **Semua** — dikelompokkan per status (Aktif/Nonaktif) dengan total per kelompok, diurutkan nama
   - Filter berlaku untuk tampilan layar **dan** hasil cetak/PDF.
3. Setiap siswa bernomor urut dan punya tombol **Riwayat** — membuka **Riwayat Absensi** siswa (action `history`).
4. **Print** — mencetak/menyimpan daftar ke PDF.

---

## 8. Riwayat Absensi Siswa

Dibuka dari tombol **Riwayat** di Laporan Absensi, Daftar Siswa, atau peek hari ini.

- Daftar dikelompokkan **per bulan** (bulan terbaru di atas); setiap header bulan **dapat dibuka/tutup** (klik untuk melipat).
- Badge per bulan: **hijau = N hadir**, **kuning = M izin** — beserta subtotal "N hadir · M izin". Total keseluruhan di baris status atas.
- Dibatasi oleh **rentang tahun ekskul** yang aktif.
- Tombol **Print** (dari Laporan/Daftar Siswa) mencetak riwayat + ringkasan per bulan (`Bulan Tahun : [ X hadir · Y izin ]`) + total. Nama file PDF yang disarankan: `History+<nama siswa>`.

---

## 9. Ubah Kata Sandi & Mode Maintenance

Buka submenu **Ubah password/Maintenance** (header merah di bagian bawah menu).

### Ganti kata sandi admin

1. Isi **Kata Sandi Saat Ini**, **Kata Sandi Baru** (minimal 4 karakter), dan **Konfirmasi**.
2. Tekan **Ganti Kata Sandi**.
3. Ingat: kata sandi tersimpan **per perangkat** — ulangi di perangkat admin lain.

### Mode Maintenance

Sakelar **Mode Maintenance** untuk menonaktifkan absensi siswa sementara (mis. saat perbaikan data atau sebelum tahun ekskul baru dimulai).

Saat **ON**:

- Semua perangkat menampilkan jendela merah berkedip **"We're Getting Things Ready"** dan input siswa dinonaktifkan.
- Backend **menolak** `verify`/`submit` (`{ success:false, maintenance:true }`) — halaman lama yang masih terbuka pun tidak bisa menulis data.
- Status disimpan di server (Script Properties) sehingga **global untuk semua perangkat**.

Catatan teknis: perangkat yang sudah terbuka mengecek ulang status saat siswa menyentuh form (throttle 60 detik) dan saat tab kembali aktif; cache status lokal berumur maksimal 5 menit. Setelah mematikan maintenance, perangkat siswa akan kembali normal dalam hitungan detik–menit (atau setelah refresh).

---

## 10. Backup Data

Menduplikasi sheet `STUDENTS` dan `ATTENDANCE` menjadi sheet bertanggal di **spreadsheet yang sama**.

1. Buka submenu **Backup Data**.
2. Tekan **Buat Backup Sekarang**.
3. Bila muncul konfirmasi:
   - backup **tanggal hari ini akan diganti**, atau
   - kuota 6 tanggal penuh sehingga **backup terlama akan dihapus**
   tekan **Lanjutkan** (atau **Enter**) untuk melanjutkan, **Batal** (atau **Escape**) untuk membatalkan.
4. Hasil: sheet baru bernama **`STUDENTS<DDMMYY>`** dan **`ATTENDANCE<DDMMYY>`** (contoh: `STUDENTS110926` & `ATTENDANCE110926`).
   - Backup tanggal yang sama **ditimpa** bila dijalankan lagi di hari yang sama.
   - Hanya **6 tanggal backup terbaru** per sheet yang disimpan; sisanya otomatis dihapus.
5. **Daftar data backup** di bawah tombol menampilkan semua sheet backup (nama sheet, tanggal, jumlah records), **terbaru di atas**, dikelompokkan per tanggal (pasangan `STUDENTS`+`ATTENDANCE` diberi warna lembut bergilir dan nomor urut besar; 1 = terbaru). Daftar dimuat saat submenu dibuka dan diperbarui setelah backup.

> 💡 Lakukan backup **rutin** (mis. setiap akhir bulan atau sebelum mengubah data massal). Backup tersimpan sebagai sheet biasa — untuk pemulihan, salin isi sheet backup ke sheet `STUDENTS`/`ATTENDANCE` utama sesuai kebutuhan.

---

## 11. Setup Backend Google Sheets

Untuk instalasi baru/pindah spreadsheet. Kode lengkap ada di [`appsscript/code.gs`](appsscript/code.gs).

### Langkah deploy

1. Buka **Google Sheets** tujuan (spreadsheet absensi).
2. Menu **Ekstensi → Apps Script**.
3. Ganti kode default dengan isi `appsscript/code.gs`, lalu simpan.
4. **Terapkan (Deploy) → Penerapan Baru** → jenis **Aplikasi Web**:
   - **Execute as**: *Me* (akun pemilik spreadsheet)
   - **Who has access**: *Anyone*
5. Salin **URL Aplikasi Web** (berakhiran `/exec`) ke **Koneksi Google Sheets** di menu admin (Bagian 4) — dan ke `GAS_WEB_APP_URL` di `app.js` bila ingin jadi URL bawaan.
6. **Test Koneksi** untuk memastikan terhubung.

> Saat mengubah kode Apps Script, gunakan **Manage deployments → Edit → Version: New version** agar URL tetap sama.

### Struktur sheet

**`STUDENTS`** — baris 1 = header:

| ID | Nama | Kelas | PIN | Status |
|----|------|-------|-----|--------|
| PS001 | Budi Santoso | X-1 | `12345` atau hash SHA-256 | `ACTIVE` |

- **Status** harus persis `ACTIVE` (huruf besar) agar siswa bisa absen. Nilai lain = **nonaktif** (tidak bisa absen & tidak dihitung di daftar "tidak hadir").
- **PIN**: plaintext (legacy) atau **hash SHA-256** 64-hex (disarankan).
- Verifikasi memakai **ID *atau* Nama** (case-insensitive) + PIN.
- Perubahan sheet baru terbaca setelah cache habis (**maksimal ±2 menit**).

**`ATTENDANCE`** — ditulis otomatis oleh sistem:

| Timestamp | Tanggal | ID | Nama | Kelas | Jenis | Remark | Status |
|-----------|---------|----|------|-------|-------|--------|--------|
| (waktu log) | `yyyy-MM-dd` | PS001 | Budi Santoso | X-1 | Latihan Rutin | — | Hadir |

- **Status** = `Hadir`, atau `Izin` bila jenis = `Izin` (izin dihitung hadir pada rekap).
- Duplikat dicegah per **ID + Tanggal** (zona waktu GMT+7) — dua lapis: saat `verify` dan saat `submit` (di bawah `LockService`).
- Hindari mengedit manual; bila perlu koreksi, edit dan laporkan perubahanmu.

### Menambah / mengubah data siswa

1. Buka sheet `STUDENTS` di Google Sheets.
2. Tambah/edit baris: ID, Nama, Kelas, PIN, Status (`ACTIVE`).
3. Simpan — tunggu ±2 menit bila sistem memakai cache.
4. Beritahu siswa: ID/Nama dan PIN barunya.

### Migrasi PIN ke hash (disarankan)

PIN hash (SHA-256) lebih aman bila sheet bocor. Contoh fungsi untuk dijalankan di editor Apps Script:

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

Catatan keamanan lain (sudah bawaan backend): validasi jenis latihan terhadap daftar `VALID_TYPES`, pembatasan panjang input, rate-limit verifikasi (5 gagal per identitas → blokir 5 menit + pengaman global anti brute-force), dan `LockService` saat menulis absensi.

---

## 12. Pembaruan Aplikasi (Hard Refresh)

Aplikasi memakai service worker + cache. Saat ada **rilis baru**, muncul modal **Pembaruan Tersedia** ("Aplikasi ada perubahan, perlu hard refresh ulang."):

- **Hard Refresh** *(disarankan)* — mencabut service worker, menghapus cache, dan memuat ulang dari jaringan sehingga versi terbaru pasti dipakai.
- **Nanti** — menunda; pembaruan bisa lewat tombol refresh biasa/refresh browser.

Pengecekan pembaruan berjalan otomatis setiap 30 menit dan saat tab kembali aktif.

---

## 13. Mengatasi Masalah (Troubleshooting)

| Masalah | Solusi |
|---------|--------|
| Ikon roda gigi tidak muncul | Ketuk **logo tengah 5 kali** cepat (jeda antar ketukan < ±1,5 detik) |
| Lupa kata sandi admin | Di **perangkat itu**, hapus data lokal browser untuk situs ini — khususnya item `choir_absensi_pwd` (Chrome: menu ⋮ → *Delete browsing data* / DevTools → Application → Local Storage), atau hapus data situs. Kata sandi kembali ke bawaan **`00000`** — ganti segera setelah masuk |
| Terkunci "3 kali salah" | Tunggu **5 menit** sampai hitungan mundur selesai |
| Pengaturan terkunci sendiri / ikon gigi hilang | Itu **auto-lock 5 menit tanpa aktivitas** — ketuk **logo tengah 5 kali** untuk memunculkan ikon lagi, lalu buka dengan kata sandi |
| Test Koneksi gagal / merah | Periksa URL backend (harus URL `/exec` Aplikasi Web), cek izin *Anyone* pada deployment, dan pastikan kode `code.gs` ter-deploy penuh |
| Absensi siswa ditolak semua | Cek **Mode Maintenance** (Bagian 9) dan status `ACTIVE` di sheet `STUDENTS` |
| Siswa tidak bisa absen padahal data ada | Status di `STUDENTS` bukan `ACTIVE`; atau PIN salah; atau siswa sudah absen hari itu (cek Laporan hari ini); atau terkena rate-limit 5 menit |
| Data siswa tidak sinkron setelah edit sheet | Tunggu **±2 menit** (cache backend) atau cek editan tidak mengubah urutan/kolom header |
| Perlu pindah backend/spreadsheet | Deploy Apps Script baru (Bagian 11) → ganti URL di **Koneksi Google Sheets** di **setiap perangkat admin** |
| Laporan kosong padahal ada absensi | Periksa rentang **Tahun ekskul** (Bagian 5) — tanggal di luar rentang tidak ditampilkan |
| Ingin data lama diarsipkan | Gunakan **Backup Data** (Bagian 10), lalu bersihkan/arsipkan baris `ATTENDANCE` lewat Google Sheets bila diperlukan |
| Aplikasi terasa memakai versi lama | Gunakan **Hard Refresh** dari modal Pembaruan, atau refresh browser |
| Ubah tanggal/isi absensi keliru | Koreksi langsung di sheet `ATTENDANCE` (hati-hati, tanpa mengubah header) dan catat alasannya |

---

## 14. Referensi Action Backend (`doPost`)

| Action | Fungsi | Dipakai oleh |
|--------|--------|--------------|
| `verify` | Cek ID/Nama + PIN; deteksi absen hari ini; ditolak saat maintenance | Form siswa Tahap 1 |
| `submit` | Validasi ulang + tulis baris `ATTENDANCE` (anti-duplikat + lock) | Form siswa Tahap 2 |
| `report` | Rekap per tanggal + daftar tidak hadir (`lean:true` untuk peek) | Laporan Absensi, peek |
| `students` | Daftar siswa tanpa PIN | Daftar Siswa |
| `history` | Riwayat absensi per siswa | Tombol Riwayat |
| `ping` | Tes koneksi (`{ success: true }`) | Test Koneksi |
| `maintenance` | Baca/simpan status mode maintenance (Script Properties) | Sakelar Mode Maintenance |
| `backup` | Duplikat sheet `STUDENTS`/`ATTENDANCE` bertanggal (retensi 6) | Buat Backup Sekarang |
| `backuplist` | Daftar backup tersimpan | Daftar data backup |

Detail teknis: [`appsscript/readme.md`](appsscript/readme.md) · [`README.md`](README.md). Panduan siswa: [`Panduan-Siswa.md`](Panduan-Siswa.md) · panduan singkat in-app: [`Absensi.md`](Absensi.md).
