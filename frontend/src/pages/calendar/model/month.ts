export function monthDays(month: Date): (number | null)[] {
  const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return [...Array<null>(offset).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
}

export function shiftMonth(month: Date, delta: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + delta, 1);
}
