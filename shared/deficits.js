/* =====================================================================
   العجوزات — the shortage (عجز) or surplus (زيادة) each saved day ended with, and their running total.
   diff = التصفية الافتراضية − التصفية الحقيقية  (positive = عجز, negative = زيادة)
   Shown WITHOUT a minus sign: the word (عجز / زيادة) and the colour say which one it is.
   Used by the screens only; the numbers come from the saved days (days.diff).
   ===================================================================== */
import { r2 } from './money.js';

/** 'deficit' (عجز) / 'surplus' (زيادة) / 'even' (مطابق) — rounded to the piastre, so 0.001 is even. */
export const diffKind = d => (d == null ? 'none' : r2(d) > 0 ? 'deficit' : r2(d) < 0 ? 'surplus' : 'even');

/** The word for one day: عجز / زيادة / مطابق. */
export const dayWord = d => ({ deficit: 'عجز', surplus: 'زيادة', even: 'مطابق', none: '—' })[diffKind(d)];

/** The word for the running total: عجز تراكمي / زيادة تراكمية / مطابق تراكميًا. */
export const cumulativeWord = d => ({ deficit: 'عجز تراكمي', surplus: 'زيادة تراكمية', even: 'مطابق تراكميًا', none: '—' })[diffKind(d)];

/** Sum of what every saved day ended with (+ عجز, − زيادة). A day without a number (very old data) counts as 0. */
export function cumulative(days) {
  return r2((days || []).filter(d => d.status !== 'open').reduce((a, d) => a + (Number(d.diff) || 0), 0));
}

/**
 * One record per saved day, newest first, each with the running total up to and including that day.
 * Days are ordered by `seq` (the order they were worked), which is the order the shortages added up.
 */
export function deficitRecords(days) {
  let run = 0;
  const list = (days || []).filter(d => d.status !== 'open').sort((a, b) => a.seq - b.seq).map(d => {
    run = r2(run + (Number(d.diff) || 0));
    return { id: d.id, seq: d.seq, date: d.date, virtual: d.virtual, real: d.real, diff: d.diff == null ? null : r2(d.diff), notes: d.notes || '', runningAfter: run };
  });
  return list.reverse();
}
