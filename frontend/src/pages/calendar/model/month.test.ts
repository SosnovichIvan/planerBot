import { describe, expect, it } from 'vitest';
import { eventDayCounts, monthDays, shiftMonth } from './month';
import { event } from '../ui/fixtures.test-data';

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
  it('marks event days, includes overlap and excludes cancellation and an exclusive midnight', () => {
    const counts = eventDayCounts([
      event,
      { ...event, status: 'cancelled' },
      { ...event, data: { ...event.data, start_date: '2026-09-30', end_date: '2026-10-01', end_time: '10:00' } },
      { ...event, data: { ...event.data, start_date: '2026-09-30', end_date: '2026-10-01', end_time: '00:00' } },
      { ...event, data: { ...event.data, start_date: '2026-10-21', end_date: null, end_time: null } },
    ], new Date(2026, 9, 1));
    expect(counts[20]).toBe(1);
    expect(counts[1]).toBe(1);
    expect(counts[21]).toBe(1);
    expect(counts[5]).toBe(0);
  });
});
