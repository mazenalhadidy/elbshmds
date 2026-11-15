# Phones (Android)

The shop computer runs the program; a phone opens it in Chrome.
Everything typed on the phone is saved on the phone first and sent when the shop computer can be reached.

## Same Wi-Fi as the shop computer
1. On the shop computer, run **allow-phones.cmd** once as administrator (Windows Firewall blocks phones by default — this is the usual reason "the page does not load").
2. In the program: **الإدارة → الهواتف والأجهزة المتصلة**: scan the QR code with the phone, or type the address shown (like `http://192.168.1.10:3000`).
3. Give the computer a fixed address in the router ("DHCP reservation") so the address never changes.
Still not loading? Check that both are on the same Wi-Fi (not the guest network) and that the program is running on the computer.

## From anywhere, installed as an app (optional, free): Tailscale
1. Install Tailscale on the computer and the phone, same account.
2. Tailscale admin → DNS: turn on MagicDNS and HTTPS certificates.
3. On the computer: `tailscale serve --bg 3000`, then `tailscale serve status` shows `https://<computer>.<name>.ts.net`.
4. Open that address on the phone → Chrome menu → **Install app**. It opens even with no connection.
