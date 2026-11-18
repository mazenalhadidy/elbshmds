# Installing on the shop computer (Windows)

## 1. Node.js
Download the **LTS** version (22 or newer) from nodejs.org and install it with the default options.
No administrator rights? Download the "Windows Binary (.zip)", extract it, and put its files in a folder named `node` inside the program folder (so that `node\node.exe` exists). The scripts use it automatically.

## 2. The program folder
Extract the zip to a NEW folder, for example `C:\elbshmds` (not Downloads, not inside the zip).

## 3. Coming from the old version? (your current data)
- Close the old program first (close its black window) and do not run both.
- Copy your old `.env` file into the new folder (it has your password and Turso keys), then open it in Notepad and add the new lines from `.env.example` (GITHUB_REPO, UPDATE_PASSWORD).
- Your data comes over by itself on the first start: the program reads the old data from Turso (or from the old `data\shop.db` if you did not use Turso), converts it, and keeps a copy of the old data in `data\backups`. The old tables in Turso are only read, never changed.
  - Saved days keep their numbers as they were. Only the sign of العجز/الزيادة changes (now: الافتراضي − الحقيقي).
  - Old transfers/transactions are kept in the database (table `legacy_archive`) but are not shown, because wallets are now typed by hand.
- The first start needs internet if you use Turso (to bring your data). If it cannot reach Turso it stops and tells you, instead of starting empty.

## 4. Start
Double-click **start-shop.cmd**. The first time it opens Notepad for the settings (`.env`, see below). Save and close Notepad. It installs and builds (internet needed, a few minutes the first time) and opens the program.
New shop (no old data): it asks for the first day's التصفية.

## The settings file (.env)
It is a plain text file named exactly `.env` in the program folder. `start-shop.cmd` creates it the first time and
opens it in Notepad; later: right-click `.env` → Open with → Notepad. One setting per line, `NAME=value`, no spaces
around `=`. Save (Ctrl+S) and close Notepad, then start the program again.
- `APP_PASSWORD=` the login password (8+ characters).
- `UPDATE_PASSWORD=` the password for «تحديث متاح» (choose your own, different from the login one).
- `TURSO_URL=` / `TURSO_TOKEN=` your Turso database (empty = data only on this computer).
- `GITHUB_REPO=mazenalhadidy/elbshmds` (where updates come from; empty = no updates).
Never send this file to anyone and never upload it to GitHub.

## Updates
When a new version is on GitHub and passed its tests, the program prepares it in the background and shows
**«تحديث متاح»** at the top. Nothing changes until you press it and type `UPDATE_PASSWORD`. Then it switches in a few
seconds: changes being saved finish first, the database is copied to `data\backups\before-update-…`, and if the new
version does not start, the copy is put back and the old version runs again. Phones keep their unsent changes and send
them when the program is back.

## 5. Make it easy
- **make-desktop-shortcut.cmd** (once): an icon on the Desktop.
- **autostart-install.cmd** (once): starts by itself, minimized, every time you log in. **autostart-remove.cmd** undoes it. **stop-shop.cmd** stops it.
- **add-wallets.cmd**: drag a WhatsApp chat (.zip or .txt) onto it → every phone number in it becomes a wallet with balance 0.
- **allow-phones.cmd** (once, right-click → Run as administrator): lets phones on the same Wi-Fi open it.

## Good to know
- If the computer sleeps or is off, phones cannot reach it (they keep working and send their changes later). Windows Settings → Power → Sleep: Never while plugged in.
- Backups: `data\backups` (one per day + one at every start, last 30 days). Turso has a copy too.
- A work laptop may block installing programs, the firewall rule, or GitHub. Ask IT if something is blocked.
