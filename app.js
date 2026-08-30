// ==========================================
// ABSENSI PADUAN SUARA - Aplikasi Frontend
// Dimuat dengan atribut defer sehingga DOM
// sudah siap saat script ini dieksekusi.
// ==========================================

// Daftarkan Service Worker lebih awal agar
// cache aset tersedia sesegera mungkin.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
}

// ==========================================
// CONFIGURASI BACKEND
// ==========================================
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbz8mxqoDrC0Wjqn-xPkTeqEMaBce2nGJR1ASrgazuTHSizvfhDEm8jfTCOP7mtHAr5zMQ/exec";
const LS_CONFIG = 'choir_absensi_config';
const LS_PWD = 'choir_absensi_pwd';

// ==========================================
// STATE GLOBAL
// ==========================================
let currentStudentId = null;
let currentStudentPin = null;
let currentReportDate = null;
let currentReportData = null;
let currentStudentList = [];

let maintenanceMode = false;
let logoClickCount = 0;
let logoClickTimer = null;
let maintenanceSyncInFlight = false;

let settingsLocked = true;
let helpLoaded = false;

// ==========================================
// REFERENSI ELEMEN DOM
// ==========================================
const verifyForm = document.getElementById('verifyForm');
const attendanceForm = document.getElementById('attendanceForm');
const btnVerify = document.getElementById('btnVerify');
const btnSubmit = document.getElementById('btnSubmit');
const btnBack = document.getElementById('btnBack');

const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

// ==========================================
// UTILITAS
// ==========================================
function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

// Format tanggal "yyyy-MM-dd" dari backend menjadi teks bahasa Indonesia
function formatDateDisplay(dateStr) {
    const parts = String(dateStr || '').split('-');
    if (parts.length !== 3) return dateStr;
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return date.toLocaleDateString('id-ID', dateOptions);
}

// Tanggal hari ini dalam format "yyyy-MM-dd"
function todayISO() {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

function getConfig() {
    try {
        return JSON.parse(localStorage.getItem(LS_CONFIG)) || {};
    } catch (e) {
        return {};
    }
}

function setConfig(cfg) {
    localStorage.setItem(LS_CONFIG, JSON.stringify(cfg));
}

// URL backend: pakai yang disimpan, fallback ke URL bawaan.
function getApiUrl() {
    const cfg = getConfig();
    return cfg.apiUrl && cfg.apiUrl.trim() ? cfg.apiUrl.trim() : GAS_WEB_APP_URL;
}

function hashPassword(pwd) {
    if (window.crypto && window.crypto.subtle) {
        return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode('choir_' + pwd))
            .then(function (buf) {
                return Array.prototype.map.call(new Uint8Array(buf), function (b) {
                    return ('0' + b.toString(16)).slice(-2);
                }).join('');
            });
    }
    var h = 5381;
    var s = 'choir_' + pwd;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return Promise.resolve('djb2_' + h.toString(16));
}

function checkPassword(pwd) {
    const stored = localStorage.getItem(LS_PWD);
    return hashPassword(pwd).then(hash => stored ? hash === stored : pwd === '00000');
}

// Renderer Markdown sederhana untuk panduan (Absensi.md)
function renderMarkdown(md) {
    const src = String(md || '').replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    const out = [];
    let list = null;
    let quote = false;

    function inline(text) {
        return text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }
    function closeList() {
        if (list) { out.push('</' + list + '>'); list = null; }
    }
    function closeQuote() {
        if (quote) { out.push('</blockquote>'); quote = false; }
    }

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const isHardBreak = / {2,}$/.test(raw);
        const line = raw.trim();
        let m;

        if (!line) { closeList(); closeQuote(); continue; }

        if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
            closeList(); closeQuote();
            const lv = m[1].length;
            out.push('<' + 'h' + lv + '>' + inline(escapeHtml(m[2])) + '</' + 'h' + lv + '>');
            continue;
        }
        if ((m = line.match(/^>\s?(.*)$/))) {
            closeList();
            if (!quote) { out.push('<blockquote>'); quote = true; }
            out.push('<p>' + inline(escapeHtml(m[1])) + '</p>');
            continue;
        } else if (quote) {
            closeQuote();
        }
        if ((m = line.match(/^[-*]\s+(.*)$/))) {
            if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
            out.push('<li>' + inline(escapeHtml(m[1])) + (isHardBreak ? '<br>' : '') + '</li>');
            continue;
        }
        if ((m = line.match(/^\d+\.\s+(.*)$/))) {
            if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
            out.push('<li>' + inline(escapeHtml(m[1])) + (isHardBreak ? '<br>' : '') + '</li>');
            continue;
        }
        closeList();
        out.push('<p>' + inline(escapeHtml(line)) + (isHardBreak ? '<br>' : '') + '</p>');
    }
    closeList(); closeQuote();
    return out.join('\n');
}

// ==========================================
// MODE MAINTENANCE TERSEMBUNYI (5x klik logo)
// ==========================================
function logoClick() {
    logoClickCount++;
    if (logoClickTimer) clearTimeout(logoClickTimer);
    logoClickTimer = setTimeout(function () { logoClickCount = 0; }, 1500);
    if (logoClickCount >= 5) {
        logoClickCount = 0;
        clearTimeout(logoClickTimer);
        toggleMaintenance();
    }
}

function maintenanceApiUrl() {
    const base = getApiUrl();
    const sep = base.indexOf('?') === -1 ? '?' : '&';
    return base + sep + '_=' + Date.now();
}

function toggleMaintenance() {
    if (maintenanceSyncInFlight) return;
    maintenanceSyncInFlight = true;
    const newValue = !maintenanceMode;
    applyMaintenance(newValue);
    fetch(maintenanceApiUrl(), { method: 'POST', body: JSON.stringify({ action: 'maintenance', value: newValue }) })
        .then(r => r.json())
        .then(res => {
            if (res && res.success) {
                applyMaintenance(!!res.maintenance);
            } else {
                applyMaintenance(!newValue);
            }
        })
        .catch(() => applyMaintenance(!newValue))
        .finally(() => { maintenanceSyncInFlight = false; });
}

function applyMaintenance(on) {
    maintenanceMode = on;
    document.getElementById('maintenanceWindow').classList.toggle('hidden', !on);
    document.getElementById('studentIdentity').disabled = on;
    document.getElementById('studentPin').disabled = on;
    btnVerify.disabled = on;
    btnVerify.classList.toggle('opacity-50', on);
    btnVerify.classList.toggle('cursor-not-allowed', on);
}

function initMaintenance() {
    fetch(maintenanceApiUrl(), { method: 'POST', body: JSON.stringify({ action: 'maintenance' }) })
        .then(r => r.json())
        .then(res => {
            if (res && res.success) applyMaintenance(!!res.maintenance);
        })
        .catch(() => {});
}

// ==========================================
// TAHAP 1: VERIFIKASI SISWA (POST)
// ==========================================
verifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const studentIdentity = document.getElementById('studentIdentity').value.trim();
    const studentPin = document.getElementById('studentPin').value.trim();

    // Nyalakan Loader
    document.getElementById('verifyLoader').classList.remove('hidden');
    btnVerify.disabled = true;

    // Payload disesuaikan dengan kebutuhan fungsi verifyStudent(id, pin) di Code.gs
    const payload = {
        action: 'verify',
        id: studentIdentity,
        pin: studentPin
    };

    try {
        const response = await fetch(getApiUrl(), {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        console.log('[Absensi] verify response:', result);

        // Di Code.gs Anda menggunakan properti 'success', bukan 'status'
        if (result.success) {
            // Simpan ID & PIN global untuk validasi lapis dua saat submit attendance
            currentStudentId = studentIdentity;
            currentStudentPin = studentPin;

            // Jika siswa sudah absen hari ini, tampilkan pemberitahuan dan hentikan alur
            if (result.already) {
                const rec = result.record || {};
                let notice = `Akun Anda sudah melakukan absensi pada tanggal ${formatDateDisplay(rec.date) || 'hari ini'}, dengan jenis latihan "${rec.type || '-'}".`;
                if (rec.remark) {
                    notice += ` Remark: "${rec.remark}"`;
                }
                showStatusModal("Pemberitahuan", notice, true);
                return;
            }

            // Isi informasi ke form tahap 2 sesuai properti return backend Anda
            document.getElementById('displayName').textContent = result.data.name;
            document.getElementById('displayStudentId').textContent = result.data.id || studentIdentity;
            document.getElementById('displayClass').textContent = result.data.className;
            document.getElementById('displayLoginTime').textContent =
                new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            // Switch Form Tampilan
            verifyForm.classList.add('hidden');
            attendanceForm.classList.remove('hidden');
        } else {
            showStatusModal("Gagal", result.message || "ID atau PIN salah!", false);
        }
    } catch (error) {
        console.error(error);
        showStatusModal("Error", "Gagal terhubung ke server backend.", false);
    } finally {
        // Matikan Loader
        document.getElementById('verifyLoader').classList.add('hidden');
        btnVerify.disabled = false;
    }
});

// ==========================================
// TAHAP 2: SUBMIT ABSENSI
// ==========================================
attendanceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentStudentId || !currentStudentPin) return;

    const jenisLatihan = document.getElementById('jenisLatihan').value;
    const remark = document.getElementById('remark').value.trim();

    // Nyalakan Loader
    document.getElementById('submitLoader').classList.remove('hidden');
    btnSubmit.disabled = true;

    // Payload disesuaikan dengan destructuring di fungsi submitAttendance(payload)
    const payload = {
        action: "submit",
        id: currentStudentId,
        pin: currentStudentPin,
        type: jenisLatihan,
        remark: remark
    };

    try {
        const response = await fetch(getApiUrl(), {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (result.success) {
            showStatusModal("Berhasil!", result.message, true);
            resetForm();
        } else {
            showStatusModal("Gagal", result.message || "Gagal menyimpan absensi.", false);
        }
    } catch (error) {
        console.error(error);
        showStatusModal("Error", "Terjadi gangguan jaringan saat mengirim data.", false);
    } finally {
        // Matikan Loader
        document.getElementById('submitLoader').classList.add('hidden');
        btnSubmit.disabled = false;
    }
});

// Tombol Batal / Kembali ke Tahap 1
btnBack.addEventListener('click', resetForm);

function resetForm() {
    currentStudentId = null;
    currentStudentPin = null;
    verifyForm.reset();
    attendanceForm.reset();
    document.getElementById('displayStudentId').textContent = '-';
    document.getElementById('displayLoginTime').textContent = '-';
    attendanceForm.classList.add('hidden');
    verifyForm.classList.remove('hidden');
}

// ==========================================
// MODAL STATUS & ADMIN MODAL
// ==========================================
function showStatusModal(title, message, isSuccess) {
    const modal = document.getElementById('statusModal');
    const content = document.getElementById('statusModalContent');
    const iconContainer = document.getElementById('statusIcon');

    document.getElementById('statusTitle').textContent = title;
    document.getElementById('statusMessage').textContent = message;

    if (isSuccess) {
        iconContainer.className = "mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-green-100 text-green-600";
        iconContainer.innerHTML = `<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
    } else {
        iconContainer.className = "mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-red-100 text-red-600";
        iconContainer.innerHTML = `<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`;
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        content.classList.remove('scale-95');
    }, 10);
}

function closeStatusModal() {
    const modal = document.getElementById('statusModal');
    const content = document.getElementById('statusModalContent');
    modal.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
}

function toggleAdminModal() {
    const modal = document.getElementById('adminModal');
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    } else {
        modal.classList.add('opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 300);
    }
}

// ==========================================
// SETTINGS ADMIN (KATA SANDI & KEAMANAN)
// ==========================================
function applySecurityState() {
    const secLocked = document.getElementById('secLocked');
    const secUnlocked = document.getElementById('secUnlocked');
    const urlInput = document.getElementById('apiUrlSetting');
    secLocked.classList.toggle('hidden', !settingsLocked);
    secUnlocked.classList.toggle('hidden', settingsLocked);
    urlInput.disabled = settingsLocked;
    document.getElementById('btnTestConn').disabled = settingsLocked;
    document.getElementById('btnSaveConn').disabled = settingsLocked;
    urlInput.placeholder = settingsLocked ? 'Terkunci - masukkan kata sandi admin' : 'https://script.google.com/macros/s/.../exec';
    urlInput.value = settingsLocked ? '' : (getConfig().apiUrl || '');
    document.getElementById('reportDate').disabled = settingsLocked;
    document.getElementById('btnShowReport').disabled = settingsLocked;
    document.getElementById('btnShowStudents').disabled = settingsLocked;
    document.getElementById('reportBlock').classList.toggle('hidden', settingsLocked);
    document.getElementById('studentBlock').classList.toggle('hidden', settingsLocked);
    if (settingsLocked) {
        document.getElementById('reportStatus').textContent = '';
    }
}

function unlockSettings() {
    const p = document.getElementById('unlockPwd').value;
    if (!p) {
        showStatusModal("Gagal", "Masukkan kata sandi admin terlebih dahulu.", false);
        return;
    }
    checkPassword(p).then(ok => {
        if (!ok) {
            showStatusModal("Gagal", "Kata sandi yang dimasukkan salah.", false);
            return;
        }
        document.getElementById('unlockPwd').value = '';
        settingsLocked = false;
        applySecurityState();
        showStatusModal("Berhasil", "Pengaturan Admin berhasil dibuka.", true);
    });
}

function lockSettings() {
    settingsLocked = true;
    applySecurityState();
    document.getElementById('connStatus').textContent = '';
    showStatusModal("Pemberitahuan", "Pengaturan Admin berhasil dikunci.", true);
}

function changePassword() {
    const old = document.getElementById('oldPwd').value;
    const np = document.getElementById('newPwd').value;
    const cp = document.getElementById('confirmPwd').value;
    if (!old) {
        showStatusModal("Gagal", "Masukkan kata sandi saat ini.", false);
        return;
    }
    if (!np || np.length < 4) {
        showStatusModal("Gagal", "Kata sandi baru minimal 4 karakter.", false);
        return;
    }
    if (np !== cp) {
        showStatusModal("Gagal", "Konfirmasi kata sandi baru tidak cocok.", false);
        return;
    }
    checkPassword(old).then(ok => {
        if (!ok) {
            showStatusModal("Gagal", "Kata sandi saat ini salah.", false);
            return;
        }
        hashPassword(np).then(newHash => {
            localStorage.setItem(LS_PWD, newHash);
            document.getElementById('oldPwd').value = '';
            document.getElementById('newPwd').value = '';
            document.getElementById('confirmPwd').value = '';
            showStatusModal("Berhasil", "Kata sandi admin berhasil diganti.", true);
        });
    });
}

// ==========================================
// KONEKSI GOOGLE SHEETS
// ==========================================
function setConnStatus(msg, type) {
    const el = document.getElementById('connStatus');
    el.textContent = msg || '';
    el.className = 'text-sm mt-2 ' + (type === 'ok' ? 'text-green-600' : type === 'err' ? 'text-red-500' : 'text-gray-500');
}

function saveConfig() {
    const url = document.getElementById('apiUrlSetting').value.trim();
    const cfg = getConfig();
    cfg.apiUrl = url;
    setConfig(cfg);
    testConnection();
}

function testConnection() {
    const url = document.getElementById('apiUrlSetting').value.trim();
    const cfg = getConfig();
    cfg.apiUrl = url;
    setConfig(cfg);

    if (!url) {
        setConnStatus('URL belum diisi.', 'err');
        return;
    }

    setConnStatus('Menguji koneksi...', '');
    fetch(url, { method: 'POST', body: JSON.stringify({ action: 'ping' }) })
        .then(r => r.json())
        .then(res => {
            if (res && res.success === true) {
                setConnStatus('Koneksi berhasil! Backend aktif dan dapat digunakan.', 'ok');
            } else if (res && res.success === false) {
                setConnStatus('Backend merespons, namun action ping tidak tersedia. Pastikan code.gs sudah diperbarui.', 'err');
            } else {
                setConnStatus('Respons tidak dikenali. Pastikan URL adalah Apps Script Web App.', 'err');
            }
        })
        .catch(() => {
            setConnStatus('Koneksi gagal. Periksa URL dan deployment Apps Script.', 'err');
        });
}

// ==========================================
// LAPORAN ABSENSI
// ==========================================
function setReportStatus(msg, type) {
    const el = document.getElementById('reportStatus');
    el.textContent = msg || '';
    el.className = 'text-sm mt-2 ' + (type === 'ok' ? 'text-green-600' : type === 'err' ? 'text-red-500' : 'text-gray-500');
}

function loadReport() {
    const date = document.getElementById('reportDate').value;
    if (!date) {
        setReportStatus('Pilih tanggal terlebih dahulu.', 'err');
        return;
    }
    if (date > todayISO()) {
        setReportStatus('Tanggal tidak boleh melebihi hari ini.', 'err');
        return;
    }
    setReportStatus('Memuat data...', '');
    fetch(getApiUrl(), { method: 'POST', body: JSON.stringify({ action: 'report', date: date }) })
        .then(r => r.json())
        .then(res => {
            if (!res.success) {
                setReportStatus(res.message || 'Gagal memuat laporan.', 'err');
                return;
            }
            setReportStatus('', '');
            renderReport(res);
        })
        .catch(() => setReportStatus('Koneksi gagal. Periksa backend.', 'err'));
}

function renderReport(res) {
    document.getElementById('reportDateDisplay').textContent = formatDateDisplay(res.date) || res.date;
    const records = res.records || [];
    document.getElementById('reportCountDisplay').textContent = records.length + ' siswa tercatat';
    document.getElementById('reportEmpty').classList.toggle('hidden', records.length > 0);
    if (records.length === 0) {
        document.getElementById('reportEmptyText').textContent =
            'Tidak ada aktifitas latihan paduan suara pada ' + (formatDateDisplay(res.date) || res.date);
    }
    document.getElementById('reportList').innerHTML = records.map((r, i) => {
        const remark = r.remark ? `<div class="text-xs text-gray-400 mt-0.5">${escapeHtml(r.remark)}</div>` : '';
        return `<div class="flex items-start gap-3 bg-gray-50 p-3 rounded-xl border border-gray-100">
            <div class="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold shrink-0">${(i + 1)}</div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                    <span class="font-semibold text-gray-800 text-sm truncate">${escapeHtml(r.name)}</span>
                    <span class="text-xs font-semibold text-green-600 shrink-0">${escapeHtml(r.status)}</span>
                </div>
                <div class="text-xs text-gray-500">${escapeHtml(r.id)} | ${escapeHtml(r.className)}</div>
                <div class="text-xs text-gray-500">${escapeHtml(r.type)}</div>
                ${remark}
                <div class="text-xs text-gray-400 mt-1">${escapeHtml(r.timestamp)}</div>
            </div>
        </div>`;
    }).join('');
    currentReportData = res;
    populateReportAbsent(res);
    populateReportPrint(res);
    openReportModal();
}

function populateReportAbsent(res) {
    const absent = res.absent || [];
    const records = res.records || [];
    const block = document.getElementById('reportAbsentBlock');
    block.classList.toggle('hidden', absent.length === 0 || records.length === 0);
    document.getElementById('reportAbsentList').innerHTML = absent.map((s, i) => {
        return `<div class="flex items-start gap-3 bg-yellow-500 p-3 rounded-xl border border-yellow-600">
            <div class="w-10 h-10 rounded-full bg-white text-yellow-600 flex items-center justify-center font-bold shrink-0">${(i + 1)}</div>
            <div class="flex-1 min-w-0">
                <div class="font-semibold text-yellow-900 text-sm truncate">${escapeHtml(s.name)}</div>
                <div class="text-xs text-yellow-800">${escapeHtml(s.id)} | ${escapeHtml(s.className)}</div>
            </div>
        </div>`;
    }).join('');
}

function populateReportPrint(res) {
    const records = res.records || [];
    currentReportDate = res.date || '';
    document.getElementById('printReportDate').textContent = formatDateDisplay(res.date) || res.date;
    document.getElementById('printReportCount').textContent = records.length + ' siswa tercatat';
    document.getElementById('printReportRows').innerHTML = records.length ? records.map((r, i) => {
        return '<tr>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + (i + 1) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.name) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.id) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.className) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.type) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.remark) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.timestamp) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.status) + '</td>' +
            '</tr>';
    }).join('') : '<tr><td style="border:1px solid #999;padding:6px;text-align:center;" colspan="8">Tidak ada data</td></tr>';
    const absent = res.absent || [];
    document.getElementById('printReportAbsentBlock').style.display = absent.length ? 'block' : 'none';
    document.getElementById('printReportAbsentRows').innerHTML = absent.length ? absent.map((s, i) => {
        return '<tr>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + (i + 1) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(s.name) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(s.id) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(s.className) + '</td>' +
            '</tr>';
    }).join('') : '<tr><td style="border:1px solid #999;padding:6px;text-align:center;" colspan="4">Tidak ada data</td></tr>';
}

function openReportModal() {
    const modal = document.getElementById('reportModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('reportScroll').scrollTop = 0;
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

function printReport() {
    if (!currentReportData) return;
    populateReportPrint(currentReportData);
    const prevTitle = document.title;
    document.title = 'Absensi+' + (currentReportData.date || '');
    document.body.classList.add('printing-report');
    window.print();
    document.body.classList.remove('printing-report');
    document.title = prevTitle;
}

function closeReportModal() {
    const modal = document.getElementById('reportModal');
    modal.classList.add('opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
}

// ==========================================
// DAFTAR SISWA
// ==========================================
function setStudentStatus(msg, type) {
    const el = document.getElementById('studentStatus');
    el.textContent = msg || '';
    el.className = 'text-sm mt-2 ' + (type === 'ok' ? 'text-green-600' : type === 'err' ? 'text-red-500' : 'text-gray-500');
}

function loadStudents() {
    setStudentStatus('Memuat daftar siswa...', '');
    fetch(getApiUrl(), { method: 'POST', body: JSON.stringify({ action: 'students' }) })
        .then(r => r.json())
        .then(res => {
            if (!res.success) {
                setStudentStatus(res.message || 'Gagal memuat daftar siswa.', 'err');
                return;
            }
            setStudentStatus('', '');
            renderStudents(res);
        })
        .catch(() => setStudentStatus('Koneksi gagal. Periksa backend.', 'err'));
}

function renderStudents(res) {
    const students = res.students || [];
    currentStudentList = students;
    document.getElementById('studentCountDisplay').textContent = students.length + ' siswa terdaftar';
    document.getElementById('studentEmpty').classList.toggle('hidden', students.length > 0);
    document.getElementById('studentList').innerHTML = students.map((s, i) => {
        const active = String(s.status).toUpperCase() === 'ACTIVE';
        const statusBadge = active
            ? '<span class="text-xs font-semibold text-green-600 shrink-0">Aktif</span>'
            : '<span class="text-xs font-semibold text-red-500 shrink-0">Nonaktif</span>';
        return `<div class="flex items-start gap-3 bg-gray-50 p-3 rounded-xl border border-gray-100">
            <div class="w-10 h-10 rounded-full bg-green-600 text-white flex items-center justify-center font-bold shrink-0">${(i + 1)}</div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                    <span class="font-semibold text-gray-800 text-sm truncate">${escapeHtml(s.name)}</span>
                    ${statusBadge}
                </div>
                <div class="text-xs text-gray-500">${escapeHtml(s.id)}${s.className ? ' | ' + escapeHtml(s.className) : ''}</div>
            </div>
            <button onclick="showStudentHistory(${i})" class="shrink-0 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1.5 rounded-lg transition">Riwayat</button>
        </div>`;
    }).join('');
    document.getElementById('printStudentCount').textContent = students.length + ' siswa terdaftar';
    document.getElementById('printStudentDate').textContent = 'Dicetak: ' + new Date().toLocaleDateString('id-ID', dateOptions);
    document.getElementById('printStudentRows').innerHTML = students.length ? students.map((s, i) => {
        return '<tr>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + (i + 1) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(s.name) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(s.id) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(s.className) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(String(s.status).toUpperCase() === 'ACTIVE' ? 'Aktif' : 'Nonaktif') + '</td>' +
            '</tr>';
    }).join('') : '<tr><td style="border:1px solid #999;padding:6px;text-align:center;" colspan="5">Tidak ada data</td></tr>';
    openStudentModal();
}

function openStudentModal() {
    const modal = document.getElementById('studentModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('studentScroll').scrollTop = 0;
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

function printStudents() {
    const prevTitle = document.title;
    document.title = 'Students+' + todayISO();
    document.body.classList.add('printing-students');
    window.print();
    document.body.classList.remove('printing-students');
    document.title = prevTitle;
}

function closeStudentModal() {
    const modal = document.getElementById('studentModal');
    modal.classList.add('opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
}

// ==========================================
// RIWAYAT ABSENSI PER SISWA
// ==========================================
function showStudentHistory(index) {
    const student = currentStudentList[index];
    if (!student) return;
    const modal = document.getElementById('historyModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('historyScroll').scrollTop = 0;
    setTimeout(() => modal.classList.remove('opacity-0'), 10);

    document.getElementById('historyNameDisplay').textContent = student.name || '-';
    document.getElementById('historyMetaDisplay').textContent =
        (student.id || '') + (student.className ? ' | ' + student.className : '');
    document.getElementById('historyList').innerHTML = '';
    document.getElementById('historyEmpty').classList.add('hidden');
    document.getElementById('historyStatus').textContent = 'Memuat riwayat...';

    fetch(getApiUrl(), { method: 'POST', body: JSON.stringify({ action: 'history', id: student.id }) })
        .then(r => r.json())
        .then(res => {
            if (!res.success) {
                document.getElementById('historyStatus').textContent = res.message || 'Gagal memuat riwayat.';
                return;
            }
            const records = res.records || [];
            document.getElementById('historyStatus').textContent = records.length + ' kali hadir';
            document.getElementById('historyEmpty').classList.toggle('hidden', records.length > 0);

            const monthGroups = [];
            records.forEach(r => {
                const key = String(r.date || '').substring(0, 7);
                let group = monthGroups.find(g => g.key === key);
                if (!group) {
                    group = { key: key, records: [] };
                    monthGroups.push(group);
                }
                group.records.push(r);
            });

            document.getElementById('historyList').innerHTML = monthGroups.map(group => {
                const parts = group.key.split('-');
                let label = group.key;
                if (parts.length === 2) {
                    label = new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
                }
                const sorted = group.records.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
                const items = sorted.map((r, i) => {
                    const seq = i + 1;
                    const remark = r.remark ? `<div class="text-xs text-gray-400 mt-0.5">Catatan: ${escapeHtml(r.remark)}</div>` : '';
                    return `<div class="flex items-start gap-3 bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <div class="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold shrink-0">${seq}</div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between gap-2">
                            <span class="font-semibold text-gray-800 text-sm truncate">${escapeHtml(formatDateDisplay(r.date) || r.date)}</span>
                            <span class="text-xs font-semibold text-green-600 shrink-0">${escapeHtml(r.status)}</span>
                        </div>
                        <div class="text-xs text-gray-500">${escapeHtml(r.type)}</div>
                        ${remark}
                        <div class="text-xs text-gray-400 mt-1">${escapeHtml(r.timestamp)}</div>
                    </div>
                </div>`;
                }).join('');
                return `<div class="mb-3">
                    <div class="flex items-center justify-between px-1 mb-1.5">
                        <span class="text-sm font-bold text-indigo-700">${escapeHtml(label)}</span>
                        <span class="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">${group.records.length} hadir</span>
                    </div>
                    <div class="space-y-2">${items}</div>
                </div>`;
            }).join('');

            document.getElementById('printHistoryStudent').textContent = student.name || '-';
            document.getElementById('printHistoryMeta').textContent =
                (student.id || '') + (student.className ? ' | ' + student.className : '');
            document.getElementById('printHistoryDate').textContent = 'Dicetak: ' + new Date().toLocaleDateString('id-ID', dateOptions);
            document.getElementById('printHistoryRows').innerHTML = records.length ? monthGroups.map(group => {
                const parts = group.key.split('-');
                let label = group.key;
                if (parts.length === 2) {
                    label = new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
                }
                let html = '<tr><td style="border:1px solid #999;padding:6px;text-align:left;font-weight:bold;background:#f1f5f9;" colspan="6">' + escapeHtml(label) + ' &mdash; ' + group.records.length + ' hadir</td></tr>';
                const sorted = group.records.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
                sorted.forEach((r, i) => {
                    const seq = i + 1;
                    const ts = String(r.timestamp || '');
                    const time = ts.length >= 19 ? ts.substring(11, 16) : '';
                    html += '<tr>' +
                        '<td style="border:1px solid #999;padding:6px;text-align:center;">' + seq + '</td>' +
                        '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(formatDateDisplay(r.date) || r.date) + '</td>' +
                        '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(time) + '</td>' +
                        '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.type) + '</td>' +
                        '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.remark) + '</td>' +
                        '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.status) + '</td>' +
                        '</tr>';
                });
                return html;
            }).join('') : '<tr><td style="border:1px solid #999;padding:6px;text-align:center;" colspan="6">Tidak ada data</td></tr>';
        })
        .catch(() => {
            document.getElementById('historyStatus').textContent = 'Koneksi gagal. Periksa backend.';
        });
}

function closeHistoryModal() {
    const modal = document.getElementById('historyModal');
    modal.classList.add('opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
}

function printHistory() {
    const prevTitle = document.title;
    document.title = 'History+' + todayISO();
    document.body.classList.add('printing-history');
    window.print();
    document.body.classList.remove('printing-history');
    document.title = prevTitle;
}

// ==========================================
// MODAL PENGATURAN ADMIN
// ==========================================
function toggleSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    } else {
        modal.classList.add('opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 300);
    }
}

// ==========================================
// BANTUAN (PANDUAN ABSENSI)
// ==========================================
function loadHelpContent() {
    const content = document.getElementById('helpContent');
    content.innerHTML = '<p class="text-sm text-gray-500">Memuat panduan...</p>';
    fetch('Absensi.md', { cache: 'no-store' })
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
        })
        .then(md => {
            content.innerHTML = renderMarkdown(md);
            helpLoaded = true;
        })
        .catch(() => {
            content.innerHTML = '<p class="text-sm text-red-500">Gagal memuat panduan. Periksa koneksi Anda.</p>';
        });
}

function toggleHelpModal() {
    const modal = document.getElementById('helpModal');
    if (modal.classList.contains('hidden')) {
        if (!helpLoaded) loadHelpContent();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    } else {
        modal.classList.add('opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 300);
    }
}

// ==========================================
// EVENT LISTENERS
// ==========================================
document.getElementById('btnUnlock').addEventListener('click', unlockSettings);
document.getElementById('btnLock').addEventListener('click', lockSettings);
document.getElementById('btnChangePwd').addEventListener('click', changePassword);
document.getElementById('btnTestConn').addEventListener('click', testConnection);
document.getElementById('btnSaveConn').addEventListener('click', saveConfig);
document.getElementById('btnShowReport').addEventListener('click', loadReport);
document.getElementById('reportDate').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadReport();
});
document.getElementById('btnShowStudents').addEventListener('click', loadStudents);
document.getElementById('unlockPwd').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') unlockSettings();
});
document.getElementById('apiUrlSetting').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveConfig();
});

// ==========================================
// INISIALISASI
// ==========================================
document.getElementById('currentDateDisplay').textContent = new Date().toLocaleDateString('id-ID', dateOptions);
document.getElementById('reportDate').value = todayISO();
initMaintenance();
applySecurityState();
