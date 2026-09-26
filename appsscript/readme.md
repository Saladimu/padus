# Backend Google Apps Script

Kode backend untuk aplikasi Absensi Paduan Suara. Deploy sebagai **Aplikasi Web** dari menu **Terapkan > Penerapan Baru** (Execute as: Me, Access: Anyone). URL Aplikasi Web yang dihasilkan diisi di `../config.js` (`window.PADUS_DEFAULT_API_URL`) agar semua perangkat (termasuk siswa) otomatis memakai backend yang sama, atau lewat menu **Pengaturan & Setup > Koneksi Google Sheets** untuk override per perangkat. Bila keduanya kosong, aplikasi menampilkan peringatan agar admin mengisinya.

## Action yang Didukung (`doPost`)

| Action | Deskripsi |
|--------|-----------|
| `verify` | Verifikasi `id` (Student ID **atau** Nama) + `pin` terhadap sheet `STUDENTS`; mengembalikan nama dan kelas siswa. Jika siswa sudah tercatat absen hari ini, respons menyertakan `already: true` beserta `record` (tanggal, jenis latihan, remark). Ditolak dengan `{ success:false, maintenance:true }` saat mode maintenance aktif. |
| `ping` | Kesehatan koneksi; mengembalikan `{ success: true }`. Dipakai oleh tombol **Test Koneksi** di Pengaturan & Setup. |
| `report` | Mengembalikan rekap absensi untuk tanggal tertentu (`date` format `yyyy-MM-dd`) dari sheet `ATTENDANCE`, diurutkan berdasarkan timestamp. Dipakai oleh menu **Laporan Absensi**. |
| `submit` | Validasi ulang identitas (tanpa membaca ulang absensi hari ini di `verifyStudent`), cek duplikasi per hari di bawah `LockService` (scan dari baris terbaru), lalu menulis baris ke sheet `ATTENDANCE`. Ditolak dengan `{ success:false, maintenance:true }` saat mode maintenance aktif. |
| `backup` | Menduplikasi sheet `STUDENTS` dan `ATTENDANCE` menjadi sheet bertanggal `DDMMYY` di spreadsheet yang sama, lalu menyimpan maksimal `BACKUP_KEEP` (6) backup terbaru per sheet (lihat `backupSheets()`). Dipakai oleh submenu **Backup Data**. |
| `backuplist` | Mengembalikan daftar backup tersimpan (`name`, `base`, `stamp`, `rows`) beserta nilai `keep`, dipakai untuk menampilkan daftar di submenu **Backup Data** (lihat `listBackups()`). |
| `maintenance` | Baca/simpan mode maintenance global. `value` boolean = override manual (paksa ON/OFF); `value:"auto"` = hapus override agar ikut jadwal; `schedule:{enabled,start,end,days}` = simpan **Jadwal Otomatis Harian** (format `HH:MM`, zona WIB, bawaan `09:00`-`17:00`; `days` 0=Min … 6=Sab = **hari aktif**, ON sepanjang hari; hari tidak dicentang: OFF di dalam jam Dari/Sampai, ON di luar jam; mendukung rentang lintas tengah malam). Respons memuat `maintenance` (efektif), `manual` (`null`/`true`/`false`), dan `schedule`. Dipakai submenu **Ubah password/Maintenance**. |

## Struktur Sheet

### STUDENTS
`ID | Nama | Kelas | PIN | Status`

Status harus bernilai `ACTIVE` agar siswa bisa absensi. Kolom PIN dapat berupa plaintext (legacy) atau hash SHA-256 64-hex (disarankan).

### ATTENDANCE
`Timestamp | Tanggal | ID | Nama | Kelas | Jenis | Remark | Status`

Duplikasi dicegah berdasarkan kombinasi `ID` + `Tanggal` (format `yyyy-MM-dd`, zona waktu GMT+7).

## Keamanan

- PIN dicocokkan dengan `pinMatches()` di `code.gs` - mendukung hash dan legacy plaintext.
- `type` divalidasi terhadap `VALID_TYPES` di sisi server.
- Panjang input `id`/`pin` dibatasi.
- Gunakan `LockService` untuk mencegah race condition saat menulis absensi.

## Duplikasi Absensi

- Pengecekan dilakukan dua lapis: pada `verify` (via `getTodayRecord()`, scan dari baris terbaru) frontend menampilkan pemberitahuan "Pemberitahuan", dan pada `submit` (via `submitAttendance()` di bawah lock) sebagai pengaman terhadap race condition.

## Optimisasi

- Cache request-level untuk spreadsheet, timezone, dan `CacheService`.
- `submit` melewati cek absensi hari ini di `verifyStudent` (`skipTodayCheck`); duplikat tetap dicek sekali di bawah lock.
- `getAbsentStudents()` tidak membangun log terakhir untuk siswa yang sudah hadir pada tanggal laporan.
- Format tanggal/jam GMT+7 dihitung lokal (`datePartsGmt7()`) alih-alih `Utilities.formatDate` per baris pada `report`/`history`/`getAbsentStudents`.
- `backuplist` memakai satu `getSheets()`, cache request-level, dan `CacheService` 120 detik (`backup:list:v1`); cache dihapus setelah `backup`.
