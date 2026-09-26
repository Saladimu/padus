// ==========================================
// ABSENSI PADUAN SUARA - Aplikasi Frontend
// Dimuat dengan atribut defer sehingga DOM
// sudah siap saat script ini dieksekusi.
// ==========================================

// Daftarkan Service Worker lebih awal agar
// cache aset tersedia sesegera mungkin.
// Sekaligus deteksi bila ada versi baru terpasang agar pengguna
// dapat diminta melakukan hard refresh.
const APP_ASSET_VERSION = '20260926b';
let swRegistration = null;
let hasSwController = false;
let updateModalShown = false;
let updateReloadArmed = false;

function watchWaitingWorker(worker) {
    if (!worker) return;
    if (worker.state === 'installed' && hasSwController) promptAppUpdate();
    worker.addEventListener('statechange', function () {
        if (worker.state === 'installed' && hasSwController) promptAppUpdate();
    });
}

function listenForWaitingSw(reg) {
    if (!reg) return;
    watchWaitingWorker(reg.waiting);
    watchWaitingWorker(reg.installing);
    reg.addEventListener('updatefound', function () {
        watchWaitingWorker(reg.installing);
    });
}

function checkRemoteAppVersion() {
    fetch('sw.js?_=' + Date.now(), { cache: 'no-store' })
        .then(function (res) { return res.text(); })
        .then(function (text) {
            const match = String(text).match(/ASSET_VERSION\s*=\s*['"]([^'"]+)['"]/);
            if (match && match[1] && match[1] !== APP_ASSET_VERSION) promptAppUpdate();
        })
        .catch(function () {});
}

if ('serviceWorker' in navigator) {
    hasSwController = !!navigator.serviceWorker.controller;

    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
        swRegistration = reg;
        listenForWaitingSw(reg);
        if (reg.waiting && hasSwController) promptAppUpdate();
        return reg.update();
    }).catch(function () {});

    navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (updateReloadArmed) {
            window.location.reload();
            return;
        }
        if (hasSwController) promptAppUpdate();
        hasSwController = true;
    });

    const checkForAppUpdate = function () {
        if (swRegistration) swRegistration.update().catch(function () {});
        checkRemoteAppVersion();
    };
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            checkForAppUpdate();
            if (typeof refreshMaintenance === 'function') refreshMaintenance(true);
        }
    });
    setTimeout(checkForAppUpdate, 2000);
    setInterval(checkForAppUpdate, 60 * 1000);
}

// ==========================================
// MODAL PEMBARUAN APLIKASI (HARD REFRESH)
// ==========================================
function promptAppUpdate() {
    if (updateModalShown) return;
    const modal = document.getElementById('updateModal');
    const content = document.getElementById('updateModalContent');
    if (!modal || !content) {
        setTimeout(promptAppUpdate, 300);
        return;
    }
    updateModalShown = true;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(function () {
        modal.classList.remove('opacity-0');
        content.classList.remove('scale-95');
        const btn = document.getElementById('btnHardRefresh');
        if (btn) btn.focus();
    }, 10);
}

function dismissUpdateModal() {
    const modal = document.getElementById('updateModal');
    const content = document.getElementById('updateModalContent');
    if (!modal || !content) return;
    modal.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(function () {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        updateModalShown = false;
    }, 300);
}

// Bersihkan cache + service worker lalu muat ulang dari jaringan.
function hardRefreshApp() {
    updateReloadArmed = true;
    if (swRegistration && swRegistration.waiting) {
        swRegistration.waiting.postMessage('SKIP_WAITING');
    }
    const reload = function () { window.location.reload(); };
    const clearCaches = function () {
        if (window.caches && caches.keys) {
            caches.keys().then(function (keys) {
                return Promise.all(keys.map(function (k) { return caches.delete(k); }));
            }).catch(function () {}).then(reload);
        } else {
            reload();
        }
    };
    setTimeout(reload, 1500);
    if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then(function (regs) {
            return Promise.all(regs.map(function (r) { return r.unregister(); }));
        }).catch(function () {}).then(clearCaches);
    } else {
        clearCaches();
    }
}

// ==========================================
// CONFIGURASI BACKEND
// ==========================================
// URL backend Apps Script. Nilainya diambil dari parameter submenu
// "Koneksi Google Sheets" (disimpan di localStorage). Kosong sampai admin
// mengisinya, sehingga aplikasi tidak lagi memakai URL bawaan yang hardcoded.
let GAS_WEB_APP_URL = "";
const LS_CONFIG = 'choir_absensi_config';
const LS_PWD = 'choir_absensi_pwd';
const LS_ADMIN_LOCK = 'choir_admin_lock_v1';
const ADMIN_MAX_ATTEMPTS = 3;
const ADMIN_LOCK_MS = 5 * 60 * 1000;

// Backend Apps Script kadang lambat lalu mengembalikan halaman HTML
// alih-alih JSON. Timeout harus lebih panjang dari waitLock server (10s)
// agar klien tidak memutus permintaan yang masih menulis absensi.
const API_TIMEOUT_MS = 25000;
const API_MAX_RETRIES = 3;

// ==========================================
// STATE GLOBAL
// ==========================================
let currentStudentId = null;
let currentStudentPin = null;
let currentReportDate = null;
let currentReportData = null;
let currentStudentList = [];

let maintenanceMode = false;
let maintenanceManual = null; // null = ikut jadwal, true = paksa aktif, false = paksa nonaktif
const MAINT_ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const MAINT_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MAINT_DAY_LABELS = { 0: 'Min', 1: 'Sen', 2: 'Sel', 3: 'Rab', 4: 'Kam', 5: 'Jum', 6: 'Sab' };
let maintenanceSchedule = { enabled: true, start: '09:00', end: '17:00', days: MAINT_ALL_DAYS.slice() };
let logoClickCount = 0;
let logoClickTimer = null;
let maintenanceSyncInFlight = false;
let maintenancePersistQueued = false;
let maintenanceDaySaveTimer = null;
let maintenanceOverrideReqId = 0;
let maintenanceRefreshPromise = null;
let maintenanceLastCheck = 0;
const MAINTENANCE_CHECK_MIN_INTERVAL = 60000;

let settingsLocked = true;
let settingsLockTimer = null;
let adminLockTimer = null;
const SETTINGS_LOCK_TIMEOUT = 5 * 60 * 1000;
let helpLoaded = false;

// Cache peek laporan absensi hari ini agar membuka modal lebih cepat
const PEEK_CACHE_TTL = 30000;
const PEEK_CACHE_KEY = 'choir_peek_cache_v1';
let peekCache = null;

// Cache status maintenance agar input tidak menunggu jaringan saat muat awal
const MAINTENANCE_CACHE_KEY = 'choir_maintenance_cache_v1';
const MAINTENANCE_CACHE_TTL = 5 * 60 * 1000;

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

// Ubah "yyyy-MM-dd" menjadi "DD-MM" (tanpa tahun)
function ddmmFromIso(iso) {
    const parts = String(iso || '').split('-');
    if (parts.length !== 3) return iso;
    return parts[2] + '-' + parts[1];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Ubah timestamp "yyyy-MM-dd HH:mm:ss" menjadi "HH:MM AM/PM" (tanpa tanggal).
function formatTimeAmPm(ts) {
    const text = String(ts || '').trim();
    const m = text.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
    if (!m) return text;
    let hour = Number(m[1]);
    const minute = m[2];
    const suffix = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return String(hour).padStart(2, '0') + ':' + minute + ' ' + suffix;
}

// Ubah "yyyy-MM-dd" menjadi "DD-Mon" (tanpa tahun), contoh "05-Sep"
function ddMonFromIso(iso) {
    const parts = String(iso || '').split('-');
    if (parts.length !== 3) return iso;
    const monthIndex = Number(parts[1]) - 1;
    return parts[2] + '-' + (MONTHS[monthIndex] || parts[1]);
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

// Batas tahun ekskul berlaku selama tidak dimatikan (default aktif agar
// pengaturan lama yang sudah terisi tetap berjalan).
function isYearRangeEnabled() {
    return getConfig().yearEnabled !== false;
}

// Rentang tahun ekskul dalam format "MM-YYYY".
function getYearRange() {
    if (!isYearRangeEnabled()) return { start: '', end: '' };
    const cfg = getConfig();
    return { start: String(cfg.startYear || '').trim(), end: String(cfg.endYear || '').trim() };
}

function isValidMonthYear(val) {
    if (!/^\d{2}-\d{4}$/.test(val)) return false;
    const m = Number(val.substring(0, 2));
    return m >= 1 && m <= 12;
}

function formatMonthYearInput(el, deleting) {
    if (!el) return;
    const selStart = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
    const digits = String(el.value || '').replace(/\D/g, '').substring(0, 6);
    let formatted = digits;
    if (digits.length > 2 || (digits.length === 2 && !deleting)) {
        formatted = digits.substring(0, 2) + '-' + digits.substring(2);
    }
    if (el.value === formatted) return;
    const insertedDash = formatted.charAt(2) === '-' && String(el.value).charAt(2) !== '-';
    el.value = formatted;
    let nextPos = selStart;
    if (insertedDash && selStart >= 2) nextPos = selStart + 1;
    try { el.setSelectionRange(nextPos, nextPos); } catch (e) { /* abaikan bila tidak didukung */ }
}

function bindMonthYearInput(el) {
    if (!el) return;
    el.addEventListener('input', function () {
        const prevLen = el.dataset.prevLen ? Number(el.dataset.prevLen) : 0;
        formatMonthYearInput(el, el.value.length < prevLen);
        el.dataset.prevLen = String(el.value.length);
    });
}

// Konversi "MM-YYYY" menjadi "YYYY-MM" agar dapat dibandingkan secara leksikografis.
function monthYearToYM(val) {
    return String(val || '').substring(3, 7) + '-' + String(val || '').substring(0, 2);
}

// Apakah tanggal "yyyy-MM-dd" (atau "yyyy-MM") berada dalam rentang tahun ekskul?
function dateInRange(dateStr, range) {
    const m = String(dateStr || '').substring(0, 7);
    if (!m) return true;
    const start = range && range.start ? monthYearToYM(range.start) : '';
    const end = range && range.end ? monthYearToYM(range.end) : '';
    if (start && m < start) return false;
    if (end && m > end) return false;
    return true;
}

// URL default publik dari config.js (dimuat sebelum app.js). Nilai ini
// dipakai SEMUA perangkat sehingga siswa tidak perlu mengisi apa pun.
function getDefaultApiUrl() {
    if (typeof window === 'undefined' || !window.PADUS_DEFAULT_API_URL) return '';
    return String(window.PADUS_DEFAULT_API_URL).trim();
}

// URL backend: pakai override dari submenu "Koneksi Google Sheets" bila ada,
// jika tidak pakai URL default dari config.js. Tidak ada URL hardcoded di sini.
function getApiUrl() {
    const fromSettings = (getConfig().apiUrl || '').trim();
    GAS_WEB_APP_URL = fromSettings || getDefaultApiUrl();
    return GAS_WEB_APP_URL;
}

function hasApiUrl() {
    return getApiUrl() !== '';
}

// URL valid = Apps Script Web App (berakhiran /exec).
function isValidAppsScriptUrl(url) {
    return /^https:\/\/script\.google\.com\/\S*\/exec(\?.*)?$/i.test(String(url || '').trim());
}

function apiUrlMissingMessage() {
    return 'URL Apps Script belum diatur. Buka Pengaturan > Koneksi Google Sheets, tempel URL Web App yang berakhiran /exec, lalu tekan Simpan. (Ketuk logo 5 kali bila ikon Pengaturan belum tampil.)';
}

// Tampilkan/sembunyikan banner peringatan di menu utama.
function updateConnectionWarning() {
    const el = document.getElementById('connWarning');
    if (!el) return;
    el.classList.toggle('hidden', hasApiUrl());
}

// Tandai sumber URL yang sedang dipakai di submenu Koneksi Google Sheets:
// pengaturan perangkat ini (override) atau default config.js.
function updateConnSourceBadge() {
    const el = document.getElementById('connSource');
    if (!el) return;
    const saved = (getConfig().apiUrl || '').trim();
    const def = getDefaultApiUrl();
    if (saved) {
        el.textContent = 'Sumber URL: pengaturan perangkat ini (menimpa default config.js).';
        el.className = 'text-xs font-medium mb-3 text-blue-600';
    } else if (def) {
        el.textContent = 'Sumber URL: config.js (default untuk semua perangkat).';
        el.className = 'text-xs font-medium mb-3 text-green-600';
    } else {
        el.textContent = 'Sumber URL: belum diatur (config.js kosong dan belum ada pengaturan perangkat).';
        el.className = 'text-xs font-medium mb-3 text-red-500';
    }
}

// POST JSON ke backend dengan batas waktu dan percobaan ulang.
// Respons non-JSON (halaman error Google) atau jaringan lambat akan
// dicoba ulang, kecuali `options.retries` diisi.
function apiPost(payload, options) {
    const opts = options || {};
    const url = opts.url || getApiUrl();
    const timeoutMs = opts.timeoutMs || API_TIMEOUT_MS;
    const maxRetries = typeof opts.retries === 'number' ? opts.retries : API_MAX_RETRIES;
    const body = JSON.stringify(payload);

    if (!url || !/^https?:\/\//i.test(url)) {
        updateConnectionWarning();
        return Promise.reject(new Error(apiUrlMissingMessage()));
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return Promise.reject(new Error('Tidak ada koneksi internet.'));
    }

    function run(remaining) {
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        let timer = null;
        const clear = function () {
            if (timer) { clearTimeout(timer); timer = null; }
        };
        if (controller) {
            timer = setTimeout(function () { controller.abort(); }, timeoutMs);
        }
        const init = { method: 'POST', body: body, cache: 'no-store' };
        if (controller) init.signal = controller.signal;

        return fetch(url, init)
            .then(function (response) {
                return response.text().then(function (text) {
                    clear();
                    return text;
                });
            })
            .then(function (text) {
                const trimmed = (text || '').trim();
                if (trimmed.charAt(0) !== '{' && trimmed.charAt(0) !== '[') {
                    throw new Error('Respons backend tidak valid.');
                }
                return JSON.parse(trimmed);
            })
            .catch(function (err) {
                clear();
                if (typeof navigator !== 'undefined' && navigator.onLine === false) throw err;
                if (remaining <= 0) throw err;
                const delay = 500 * (maxRetries - remaining + 1) + Math.floor(Math.random() * 250);
                return new Promise(function (resolve) {
                    setTimeout(function () { resolve(run(remaining - 1)); }, delay);
                });
            });
    }

    return run(maxRetries);
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

// ==========================================
// KUNCI SEMENTARA KATA SANDI ADMIN (3x salah -> 5 menit)
// ==========================================
function readAdminLock() {
    try {
        const raw = localStorage.getItem(LS_ADMIN_LOCK);
        if (!raw) return { fails: 0, lockedUntil: 0 };
        const s = JSON.parse(raw);
        return { fails: Number(s.fails) || 0, lockedUntil: Number(s.lockedUntil) || 0 };
    } catch (e) {
        return { fails: 0, lockedUntil: 0 };
    }
}

function writeAdminLock(state) {
    try { localStorage.setItem(LS_ADMIN_LOCK, JSON.stringify(state)); } catch (e) { /* localStorage tidak tersedia */ }
}

function adminLockRemaining() {
    const remain = readAdminLock().lockedUntil - Date.now();
    return remain > 0 ? remain : 0;
}

function formatLockRemaining(ms) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return m + ':' + (sec < 10 ? '0' + sec : String(sec));
}

function clearAdminLock() {
    writeAdminLock({ fails: 0, lockedUntil: 0 });
}

function registerAdminFail() {
    const s = readAdminLock();
    let fails = s.fails + 1;
    let lockedUntil = s.lockedUntil;
    if (fails >= ADMIN_MAX_ATTEMPTS) {
        lockedUntil = Date.now() + ADMIN_LOCK_MS;
        fails = ADMIN_MAX_ATTEMPTS;
    }
    writeAdminLock({ fails: fails, lockedUntil: lockedUntil });
    const remaining = lockedUntil - Date.now();
    return { fails: fails, locked: remaining > 0, remaining: remaining > 0 ? remaining : 0 };
}

function setUnlockStatus(msg, type) {
    const el = document.getElementById('unlockStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'text-xs mt-2 ' + (type === 'err' ? 'text-red-500' : type === 'ok' ? 'text-green-600' : 'text-gray-500');
}

function refreshAdminLockUI() {
    const remain = adminLockRemaining();
    const locked = remain > 0;
    const inputEl = document.getElementById('unlockPwd');
    const btnEl = document.getElementById('btnUnlock');

    if (inputEl) inputEl.disabled = locked;
    if (btnEl) {
        btnEl.disabled = locked;
        btnEl.classList.toggle('opacity-50', locked);
        btnEl.classList.toggle('cursor-not-allowed', locked);
    }

    if (locked) {
        setUnlockStatus('Terkunci sementara. Coba lagi dalam ' + formatLockRemaining(remain) + '.', 'err');
        if (!adminLockTimer) adminLockTimer = setInterval(refreshAdminLockUI, 1000);
    } else {
        if (adminLockTimer) {
            clearInterval(adminLockTimer);
            adminLockTimer = null;
        }
        const s = readAdminLock();
        if (s.lockedUntil && s.fails >= ADMIN_MAX_ATTEMPTS) {
            // Masa kunci baru saja berakhir: buka kembali percobaan.
            clearAdminLock();
            setUnlockStatus('', '');
        }
    }
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
// PENGATURAN (publik) & MENU ADMIN (5x klik logo)
// ==========================================
// Pengaturan publik (Koneksi Google Sheets + Setup Backend) dibuka lewat
// ikon roda gigi yang selalu tampil. Menu Admin tetap tersembunyi dan
// dibuka/ditutup dengan mengetuk logo tengah 5 kali.

function logoClick() {
    logoClickCount++;
    if (logoClickTimer) clearTimeout(logoClickTimer);
    logoClickTimer = setTimeout(function () { logoClickCount = 0; }, 1500);
    if (logoClickCount >= 5) {
        logoClickCount = 0;
        clearTimeout(logoClickTimer);
        toggleMenuAdminModal();
    }
}

function maintenanceApiUrl() {
    const base = getApiUrl();
    const sep = base.indexOf('?') === -1 ? '?' : '&';
    return base + sep + '_=' + Date.now();
}

function normalizeMaintenanceDays(days) {
    if (!Array.isArray(days)) return MAINT_ALL_DAYS.slice();
    const seen = {};
    const out = [];
    days.forEach(function (d) {
        const n = parseInt(d, 10);
        if (n >= 0 && n <= 6 && !seen[n]) {
            seen[n] = true;
            out.push(n);
        }
    });
    out.sort(function (a, b) { return a - b; });
    return out;
}

function normalizeMaintenanceSchedule(schedule) {
    const s = schedule && typeof schedule === 'object' ? schedule : {};
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    return {
        enabled: s.enabled === undefined ? true : !!s.enabled,
        start: timeRe.test(s.start) ? s.start : '09:00',
        end: timeRe.test(s.end) ? s.end : '17:00',
        days: normalizeMaintenanceDays(s.days)
    };
}

function collectMaintenanceDays() {
    const boxes = document.querySelectorAll('#maintenanceDays input[type="checkbox"]');
    const days = [];
    boxes.forEach(function (el) {
        if (el.checked) days.push(parseInt(el.getAttribute('data-day'), 10));
    });
    return normalizeMaintenanceDays(days);
}

function onMaintenanceDayChange() {
    maintenanceSchedule = normalizeMaintenanceSchedule(maintenanceSchedule);
    maintenanceSchedule.days = collectMaintenanceDays();
    renderMaintenanceControls();
    if (maintenanceDaySaveTimer) clearTimeout(maintenanceDaySaveTimer);
    maintenanceDaySaveTimer = setTimeout(function () {
        maintenanceDaySaveTimer = null;
        persistMaintenanceSchedule();
    }, 400);
}

function formatMaintenanceDays(days) {
    const list = normalizeMaintenanceDays(days);
    if (list.length === 0) return 'tidak ada hari';
    if (list.length === 7) return 'setiap hari';
    return MAINT_DAY_ORDER.filter(function (d) { return list.indexOf(d) !== -1; })
        .map(function (d) { return MAINT_DAY_LABELS[d]; })
        .join(', ');
}

// Menit saat ini menurut zona waktu WIB, apa pun zona perangkat.
function wibMinutesNow(now) {
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(now || new Date());
        let hour = 0, minute = 0;
        parts.forEach(function (part) {
            if (part.type === 'hour') hour = parseInt(part.value, 10);
            if (part.type === 'minute') minute = parseInt(part.value, 10);
        });
        return hour * 60 + minute;
    } catch (e) {
        const d = new Date();
        return d.getHours() * 60 + d.getMinutes();
    }
}

function minutesOfHhmm(value) {
    const parts = String(value).split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function wibWeekdayNow(now) {
    try {
        const wd = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Jakarta', weekday: 'short'
        }).format(now || new Date());
        const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        if (Object.prototype.hasOwnProperty.call(map, wd)) return map[wd];
    } catch (e) { /* fallback zona perangkat */ }
    return (now || new Date()).getDay();
}

function isDayInSchedule(schedule, weekday) {
    const days = schedule && Array.isArray(schedule.days) ? schedule.days : MAINT_ALL_DAYS;
    return days.indexOf(weekday) !== -1;
}

function isMaintenanceDaySelected(schedule, now) {
    return isDayInSchedule(schedule, wibWeekdayNow(now));
}

function isWithinMaintenanceSchedule(schedule, now) {
    if (!schedule || !schedule.enabled) return false;
    const current = wibMinutesNow(now);
    const start = minutesOfHhmm(schedule.start);
    const end = minutesOfHhmm(schedule.end);
    if (start === end) return false;
    const weekday = wibWeekdayNow(now);
    if (start < end) {
        return isDayInSchedule(schedule, weekday) && current >= start && current < end;
    }
    if (current >= start) return isDayInSchedule(schedule, weekday);
    if (current < end) return isDayInSchedule(schedule, (weekday + 6) % 7);
    return false;
}

function setMaintenanceOverride(mode) {
    const prevManual = maintenanceManual;
    const prevOn = maintenanceMode;
    if (mode === 'auto') maintenanceManual = null;
    else maintenanceManual = (mode === 'on');
    const nextOn = maintenanceManual === true
        ? true
        : (maintenanceManual === false
            ? false
            : (maintenanceSchedule.enabled && isWithinMaintenanceSchedule(maintenanceSchedule)));
    applyMaintenance(nextOn);
    const reqId = ++maintenanceOverrideReqId;
    maintenanceSyncInFlight = true;
    const value = mode === 'auto' ? 'auto' : (mode === 'on');
    apiPost({ action: 'maintenance', value: value }, { url: maintenanceApiUrl(), retries: 1 })
        .then(res => {
            if (reqId !== maintenanceOverrideReqId) return;
            if (res && res.success) applyMaintenanceResult(res);
            else {
                maintenanceManual = prevManual;
                applyMaintenance(prevOn);
            }
        })
        .catch(() => {
            if (reqId !== maintenanceOverrideReqId) return;
            maintenanceManual = prevManual;
            applyMaintenance(prevOn);
        })
        .finally(() => {
            if (reqId !== maintenanceOverrideReqId) return;
            maintenanceSyncInFlight = false;
            flushMaintenancePersistQueue();
        });
}

function toggleMaintenanceSchedule() {
    maintenanceSchedule = normalizeMaintenanceSchedule(maintenanceSchedule);
    maintenanceSchedule.enabled = !maintenanceSchedule.enabled;
    renderMaintenanceControls();
    persistMaintenanceSchedule();
}

function saveMaintenanceSchedule() {
    const startEl = document.getElementById('maintenanceStart');
    const endEl = document.getElementById('maintenanceEnd');
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!startEl || !endEl) return;
    if (!timeRe.test(startEl.value) || !timeRe.test(endEl.value)) {
        setMaintenanceScheduleStatus('Format jam harus HH:MM.', true);
        return;
    }
    maintenanceSchedule = {
        enabled: normalizeMaintenanceSchedule(maintenanceSchedule).enabled,
        start: startEl.value,
        end: endEl.value,
        days: collectMaintenanceDays()
    };
    persistMaintenanceSchedule();
}

function flushMaintenancePersistQueue() {
    if (!maintenancePersistQueued) return;
    maintenancePersistQueued = false;
    persistMaintenanceSchedule();
}

function persistMaintenanceSchedule() {
    if (maintenanceSyncInFlight) {
        maintenancePersistQueued = true;
        return;
    }
    maintenanceSyncInFlight = true;
    setMaintenanceScheduleStatus('Menyimpan jadwal...', false);
    apiPost({ action: 'maintenance', schedule: maintenanceSchedule }, { url: maintenanceApiUrl() })
        .then(res => {
            if (res && res.success) {
                applyMaintenanceResult(res);
                setMaintenanceScheduleStatus('Jadwal tersimpan.', false);
            } else {
                setMaintenanceScheduleStatus('Gagal menyimpan jadwal.', true);
            }
        })
        .catch(() => setMaintenanceScheduleStatus('Gagal menyimpan jadwal (jaringan).', true))
        .finally(() => {
            maintenanceSyncInFlight = false;
            flushMaintenancePersistQueue();
        });
}

function setMaintenanceScheduleStatus(message, isError) {
    const el = document.getElementById('maintenanceScheduleStatus');
    if (!el) return;
    el.textContent = message;
    el.className = 'mt-2 text-xs ' + (isError ? 'text-red-600' : 'text-gray-500');
}

function applyMaintenanceResult(res) {
    if (!res || !res.success) return;
    maintenanceManual = (res.manual === true || res.manual === false) ? res.manual : null;
    if (res.schedule) maintenanceSchedule = normalizeMaintenanceSchedule(res.schedule);
    applyMaintenance(!!res.maintenance);
}

function renderMaintenanceControls() {
    const active = maintenanceManual === true ? 'on' : (maintenanceManual === false ? 'off' : 'auto');
    const buttons = {
        auto: document.getElementById('btnMaintAuto'),
        on: document.getElementById('btnMaintOn'),
        off: document.getElementById('btnMaintOff')
    };
    Object.keys(buttons).forEach(function (key) {
        const el = buttons[key];
        if (!el) return;
        const isActive = key === active;
        el.classList.toggle('bg-white', isActive);
        el.classList.toggle('text-blue-700', isActive);
        el.classList.toggle('shadow', isActive);
        el.classList.toggle('text-gray-600', !isActive);
    });

    const schedToggle = document.getElementById('maintenanceScheduleToggle');
    if (schedToggle) {
        const on = maintenanceSchedule.enabled;
        schedToggle.classList.toggle('bg-green-500', on);
        schedToggle.classList.toggle('bg-gray-300', !on);
        schedToggle.setAttribute('aria-checked', on ? 'true' : 'false');
        const knob = schedToggle.querySelector('span');
        if (knob) knob.classList.toggle('translate-x-5', on);
    }
    const startEl = document.getElementById('maintenanceStart');
    const endEl = document.getElementById('maintenanceEnd');
    if (startEl && document.activeElement !== startEl) startEl.value = maintenanceSchedule.start;
    if (endEl && document.activeElement !== endEl) endEl.value = maintenanceSchedule.end;

    const dayBoxes = document.querySelectorAll('#maintenanceDays input[type="checkbox"]');
    const selectedDays = normalizeMaintenanceDays(maintenanceSchedule.days);
    dayBoxes.forEach(function (el) {
        el.checked = selectedDays.indexOf(parseInt(el.getAttribute('data-day'), 10)) !== -1;
    });

    const status = document.getElementById('maintenanceStatus');
    if (status) {
        let text;
        const dayText = formatMaintenanceDays(maintenanceSchedule.days);
        if (maintenanceManual === true) {
            text = 'Status: AKTIF (dipaksa manual) — jadwal diabaikan.';
        } else if (maintenanceManual === false) {
            text = 'Status: NONAKTIF (dipaksa manual) — jadwal diabaikan.';
        } else if (!maintenanceSchedule.enabled) {
            text = 'Status: NONAKTIF — jadwal otomatis dimatikan.';
        } else if (selectedDays.length === 0) {
            text = 'Status: NONAKTIF — tidak ada hari yang dipilih.';
        } else if (isWithinMaintenanceSchedule(maintenanceSchedule)) {
            text = 'Status: AKTIF otomatis (dalam jadwal ' + maintenanceSchedule.start + '-' + maintenanceSchedule.end + ' WIB, ' + dayText + ').';
        } else if (!isMaintenanceDaySelected(maintenanceSchedule)) {
            text = 'Status: NONAKTIF — hari ini tidak termasuk jadwal (' + dayText + ').';
        } else {
            text = 'Status: NONAKTIF — di luar jadwal ' + maintenanceSchedule.start + '-' + maintenanceSchedule.end + ' WIB (' + dayText + ').';
        }
        status.textContent = text;
    }
}

function applyMaintenance(on, persist) {
    maintenanceMode = on;
    document.getElementById('maintenanceWindow').classList.toggle('hidden', !on);
    document.getElementById('studentIdentity').disabled = on;
    document.getElementById('studentPin').disabled = on;
    btnVerify.disabled = on;
    btnVerify.classList.toggle('opacity-50', on);
    btnVerify.classList.toggle('cursor-not-allowed', on);
    renderMaintenanceControls();
    if (persist === false) return;
    try {
        localStorage.setItem(MAINTENANCE_CACHE_KEY, JSON.stringify({
            value: on, manual: maintenanceManual, schedule: maintenanceSchedule, ts: Date.now()
        }));
    } catch (e) { /* localStorage tidak tersedia */ }
}

function applyCachedMaintenance() {
    try {
        const raw = localStorage.getItem(MAINTENANCE_CACHE_KEY);
        if (!raw) return false;
        const entry = JSON.parse(raw);
        if (entry && typeof entry.value === 'boolean' && (Date.now() - entry.ts) < MAINTENANCE_CACHE_TTL) {
            if (entry.schedule) {
                const cached = normalizeMaintenanceSchedule(entry.schedule);
                maintenanceSchedule.enabled = cached.enabled;
                maintenanceSchedule.start = cached.start;
                maintenanceSchedule.end = cached.end;
            }
            maintenanceManual = (entry.manual === true || entry.manual === false) ? entry.manual : null;
            applyMaintenance(entry.value, false);
            return true;
        }
    } catch (e) { /* abaikan data rusak */ }
    return false;
}

function fetchMaintenance() {
    return apiPost({ action: 'maintenance' }, { url: maintenanceApiUrl() })
        .then(res => {
            if (res && res.success) {
                applyMaintenanceResult(res);
                return !!res.maintenance;
            }
            return maintenanceMode;
        })
        .catch(() => maintenanceMode);
}

// Ambil ulang status maintenance dari server. `force` menembus throttle;
// pemanggilan dari interaksi pengguna di-throttle agar tidak spam jaringan.
function refreshMaintenance(force) {
    const now = Date.now();
    if (!force && (now - maintenanceLastCheck) < MAINTENANCE_CHECK_MIN_INTERVAL) {
        return Promise.resolve(maintenanceMode);
    }
    if (maintenanceRefreshPromise) return maintenanceRefreshPromise;
    maintenanceLastCheck = now;
    maintenanceRefreshPromise = fetchMaintenance().finally(() => {
        maintenanceRefreshPromise = null;
    });
    return maintenanceRefreshPromise;
}

// Cek mode maintenance saat siswa hendak mengetuk/mengisi identitas.
// Jika server baru saja mengaktifkannya, kunci form dan kembalikan ke tahap 1.
function guardMaintenanceInteraction() {
    refreshMaintenance().then(on => {
        if (on) resetForm();
    });
}

function refreshMaintenanceScheduleView() {
    maintenanceLastCheck = 0;
    maintenanceRefreshPromise = null;
    setMaintenanceScheduleStatus('Memuat jadwal...', false);
    return fetchMaintenance().then(function () {
        renderMaintenanceControls();
        const el = document.getElementById('maintenanceScheduleStatus');
        if (el && el.textContent === 'Memuat jadwal...') setMaintenanceScheduleStatus('', false);
    }).catch(function () {
        setMaintenanceScheduleStatus('Gagal memuat jadwal dari server.', true);
        renderMaintenanceControls();
    });
}

function initMaintenance() {
    applyCachedMaintenance();
    refreshMaintenance(true);
}

// ==========================================
// TAHAP 1: VERIFIKASI SISWA (POST)
// ==========================================
document.getElementById('studentIdentity').addEventListener('focus', guardMaintenanceInteraction);
document.getElementById('studentIdentity').addEventListener('click', guardMaintenanceInteraction);

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
        const result = await apiPost(payload);
        console.log('[Absensi] verify response:', result);

        // Server menolak karena mode maintenance baru diaktifkan.
        if (result.maintenance) {
            applyMaintenance(true);
            resetForm();
            showStatusModal("Maintenance", result.message || "Aplikasi sedang dalam mode maintenance. Silakan coba lagi nanti.", false);
            return;
        }

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
        if (!hasApiUrl()) {
            showStatusModal("Backend Belum Diatur", apiUrlMissingMessage(), false);
        } else {
            showStatusModal("Error", "Server tidak merespons setelah beberapa percobaan. Periksa koneksi Anda lalu coba lagi.", false);
        }
    } finally {
        // Matikan Loader
        document.getElementById('verifyLoader').classList.add('hidden');
        btnVerify.disabled = maintenanceMode;
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
        const result = await apiPost(payload, { retries: 2 });

        // Server menolak karena mode maintenance baru diaktifkan.
        if (result.maintenance) {
            applyMaintenance(true);
            resetForm();
            showStatusModal("Maintenance", result.message || "Aplikasi sedang dalam mode maintenance. Silakan coba lagi nanti.", false);
            return;
        }

        // Bila percobaan pertama berhasil namun responsnya hilang lalu
        // diulang, server membalas "sudah tercatat" - perlakukan sebagai sukses.
        if (result.success || /sudah tercatat/i.test(result.message || '')) {
            showStatusModal("Berhasil!", result.message, true);
            resetForm();
            invalidatePeekCache();
            setTimeout(fetchPeekToday, 1000);
        } else {
            showStatusModal("Gagal", result.message || "Gagal menyimpan absensi.", false);
        }
    } catch (error) {
        console.error(error);
        if (!hasApiUrl()) {
            showStatusModal("Backend Belum Diatur", apiUrlMissingMessage(), false);
        } else {
            showStatusModal("Error", "Server tidak merespons setelah beberapa percobaan. Coba lagi sebentar lagi (absensi aman dari data ganda).", false);
        }
    } finally {
        // Matikan Loader
        document.getElementById('submitLoader').classList.add('hidden');
        btnSubmit.disabled = maintenanceMode;
    }
});

// Jenis "Izin": ubah status keterangan remark + pernyataan disclaimer
function updateJenisMode() {
    const isIzin = document.getElementById('jenisLatihan').value === 'Izin';
    document.getElementById('remarkOptional').classList.toggle('hidden', isIzin);
    document.getElementById('remarkRequiredLabel').classList.toggle('hidden', !isIzin);
    document.getElementById('disclaimerPresent').classList.toggle('hidden', isIzin);
    document.getElementById('disclaimerIzin').classList.toggle('hidden', !isIzin);
    const remark = document.getElementById('remark');
    remark.required = isIzin;
    if (isIzin) {
        remark.placeholder = 'Contoh: izin karena acara keluarga, sakit, dll.';
    } else {
        remark.placeholder = 'Tulis catatan jika ada...';
    }
    document.getElementById('submitText').textContent = isIzin ? 'Submit Izin' : 'Submit Absensi';
}

document.getElementById('jenisLatihan').addEventListener('change', updateJenisMode);

// Tombol Batal / Kembali ke Tahap 1
btnBack.addEventListener('click', resetForm);

function resetForm() {
    currentStudentId = null;
    currentStudentPin = null;
    verifyForm.reset();
    attendanceForm.reset();
    updateJenisMode();
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

let confirmResolver = null;

function closeConfirmModal(result) {
    const modal = document.getElementById('confirmModal');
    const content = document.getElementById('confirmModalContent');
    if (!modal || !content) {
        if (confirmResolver) {
            const resolve = confirmResolver;
            confirmResolver = null;
            resolve(!!result);
        }
        return;
    }
    modal.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
    if (confirmResolver) {
        const resolve = confirmResolver;
        confirmResolver = null;
        resolve(!!result);
    }
}

function showConfirmModal(title, message) {
    const modal = document.getElementById('confirmModal');
    const content = document.getElementById('confirmModalContent');
    if (!modal || !content) return Promise.resolve(false);
    if (confirmResolver) {
        const prev = confirmResolver;
        confirmResolver = null;
        prev(false);
    }
    document.getElementById('confirmTitle').textContent = title || 'Konfirmasi';
    document.getElementById('confirmMessage').textContent = message || '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        content.classList.remove('scale-95');
        const okBtn = document.getElementById('confirmOk');
        if (okBtn) okBtn.focus();
    }, 10);
    return new Promise(function (resolve) {
        confirmResolver = resolve;
    });
}

// ==========================================
// SETTINGS ADMIN (KATA SANDI & KEAMANAN)
// ==========================================
function toggleSettingsSection(bodyId, btn) {
    const body = document.getElementById(bodyId);
    if (!body) return;
    const willOpen = body.classList.contains('hidden');
    body.classList.toggle('hidden', !willOpen);
    if (btn) {
        btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        const icon = btn.querySelector('svg');
        if (icon) {
            icon.style.transition = 'transform 0.2s';
            icon.style.transform = willOpen ? 'rotate(180deg)' : 'rotate(0deg)';
        }
    }
    if (willOpen && bodyId === 'backupBody' && !settingsLocked) loadBackupList();
    if (willOpen && bodyId === 'maintBody' && !settingsLocked) refreshMaintenanceScheduleView();
}

function collapseSettingsSections() {
    ['backupBody', 'pwdBody', 'maintBody'].forEach(function (id) {
        const body = document.getElementById(id);
        if (body) body.classList.add('hidden');
    });
    document.querySelectorAll('#menuAdminModal button[aria-expanded]').forEach(function (btn) {
        btn.setAttribute('aria-expanded', 'false');
        const icon = btn.querySelector('svg');
        if (icon) icon.style.transform = 'rotate(0deg)';
    });
}

function applySecurityState() {
    const secLocked = document.getElementById('secLocked');
    const secUnlocked = document.getElementById('secUnlocked');
    const urlInput = document.getElementById('apiUrlSetting');
    secLocked.classList.toggle('hidden', !settingsLocked);
    secUnlocked.classList.toggle('hidden', settingsLocked);
    // Koneksi Google Sheets TIDAK dikunci: URL backend dapat dilihat, diubah,
    // diuji, dan disimpan tanpa kata sandi admin (berlaku per perangkat ini).
    urlInput.disabled = false;
    document.getElementById('btnTestConn').disabled = false;
    document.getElementById('btnSaveConn').disabled = false;
    urlInput.placeholder = 'https://script.google.com/macros/s/.../exec';
    const savedUrl = (getConfig().apiUrl || '').trim();
    urlInput.value = savedUrl || getDefaultApiUrl();
    updateConnectionWarning();
    updateConnSourceBadge();
    if (!hasApiUrl()) {
        setConnStatus(apiUrlMissingMessage(), 'err');
    } else if (savedUrl && !isValidAppsScriptUrl(savedUrl)) {
        setConnStatus('URL tersimpan tidak valid. Gunakan URL Web App yang berakhiran "/exec", lalu Simpan.', 'err');
    } else if (!savedUrl) {
        setConnStatus('Memakai URL default dari config.js.', 'ok');
    } else {
        setConnStatus('', '');
    }
    document.getElementById('reportDate').disabled = settingsLocked;
    document.getElementById('btnShowReport').disabled = settingsLocked;
    document.getElementById('btnShowStudents').disabled = settingsLocked;
    document.getElementById('reportBlock').classList.toggle('hidden', settingsLocked);
    document.getElementById('studentBlock').classList.toggle('hidden', settingsLocked);
    document.getElementById('btnShowBackup').disabled = settingsLocked;
    document.getElementById('backupBlock').classList.toggle('hidden', settingsLocked);
    document.getElementById('yearBlock').classList.toggle('hidden', settingsLocked);
    document.getElementById('pwdChangeBlock').classList.toggle('hidden', settingsLocked);
    document.getElementById('maintBlock').classList.toggle('hidden', settingsLocked);
    renderMaintenanceControls();
    document.getElementById('startYearSetting').value = settingsLocked ? '' : (getConfig().startYear || '');
    document.getElementById('endYearSetting').value = settingsLocked ? '' : (getConfig().endYear || '');
    renderYearRangeToggle();
    if (settingsLocked) {
        document.getElementById('reportStatus').textContent = '';
        document.getElementById('yearStatus').textContent = '';
        document.getElementById('backupStatus').textContent = '';
        collapseSettingsSections();
    }
    refreshAdminLockUI();
}

// Sesi pengaturan berbatas waktu idle: terkunci otomatis setelah
// SETTINGS_LOCK_TIMEOUT tanpa aktivitas pengguna. Aktivitas di menu
// pengaturan/riwayat akan menyegarkan timer (lihat bindIdleActivityReset).
function startSettingsLockTimer() {
    resetSettingsLockTimer();
}

function resetSettingsLockTimer() {
    if (settingsLocked) return;
    stopSettingsLockTimer();
    settingsLockTimer = setTimeout(function () {
        settingsLockTimer = null;
        lockSettings(true);
    }, SETTINGS_LOCK_TIMEOUT);
}

function stopSettingsLockTimer() {
    if (settingsLockTimer) {
        clearTimeout(settingsLockTimer);
        settingsLockTimer = null;
    }
}

// Aktivitas pengguna memperpanjang sesi Menu Admin yang sedang terbuka
// (kunci otomatis setelah 5 menit tanpa aktivitas).
function resetIdleTimers() {
    if (!settingsLocked) resetSettingsLockTimer();
}

// Aktivitas pengguna (klik, ketik, gulir, sentuh, gerak) menyegarkan timer idle.
function bindIdleActivityReset(target) {
    if (!target) return;
    ['click', 'input', 'change', 'keydown', 'scroll', 'mousemove', 'touchstart', 'touchmove'].forEach(function (evt) {
        target.addEventListener(evt, resetIdleTimers, true);
    });
}

function unlockSettings() {
    const remain = adminLockRemaining();
    if (remain > 0) {
        refreshAdminLockUI();
        showStatusModal("Terkunci Sementara", "Terlalu banyak percobaan salah. Coba lagi dalam " + formatLockRemaining(remain) + ".", false);
        return;
    }
    const p = document.getElementById('unlockPwd').value;
    if (!p) {
        showStatusModal("Gagal", "Masukkan kata sandi admin terlebih dahulu.", false);
        return;
    }
    checkPassword(p).then(ok => {
        if (!ok) {
            const res = registerAdminFail();
            refreshAdminLockUI();
            if (res.locked) {
                showStatusModal("Terkunci Sementara", "Kata sandi salah " + ADMIN_MAX_ATTEMPTS + " kali. Pengaturan terkunci sementara selama 5 menit. Coba lagi dalam " + formatLockRemaining(res.remaining) + ".", false);
            } else {
                setUnlockStatus("Kata sandi salah. Percobaan " + res.fails + " dari " + ADMIN_MAX_ATTEMPTS + ".", 'err');
                showStatusModal("Gagal", "Kata sandi yang dimasukkan salah. Percobaan " + res.fails + " dari " + ADMIN_MAX_ATTEMPTS + ".", false);
            }
            return;
        }
        clearAdminLock();
        refreshAdminLockUI();
        setUnlockStatus('', '');
        document.getElementById('unlockPwd').value = '';
        settingsLocked = false;
        applySecurityState();
        startSettingsLockTimer();
        refreshMaintenanceScheduleView();
        showStatusModal("Berhasil", "Pengaturan Admin berhasil dibuka.", true);
    });
}

// `auto` true = dipanggil oleh timer idle 5 menit; modal Menu Admin ikut ditutup.
function lockSettings(auto) {
    settingsLocked = true;
    stopSettingsLockTimer();
    applySecurityState();
    if (auto === true) {
        hideMenuAdminModal();
        showStatusModal("Sesi Berakhir", "Pengaturan Admin terkunci otomatis karena tidak ada aktivitas selama 5 menit.", true);
        return;
    }
    showStatusModal("Pemberitahuan", "Pengaturan Admin berhasil dikunci.", true);
}

function setBackupStatus(msg, type) {
    const el = document.getElementById('backupStatus');
    el.textContent = msg || '';
    el.className = 'text-sm mt-2 ' + (type === 'ok' ? 'text-green-600' : type === 'err' ? 'text-red-500' : 'text-gray-500');
}

function formatBackupStamp(stamp) {
    const s = String(stamp || '');
    if (!/^\d{6}$/.test(s)) return s;
    const day = s.substring(0, 2);
    const month = MONTHS[parseInt(s.substring(2, 4), 10) - 1] || '?';
    const yy = s.substring(4, 6);
    return day + '-' + month + '-20' + yy;
}

// Stempel DDMMYY -> kunci urut YYMMDD agar pengurutan kronologis.
function backupStampKey(stamp) {
    const s = String(stamp || '');
    if (!/^\d{6}$/.test(s)) return s;
    return s.substring(4, 6) + s.substring(2, 4) + s.substring(0, 2);
}

// Dua warna latar lembut yang bergilir untuk tiap pasangan backup.
const BACKUP_PAIR_COLORS = [
    { bg: '#eff6ff', border: '#bfdbfe', num: '#1d4ed8' },
    { bg: '#f0fdf4', border: '#bbf7d0', num: '#15803d' }
];

let lastBackupList = [];
let lastBackupKeep = 6;
let backupListInFlight = null;

function todayBackupStamp() {
    const iso = todayISO();
    return iso.substring(8, 10) + iso.substring(5, 7) + iso.substring(2, 4);
}

function uniqueBackupStamps(backups) {
    const seen = {};
    const stamps = [];
    (backups || []).forEach(function (b) {
        const stamp = String(b.stamp || '');
        if (!stamp || seen[stamp]) return;
        seen[stamp] = true;
        stamps.push(stamp);
    });
    stamps.sort(function (a, b) {
        return backupStampKey(b).localeCompare(backupStampKey(a));
    });
    return stamps;
}

function getBackupWarning() {
    const backups = lastBackupList || [];
    const keep = Number(lastBackupKeep) || 6;
    const todayStamp = todayBackupStamp();
    const stamps = uniqueBackupStamps(backups);
    const warnings = [];
    const willReplace = stamps.indexOf(todayStamp) !== -1;
    if (willReplace) {
        warnings.push('Backup tanggal ' + formatBackupStamp(todayStamp) + ' sudah ada dan akan diganti.');
    }
    if (!willReplace && stamps.length >= keep) {
        const oldest = stamps[stamps.length - 1];
        warnings.push('Kuota ' + keep + ' backup terpenuhi. Backup terlama (' + formatBackupStamp(oldest) + ') akan dihapus otomatis.');
    }
    return warnings;
}

function renderBackupList(backups, keep) {
    lastBackupList = backups || [];
    if (keep) lastBackupKeep = keep;
    const listEl = document.getElementById('backupList');
    if (keep) document.getElementById('backupKeepLabel').textContent = keep;
    const items = backups || [];
    if (items.length === 0) {
        listEl.innerHTML = '<span class="text-gray-400">Belum ada backup.</span>';
        return;
    }

    // Kelompokkan backup menjadi pasangan per tanggal (STUDENTS + ATTENDANCE).
    const groups = [];
    const byStamp = {};
    items.forEach(function (b) {
        const stamp = String(b.stamp || '');
        if (!byStamp[stamp]) {
            byStamp[stamp] = { stamp: stamp, items: [] };
            groups.push(byStamp[stamp]);
        }
        byStamp[stamp].items.push(b);
    });
    groups.sort(function (a, b) {
        return backupStampKey(b.stamp).localeCompare(backupStampKey(a.stamp));
    });
    groups.forEach(function (g) {
        g.items.sort(function (a, b) {
            return String(a.name).localeCompare(String(b.name));
        });
    });

    listEl.innerHTML = groups.map(function (g, i) {
        const color = BACKUP_PAIR_COLORS[i % BACKUP_PAIR_COLORS.length];
        const rows = g.items.map(function (b) {
            return `<div class="flex items-center justify-between gap-2 rounded" style="background-color:rgba(255,255,255,0.72);padding:3px 6px;">
                <code class="text-gray-800 rounded" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background-color:rgba(255,255,255,0.8);padding:1px 5px;">${escapeHtml(b.name)}</code>
                <span class="text-gray-500">${Number(b.rows) || 0} records</span>
            </div>`;
        }).join('');
        return `<div class="rounded-lg flex items-center gap-2" style="background-color:${color.bg};border:1px solid ${color.border};padding:6px 8px;">
            <span class="font-bold shrink-0" style="font-size:20px;line-height:1;min-width:24px;text-align:center;color:${color.num};">${i + 1}</span>
            <div class="flex-1 min-w-0">
                <div class="mb-1">
                    <span class="font-semibold text-gray-700">${escapeHtml(formatBackupStamp(g.stamp))}</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:3px;">${rows}</div>
            </div>
        </div>`;
    }).join('');
}

function loadBackupList() {
    const listEl = document.getElementById('backupList');
    if (lastBackupList && lastBackupList.length) {
        renderBackupList(lastBackupList, lastBackupKeep);
    } else {
        listEl.innerHTML = '<span class="text-gray-400">Memuat...</span>';
    }
    if (backupListInFlight) return backupListInFlight;
    backupListInFlight = apiPost({ action: 'backuplist' }, { retries: 1 })
        .then(res => {
            if (!res.success) {
                if (!(lastBackupList && lastBackupList.length)) {
                    listEl.innerHTML = '<span class="text-red-500">' + escapeHtml(res.message || 'Gagal memuat daftar backup.') + '</span>';
                }
                return;
            }
            renderBackupList(res.backups, res.keep);
        })
        .catch(() => {
            if (!(lastBackupList && lastBackupList.length)) {
                listEl.innerHTML = '<span class="text-red-500">Koneksi gagal. Periksa backend.</span>';
            }
        })
        .finally(function () { backupListInFlight = null; });
    return backupListInFlight;
}

function runBackupSheets() {
    const btn = document.getElementById('btnShowBackup');
    btn.disabled = true;
    setBackupStatus('Membuat backup...', '');
    apiPost({ action: 'backup' }, { retries: 2 })
        .then(res => {
            if (!res.success) {
                setBackupStatus(res.message || 'Gagal membuat backup.', 'err');
                loadBackupList();
                return;
            }
            setBackupStatus(res.message || 'Backup berhasil dibuat.', 'ok');
            renderBackupList(res.backups, res.keep);
        })
        .catch(() => setBackupStatus('Koneksi gagal. Periksa backend.', 'err'))
        .finally(() => { btn.disabled = settingsLocked; });
}

function backupSheets() {
    const warnings = getBackupWarning();
    if (!warnings.length) {
        runBackupSheets();
        return;
    }
    showConfirmModal('Peringatan Backup', warnings.join(' ') + ' Lanjutkan?').then(function (ok) {
        if (ok) runBackupSheets();
    });
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
    if (!url) {
        cfg.apiUrl = '';
        setConfig(cfg);
        updateConnectionWarning();
        updateConnSourceBadge();
        if (!hasApiUrl()) {
            setConnStatus(apiUrlMissingMessage(), 'err');
            return;
        }
        setConnStatus('Kolom URL dikosongkan: memakai URL default dari config.js.', 'ok');
        testConnection();
        return;
    }
    if (!isValidAppsScriptUrl(url)) {
        setConnStatus('URL tidak valid. Gunakan URL Apps Script Web App yang berakhiran "/exec" (contoh: https://script.google.com/macros/s/.../exec).', 'err');
        return;
    }
    cfg.apiUrl = url;
    setConfig(cfg);
    updateConnectionWarning();
    testConnection();
}

function setYearStatus(msg, type) {
    const el = document.getElementById('yearStatus');
    el.textContent = msg || '';
    el.className = 'text-sm mt-2 ' + (type === 'ok' ? 'text-green-600' : type === 'err' ? 'text-red-500' : 'text-gray-500');
}

// Perbarui tampilan tombol ON/OFF dan aktif/nonaktifkan input rentang tahun.
function renderYearRangeToggle() {
    const toggle = document.getElementById('yearEnabledToggle');
    const knob = document.getElementById('yearEnabledKnob');
    const fields = document.getElementById('yearRangeFields');
    const toggleStatus = document.getElementById('yearToggleStatus');
    if (!toggle) return;
    const enabled = isYearRangeEnabled();
    const active = enabled && !settingsLocked;
    toggle.setAttribute('aria-checked', active ? 'true' : 'false');
    toggle.disabled = settingsLocked;
    toggle.classList.toggle('bg-blue-600', active);
    toggle.classList.toggle('bg-gray-300', !active);
    if (knob) {
        knob.classList.toggle('translate-x-6', active);
        knob.classList.toggle('translate-x-1', !active);
    }
    if (fields) {
        fields.classList.toggle('opacity-60', !active);
        document.getElementById('startYearSetting').disabled = !active;
        document.getElementById('endYearSetting').disabled = !active;
        document.getElementById('btnSaveYear').disabled = !active;
    }
    if (toggleStatus) {
        toggleStatus.textContent = enabled
            ? (settingsLocked ? 'Batasan tahun ekskul aktif (terkunci).' : 'Batasan tahun ekskul aktif.')
            : 'Batasan tahun ekskul nonaktif.';
        toggleStatus.className = 'text-xs mt-2 font-medium ' + (enabled ? 'text-green-600' : 'text-gray-500');
    }
}

function toggleYearRange() {
    if (settingsLocked) return;
    const cfg = getConfig();
    cfg.yearEnabled = !isYearRangeEnabled();
    setConfig(cfg);
    renderYearRangeToggle();
    setYearStatus('', '');
}

function saveYearRange() {
    if (!isYearRangeEnabled()) {
        setYearStatus('Aktifkan batas tahun ekskul untuk menyimpan rentang.', 'err');
        return;
    }
    const start = document.getElementById('startYearSetting').value.trim();
    const end = document.getElementById('endYearSetting').value.trim();
    if (start && !isValidMonthYear(start)) {
        setYearStatus('Format awal ekskul harus MM-YYYY.', 'err');
        return;
    }
    if (end && !isValidMonthYear(end)) {
        setYearStatus('Format akhir ekskul harus MM-YYYY.', 'err');
        return;
    }
    if (start && end && monthYearToYM(start) > monthYearToYM(end)) {
        setYearStatus('Awal ekskul tidak boleh lebih besar dari akhir ekskul.', 'err');
        return;
    }
    const cfg = getConfig();
    cfg.startYear = start;
    cfg.endYear = end;
    setConfig(cfg);
    setYearStatus('Rentang tahun ekskul berhasil disimpan.', 'ok');
}

function testConnection() {
    const typed = document.getElementById('apiUrlSetting').value.trim();
    const url = typed || getDefaultApiUrl();
    if (!url) {
        setConnStatus(apiUrlMissingMessage(), 'err');
        updateConnectionWarning();
        updateConnSourceBadge();
        return;
    }
    if (!isValidAppsScriptUrl(url)) {
        setConnStatus('URL tidak valid. Gunakan URL Apps Script Web App yang berakhiran "/exec" (contoh: https://script.google.com/macros/s/.../exec).', 'err');
        return;
    }
    if (typed) {
        const cfg = getConfig();
        cfg.apiUrl = typed;
        setConfig(cfg);
    }
    updateConnectionWarning();
    updateConnSourceBadge();

    setConnStatus('Menguji koneksi...', '');
    apiPost({ action: 'ping' }, { url: url, retries: 1 })
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
    const range = getYearRange();
    if (!dateInRange(date, range)) {
        setReportStatus('Tanggal di luar rentang tahun ekskul (' + (range.start || '??-????') + ' s.d. ' + (range.end || '??-????') + ').', 'err');
        return;
    }
    setReportStatus('Memuat data...', '');
    const btn = document.getElementById('btnShowReport');
    btn.disabled = true;
    apiPost({ action: 'report', date: date }, { retries: 1 })
        .then(res => {
            if (!res.success) {
                setReportStatus(res.message || 'Gagal memuat laporan.', 'err');
                return;
            }
            setReportStatus('', '');
            renderReport(res);
        })
        .catch(() => setReportStatus('Koneksi gagal. Periksa backend.', 'err'))
        .finally(() => { btn.disabled = settingsLocked; });
}

function statusClass(status) {
    return String(status || '').toUpperCase() === 'IZIN' ? 'text-yellow-600' : 'text-green-600';
}

// Hitung rincian Hadir vs Izin dari sekumpulan catatan absensi.
function countAttendanceStatus(records) {
    const list = records || [];
    let izin = 0;
    list.forEach(function (r) {
        if (r && String(r.status || '').toUpperCase() === 'IZIN') izin++;
    });
    return { total: list.length, hadir: list.length - izin, izin: izin };
}

// Label ringkas rincian, mis. "8 hadir . 2 izin"
function formatAttendanceCount(counts) {
    return counts.hadir + ' hadir \u00b7 ' + counts.izin + ' izin';
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
                    <span class="text-xs font-semibold ${statusClass(r.status)} shrink-0">${escapeHtml(r.status)}</span>
                </div>
                <div class="text-xs text-gray-500">${escapeHtml(r.id)} | ${escapeHtml(r.className)}</div>
                <div class="text-xs text-gray-500">${escapeHtml(r.type)}</div>
                ${remark}
                <div class="flex items-center justify-between gap-2">
                    <div class="text-xs text-gray-400 mt-1">${escapeHtml(r.timestamp)}</div>
                    <button onclick="showReportStudentHistory(${i})" class="shrink-0 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded-lg transition flex items-center gap-1">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        Riwayat
                    </button>
                </div>
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
    document.getElementById('reportAbsentCount').textContent = absent.length;
    document.getElementById('reportAbsentList').innerHTML = absent.map((s, i) => {
        let lastHtml = '';
        if (s.lastDate) {
            let line = '📅->';
            line += ' ' + escapeHtml(ddMonFromIso(s.lastDate));
            if (s.lastTime) line += ' <span class="font-semibold">(' + escapeHtml(s.lastTime) + ')</span>';
            if (s.lastType) line += ' &middot; ' + escapeHtml(s.lastType);
            if (s.lastRemark) line += ' (' + escapeHtml(s.lastRemark) + ')';
            lastHtml = '<div class="flex items-center gap-1.5 text-xs text-yellow-800 mt-1">' +
                '<span>' + line + '</span>' +
                '</div>';
        } else {
            lastHtml = '<div class="flex items-center gap-1.5 text-xs text-yellow-800 mt-1">' +
                '<span>📅-> -</span>' +
                '</div>';
        }
        return `<div class="flex items-start gap-3 bg-yellow-500 p-3 rounded-xl border border-yellow-600">
            <div class="w-10 h-10 rounded-full bg-white text-yellow-600 flex items-center justify-center font-bold shrink-0">${(i + 1)}</div>
            <div class="flex-1 min-w-0">
                <div class="font-semibold text-yellow-900 text-sm truncate">${escapeHtml(s.name)}</div>
                <div class="text-xs text-yellow-800">${escapeHtml(s.id)} | ${escapeHtml(s.className)}</div>
                ${lastHtml}
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
            '<td style="border:1px solid #999;padding:6px;text-align:left;">' + escapeHtml(r.name) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.id) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.className) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.type) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.remark) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(formatTimeAmPm(r.timestamp)) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.status) + '</td>' +
            '</tr>';
    }).join('') : '<tr><td style="border:1px solid #999;padding:6px;text-align:center;" colspan="8">Tidak ada data</td></tr>';
    const absent = res.absent || [];
    document.getElementById('printReportAbsentBlock').style.display = absent.length ? 'block' : 'none';
    document.getElementById('printReportAbsentRows').innerHTML = absent.length ? absent.map((s, i) => {
        let lastTxt = s.lastDate ? ddMonFromIso(s.lastDate) : '';
        if (s.lastTime) lastTxt += (lastTxt ? ' ' : '') + s.lastTime;
        if (s.lastType) lastTxt += ' - ' + s.lastType;
        if (s.lastRemark) lastTxt += ' (' + s.lastRemark + ')';
        return '<tr>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + (i + 1) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(s.name) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(s.id) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(s.className) + '</td>' +
            '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(lastTxt) + '</td>' +
            '</tr>';
    }).join('') : '<tr><td style="border:1px solid #999;padding:6px;text-align:center;" colspan="5">Tidak ada data</td></tr>';
}

function openReportModal() {
    const modal = document.getElementById('reportModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('reportScroll').scrollTop = 0;
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

// Format "MM-YYYY" menjadi "Mmm-YYYY" (mis. "08-2026" -> "Aug-2026")
function monthYearToMmmYYYY(val) {
    const parts = String(val || '').trim().split('-');
    if (parts.length !== 2) return String(val || '').trim();
    const mIdx = Number(parts[0]) - 1;
    const month = MONTHS[mIdx] || parts[0];
    const year = parts[1] || '';
    return month + '-' + year;
}

function setPrintFootnotes() {
    const range = getYearRange();
    const start = range.start ? monthYearToMmmYYYY(range.start) : '';
    const end = range.end ? monthYearToMmmYYYY(range.end) : '';
    const text = (start && end) ? 'Tahun ekskul: ' + start + ' s/d ' + end : '';
    ['printFootnoteReport', 'printFootnoteStudent', 'printFootnoteHistory'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    });
}

function printReport() {
    if (!currentReportData) return;
    populateReportPrint(currentReportData);
    setPrintFootnotes();
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
// PEEK LAPORAN ABSENSI HARI INI (klik tanggal di header)
// ==========================================
function renderPeekRecords(records) {
    const list = records || [];
    document.getElementById('peekCountDisplay').textContent = list.length + ' siswa tercatat';
    document.getElementById('peekEmpty').classList.toggle('hidden', list.length > 0);
    document.getElementById('peekList').innerHTML = list.map((r, i) => {
        const ts = String(r.timestamp || '');
        const time = ts.length >= 16 ? ts.substring(11, 16) : ts;
        const izinTag = String(r.status || '').toUpperCase() === 'IZIN'
            ? '<span class="text-xs font-semibold" style="color:#f97316;">(Izin)</span>'
            : '';
        return `<div class="flex items-center gap-3 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
            <div class="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold shrink-0 text-sm">${(i + 1)}</div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2 min-w-0">
                    <span class="font-semibold text-gray-800 text-sm truncate">${escapeHtml(r.name)} ${izinTag}</span>
                    <span class="text-xs text-gray-500 shrink-0">${escapeHtml(r.id)}${r.className ? ' | ' + escapeHtml(r.className) : ''}</span>
                </div>
                <div class="flex items-center justify-between gap-2 mt-0.5">
                    <div class="text-xs text-gray-600">Login ${escapeHtml(time)}</div>
                    <button type="button" onclick="showPeekStudentHistory(${i})" class="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white p-1.5 rounded-lg transition flex items-center justify-center" title="Riwayat" aria-label="Riwayat">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderPeekMessage(msg, isError) {
    const statusEl = document.getElementById('peekStatus');
    statusEl.textContent = msg || '';
    statusEl.className = 'text-sm mt-1 ' + (isError ? 'text-red-500' : 'text-gray-500');
}

// Banner callout di menu utama: jumlah siswa yang sudah absensi hari ini.
// Teks diset ke semua salinan marquee agar animasi kiri->kanan mulus.
function setMainCallout(count) {
    const el = document.getElementById('mainCallout');
    if (!el) return;
    const n = Number(count) || 0;
    if (n > 0) {
        const text = n + ' siswa sudah absensi';
        el.querySelectorAll('.callout-marquee-text').forEach(function (span) {
            span.textContent = text;
        });
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

// Marquee banner: berhenti saat disentuh/ditahan, lanjut saat jari dilepas.
function initCalloutMarquee() {
    const el = document.getElementById('mainCallout');
    if (!el) return;
    const pause = function () { el.classList.add('marquee-paused'); };
    const resume = function () { el.classList.remove('marquee-paused'); };
    el.addEventListener('touchstart', pause, { passive: true });
    el.addEventListener('touchend', resume, { passive: true });
    el.addEventListener('touchcancel', resume, { passive: true });
}

function fetchPeekToday() {
    const date = todayISO();
    return apiPost({ action: 'report', date: date, lean: true })
        .then(res => {
            peekCache = { date: date, ts: Date.now(), res: res };
            savePersistedPeekCache(peekCache);
            if (res && res.success) setMainCallout((res.records || []).length);
            return res;
        })
        .catch(err => {
            peekCache = { date: date, ts: Date.now(), res: { success: false, message: 'Koneksi gagal. Periksa backend.' } };
            return peekCache.res;
        });
}

function savePersistedPeekCache(entry) {
    try {
        if (entry && entry.res && entry.res.success) {
            localStorage.setItem(PEEK_CACHE_KEY, JSON.stringify(entry));
        }
    } catch (e) { /* localStorage tidak tersedia */ }
}

function loadPersistedPeekCache() {
    try {
        const raw = localStorage.getItem(PEEK_CACHE_KEY);
        if (!raw) return;
        const entry = JSON.parse(raw);
        if (entry && entry.date === todayISO() && entry.res && entry.res.success) {
            peekCache = entry;
            setMainCallout((entry.res.records || []).length);
        }
    } catch (e) { /* abaikan data rusak */ }
}

function schedulePeekPrefetch() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && conn.saveData) return;
    const date = todayISO();
    if (peekCache && peekCache.date === date && (Date.now() - peekCache.ts) < PEEK_CACHE_TTL) return;
    setTimeout(function () { fetchPeekToday(); }, 2000);
}

function peekLaporanToday() {
    const modal = document.getElementById('peekModal');
    const date = todayISO();
    const dateText = new Date().toLocaleDateString('id-ID', dateOptions);

    document.getElementById('peekDateDisplay').textContent = dateText;
    document.getElementById('peekCountDisplay').textContent = '';
    document.getElementById('peekList').innerHTML = '';
    document.getElementById('peekEmpty').classList.add('hidden');
    renderPeekMessage('Memuat data...', false);

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('peekScroll').scrollTop = 0;
    setTimeout(() => modal.classList.remove('opacity-0'), 10);

    const range = getYearRange();
    if (!dateInRange(date, range)) {
        renderPeekMessage('Hari ini di luar rentang tahun ekskul (' + (range.start || '??-????') + ' s.d. ' + (range.end || '??-????') + ').', true);
        return;
    }

    const cached = peekCache && peekCache.date === date ? peekCache.res : null;
    const isFresh = cached && (Date.now() - peekCache.ts) < PEEK_CACHE_TTL;

    if (cached) {
        if (cached.success) {
            renderPeekRecords(cached.records || []);
            renderPeekMessage('', false);
        } else {
            renderPeekMessage(cached.message || 'Gagal memuat laporan.', true);
        }
    }

    // Muat ulang di latar belakang bila cache tidak ada atau sudah basi
    if (!isFresh) {
        fetchPeekToday().then(res => {
            if (peekCache.date !== date) return;
            const modalHidden = document.getElementById('peekModal').classList.contains('hidden');
            if (modalHidden) return;
            applyPeekResult(res);
        });
    }
}

function invalidatePeekCache() {
    peekCache = null;
    try { localStorage.removeItem(PEEK_CACHE_KEY); } catch (e) { /* abaikan */ }
}

function applyPeekResult(res) {
    if (!res.success) {
        renderPeekMessage(res.message || 'Gagal memuat laporan.', true);
        return;
    }
    renderPeekRecords(res.records || []);
    setMainCallout((res.records || []).length);
    renderPeekMessage('', false);
}

function refreshPeek() {
    const date = todayISO();
    const range = getYearRange();
    if (!dateInRange(date, range)) {
        renderPeekMessage('Hari ini di luar rentang tahun ekskul (' + (range.start || '??-????') + ' s.d. ' + (range.end || '??-????') + ').', true);
        return;
    }
    document.getElementById('peekCountDisplay').textContent = '';
    document.getElementById('peekList').innerHTML = '';
    document.getElementById('peekEmpty').classList.add('hidden');
    renderPeekMessage('Memuat ulang data...', false);
    invalidatePeekCache();
    fetchPeekToday().then(res => {
        if (peekCache.date !== date) return;
        if (document.getElementById('peekModal').classList.contains('hidden')) return;
        applyPeekResult(res);
    });
}

function closePeekModal() {
    const modal = document.getElementById('peekModal');
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
    apiPost({ action: 'students' })
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
    currentStudentList = res.students || [];
    renderStudentList();
    openStudentModal();
}

function renderStudentList() {
    const filter = document.getElementById('studentStatusFilter').value;
    const allStudents = currentStudentList.filter(s => {
        const active = String(s.status).toUpperCase() === 'ACTIVE';
        if (filter === 'all') return true;
        return filter === 'active' ? active : !active;
    });

    const sortByName = function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''));
    };
    const isActive = function (s) {
        return String(s.status).toUpperCase() === 'ACTIVE';
    };

    let groups = [];
    if (filter === 'all') {
        const active = allStudents.filter(isActive).sort(sortByName);
        const inactive = allStudents.filter(function (s) { return !isActive(s); }).sort(sortByName);
        if (active.length) groups.push({ label: 'Aktif', students: active });
        if (inactive.length) groups.push({ label: 'Nonaktif', students: inactive });
    } else {
        const single = allStudents.slice().sort(sortByName);
        if (single.length) groups.push({ label: filter === 'active' ? 'Aktif' : 'Nonaktif', students: single });
    }

    const countText = allStudents.length + ' siswa terdaftar';
    document.getElementById('studentCountDisplay').textContent = countText;
    document.getElementById('studentEmpty').classList.toggle('hidden', allStudents.length > 0);

    const groupHeaderHtml = function (label, count) {
        const accent = label === 'Aktif' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700';
        return `<div class="flex items-center justify-between ${accent} rounded-lg px-3 py-2 mb-2">
            <span class="font-bold text-sm">${escapeHtml(label)}</span>
            <span class="text-xs font-semibold">${count} siswa</span>
        </div>`;
    };
    const rowHtml = function (s, i) {
        const fullIndex = currentStudentList.indexOf(s);
        const statusBadge = isActive(s)
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
            <button onclick="showStudentHistory(${fullIndex})" class="shrink-0 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1.5 rounded-lg transition flex items-center gap-1">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                Riwayat
            </button>
        </div>`;
    };

    let listHtml = '';
    groups.forEach(function (g) {
        if (filter === 'all') listHtml += groupHeaderHtml(g.label, g.students.length);
        listHtml += g.students.map(rowHtml).join('');
    });
    document.getElementById('studentList').innerHTML = listHtml;

    document.getElementById('printStudentCount').textContent = countText;
    document.getElementById('printStudentDate').textContent = 'Dicetak: ' + new Date().toLocaleDateString('id-ID', dateOptions);

    let printHtml = '';
    groups.forEach(function (g) {
        if (filter === 'all') {
            printHtml += '<tr><td colspan="5" style="border:1px solid #999;padding:6px;background:#e5e7eb;font-weight:bold;text-align:left;">' +
                escapeHtml(g.label) + ' (' + g.students.length + ' siswa)</td></tr>';
        }
        printHtml += g.students.map(function (s, i) {
            return '<tr>' +
                '<td style="border:1px solid #999;padding:6px;text-align:center;">' + (i + 1) + '</td>' +
                '<td style="border:1px solid #999;padding:6px;text-align:left;">' + escapeHtml(s.name) + '</td>' +
                '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(s.id) + '</td>' +
                '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(s.className) + '</td>' +
                '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(isActive(s) ? 'Aktif' : 'Nonaktif') + '</td>' +
                '</tr>';
        }).join('');
    });
    if (!printHtml) {
        printHtml = '<tr><td style="border:1px solid #999;padding:6px;text-align:center;" colspan="5">Tidak ada data</td></tr>';
    }
    document.getElementById('printStudentRows').innerHTML = printHtml;
}

function openStudentModal() {
    const modal = document.getElementById('studentModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('studentScroll').scrollTop = 0;
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

function printStudents() {
    setPrintFootnotes();
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
function toggleHistoryMonth(btn) {
    if (!btn) return;
    const body = btn.nextElementSibling;
    if (!body) return;
    const willOpen = body.classList.contains('hidden');
    body.classList.toggle('hidden', !willOpen);
    btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    const icon = btn.querySelector('svg');
    if (icon) icon.style.transform = willOpen ? 'rotate(180deg)' : 'rotate(0deg)';
}

function setHistoryPrintVisible(visible) {
    const btn = document.getElementById('btnPrintHistory');
    const closeBtn = document.getElementById('btnCloseHistory');
    if (btn) btn.classList.toggle('hidden', !visible);
    if (closeBtn) {
        closeBtn.classList.toggle('w-1/2', visible);
        closeBtn.classList.toggle('w-full', !visible);
    }
}

function showStudentHistory(index, options) {
    let student = null;
    if (typeof index === 'object' && index !== null) {
        student = index;
    } else if (currentStudentList[index]) {
        student = currentStudentList[index];
    }
    if (!student) return;
    setHistoryPrintVisible(!(options && options.hidePrint));
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

    apiPost({ action: 'history', id: student.id })
        .then(res => {
            if (!res.success) {
                document.getElementById('historyStatus').textContent = res.message || 'Gagal memuat riwayat.';
                return;
            }
            const records = (res.records || []).filter(r => dateInRange(r.date, getYearRange()));
            document.getElementById('historyStatus').textContent = 'Total: ' + formatAttendanceCount(countAttendanceStatus(records));
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
                            <span class="text-xs font-semibold ${statusClass(r.status)} shrink-0">${escapeHtml(r.status)}</span>
                        </div>
                        <div class="text-xs text-gray-500">${escapeHtml(r.type)}</div>
                        ${remark}
                        <div class="text-xs text-gray-400 mt-1">${escapeHtml(r.timestamp)}</div>
                    </div>
                </div>`;
                }).join('');
                const counts = countAttendanceStatus(group.records);
                return `<div class="mb-3">
                    <button type="button" onclick="toggleHistoryMonth(this)" aria-expanded="true" class="w-full flex items-center justify-between gap-2 px-1 mb-1.5 text-left">
                        <span class="flex items-center gap-1.5 text-sm font-bold text-indigo-700 min-w-0">
                            <svg class="w-4 h-4 text-indigo-500 shrink-0" style="transition:transform 0.2s;transform:rotate(180deg);" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            <span class="truncate">${escapeHtml(label)}</span>
                        </span>
                        <span class="flex items-center gap-1 shrink-0">
                            <span class="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full whitespace-nowrap">${counts.hadir} hadir</span>
                            <span class="text-xs font-semibold text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full whitespace-nowrap">${counts.izin} izin</span>
                        </span>
                    </button>
                    <div class="history-month-body space-y-2">${items}</div>
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
                const counts = countAttendanceStatus(group.records);
                let html = '<tr><td style="border:1px solid #999;padding:6px;text-align:left;font-weight:bold;background:#f1f5f9;" colspan="6">' + escapeHtml(label) + ' &mdash; [ ' + formatAttendanceCount(counts) + ' ]</td></tr>';
                const sorted = group.records.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
                sorted.forEach((r, i) => {
                    const seq = i + 1;
                    const ts = String(r.timestamp || '');
                    const time = ts.length >= 19 ? ts.substring(11, 16) : '';
                    html += '<tr>' +
                        '<td style="border:1px solid #999;padding:6px;text-align:center;">' + seq + '</td>' +
                        '<td style="border:1px solid #999;padding:6px;text-align:left;">' + escapeHtml(formatDateDisplay(r.date) || r.date) + '</td>' +
                        '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(time) + '</td>' +
                        '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.type) + '</td>' +
                        '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.remark) + '</td>' +
                        '<td style="border:1px solid #999;padding:6px;text-align:center;">' + escapeHtml(r.status) + '</td>' +
                        '</tr>';
                });
                return html;
            }).join('') : '<tr><td style="border:1px solid #999;padding:6px;text-align:center;" colspan="6">Tidak ada data</td></tr>';

            const summaryGroups = monthGroups.slice().sort((a, b) => String(b.key).localeCompare(String(a.key)));
            document.getElementById('printHistorySummary').innerHTML = records.length ? '<div style="font-weight:bold; margin-bottom:2px;">- Summary Absensi Siswa -</div>' + summaryGroups.map(g => {
                const parts = g.key.split('-');
                let label = g.key;
                if (parts.length === 2) {
                    label = new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
                }
                return '<div>' + escapeHtml(label) + ' : [ ' + formatAttendanceCount(countAttendanceStatus(g.records)) + ' ]</div>';
            }).join('') + '<div style="font-weight:bold; border-top:1px solid #999; margin-top:2px; padding-top:2px;">Total : ' + formatAttendanceCount(countAttendanceStatus(records)) + '</div>' : '';
        })
        .catch(() => {
            document.getElementById('historyStatus').textContent = 'Koneksi gagal. Periksa backend.';
        });
}

function showReportStudentHistory(index) {
    const records = (currentReportData && currentReportData.records) || [];
    const r = records[index];
    if (!r) return;
    showStudentHistory({ id: r.id, name: r.name, className: r.className });
}

function showPeekStudentHistory(index) {
    const records = (peekCache && peekCache.res && peekCache.res.records) || [];
    const r = records[index];
    if (!r) return;
    showStudentHistory({ id: r.id, name: r.name, className: r.className }, { hidePrint: true });
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
    setPrintFootnotes();
    const prevTitle = document.title;
    const studentName = (document.getElementById('printHistoryStudent').textContent || '').trim();
    document.title = 'History+' + (studentName || todayISO());
    document.body.classList.add('printing-history');
    window.print();
    document.body.classList.remove('printing-history');
    document.title = prevTitle;
}

// ==========================================
// MODAL PENGATURAN (publik) & MENU ADMIN
// ==========================================
// Pengaturan publik: Koneksi Google Sheets + Setup Backend, selalu bisa dibuka.
function toggleSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    } else {
        hideModalEl(modal);
    }
}

// Menu Admin: tersembunyi, dibuka/ditutup dengan 5 ketuk logo. Selalu butuh
// kata sandi; saat ditutup langsung terkunci kembali.
function toggleMenuAdminModal() {
    const modal = document.getElementById('menuAdminModal');
    if (!modal) return;
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
        const backupBody = document.getElementById('backupBody');
        if (!settingsLocked && backupBody && !backupBody.classList.contains('hidden')) loadBackupList();
        if (!settingsLocked) refreshMaintenanceScheduleView();
    } else {
        hideMenuAdminModal();
        relockSettingsSilently();
    }
}

function hideMenuAdminModal() {
    const modal = document.getElementById('menuAdminModal');
    if (modal) hideModalEl(modal);
}

function hideModalEl(modal) {
    modal.classList.add('opacity-0');
    setTimeout(function () {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
}

// Kunci kembali sesi admin tanpa pesan (dipakai saat Menu Admin ditutup).
function relockSettingsSilently() {
    if (settingsLocked) return;
    settingsLocked = true;
    stopSettingsLockTimer();
    applySecurityState();
}

// ==========================================
// BANTUAN (PANDUAN ABSENSI)
// ==========================================
function loadHelpContent() {
    const content = document.getElementById('helpContent');
    content.innerHTML = '<p class="text-sm text-gray-500">Memuat panduan...</p>';
    fetch('Absensi.md')
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

function toggleQrModal() {
    const modal = document.getElementById('qrModal');
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

// Modal panduan setup backend (dibuka dari banner peringatan & submenu Setup Backend).
function toggleAdminModal() {
    const modal = document.getElementById('adminModal');
    if (!modal) return;
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
// EVENT LISTENERS
// ==========================================
document.getElementById('btnUnlock').addEventListener('click', unlockSettings);
document.getElementById('btnLock').addEventListener('click', lockSettings);
document.getElementById('btnChangePwd').addEventListener('click', changePassword);
document.getElementById('btnTestConn').addEventListener('click', testConnection);
document.getElementById('btnSaveConn').addEventListener('click', saveConfig);
document.getElementById('btnSaveYear').addEventListener('click', saveYearRange);
bindMonthYearInput(document.getElementById('startYearSetting'));
bindMonthYearInput(document.getElementById('endYearSetting'));
document.getElementById('yearEnabledToggle').addEventListener('click', toggleYearRange);
document.getElementById('btnShowReport').addEventListener('click', loadReport);
document.getElementById('reportDate').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadReport();
});
document.getElementById('btnShowStudents').addEventListener('click', loadStudents);
document.getElementById('btnShowBackup').addEventListener('click', backupSheets);
document.getElementById('confirmOk').addEventListener('click', function () { closeConfirmModal(true); });
document.getElementById('confirmCancel').addEventListener('click', function () { closeConfirmModal(false); });
document.getElementById('confirmModal').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        closeConfirmModal(true);
    } else if (e.key === 'Escape') {
        e.preventDefault();
        closeConfirmModal(false);
    }
});
document.getElementById('studentStatusFilter').addEventListener('change', renderStudentList);
document.getElementById('unlockPwd').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') unlockSettings();
});
document.getElementById('apiUrlSetting').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveConfig();
});

// Timer idle (sesi pengaturan & sembunyi ikon) disegarkan oleh aktivitas
// pengguna di seluruh halaman, termasuk menu utama.
bindIdleActivityReset(document);
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') resetIdleTimers();
});

// ==========================================
// INISIALISASI
// ==========================================
document.getElementById('currentDateDisplay').textContent = new Date().toLocaleDateString('id-ID', dateOptions);
document.getElementById('reportDate').value = todayISO();
initMaintenance();
applySecurityState();
initCalloutMarquee();

// Panaskan cache peek laporan hari ini agar klik pertama terasa instan
loadPersistedPeekCache();
schedulePeekPrefetch();
