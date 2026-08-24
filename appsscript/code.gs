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
    } else if (action === 'debug') {
      return respond(debugCheck(data.id));
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

// SEMENTARA: hanya untuk diagnosa format data, hapus setelah selesai.
function debugCheck(studentId) {
  const sheet = getSheet(SHEET_NAME_ATTENDANCE);
  if (!sheet) return { success: false, message: 'Sheet ATTENDANCE tidak ditemukan.' };
  const rows = sheet.getDataRange().getValues();
  const now = new Date();
  const dateString = Utilities.formatDate(now, 'GMT+7', 'yyyy-MM-dd');
  const target = String(studentId || '').trim().toUpperCase();
  const matches = [];
  for (let i = 1; i < rows.length; i++) {
    const recId = rows[i][2] ? String(rows[i][2]).trim().toUpperCase() : '';
    if (target && recId !== target) continue;
    matches.push({
      col1Raw: rows[i][1],
      col1IsDate: isDateValue(rows[i][1]),
      col2: rows[i][2],
      matchesToday: matchesToday(rows[i][1], dateString)
    });
  }
  return {
    success: true,
    todayGMT7: dateString,
    scriptTimezone: Session.getScriptTimeZone(),
    targetId: target,
    rowCount: rows.length - 1,
    matches: matches
  };
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

function isDateValue(v) {
  return v instanceof Date || Object.prototype.toString.call(v) === '[object Date]';
}

function matchesToday(cellValue, todayString) {
  if (!cellValue) return false;
  if (isDateValue(cellValue)) {
    // Object Date dari Sheets kadang gagal dicek dengan instanceof, gunakan isDateValue().
    const tz = Session.getScriptTimeZone();
    if (Utilities.formatDate(cellValue, tz, 'yyyy-MM-dd') === todayString) return true;
    if (Utilities.formatDate(cellValue, 'GMT+7', 'yyyy-MM-dd') === todayString) return true;
    return false;
  }
  const text = String(cellValue).trim();
  // Menangani teks "2026-08-24", "2026-08-24 08:00:00", dsb.
  if (text.substring(0, 10) === todayString) return true;
  return text === todayString;
}

function getTodayRecord(studentId) {
  const sheet = getSheet(SHEET_NAME_ATTENDANCE);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const dateString = Utilities.formatDate(now, 'GMT+7', 'yyyy-MM-dd');

  for (let i = 1; i < data.length; i++) {
    if (!data[i] || data[i][2] === '') continue;

    const recId = data[i][2] ? data[i][2].toString().trim().toUpperCase() : '';
    if (recId !== studentId) continue;

    if (matchesToday(data[i][1], dateString)) {
      return {
        date: dateString,
        type: data[i][5] || '',
        remark: data[i][6] || ''
      };
    }
  }
  return null;
}

function verifyStudent(id, pin) {
  if (!id || !pin) return { success: false, message: 'Student ID/Nama dan PIN wajib diisi.' };
  if (id.toString().length > 50 || pin.toString().length > 20) {
    return { success: false, message: 'Student ID/Nama atau PIN terlalu panjang.' };
  }

  const sheet = getSheet(SHEET_NAME_STUDENTS);
  if (!sheet) return { success: false, message: 'Sheet STUDENTS tidak ditemukan.' };
  const data = sheet.getDataRange().getValues();
  const input = id.toString().trim().toUpperCase();

  for (let i = 1; i < data.length; i++) {
    if (!data[i] || data[i][0] === '') continue;

    const rowId = data[i][0] ? data[i][0].toString().trim().toUpperCase() : '';
    const rowName = data[i][1] ? data[i][1].toString().trim().toUpperCase() : '';
    const rowClass = data[i][2] || '';
    const rowPin = data[i][3] || '';
    const rowStatus = data[i][4] ? data[i][4].toString().trim().toUpperCase() : '';

    // Cocokkan dengan Student ID ATAU Nama (case-insensitive)
    if (rowId !== input && rowName !== input) continue;

    if (rowStatus !== 'ACTIVE') {
      return { success: false, message: 'Akun Anda tidak memiliki akses untuk melakukan absensi.' };
    }
    if (!pinMatches(rowPin, pin)) {
      return { success: false, message: 'PIN yang dimasukkan salah.' };
    }

    const response = {
      success: true,
      data: { id: rowId, name: data[i][1] || '', className: rowClass }
    };

    const todayRecord = getTodayRecord(rowId);
    if (todayRecord) {
      response.already = true;
      response.record = todayRecord;
    }

    return response;
  }

  return { success: false, message: 'Student ID atau Nama tidak terdaftar. Silakan hubungi guru pembimbing.' };
}

function submitAttendance(payload) {
  const { id, pin, type, remark } = payload;
  if (VALID_TYPES.indexOf(type) === -1) {
    return { success: false, message: 'Jenis latihan tidak valid.' };
  }

  const verify = verifyStudent(id, pin);
  if (!verify.success) return verify;
  if (verify.already) {
    return { success: false, message: 'Absensi Anda untuk hari ini sudah tercatat.' };
  }

  const student = verify.data;
  const studentId = student.id; // Gunakan Student ID kanonik dari sheet
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

      const recId = data[i][2] ? data[i][2].toString().trim().toUpperCase() : '';

      if (recId === studentId && matchesToday(data[i][1], dateString)) {
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
