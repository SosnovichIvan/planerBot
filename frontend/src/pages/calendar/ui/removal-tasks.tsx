import type { CalendarEvent } from '../../../shared/api';
import { Button } from '../../../shared/ui/button';
import { Panel } from '../../../shared/ui/panel';
import { TextLink } from '../../../shared/ui/text-link';
import { openTelegramMessage } from '../../../shared/telegram';

const labels: Record<string, string> = {
  pending: 'Удаление сообщения в очереди', sending: 'Удаляем сообщение в Telegram',
  failed: 'Не удалось удалить сообщение. Проверьте соединение, права бота и возраст сообщения (до 48 часов).',
  unknown: 'Результат удаления неизвестен. Проверьте сообщение в чате.',
};

export function RemovalTasks({ events, more, busy, onRetry }: { events: CalendarEvent[]; more: boolean; busy: boolean; onRetry: (event: CalendarEvent) => void }) {
  if (!events.length) return null;
  return <Panel className="mt-6" aria-label="Удаление сообщений в Telegram">
    <h2 className="font-semibold">Удаление сообщений в Telegram</h2>
    <p className="mt-2 text-sm text-muted">Эти события уже убраны из календаря. Здесь показана только обработка их сообщений для администраторов.</p>
    {more && <p className="mt-3 text-sm" role="status">Показаны первые 50 задач. После обработки появятся следующие.</p>}
    <ul className="mt-4 space-y-4">{events.map(event => {
      const unknownId = event.publication_status === 'unknown' && !event.message_url;
      return <li key={event.id} className="min-w-0 border-t border-line pt-4 [overflow-wrap:anywhere]">
        <h3 className="font-medium">{event.data.title}</h3>
        <p className="mt-1 text-xs text-muted">{event.chat_title} · {event.topic_title}</p>
        <p className="mt-2 text-sm" role="status">{labels[event.publication_status ?? 'pending']}</p>
        {event.message_url && <TextLink className="mt-2" href={event.message_url} onClick={e => { if (openTelegramMessage(event.message_url!)) e.preventDefault(); }}>Проверить сообщение в Telegram</TextLink>}
        {unknownId ? <p className="mt-2 text-sm text-attention">ID сообщения неизвестен. Требуется проверка и удаление вручную в Telegram.</p> :
          ['failed', 'unknown'].includes(event.publication_status ?? '') && <Button className="mt-3" disabled={busy} onClick={() => onRetry(event)}>Повторить удаление сообщения</Button>}
      </li>;
    })}</ul>
  </Panel>;
}
