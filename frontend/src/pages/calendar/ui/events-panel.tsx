import { Panel } from '../../../shared/ui/panel';
import { Button, IconButton } from '../../../shared/ui/button';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { errorText, eventAction, loadEvents } from '../../../shared/api';
import type { CalendarEvent, Chat } from '../../../shared/api';
import { EventForm } from './event-form';
import { monthRange } from '../model/month';
import { formatDate } from '../../../shared/lib/date';
import { Icon } from '../../../shared/ui/icon';
import { Badge } from '../../../shared/ui/badge';
import { RemovalTasks } from './removal-tasks';

type State = { kind: 'loading' } | { kind: 'error'; error: string } |
  { kind: 'ready'; events: CalendarEvent[]; more: boolean; removals: CalendarEvent[]; moreRemovals: boolean };

const publicationLabels: Record<string, string> = {
  pending: 'Ожидает публикации', sending: 'Отправляется в Telegram', published: 'Опубликовано',
  failed: 'Не удалось опубликовать', unknown: 'Результат отправки неизвестен',
};

export function EventsPanel({ chats, raw, month, selectedChat, onCreated, onLoaded, toolbarTarget, initialCreation, onCreationHandled, onOpen, revision = 0 }: { chats: Chat[]; raw: string; month: Date; selectedChat: string; onCreated?: (event: CalendarEvent) => void; onLoaded?: (events: CalendarEvent[], more?: boolean) => void; toolbarTarget?: HTMLElement | null; initialCreation?: { chatId?: string; topicId?: string } | null; onCreationHandled?: () => void; onOpen?: (event: CalendarEvent) => void; revision?: number }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const allowedCreation = !!initialCreation && chats.some((chat) => chat.can_manage && (!initialCreation.chatId || chat.id === initialCreation.chatId));
  const [editor, setEditor] = useState<CalendarEvent | 'new' | null>(() => allowedCreation ? 'new' : null);
  const [attempt, setAttempt] = useState(0);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const [notice, setNotice] = useState('');
  const { start, end } = monthRange(month);
  const queryKey = `${start}:${selectedChat}:${attempt}:${revision}`;
  const [loadedKey, setLoadedKey] = useState('');

  useEffect(() => {
    if (state.kind === 'ready' && [...state.events, ...state.removals].some((event) => ['pending', 'sending'].includes(event.publication_status ?? ''))) {
      const timer = window.setTimeout(() => setAttempt((value) => value + 1), 3000);
      return () => window.clearTimeout(timer);
    }
  }, [state]);

  useEffect(() => {
    const controller = new AbortController();
    loadEvents(raw, controller.signal, { start, end,
      chat_id: selectedChat === 'all' ? undefined : Number(selectedChat),
    }).then((data) => {
      if (!controller.signal.aborted) {
        const events = data.events.filter(event => event.status !== 'cancelled');
        const removals = (data.removals ?? []).filter(event => event.can_manage);
        setState({ kind: 'ready', events, more: data.has_more, removals, moreRemovals: data.has_more_removals ?? false });
        setLoadedKey(queryKey); onLoaded?.(events, data.has_more);
      }
    }, (error: unknown) => {
      if (!controller.signal.aborted) { setState({ kind: 'error', error: errorText(error) }); setLoadedKey(queryKey); onLoaded?.([]); }
    });
    return () => controller.abort();
  }, [raw, start, end, selectedChat, queryKey, onLoaded]);

  const current = loadedKey === queryKey ? state : { kind: 'loading' as const };
  const refresh = () => setAttempt((value) => value + 1);
  async function action(event: CalendarEvent, name: 'approve' | 'cancel' | 'retry') {
    if (actionLock.current) return;
    if (name === 'cancel' && !window.confirm(`Удалить событие «${event.data.title}» из календаря и его сообщение в Telegram? История и ответы сохранятся. Telegram может отказать в удалении старого сообщения.`)) return;
    const unknown = name === 'retry' && event.publication_status === 'unknown';
    if (unknown && !window.confirm(event.status === 'cancelled' ? 'Повторить удаление сообщения? Если оно уже удалено, повтор не создаст новое.' : 'Сообщение могло быть отправлено. Повтор может создать дубликат. Продолжить?')) return;
    actionLock.current = true; setBusy(true); setActionError('');
    try {
      await eventAction(raw, event, name, unknown);
      if (name === 'cancel' && state.kind === 'ready') {
        const events = state.events.filter(item => item.id !== event.id);
        onLoaded?.(events, state.more);
        setNotice('Событие убрано из календаря. Удаление сообщения поставлено в очередь; его статус показан отдельно.');
      }
      refresh();
    }
    catch (cause) { setActionError(errorText(cause)); }
    finally { actionLock.current = false; setBusy(false); }
  }

  const toolbar = <div className="flex flex-wrap items-center gap-2" aria-label="Действия календаря">
      {chats.some((chat) => chat.can_manage) && <Button variant="primary" onClick={() => { onCreationHandled?.(); setEditor('new'); setNotice(''); }}>Создать событие</Button>}
      <IconButton aria-label="Обновить события" onClick={refresh}><Icon name="refresh" /></IconButton>
    </div>;

  return <section className="min-w-0 lg:pt-20" aria-labelledby="events-title">
    {toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar}
    <h2 id="events-title" className="mb-4 text-xl font-semibold">Повестка</h2>
    {initialCreation && !allowedCreation && <Panel as="p" className="mb-4 text-sm" role="alert">Для создания события нужны права администратора выбранного чата.</Panel>}
    {notice && <p className="mb-4 text-sm" role="status">{notice}</p>}
    {actionError && <p className="mb-4 text-sm" role="alert">{actionError}</p>}
    {editor && <EventForm key={editor === 'new' ? 'new' : editor.id} chats={chats} raw={raw} initialChatId={initialCreation?.chatId ?? selectedChat} initialTopicId={initialCreation?.topicId} event={editor === 'new' ? undefined : editor}
      onClose={() => { setEditor(null); onCreationHandled?.(); }} onSaved={(saved, message) => { setEditor(null); onCreationHandled?.(); setNotice(message ?? `Событие сохранено на ${saved.data.start_date}. Статус публикации указан в карточке.`); refresh(); onCreated?.(saved); }} />}
    {current.kind === 'loading' ? <Panel as="p" role="status" className="mt-5">Загружаем события…</Panel> : current.kind === 'error' ? <Panel as="div" className="mt-5" role="alert"><p>{current.error}</p></Panel> : <>
      {current.events.length === 0 && <Panel as="p" className="mt-5 text-sm text-muted">В выбранном периоде событий нет.</Panel>}
      {current.more && <p role="status" className="my-3 text-sm">Показаны первые 200 событий. Выберите конкретный чат, чтобы сузить список.</p>}
      <ul className="space-y-3">{current.events.map((event) => <li className="rounded-2xl border border-line bg-surface p-4" key={event.id}>
        <p className="mb-2 text-xs text-muted">{event.chat_title} · {event.topic_title}</p>
        <h3 className="break-words text-lg font-semibold">{event.data.title}</h3>
        {event.has_updates && <Badge className="mt-2">Обновлено</Badge>}
        {event.status === 'active' && (event.my_response ?? 'unanswered') === 'unanswered' && <p className="mt-2 text-sm font-semibold text-attention">Нужен ваш ответ</p>}
        {onOpen && <Button variant="secondary" className="mt-3" onClick={() => onOpen(event)}>Открыть событие</Button>}
        <p className="mt-2 text-sm">{formatDate(event.data.start_date)} · {event.data.start_time ?? 'Весь день'}{event.data.end_time && ` — ${event.data.end_date && event.data.end_date !== event.data.start_date ? formatDate(event.data.end_date) + ' ' : ''}${event.data.end_time}`} · {event.timezone}</p>
        <p className="mt-2 text-sm">{event.data.place_pending ? 'Место уточняется' : [event.data.place, event.data.address].filter(Boolean).join(', ')}</p>
        <p className="mt-3 text-xs font-medium">{event.status === 'pending' ? 'Ожидает подтверждения' : event.status === 'cancelled' ? 'Отменено' : 'Запланировано'}{event.publication_status && ` · ${publicationLabels[event.publication_status]}`}</p>
        {event.can_manage && <div className="mt-4 flex flex-wrap gap-2">
          {event.status !== 'cancelled' && <><Button disabled={busy} onClick={() => setEditor(event)}>Изменить</Button><Button variant="danger" disabled={busy} onClick={() => void action(event, 'cancel')}>Удалить событие</Button></>}
          {event.status === 'pending' && <Button variant="secondary" disabled={busy} onClick={() => void action(event, 'approve')}>Подтвердить событие</Button>}
          {['failed', 'unknown'].includes(event.publication_status ?? '') && <Button variant="secondary" disabled={busy} onClick={() => void action(event, 'retry')}>{event.publication_status === 'unknown' ? 'Повторить с риском дубликата' : 'Повторить публикацию'}</Button>}
        </div>}
      </li>)}</ul>
      <RemovalTasks events={current.removals} more={current.moreRemovals} busy={busy} onRetry={event => void action(event, 'retry')} />
    </>}
  </section>;
}
