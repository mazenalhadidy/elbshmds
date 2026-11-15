/* =====================================================================
   THE APP'S BRAIN (Pinia store) — works OFFLINE first.
   - snap     : the last data received from the shop computer
   - pending  : your changes not yet confirmed by it (saved on this device, twice)
   - failed   : changes it refused — KEPT here until you retry or delete them yourself
   - view     : what every screen shows = snap + pending, calculated with the shared engine
                (or, in "edit a saved day" mode, that day + your edits)
   Every change goes through dispatch(). It appears on screen instantly; sync() sends it.
   ===================================================================== */
import { defineStore } from 'pinia';
import { reduce, summarize, clone, EngineError } from '@shared/engine.js';
import { describeOp } from '@shared/describe.js';
import { api, uid, setToken, getToken, isOffline, downloadJson, clientId } from '@/lib/api.js';
import { ls, openIdb, saveUnsent, loadUnsent } from '@/lib/storage.js';
import { useToasts } from './toasts.js';

const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

export const useShop = defineStore('shop', {
  state: () => ({
    loggedIn: !!getToken(),
    ready: false,                 // first data loaded
    snap: ls.get('elb_snap', null),
    pending: [], failed: [], n: 0,
    lock: { editor: true, held: false },
    connected: true,              // could we reach the shop computer last time?
    lastContactAt: null,
    system: null,                 // management info (Turso, devices, version) — refreshed now and then
    syncing: false,
    view: null,                   // { items, book, summary, editing } — what the screens show
    editing: null,                // { dayId, date, seq, base:{items,book}, ops:[] } while editing a saved day
  }),

  getters: {
    items: s => s.view?.items || {},
    book: s => s.view?.book || null,
    summary: s => s.view?.summary || null,
    canEdit: s => !!s.editing || s.lock.editor,
    /** Turso (internet) reachable from the shop computer? null when unknown / not configured. */
    internetOk: s => (s.system?.turso?.configured ? !s.system.turso.lastError : null),
    /** Anything not yet safe on the server or not yet in Turso. */
    hasUnsent: s => s.pending.length > 0 || s.failed.length > 0 || (s.system?.turso?.pendingRows || 0) > 0,
  },

  actions: {
    /* ---------------- start ---------------- */
    async start() {
      await openIdb();
      const u = await loadUnsent();
      this.pending = u.pending || []; this.failed = u.failed || []; this.n = u.n || 0;
      this.rebuild();
      if (this.loggedIn) { await this.sync(); this.refreshSystem(); }
      this.ready = true;
      // keep in touch: every 10 s (keeps the editor role, brings other devices' changes)
      setInterval(() => { if (this.loggedIn && !document.hidden) this.sync(); }, 10000);
      setInterval(() => { if (this.loggedIn && !document.hidden) this.refreshSystem(); }, 60000);
      window.addEventListener('online', () => this.sync());
      document.addEventListener('visibilitychange', () => { if (!document.hidden && this.loggedIn) this.sync(); });
    },
    async login(password) {
      const { token } = await api('POST', '/login', { password });
      setToken(token); this.loggedIn = true;
      await this.sync(); this.refreshSystem();
    },
    logout() { setToken(''); this.loggedIn = false; },

    /* ---------------- what the screens show ---------------- */
    /** Recalculate the view. A waiting change that no longer fits is moved to `failed` (never dropped). */
    rebuild() {
      if (this.editing) {
        const st = { items: clone(this.editing.base.items), book: clone(this.editing.base.book) };
        for (const op of this.editing.ops) { try { reduce(st, op); } catch { /* checked when added */ } }
        this.view = { ...st, summary: summarize(st.book, st.items), editing: true };
        return;
      }
      if (!this.snap || !this.snap.book) { this.view = null; return; }
      const st = { items: clone(this.snap.items), book: clone(this.snap.book) };
      const bad = [];
      this.pending = this.pending.filter(op => {
        try { const t = clone(st); reduce(t, op); st.items = t.items; st.book = t.book; return true; }
        catch (e) { bad.push({ op, error: e.message, at: new Date().toISOString() }); return false; }
      });
      if (bad.length) { this.failed.push(...bad); this.persist(); useToasts().show(`${bad.length} تعديل لم يعد صالحًا — محفوظ في «لم يُقبل»`, 'error'); }
      this.view = { ...st, summary: summarize(st.book, st.items), editing: false };
    },
    persist() { this.n++; return saveUnsent(this.n, this.pending, this.failed); },

    /* ---------------- every change ---------------- */
    /** Apply a change now (on screen) and queue it for the server. Returns true if accepted. */
    dispatch(o, { quiet = false } = {}) {
      const toasts = useToasts();
      if (this.editing) {                                   // editing a saved day: changes stay in the draft until you save
        const op = { ...o, opId: uid(), ts: new Date().toISOString() };
        try { const st = { items: clone(this.view.items), book: clone(this.view.book) }; reduce(st, op); }
        catch (e) { toasts.show(e.message, 'error'); return false; }
        this.editing.ops.push(op); this.rebuild(); return true;
      }
      if (!this.lock.editor) { toasts.show('وضع المشاهدة فقط — جهاز آخر يقوم بالتعديل', 'error'); return false; }
      if (!this.view) return false;
      const op = { ...o, opId: uid(), ts: new Date().toISOString(), dayId: this.view.book.day.id, dayDate: this.view.book.day.date || todayStr() };
      try { const st = { items: clone(this.view.items), book: clone(this.view.book) }; reduce(st, op); }
      catch (e) { if (e instanceof EngineError) { toasts.show(e.message, 'error'); return false; } throw e; }
      const last = this.pending[this.pending.length - 1];
      const sameTyping = last && last.t === op.t && ['setCash', 'setNetwork', 'setNotes'].includes(op.t);   // typing: keep only the latest value
      const backup = this.pending.slice();
      if (sameTyping) this.pending[this.pending.length - 1] = op; else this.pending.push(op);
      if (!this.persist()) { this.pending = backup; toasts.show('تعذّر حفظ التغيير على هذا الجهاز (التخزين ممتلئ) — لم يُنفَّذ', 'error'); return false; }
      this.rebuild();
      if (!quiet) toasts.done(op);
      this.syncSoon(quiet ? 800 : 60);
      return true;
    },
    syncSoon(ms) { clearTimeout(this._t); this._t = setTimeout(() => this.sync(), ms); },

    /* ---------------- talking to the shop computer ---------------- */
    adopt(r) {
      if (r.lock) this.lock = r.lock;
      if (r.book !== undefined || r.setupNeeded !== undefined) {
        const { lock, done, rejected, unchanged, ...snap } = r;
        this.snap = snap; ls.set('elb_snap', snap);
      }
    },
    async sync() {
      if (this.syncing || !this.loggedIn) return;
      this.syncing = true;
      const batch = this.pending.slice(0, 200);
      let more = false;
      try {
        const r = batch.length ? await api('POST', '/ops', { ops: batch }) : await api('GET', '/state?rev=' + (this.snap?.rev || 0));
        if (!this.connected && this.loggedIn) useToasts().show(batch.length ? `عاد الاتصال — تم إرسال ${batch.length} تغيير` : 'عاد الاتصال بجهاز المحل');
        this.connected = true; this.lastContactAt = Date.now();
        if (!r.unchanged) this.adopt(r); else this.lock = r.lock;
        if (batch.length) {
          const refused = r.rejected || [];
          for (const x of refused) { const op = batch.find(p => p.opId === x.opId); if (op) this.failed.push({ op, error: x.error, at: new Date().toISOString() }); }
          const gone = new Set([...(r.done || []), ...refused.map(x => x.opId)]);
          this.pending = this.pending.filter(p => !gone.has(p.opId));
          if (refused.length) useToasts().show(`${refused.length} تعديل لم يُقبل: ${refused[0].error} — محفوظ في «لم يُقبل»`, 'error');
          more = this.pending.length > 0;
          this.persist();
        }
      } catch (e) {
        if (e.status === 401) this.logout();
        else if (e.status === 403 && e.body) { this.connected = true; this.adopt(e.body); }   // another device is the editor: our changes wait
        else if (isOffline(e)) { if (this.connected) useToasts().show('انقطع الاتصال بجهاز المحل — تغييراتك تُحفظ على هذا الجهاز وتُرسل لاحقًا', 'error'); this.connected = false; }
        else useToasts().show(e.message, 'error');
      }
      this.syncing = false;
      this.rebuild();
      if (this.pending.length && this.connected && this.lock.editor) this.syncSoon(more ? 50 : 5000);
    },
    /** Send everything waiting (needed before closing a day). */
    async flush() { for (let i = 0; i < 20 && this.pending.length; i++) { await this.sync(); if (!this.connected) break; } return !this.pending.length; },
    async refreshSystem() { try { this.system = await api('GET', '/system'); this.connected = true; } catch (e) { if (isOffline(e)) this.connected = false; } },
    async takeOver() {
      try { const r = await api('POST', '/lock', { take: true }); this.adopt(r); this.rebuild(); this.sync(); useToasts().show('هذا الجهاز هو الذي يعدّل الآن'); }
      catch (e) { useToasts().show(isOffline(e) ? 'لا يوجد اتصال بجهاز المحل' : e.message, 'error'); }
    },

    /* ---------------- first start ---------------- */
    async setup(opening) { const r = await api('POST', '/setup', { opening }); this.adopt(r); this.rebuild(); useToasts().show('تم بدء أول يوم'); },

    /* ---------------- closing the day (needs the shop computer + password) ---------------- */
    async closeDay({ date, password }) {
      if (!(await this.flush())) throw new Error('لا يمكن الوصول إلى جهاز المحل الآن — التغييرات محفوظة وستُرسل لاحقًا');
      const r = await api('POST', '/close', { dayId: this.snap.book.day.id, date, notes: this.view.book.day.notes, password });
      this.adopt(r); this.rebuild();
    },

    /* ---------------- a saved day: open, edit, save ---------------- */
    getDay: id => api('GET', '/days/' + id),
    async startEdit(dayId) {
      useToasts().show('وضع تعديل يوم محفوظ — كل الصفحات تعرض هذا اليوم');
      const d = await api('GET', '/days/' + dayId);
      this.editing = { dayId, date: d.book.day.date, seq: d.book.day.seq, base: { items: clone(this.snap.items), book: d.book }, ops: [] };
      this.rebuild();
    },
    cancelEdit() { this.editing = null; this.rebuild(); useToasts().show('تم إلغاء تعديل اليوم'); },
    previewEdit() { return api('POST', `/days/${this.editing.dayId}/edit`, { ops: this.editing.ops, preview: true }); },
    describeEdits() { return this.editing.ops.map(o => describeOp(o, this.view.items)); },
    async saveEdit({ note, password }) {
      if (!(await this.flush())) throw new Error('لا يمكن الوصول إلى جهاز المحل الآن');
      const r = await api('POST', `/days/${this.editing.dayId}/edit`, { ops: this.editing.ops, note, password });
      this.editing = null; this.adopt(r.snapshot); this.rebuild();
      return r;
    },

    /* ---------------- items ---------------- */
    itemHistory: id => api('GET', `/items/${id}/history`),
    async purgeItem(id, password) { await this.flush(); const r = await api('POST', `/items/${id}/purge`, { password }); this.adopt(r); this.rebuild(); },
    cashProfit: password => api('POST', '/cash-profit', { password }),

    /* ---------------- the "not accepted" list ---------------- */
    retryFailed(i) { const x = this.failed[i]; if (!x) return; const { opId, ts, dayId, dayDate, ...rest } = x.op; if (this.dispatch(rest, { quiet: true })) { this.failed.splice(i, 1); this.persist(); useToasts().show('تمت إعادة المحاولة — التعديل في الطريق'); } },
    dropFailed(i) { this.failed.splice(i, 1); this.persist(); useToasts().show('تم حذف التعديل'); },

    /** Download: the full database from the shop computer if reachable, plus everything waiting on this device. */
    async download() {
      let server = null;
      try { server = await api('GET', '/export'); } catch { /* offline: local copy only */ }
      downloadJson(`elbshmds-${todayStr()}${server ? '' : '-this-device'}.json`, { savedAt: new Date().toISOString(), device: clientId, waiting: this.pending, notAccepted: this.failed, lastData: this.snap, database: server });
      useToasts().show(server ? 'تم تنزيل نسخة كاملة من قاعدة البيانات' : 'لا يوجد اتصال — تم تنزيل نسخة من بيانات هذا الجهاز فقط', server ? 'done' : 'error');
    },
  },
});
