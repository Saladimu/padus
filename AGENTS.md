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

- Frontend is hosted on **Cloudflare Pages** (`https://padus-cog.pages.dev/`). Changes only take effect after the user redeploys.
- Backend is Google Apps Script (`appsscript/code.gs`). Changes only take effect after the user redeploys it in the Apps Script editor.
- After making changes, tell the user these redeploys are required.

## Service Worker (`sw.js`)

- Strategy: cache-first for navigation HTML (not overwritten until Hard Refresh so the update modal can show), network-first for `config.js`, cache-first for same-origin static assets, stale-while-revalidate for Google Fonts.
- Precache `./`, never `./index.html`: Cloudflare Pages 308-redirects `/index.html` to `/`, and returning a redirected response for a navigation makes Chrome show "This site can't be reached". Strip the redirect flag (`cleanResponse`) before caching or returning navigation responses.
- Keep `data-chevron="true"` on accordion chevron SVGs. `app.js` targets `[data-chevron]` so newly added header icons are not rotated by the accordion logic.

## Hard Refresh / Update Prompt

- The "Pembaruan Tersedia" prompt (`#updateModal`, Hard Refresh button) exists because the SW serves navigation HTML cache-first, so new HTML is not fetched until a hard refresh. Do not remove this flow.
- Detection lives in `app.js`: `remoteVersionMismatch()` compares `sw.js` `ASSET_VERSION`/`CACHE_NAME` and the `index.html` `app.js?v=` value against `APP_ASSET_VERSION`/`APP_CACHE_NAME`; `checkRemoteAppVersion()` fetches both with `cache: 'no-store'`.
- `checkForAppUpdate()` must keep running 2s after load, every 60s, on `visibilitychange`, and when `swRegistration.waiting` exists.
- `hardRefreshApp()` must: set `updateReloadArmed`, post `SKIP_WAITING` to the waiting worker, unregister all service workers, delete all caches, then reload. Never simplify it to a plain `location.reload()`.
- The prompt only fires on a version mismatch: forgetting to bump `APP_ASSET_VERSION`, `APP_CACHE_NAME`, and the `?v=` values means it never appears.
