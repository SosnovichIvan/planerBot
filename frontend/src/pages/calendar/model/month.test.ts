import { describe, expect, it } from 'vitest';
import { monthDays, shiftMonth } from './month';

describe('month grid', () => {
  it('uses Monday first and includes leap days', () => {
    expect(monthDays(new Date(2024, 1, 1))).toEqual([
      null, null, null, ...Array.from({ length: 29 }, (_, i) => i + 1),
    ]);
    expect(monthDays(new Date(2026, 5, 1))[0]).toBe(1);
  });
  it('crosses year boundaries without carrying an invalid day', () => {
    expect(shiftMonth(new Date(2026, 11, 31), 1)).toEqual(new Date(2027, 0, 1));
    expect(shiftMonth(new Date(2026, 0, 31), -1)).toEqual(new Date(2025, 11, 1));
  });
});
