# Agent Preferences

- Do not verify frontend changes with puppeteer.
- Do not refactor code during normal process execution; only refactor when explicitly instructed.
- UI copy is in Indonesian; keep wording consistent with existing text.

## Release Versioning (Frontend Cache-Busting)

Bump the version on **every** frontend release. Use the **current date** (`YYYYMMDD`) plus a lowercase letter suffix, starting at `a` for the first release of that day (`20260928a`, then `20260928b`, ...). Never carry an old date forward.

Keep all of these in sync within the same change:
- `app.js`: `APP_ASSET_VERSION`, `APP_CACHE_NAME`
- `sw.js`: `ASSET_VERSION`, `CACHE_NAME`
- `index.html`: the `?v=` query on `styles.css`, `config.js`, and `app.js`
- `README.md`: the `CACHE_NAME` note

`APP_ASSET_VERSION` must equal `ASSET_VERSION` and every `?v=` value. Increment `CACHE_NAME` (e.g. `choir-absensi-v97`) on every release. This is what makes `remoteVersionMismatch()` in `app.js` show the "Pembaruan Tersedia" prompt.

## Deployment (manual, user action)

- Frontend source lives in the **GitHub repository** `https://github.com/Saladimu/padus` (branch `main`) and is published publicly through **Cloudflare** (`https://padus-cog.pages.dev/`). Cloudflare is only a front layer to hide the origin/source URL from the public, not the source of truth. Changes only take effect after the user pushes to GitHub and redeploys on Cloudflare.
- Backend is Google Apps Script (`appsscript/code.gs`). Changes only take effect after the user redeploys it in the Apps Script editor.
- After making changes, tell the user these redeploys are required.

## Service Worker (`sw.js`)

- Strategy: cache-first for navigation HTML (not overwritten until Hard Refresh so the update modal can show), network-first for `config.js`, cache-first for same-origin static assets, stale-while-revalidate for Google Fonts.
- Precache `./`, never `./index.html`: the Cloudflare front 308-redirects `/index.html` to `/`, and returning a redirected response for a navigation makes Chrome show "This site can't be reached". Strip the redirect flag (`cleanResponse`) before caching or returning navigation responses.
- Keep `data-chevron="true"` on accordion chevron SVGs. `app.js` targets `[data-chevron]` so newly added header icons are not rotated by the accordion logic.

## Hard Refresh / Update Prompt

- The "Pembaruan Tersedia" prompt (`#updateModal`, Hard Refresh button) exists because the SW serves navigation HTML cache-first, so new HTML is not fetched until a hard refresh. Do not remove this flow.
- Detection lives in `app.js`: `remoteVersionMismatch()` compares `sw.js` `ASSET_VERSION`/`CACHE_NAME` and the `index.html` `app.js?v=` value against `APP_ASSET_VERSION`/`APP_CACHE_NAME`; `checkRemoteAppVersion()` fetches both with `cache: 'no-store'`.
- `checkForAppUpdate()` must keep running 2s after load, every 60s, on `visibilitychange`, and when `swRegistration.waiting` exists.
- `hardRefreshApp()` must: set `updateReloadArmed`, post `SKIP_WAITING` to the waiting worker, unregister all service workers, delete all caches, then reload. Never simplify it to a plain `location.reload()`.
- The prompt only fires on a version mismatch: forgetting to bump `APP_ASSET_VERSION`, `APP_CACHE_NAME`, and the `?v=` values means it never appears.

## Architecture & Backend Contract

- Frontend is static (`index.html`, `app.js`, `styles.css`, `config.js`, `sw.js`), version-controlled in the GitHub repository (`https://github.com/Saladimu/padus`) and published publicly through Cloudflare (a front layer that hides the origin/source URL); backend is a Google Apps Script Web App (`appsscript/code.gs`). There is no build step.
- All backend calls go through `apiPost(payload, options)` in `app.js`. The backend `doPost(e)` parses the JSON body, dispatches on `data.action`, and returns JSON via `respond()` shaped as `{ success, message?, ... }`. The frontend rejects any response not starting with `{` or `[`.
- Known actions: `verify`, `submit`, `ping`, `report`, `students`, `backup`, `backuplist`, `history`, `maintenance`. When adding or changing an action, update **both** `app.js` and `appsscript/code.gs`, and keep the frontend tolerant of an older backend that does not yet know the action.
- Default backend URL lives in `config.js` (`window.PADUS_DEFAULT_API_URL`); admins can override it at runtime via Pengaturan > Koneksi Google Sheets (stored in localStorage `choir_absensi_config`). Do not hardcode the URL in `app.js`.

## Data Conventions

- Sheets are fixed: `STUDENTS` columns `[ID, Nama, Kelas, PIN, Status]`; `ATTENDANCE` columns `[Timestamp, Tanggal, ID, Nama, Kelas, Jenis, Remark, Status]`.
- Day index: `0=Minggu ... 6=Sabtu`. Use `MAINT_ALL_DAYS` and `MAINT_DAY_ORDER` (display `[1,2,3,4,5,6,0]`) rather than literal arrays.
- Maintenance days must stay normalized on both sides (`coerceMaintenanceDaysInput` / `normalizeMaintenanceDays`); Apps Script can return arrays as CSV strings or Rhino-like objects.

## Security Invariants

- Student verification has brute-force protection (`VERIFY_MAX_FAILS`, per-identity and global block via `CacheService`). Do not weaken or bypass it.
- Admin password is stored SHA-256-hashed in localStorage (`choir_absensi_pwd`), default `00000`. Never log, transmit, or hardcode it elsewhere.

## Testing

- No build step. Run the Node built-in tests from the repo root: `node --test`.
- `tests/maintenance-days.test.js` extracts the real `coerceMaintenanceDaysInput` / `normalizeMaintenanceDays` from `app.js` and runs them in a `vm` sandbox (no duplicated logic, no refactor). Keep it passing; these helpers have regressed before.
- `appsscript/code.gs` cannot be checked directly by `node --check` (`.gs`); copy it to a temp `.js` file first if needed.
