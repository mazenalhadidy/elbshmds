# Using the app on an Android phone

The phone does not run the server: the shop computer does. The phone opens the app in Chrome and talks to the computer.
Everything you enter is saved on the phone first and sent to the computer when it can be reached, so the phone keeps working when it is away.

## Option A - same Wi-Fi as the shop computer (simplest)
1. On the computer start the app (the desktop icon). The black window prints a line `PHONE (same Wi-Fi): http://192.168.x.x:3000`.
   The same address is shown in the app: Management page -> "الدخول من الهاتف".
2. If Windows asks about the firewall, allow **Private networks**.
3. On the phone (connected to the same Wi-Fi) open Chrome and type that address. Log in.
Limits: it works only on that Wi-Fi, the computer must be on, and because the address starts with http:// Chrome will not install it as an app and the page itself cannot open without the computer.
Tip: in your router, give the computer a fixed ("reserved") address so the address never changes.

## Option B - from anywhere, installed as an app, works offline (free Tailscale)
1. Make a free account at tailscale.com. Install Tailscale on the computer AND on the phone and sign in with the SAME account on both.
2. In the Tailscale admin console -> **DNS**: turn on **MagicDNS**, and under **HTTPS Certificates** press **Enable HTTPS**.
3. On the computer, in CMD: `tailscale serve --bg 3000`   then   `tailscale serve status`  (it shows your address: `https://computer-name.something.ts.net`).
4. On the phone (Tailscale turned on) open that address in Chrome, log in, then menu -> **Install app**. Now it opens like an app and works offline.
Notes: the computer must be on; only your devices on your Tailscale account can open it; your computer's name appears in a public certificate list, so pick a plain computer name.

## Option C - an APK file (optional, advanced, not tested here)
Needs the server to have an https:// address (for example Option B's address) and the GitHub steps below.
1. Put the project on GitHub (see DEPLOY.md step 1).
2. GitHub -> Actions -> **Android APK** -> Run workflow -> type your https:// address -> Run.
3. After ~5 minutes download `shop-apk` from the run, unzip, send `app-debug.apk` to the phone and open it.
