export function formatDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
