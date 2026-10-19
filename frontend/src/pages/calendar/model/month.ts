import type { CalendarEvent } from '../../../shared/api';

export function monthDays(month: Date): (number | null)[] {
  const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return [...Array<null>(offset).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
}

export function shiftMonth(month: Date, delta: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + delta, 1);
}

export function monthRange(month: Date) {
  const format = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-01`;
  return { start: format(month), end: format(shiftMonth(month, 1)) };
}

export function eventDayCounts(events: CalendarEvent[], month: Date): Record<number, number> {
  const result: Record<number, number> = {};
  const prefix = monthRange(month).start.slice(0, 8);
  for (const day of monthDays(month)) {
    if (day === null) continue;
    const value = prefix + String(day).padStart(2, '0');
    result[day] = eventsOnDate(events, value).length;
  }
  return result;
}

export function eventsOnDate(events: CalendarEvent[], value: string): CalendarEvent[] {
  return events.filter((event) => event.status !== 'cancelled' && event.data.start_date === value);
}
