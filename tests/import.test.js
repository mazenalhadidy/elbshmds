// scripts/import-wallets.mjs: the Egyptian numbers in a WhatsApp chat
import { describe, it, expect } from 'vitest';
import { findNumbers } from '../scripts/import-wallets.mjs';

describe('import wallets', () => {
  it('finds each Egyptian mobile once, in any common writing', () => {
    const chat = `[11/20/25, 8:08:32 PM] محمد: 01033485462
[11/20/25, 8:08:35 PM] محمد: 170000
[11/20/25, 8:09 PM] محمد: 010 94355786
[11/20/25, 8:10 PM] حسن: [مُعاد توجيهها] 01287677347
[11/20/25, 8:11 PM] حسن: ٠١١٢٣٤٥٦٧٨٩ و +20 155 012 3456
[11/20/25, 8:12 PM] حسن: 01033485462 كمان 5050 و 0131234567 و 010123456789`;
    expect(findNumbers(chat)).toEqual(['01033485462', '01094355786', '01287677347', '01123456789', '01550123456']);
  });
});
