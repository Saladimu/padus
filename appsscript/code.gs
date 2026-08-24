/**
 * BACKEND ABSENSI PADUAN SUARA
 * Deploy sebagai Web App -> Execute as: Me -> Access: Anyone
 */

const SHEET_NAME_STUDENTS = 'STUDENTS';
const SHEET_NAME_ATTENDANCE = 'ATTENDANCE';

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
    return respond({ success: false, message: 'Terjadi kesalahan server.' });
  }
}

function doOptions(e) {
  return respond({ success: true });
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function verifyStudent(id, pin) {
  if(!id || !pin) return { success: false, message: 'ID dan PIN wajib diisi.' };
  
  const sheet = getSheet(SHEET_NAME_STUDENTS);
  const data = sheet.getDataRange().getValues();
  
  for(let i = 1; i < data.length; i++) {
    if (!data[i] || data[i][0] === "") continue; 
    
    let rowId = data[i][0] ? data[i][0].toString().trim().toUpperCase() : '';
    let rowName = data[i][1] || '';
    let rowClass = data[i][2] || '';
    let rowPin = data[i][3] ? data[i][3].toString().trim() : '';
    let rowStatus = data[i][4] ? data[i][4].toString().trim().toUpperCase() : '';
    
    if(rowId === id.toUpperCase()) {
      if(rowStatus !== 'ACTIVE') {
        return { success: false, message: 'Akun Anda tidak memiliki akses untuk melakukan absensi.' };
      }
      if(rowPin !== pin.toString().trim()) {
        return { success: false, message: 'PIN yang dimasukkan salah.' };
      }
      
      return { 
        success: true, 
        data: { name: rowName, className: rowClass }
      };
    }
  }
  
  return { success: false, message: 'Student ID tidak terdaftar. Silakan hubungi guru pembimbing.' };
}

function submitAttendance(payload) {
  const { id, pin, type, remark } = payload;
  
  const verify = verifyStudent(id, pin);
  if(!verify.success) return verify; 
  
  const student = verify.data;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  
  try {
    const sheet = getSheet(SHEET_NAME_ATTENDANCE);
    const data = sheet.getDataRange().getValues();
    
    const now = new Date();
    const dateString = Utilities.formatDate(now, "GMT+7", "yyyy-MM-dd");
    const timestampString = Utilities.formatDate(now, "GMT+7", "yyyy-MM-dd HH:mm:ss");
    
    for(let i = 1; i < data.length; i++) {
      if (!data[i] || data[i][2] === "") continue;
      let recDate = data[i][1]; 
      if (recDate instanceof Date) {
         recDate = Utilities.formatDate(recDate, "GMT+7", "yyyy-MM-dd");
      }
      let recId = data[i][2] ? data[i][2].toString().trim().toUpperCase() : '';
      
      if(recId === id.toUpperCase() && recDate === dateString) {
        return { success: false, message: 'Absensi Anda untuk hari ini sudah tercatat.' };
      }
    }
    
    const sanitizedRemark = (remark || '').toString().substring(0, 200);
    
    sheet.appendRow([
      timestampString,
      dateString,
      id.toUpperCase(),
      student.name,
      student.className,
      type,
      sanitizedRemark,
      'Hadir'
    ]);
    
    return { success: true, message: `Terima kasih, ${student.name}. Kehadiran Anda pada ${dateString} telah tercatat.` };
    
  } finally {
    lock.releaseLock();
  }
}
