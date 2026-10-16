import type { CalendarEvent } from '../../../shared/api';
import { openTelegramMessage } from '../../../shared/telegram';
import { Modal } from '../../../shared/ui/modal';

export function DayEvents({ date, events, onClose, incomplete = false }: { date: string; events: CalendarEvent[]; onClose: () => void; incomplete?: boolean }) {
  const title = new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  return <Modal title={`События ${title}`} onClose={onClose}>
    {incomplete && <p className="mt-4 text-sm" role="status">Загружены не все события месяца. Закройте окно и выберите конкретный чат, чтобы уточнить список.</p>}
    {events.length === 0 && <p className="mt-5 text-sm" role="status">Событий на этот день больше нет.</p>}
    <ul className="mt-5 space-y-3">{events.map((event) => {
      const content = <>
        <h3 className="break-words font-semibold">{event.data.title}</h3>
        <p className="mt-2 text-sm text-muted">{event.chat_title} · {event.topic_title}</p>
        <p className="mt-2 text-sm">{event.data.start_date} · {event.data.start_time ?? 'Весь день'}{event.data.end_time && ` — ${event.data.end_date ?? event.data.start_date} ${event.data.end_time}`} · {event.timezone}</p>
        <p className="mt-2 break-words text-sm">{[event.data.place, event.data.address].filter(Boolean).join(', ') || event.data.online_url || event.data.map_url || 'Место уточняется'}</p>
      </>;
      return <li key={event.id}>
        {event.message_url ? <a className="block rounded-xl border border-line p-4 hover:bg-canvas" href={event.message_url}
          onClick={(e) => { if (openTelegramMessage(event.message_url!)) e.preventDefault(); }}>
          {content}<p className="mt-3 text-sm font-medium underline">Открыть сообщение в Telegram</p>
        </a> : <div className="rounded-xl border border-line p-4">{content}
          <p className="mt-3 text-sm text-muted">{event.publication_status === 'pending' || event.publication_status === 'sending' ? 'Карточка ещё публикуется. Ссылка появится после отправки.' : 'Ссылка на сообщение пока недоступна.'}</p>
        </div>}
      </li>;
    })}</ul>
  </Modal>;
}
