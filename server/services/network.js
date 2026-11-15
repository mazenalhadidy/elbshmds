/* The addresses of this computer on the shop network (for phones) and the list of connected devices. */
import os from 'node:os';

export function lanUrls(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) {
    if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) out.push(i.address);
  }
  const home = a => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);    // usual shop/home network ranges first
  return out.sort((a, b) => home(b) - home(a)).map(a => `http://${a}:${port}`);
}

/** Devices that talked to the server recently (in memory). */
export function createDevices() {
  const map = new Map();
  return {
    seen(id, { name, ip, ua }) {
      if (!id) return;
      map.set(id, { id, name: name || guessName(ua), ip: String(ip || '').replace(/^::ffff:/, ''), lastSeen: Date.now() });
      if (map.size > 200) for (const [k, d] of map) if (Date.now() - d.lastSeen > 7 * 864e5) map.delete(k);   // forget devices unseen for a week
    },
    list() { return [...map.values()].sort((a, b) => b.lastSeen - a.lastSeen).map(d => ({ ...d, online: Date.now() - d.lastSeen < 60000 })); },
  };
}
function guessName(ua = '') {
  const os = /Android/i.test(ua) ? 'أندرويد' : /iPhone|iPad/i.test(ua) ? 'آيفون' : /Windows/i.test(ua) ? 'ويندوز' : /Mac/i.test(ua) ? 'ماك' : /Linux/i.test(ua) ? 'لينكس' : 'جهاز';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}
