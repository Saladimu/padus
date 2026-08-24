# Backend Google Apps Script

Kode backend untuk aplikasi Absensi Paduan Suara. Deploy sebagai **Aplikasi Web** dari menu **Terapkan > Penerapan Baru** (Execute as: Me, Access: Anyone). URL Aplikasi Web yang dihasilkan dimasukkan ke `GAS_WEB_APP_URL` di `../index.html`.

## Action yang Didukung (`doPost`)

| Action | Deskripsi |
|--------|-----------|
| `verify` | Verifikasi `id` + `pin` terhadap sheet `STUDENTS`; mengembalikan nama dan kelas siswa. |
| `submit` | Validasi ulang identitas, cek duplikasi per hari, lalu menulis baris ke sheet `ATTENDANCE`. |

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
