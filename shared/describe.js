/* Human (Arabic) description of a change — used in the "لم يُقبل" list and in the past-day edit preview. */
import { fmt, evalCalc } from './money.js';
import { ENTRY_KINDS, ITEM_TYPES } from './engine.js';

export function describeOp(op, items = {}) {
  const name = id => (items[id] && items[id].name) || '';
  const m = v => (v === undefined || v === null || v === '' ? '' : fmt(v));
  switch (op.t) {
    case 'addEntry': return `إضافة إلى ${ENTRY_KINDS[op.kind] || ''}: ${m(op.amount)}${op.name ? ' — ' + op.name : ''}`;
    case 'editEntry': return `تعديل سجل: ${m(op.amount)}${op.name ? ' — ' + op.name : ''}`;
    case 'delEntry': return 'حذف سجل';
    case 'addItem': return op.type === 'debt' ? `إضافة إلى الديون: ${op.name || ''} — ${m(op.amount)}` : `إضافة ${ITEM_TYPES[op.type] || ''}: ${op.name || ''} — ${m(op.amount)}`;
    case 'renameItem': return `تغيير اسم ${name(op.id)} إلى ${op.name}`;
    case 'setValue': return `${name(op.id)}: القيمة أصبحت ${m(op.value)}`;
    case 'setActive': return `${name(op.id)}: ${op.active ? 'مستخدمة اليوم' : 'غير مستخدمة اليوم'}`;
    case 'setCalc': { const v = evalCalc(op.calc); return `${name(op.id)}: التغيير ${Number.isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v)) : '—'}`; }
    case 'delItem': return `حذف ${name(op.id)}`;
    case 'restoreItem': return `استرجاع ${name(op.id)}`;
    case 'setCash': return `النقدية: ${m(op.value)}`;
    case 'setNetwork': return `المكن: ${m(op.value)}`;
    case 'setNotes': return 'تعديل الملاحظات';
    case 'setOpening': return `تصفية البارحة: ${m(op.value)}`;
    case 'addAdj': return `${op.amount < 0 || String(op.amount).trim().startsWith('-') ? 'خصم' : 'إضافة'} على التصفية الحقيقية: ${m(op.amount)} — ${op.note || ''}`;
    case 'delAdj': return 'حذف مبلغ مضاف/مخصوم';
    default: return op.t;
  }
}
