/**
 * BACKEND ABSENSI PADUAN SUARA
 * Deploy sebagai Web App -> Execute as: Me -> Access: Anyone
 */

const SHEET_NAME_STUDENTS = 'STUDENTS';
const SHEET_NAME_ATTENDANCE = 'ATTENDANCE';

// Kolom STUDENTS: [0]=ID, [1]=Nama, [2]=Kelas, [3]=PIN, [4]=Status
// Kolom ATTENDANCE: [0]=Timestamp, [1]=Tanggal, [2]=ID, [3]=Nama, [4]=Kelas, [5]=Jenis, [6]=Remark, [7]=Status
const PIN_SALT = 'choir-absensi-salt';

const VALID_TYPES = [
  'Latihan Rutin', 'Latihan Vokal', 'Latihan Lagu',
  'Persiapan Lomba', 'Persiapan Pentas', 'Gladi Bersih',
  'Latihan Tambahan', 'Lainnya'
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === 'verify') {
      return respond(verifyStudent(data.id, data.pin));
    } else if (action === 'submit') {
      return respond(submitAttendance(data));
    }

    return respond({ success: false, message: 'Action tidak valid.' });
  } catch (err) {
    console.error('doPost error:', err);
    return respond({ success: false, message: 'Terjadi kesalahan server.' });
  }
}

function doOptions(e) {
  // Dibutuhkan untuk preflight CORS pada web app Google Apps Script.
  return respond({ success: true });
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function hashPin(pin) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    PIN_SALT + pin
  );
  return digest.map(function (b) {
    return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function pinMatches(storedPin, inputPin) {
  const stored = (storedPin || '').toString().trim();
  const input = (inputPin || '').toString().trim();
  if (!stored || !input) return false;
  // Mendukung PIN lama (plaintext) maupun PIN baru (hash SHA-256, 64 hex).
  if (/^[0-9a-f]{64}$/.test(stored)) {
    return stored === hashPin(input);
  }
  return stored === input;
}

function verifyStudent(id, pin) {
  if (!id || !pin) return { success: false, message: 'ID dan PIN wajib diisi.' };
  if (id.toString().length > 50 || pin.toString().length > 20) {
    return { success: false, message: 'ID atau PIN terlalu panjang.' };
  }

  const sheet = getSheet(SHEET_NAME_STUDENTS);
  if (!sheet) return { success: false, message: 'Sheet STUDENTS tidak ditemukan.' };
  const data = sheet.getDataRange().getValues();
  const inputId = id.toString().trim().toUpperCase();

  for (let i = 1; i < data.length; i++) {
    if (!data[i] || data[i][0] === '') continue;

    const rowId = data[i][0] ? data[i][0].toString().trim().toUpperCase() : '';
    const rowName = data[i][1] || '';
    const rowClass = data[i][2] || '';
    const rowPin = data[i][3] || '';
    const rowStatus = data[i][4] ? data[i][4].toString().trim().toUpperCase() : '';

    if (rowId !== inputId) continue;

    if (rowStatus !== 'ACTIVE') {
      return { success: false, message: 'Akun Anda tidak memiliki akses untuk melakukan absensi.' };
    }
    if (!pinMatches(rowPin, pin)) {
      return { success: false, message: 'PIN yang dimasukkan salah.' };
    }

    return {
      success: true,
      data: { name: rowName, className: rowClass }
    };
  }

  return { success: false, message: 'Student ID tidak terdaftar. Silakan hubungi guru pembimbing.' };
}

function submitAttendance(payload) {
  const { id, pin, type, remark } = payload;
  if (VALID_TYPES.indexOf(type) === -1) {
    return { success: false, message: 'Jenis latihan tidak valid.' };
  }

  const verify = verifyStudent(id, pin);
  if (!verify.success) return verify;

  const student = verify.data;
  const studentId = id.toString().trim().toUpperCase();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet(SHEET_NAME_ATTENDANCE);
    if (!sheet) return { success: false, message: 'Sheet ATTENDANCE tidak ditemukan.' };
    const data = sheet.getDataRange().getValues();

    const now = new Date();
    const dateString = Utilities.formatDate(now, 'GMT+7', 'yyyy-MM-dd');
    const timestampString = Utilities.formatDate(now, 'GMT+7', 'yyyy-MM-dd HH:mm:ss');

    for (let i = 1; i < data.length; i++) {
      if (!data[i] || data[i][2] === '') continue;

      let recDate = data[i][1];
      if (recDate instanceof Date) {
        recDate = Utilities.formatDate(recDate, 'GMT+7', 'yyyy-MM-dd');
      }
      const recId = data[i][2] ? data[i][2].toString().trim().toUpperCase() : '';

      if (recId === studentId && recDate === dateString) {
        return { success: false, message: 'Absensi Anda untuk hari ini sudah tercatat.' };
      }
    }

    const sanitizedRemark = (remark || '').toString().substring(0, 200);

    sheet.appendRow([
      timestampString,
      dateString,
      studentId,
      student.name,
      student.className,
      type,
      sanitizedRemark,
      'Hadir'
    ]);

    return {
      success: true,
      message: `Terima kasih, ${student.name}. Kehadiran Anda pada ${dateString} telah tercatat.`
    };
  } finally {
    lock.releaseLock();
  }
}
