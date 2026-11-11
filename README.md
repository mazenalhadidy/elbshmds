# محل الباشمهندس — Shop Finance
Offline-first web app (Arabic, right-to-left). Server: Node + Express. Database: Turso (online SQLite). Same money engine runs on the server and in the browser/Android app.

## Run on your PC (Windows)
1. Install Node.js 20+.
2. Double-click `make-desktop-shortcut.cmd` once. A shortcut appears on the Desktop.
3. Double-click the shortcut: the first time it opens Notepad with `.env` (password + Turso values). Save and close. The app opens in the browser.
Manual way: `npm install` then `npm run dev` (PowerShell: `$env:APP_PASSWORD="1234"; npm run dev` also works).

## Folders
- `shared/engine.js` all accounting rules (used by server AND browser). Read this to understand the logic.
- `src/` server: `server.js` (start), `app.js` (API + single-editor lock), `store.js` (Turso database).
- `public/` the app screens: `index.html`, `style.css`, `app.js`, `sw.js`/`manifest.webmanifest` (installable, offline files).
- `test/` automated tests (`npm test`). `.github/workflows/` CI (tests, Docker image, Android APK). `render.yaml` free hosting recipe.

See DEPLOY.md (online for free) and ANDROID.md (APK).

## Copies of the database
- Every phone / computer that uses the app keeps its own copy (browser database) of the current data AND of all saved days, so it works and shows history without internet. It is refreshed from Turso every 15 minutes, and you can press "تحديث الآن" in the Management page.
- The computer that runs the server (start-shop.cmd) also saves a readable file `data/turso-copy.json`, re-read from Turso every 15 minutes (disable with `LOCAL_COPY=off` in `.env`).
- The server itself re-reads Turso every 15 minutes, in case the database was changed from somewhere else.

## How your entries are protected (read this)
1. Every change is saved on the device BEFORE anything else, in two places (localStorage + the browser database). If one copy is wiped, the other brings it back at the next start. If neither can be written, the app refuses the change and says so (it never pretends).
2. Changes wait in a queue until the server confirms them. A lost reply is safe (each change has an id; repeating it is ignored). A big backlog is sent in chunks.
3. A change the server or the engine refuses is NEVER deleted automatically: it moves to the "لم يُقبل" list (red banner) with the reason. You can retry it or delete it yourself. "تنزيل نسخة" saves everything unsent to a file.
4. A change written during a day that was closed meanwhile is not lost: it is added to the open day and marked "⚠ كُتب أثناء يوم ...".
5. On the server: every received change is also written to the `ops_log` table (accepted and refused). Data is saved in all-or-nothing transactions with a version check, so two servers on the same database can not overwrite each other.
What nothing can protect: a device that is destroyed / factory-reset / has its browser data cleared BEFORE its waiting changes were sent (use "تنزيل نسخة" if a device will be offline for long), and Turso itself losing data (keep your own copies of data/turso-copy.json).
