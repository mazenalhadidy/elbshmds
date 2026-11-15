// Number parsing/formatting and the calculator text.
import { describe, it, expect } from 'vitest';
import { parseAmount, fmt, evalCalc, toLatinDigits } from '../shared/money.js';

describe('money', () => {
  it('reads Arabic and Latin digits, separators and the Arabic decimal point', () => {
    expect(parseAmount('٢٬٤٢٠٬٠٠٠')).toBe(2420000);
    expect(parseAmount('1,000,000')).toBe(1000000);
    expect(parseAmount('١٢٫٥')).toBe(12.5);
    expect(parseAmount('-٥٠')).toBe(-50);
    expect(parseAmount('abc')).toBeNaN();
    expect(parseAmount('')).toBeNaN();
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });
  it('shows numbers with Egyptian Arabic digits', () => {
    expect(fmt(2420000)).toBe('٢٬٤٢٠٬٠٠٠');
    expect(fmt(12.5)).toBe('١٢٫٥');
  });
  it('evaluates the calculator lines', () => {
    expect(evalCalc('746\n+9472')).toBe(10218);
    expect(evalCalc('746\n+9472\n-100')).toBe(10118);
    expect(evalCalc('٧٤٦\n+٩٬٤٧٢')).toBe(10218);
    expect(evalCalc('5+3-2')).toBe(6);
    expect(evalCalc('')).toBe(0);
    expect(evalCalc('-50')).toBe(-50);
    expect(evalCalc('12x')).toBeNaN();
  });
});
