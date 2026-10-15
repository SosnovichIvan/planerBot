import { useEffect, useState } from 'react';
import { errorText, eventAction, loadEvents } from '../../../shared/api';
import type { CalendarEvent, Chat } from '../../../shared/api';
import { EventForm } from './event-form';
import { monthRange } from '../model/month';

type State = { kind: 'loading' } | { kind: 'error'; error: string } |
  { kind: 'ready'; events: CalendarEvent[]; more: boolean };

const publicationLabels: Record<string, string> = {
  pending: 'Ожидает публикации', sending: 'Отправляется в Telegram', published: 'Опубликовано',
  failed: 'Не удалось опубликовать', unknown: 'Результат отправки неизвестен',
};

export function EventsPanel({ chats, raw, month, selectedChat, onCreated, onLoaded }: { chats: Chat[]; raw: string; month: Date; selectedChat: string; onCreated?: (event: CalendarEvent) => void; onLoaded?: (events: CalendarEvent[]) => void }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [editor, setEditor] = useState<CalendarEvent | 'new' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [topic, setTopic] = useState('all');
  const [tag, setTag] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const { start, end } = monthRange(month);
  const queryKey = `${start}:${selectedChat}:${topic}:${tag}:${attempt}`;
  const [loadedKey, setLoadedKey] = useState('');
  const selected = chats.find((chat) => chat.id === selectedChat);

  useEffect(() => {
    if (state.kind === 'ready' && state.events.some((event) => ['pending', 'sending'].includes(event.publication_status ?? ''))) {
      const timer = window.setTimeout(() => setAttempt((value) => value + 1), 3000);
      return () => window.clearTimeout(timer);
    }
  }, [state]);

  useEffect(() => {
    const controller = new AbortController();
    onLoaded?.([]);
    loadEvents(raw, controller.signal, { start, end,
      chat_id: selectedChat === 'all' ? undefined : Number(selectedChat),
      topic_id: topic === 'all' ? undefined : Number(topic), tag: tag || undefined,
    }).then((data) => {
      if (!controller.signal.aborted) { setState({ kind: 'ready', events: data.events, more: data.has_more }); setLoadedKey(queryKey); onLoaded?.(data.events); }
    }, (error: unknown) => {
      if (!controller.signal.aborted) { setState({ kind: 'error', error: errorText(error) }); setLoadedKey(queryKey); }
    });
    return () => controller.abort();
  }, [raw, start, end, selectedChat, topic, tag, queryKey, onLoaded]);

  const current = loadedKey === queryKey ? state : { kind: 'loading' as const };
  const refresh = () => setAttempt((value) => value + 1);
  async function action(event: CalendarEvent, name: 'approve' | 'cancel' | 'retry') {
    if (busy) return;
    if (name === 'cancel' && !window.confirm(`Отменить событие «${event.data.title}»? Карточка будет помечена отменённой.`)) return;
    const unknown = name === 'retry' && event.publication_status === 'unknown';
    if (unknown && !window.confirm('Сообщение могло быть отправлено. Повтор может создать дубликат. Продолжить?')) return;
    setBusy(true); setActionError('');
    try { await eventAction(raw, event, name, unknown); refresh(); }
    catch (cause) { setActionError(errorText(cause)); }
    finally { setBusy(false); }
  }

  return <section className="mt-6" aria-labelledby="events-title">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h2 id="events-title" className="text-xl font-semibold">События месяца</h2>
      <button className="secondary-button" onClick={refresh}>Обновить события</button>
      {chats.some((chat) => chat.can_manage) && <button className="button" onClick={() => { setEditor('new'); setNotice(''); }}>Создать событие</button>}
    </div>
    <div className="mb-5 grid gap-3 sm:grid-cols-2">
      {selected && <label className="form-label">Тема событий<select className="field" value={topic} onChange={(e) => setTopic(e.target.value)}><option value="all">Все темы</option>{selected.topics.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
      <label className="form-label">Фильтр по тегу<input className="field" value={tag} maxLength={33} placeholder="#встреча" onChange={(e) => setTag(e.target.value)} /></label>
    </div>
    {notice && <p className="mb-4 text-sm" role="status">{notice}</p>}
    {actionError && <p className="mb-4 text-sm" role="alert">{actionError}</p>}
    {editor && <EventForm key={editor === 'new' ? 'new' : editor.id} chats={chats} raw={raw} initialChatId={selectedChat} event={editor === 'new' ? undefined : editor}
      onClose={() => setEditor(null)} onSaved={(saved) => { setEditor(null); setNotice(`Событие сохранено на ${saved.data.start_date}. Статус публикации указан в карточке.`); refresh(); onCreated?.(saved); }} />}
    {current.kind === 'loading' ? <p role="status" className="panel mt-5">Загружаем события…</p> : current.kind === 'error' ? <div className="panel mt-5" role="alert"><p>{current.error}</p></div> : <>
      {current.events.length === 0 && <p className="panel mt-5 text-sm text-muted">В выбранном периоде и фильтрах событий нет.</p>}
      {current.more && <p role="status" className="my-3 text-sm">Показаны первые 200 событий. Выберите чат, тему или тег, чтобы сузить список.</p>}
      <ul className="mt-5 space-y-4">{current.events.map((event) => <li className="panel" key={event.id}>
        <p className="mb-2 text-xs text-muted">{event.chat_title} · {event.topic_title}</p>
        <h3 className="break-words text-lg font-semibold">{event.data.title}</h3>
        <p className="mt-2 text-sm">{event.data.start_date} · {event.data.start_time ?? 'Весь день'}{event.data.end_time && ` — ${event.data.end_date ?? event.data.start_date} ${event.data.end_time}`} · {event.timezone}</p>
        <p className="mt-2 text-sm">{event.data.place_pending ? 'Место уточняется' : [event.data.place, event.data.address].filter(Boolean).join(', ')}</p>
        {event.data.map_url && <a className="mt-2 block text-sm underline" href={event.data.map_url} target="_blank" rel="noreferrer">Открыть карту</a>}
        {event.data.online_url && <a className="mt-2 block text-sm underline" href={event.data.online_url} target="_blank" rel="noreferrer">Подключиться онлайн</a>}
        {event.message_url && <a className="mt-2 block text-sm underline" href={event.message_url} target="_blank" rel="noreferrer">Открыть сообщение в Telegram</a>}
        {event.data.description && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted">{event.data.description}</p>}
        {event.data.tags?.length ? <p className="mt-2 break-words text-xs text-muted">{event.data.tags.join(' ')}</p> : null}
        <p className="mt-3 text-xs font-medium">{event.status === 'pending' ? 'Ожидает подтверждения' : event.status === 'cancelled' ? 'Отменено' : 'Запланировано'}{event.publication_status && ` · ${publicationLabels[event.publication_status]}`}</p>
        {event.can_manage && <div className="mt-4 flex flex-wrap gap-2">
          {event.status !== 'cancelled' && <><button className="secondary-button" disabled={busy} onClick={() => setEditor(event)}>Изменить</button><button className="secondary-button" disabled={busy} onClick={() => void action(event, 'cancel')}>Отменить событие</button></>}
          {event.status === 'pending' && <button className="secondary-button" disabled={busy} onClick={() => void action(event, 'approve')}>Подтвердить событие</button>}
          {['failed', 'unknown'].includes(event.publication_status ?? '') && <button className="secondary-button" disabled={busy} onClick={() => void action(event, 'retry')}>{event.publication_status === 'unknown' ? 'Повторить с риском дубликата' : 'Повторить публикацию'}</button>}
        </div>}
      </li>)}</ul>
    </>}
  </section>;
}
