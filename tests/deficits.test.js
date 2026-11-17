// العجوزات: words, colours (kind), running total — the examples from the shop owner.
import { describe, it, expect } from 'vitest';
import { diffKind, dayWord, cumulativeWord, cumulative, deficitRecords } from '../shared/deficits.js';

const day = (seq, diff, extra = {}) => ({ id: 'd' + seq, seq, date: `2026-11-1${seq}`, status: 'closed', virtual: 1000 + seq, real: 1000 + seq - diff, diff, notes: '', ...extra });

describe('العجوزات', () => {
  it('one word, never a minus sign: positive = عجز, negative = زيادة', () => {
    expect(dayWord(7535)).toBe('عجز'); expect(diffKind(7535)).toBe('deficit');
    expect(dayWord(-10000)).toBe('زيادة'); expect(diffKind(-10000)).toBe('surplus');
    expect(dayWord(0)).toBe('مطابق'); expect(dayWord(0.001)).toBe('مطابق');           // rounding noise is not a shortage
    expect(cumulativeWord(1000)).toBe('عجز تراكمي'); expect(cumulativeWord(-1)).toBe('زيادة تراكمية'); expect(cumulativeWord(0)).toBe('مطابق تراكميًا');
  });

  it('the owner\'s example: a 10,000 surplus, then an 11,000 shortage = a 1,000 cumulative shortage', () => {
    const days = [day(1, -10000), day(2, 11000)];
    expect(cumulative(days)).toBe(1000);
    expect(cumulativeWord(cumulative(days))).toBe('عجز تراكمي');
  });

  it('records: newest first, each with the running total after it; the open day and missing numbers are safe', () => {
    const days = [day(2, 11000, { notes: 'نقص في الدرج' }), day(1, -10000), { id: 'o', seq: 3, status: 'open', diff: 999 }, day(4, null)];
    const recs = deficitRecords(days);
    expect(recs.map(r => r.seq)).toEqual([4, 2, 1]);
    expect(recs.map(r => r.runningAfter)).toEqual([1000, 1000, -10000]);
    expect(recs[1].notes).toBe('نقص في الدرج'); expect(recs[0].diff).toBe(null);
    expect(cumulative(days)).toBe(1000);                                                 // the open day is not counted yet
    expect(cumulative(undefined)).toBe(0); expect(deficitRecords(null)).toEqual([]);
  });
});
