# Put the app online for free: Render (server) + Turso (database)

The data lives in Turso, so the free server may sleep and nothing is lost. The first visit after a pause takes ~1 minute to wake up.
(The app keeps working offline meanwhile and syncs by itself.)

## 1. Upload the project to GitHub (website only, no commands)
1. Make a free account at github.com, click **New repository**, name it `shop-finance`, choose **Private**, create it.
2. Click **uploading an existing file**, open the unzipped project folder and drag ALL its files and folders in.
   Do NOT upload the `.env` file or `node_modules` (if you see them, leave them out). Click **Commit changes**.

## 2. Create the free server on Render
1. render.com -> sign up with GitHub (no card needed) -> **New +** -> **Blueprint** -> pick your `shop-finance` repo.
2. It asks for 3 values: `APP_PASSWORD` (choose a long password), `TURSO_URL`, `TURSO_TOKEN` (from your Turso dashboard). Click **Apply**.
3. When it says "Live", open the address Render shows (like `https://shop-finance-xxxx.onrender.com`) and log in.

## 3. Use it
- Phone: open the address in Chrome -> menu -> **Install app** (works offline after the first open).
- Or build the Android APK: see ANDROID.md.

## Notes
- Updating: upload the changed files to GitHub again; Render redeploys automatically.
- Optional, to avoid the 1-minute wake-up: a free pinger (cron-job.org) opening `https://YOUR-ADDRESS/api/health` every 10 minutes.
- Security: the token you pasted in chat was seen by others in that chat — in Turso create a NEW token and use it instead.

## Why not Netlify?
Netlify hosts static files and short serverless functions. This app needs a server that keeps running (it remembers who is the editing device and the current data in memory), so use Render (above) or any Node host. Netlify would need a redesign.

## Security: what is protected and what is not
Protected: HTTPS (Render), login password, login tokens that expire after 30 days and die if the password changes, 10 wrong passwords per IP = 15 minutes block (also for delete confirmations), deleting a client/number and saving (closing) a day need the password again, the Turso token lives only on the server (never in the browser or the APK), browser safety headers, no caching of data.
Not covered: everyone shares ONE password (no separate accounts, no record of who did what); the data is also saved on every phone/PC that opened the app, so a lost unlocked phone shows it; the attempt limit is per IP and resets when the server restarts; no independent security audit.
Do: use a long password (12+ characters), keep the GitHub repo Private, never upload `.env`, create a NEW Turso token (the old one was pasted in chat), and keep an eye on who has the password.

## Optional: front end on Netlify, server on Render
Netlify can show the screens, but it cannot hold the database token or run the server, so you still need Render (step 2 above) first.
Browser (Netlify) -> your server (Render: login, password checks, rules) -> Turso. The browser never sees the Turso token.
1. Finish step 2 (Render) and copy its address.
2. netlify.com -> **Add new site** -> **Import from GitHub** -> pick the repo. It reads `netlify.toml` by itself.
3. Before deploying: **Site configuration -> Environment variables -> Add** `SERVER_URL` = the Render address (starts with https://, no slash at the end).
4. Deploy. Open the Netlify address, log in with the same password.

## 24/7 and speed (read this for a real shop)
- The app itself never waits for the server: it opens instantly from the copy stored on the phone/PC, and every change is saved there first. If the server is asleep or the internet is off, the shop keeps working and everything is sent later.
- But other devices only see your changes when the server is awake. The FREE Render server sleeps after 15 minutes without anybody using it, and wakes in about 1 minute. While at least one device has the app open (for example the counter PC) it stays awake.
- For a shop that must be always on: Render dashboard -> your service -> Settings -> Instance Type -> **Starter** (about $7/month at the time of writing; check the price on screen). It never sleeps. Keep the region on Frankfurt (same as your Turso database).
- Free alternative (not guaranteed): a free pinger such as cron-job.org that opens `https://YOUR-ADDRESS/api/health` every 10 minutes.
- Quiet checks between devices are now tiny (a few bytes) unless something changed, so it is light on mobile data.
