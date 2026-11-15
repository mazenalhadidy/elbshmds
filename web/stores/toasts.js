/* Quick light notifications ("✓ تمت إضافة ..."), and error messages. */
import { defineStore } from 'pinia';

// Success messages ONLY for actions whose result you cannot see directly in a table.
// (Adding/editing rows shows nothing: the row itself is the confirmation. Errors are always shown.)
const DONE = {
  delItem: 'تم الحذف — يبقى في أسفل الجدول ويمكن استرجاعه',
  restoreItem: 'تم الاسترجاع',
  renameItem: 'تم تغيير الاسم',
  delAdj: 'تم حذف المبلغ',
  setOpening: 'تم حفظ تصفية البارحة',
};

export const useToasts = defineStore('toasts', {
  state: () => ({ list: [] }),
  actions: {
    /** kind: 'done' (light, short) | 'error' (longer). action: { label, run } for an undo button. */
    show(text, kind = 'done', action = null) {
      const id = Math.random();
      this.list.push({ id, text, kind, action });
      if (this.list.length > 3) this.list.shift();
      setTimeout(() => this.close(id), kind === 'error' ? 4500 : action ? 4000 : 1600);
    },
    done(op, action = null) { const m = DONE[op.t]; if (m) this.show(typeof m === 'function' ? m(op) : m, 'done', action); },
    close(id) { this.list = this.list.filter(t => t.id !== id); },
  },
});
