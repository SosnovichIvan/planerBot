import { Field } from '../../shared/ui/field';
import { Panel } from '../../shared/ui/panel';
import { Button, IconButton } from '../../shared/ui/button';
import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, loadChats } from '../../shared/api';
import { creationTarget, eventTarget, initData } from '../../shared/telegram';
import { eventDayCounts, eventsOnDate, monthDays, monthRange, shiftMonth } from './model/month';
import type { CalendarEvent } from '../../shared/api';
import { EventsPanel } from './ui/events-panel';
import { SettingsForm } from './ui/settings-form';
import { DayEvents } from './ui/day-events';
import { EventDetails } from './ui/event-details';
import { Select } from '../../shared/ui/select';
import { Modal } from '../../shared/ui/modal';
import { Icon } from '../../shared/ui/icon';

type Chats = Awaited<ReturnType<typeof loadChats>>;
type LoadState = { kind: 'loading' } | { kind: 'ready'; chats: Chats } | { kind: 'error'; status: number };

export function CalendarPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('planerbot-theme') === 'light' ? 'light' : 'dark');
  const [month, setMonth] = useState(() => shiftMonth(new Date(), 0));
  const [selectedChat, setSelectedChat] = useState('all');
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [creationConsumed, setCreationConsumed] = useState(false);
  const [eventState, setEventState] = useState<{ scope: string; events: CalendarEvent[]; more: boolean }>({ scope: '', events: [], more: false });
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedEvent, setSelectedEvent] = useState(() => eventTarget(initData()));
  const raw = initData();
  const eventsScope = `${raw}:${monthRange(month).start}:${selectedChat}`;
  const recordEvents = useCallback((events: CalendarEvent[], more = false) => setEventState({ scope: eventsScope, events, more }), [eventsScope]);
  const refreshEvents = useCallback(() => setAttempt((value) => value + 1), []);
  const monthEvents = eventState.scope === eventsScope && state.kind === 'ready' ? eventState.events : [];
  const counts = eventDayCounts(monthEvents, month);
  const unanswered = eventDayCounts(monthEvents.filter((event) => event.status === 'active' && (event.my_response ?? 'unanswered') === 'unanswered'), month);
  const updated = eventDayCounts(monthEvents.filter((event) => event.has_updates), month);
  const openEvent = (event: CalendarEvent) => { setSelectedEvent({ chatId: event.chat_id, eventId: event.id }); };
  const selectedDate = selectedDay === null ? null : monthRange(month).start.slice(0, 8) + String(selectedDay).padStart(2, '0');
  const intent = creationConsumed ? null : creationTarget(raw);

  useEffect(() => {
    if (!raw) return;
    const controller = new AbortController();
    loadChats(raw, controller.signal).then(
      (chats) => { if (!controller.signal.aborted) setState({ kind: 'ready', chats }); },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ kind: 'error', status: error instanceof ApiFailure ? error.status : 0 });
        }
      },
    );
    return () => { controller.abort(); };
  }, [raw, attempt]);

  const retry = () => { setState({ kind: 'loading' }); setAttempt((value) => value + 1); };
  const chats = state.kind === 'ready' ? state.chats : [];
  const visibleChats = selectedChat === 'all' ? chats : chats.filter((chat) => chat.id === selectedChat);
  const title = month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('planerbot-theme', theme); }, [theme]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-5 [overflow-wrap:anywhere] sm:px-8 sm:py-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <a className="flex items-center gap-3 font-bold tracking-tight" href="/" aria-label="planerBot — главная">
          <span className="text-xl">planer<span className="text-muted">Bot</span></span>
        </a>
        <div className="flex items-center gap-2">
          {chats.some((chat) => chat.can_manage) && <Button variant="secondary" onClick={() => setSettingsOpen(true)}>Настройки</Button>}
          <IconButton aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></IconButton>
        </div>
      </header>
      <div className="mb-5" ref={setToolbarTarget} />
      <h1 className="sr-only">Календарь</h1>
      <div className={raw && state.kind === 'ready' ? 'grid items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]' : undefined}>
      {!raw ? (
        <Panel as="section" aria-labelledby="open-title">
          <h2 id="open-title" className="text-lg font-semibold">Откройте календарь через Telegram</h2>
          <p className="mt-3 text-sm leading-6 text-muted">Отправьте /calendar в подключённом чате и нажмите «Открыть мой календарь».</p>
        </Panel>
      ) : state.kind === 'loading' ? (
        <Panel as="section" role="status"><p>Проверяем доступ к вашим чатам…</p></Panel>
      ) : state.kind === 'error' ? (
        <Panel as="section" role="alert">
          <h2 className="font-semibold">{state.status === 401 ? 'Откройте календарь заново' : 'Не удалось проверить доступ'}</h2>
          <p className="mt-2 text-sm text-muted">{state.status === 401 ? 'Сессия истекла. Вернитесь в чат и нажмите кнопку календаря.' : 'Данные чатов скрыты. Проверьте соединение и попробуйте ещё раз.'}</p>
          {state.status !== 401 && <Button variant="primary" className="mt-5" onClick={retry}>Попробовать снова</Button>}
        </Panel>
      ) : (
        <div>
          <Field className="mb-5">Чат
            <Select label="Чат" value={selectedChat} disabled={chats.length === 0} onChange={(value) => { setSelectedDay(null); setSelectedChat(value); }} options={[{ value: 'all', label: 'Все чаты' }, ...chats.map((chat) => ({ value: chat.id, label: chat.title }))]} />
          </Field>
          {chats.length === 0 && <p className="mb-5 text-sm text-muted">Доступных чатов пока нет. Добавьте бота в чат и назначьте администратором.</p>}
          <Panel as="section" aria-label="Календарь месяца">
            <div className="mb-6 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold capitalize" aria-live="polite">{title}</h2>
              <div className="flex gap-1">
                <IconButton aria-label="Предыдущий месяц" onClick={() => { setSelectedDay(null); setMonth(shiftMonth(month, -1)); }}><Icon name="previous" /></IconButton>
                <IconButton aria-label="Следующий месяц" onClick={() => { setSelectedDay(null); setMonth(shiftMonth(month, 1)); }}><Icon name="next" /></IconButton>
              </div>
            </div>
            <table className="w-full table-fixed text-center text-sm" aria-label={title}>
              <thead><tr>{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <th key={day} className="pb-3 text-xs font-medium text-muted" scope="col">{day}</th>)}</tr></thead>
              <tbody>{Array.from({ length: Math.ceil(monthDays(month).length / 7) }, (_, week) => (
                <tr key={week}>{Array.from({ length: 7 }, (_, weekday) => {
                  const day = monthDays(month)[week * 7 + weekday];
                  return <td key={weekday} className="h-11 overflow-hidden p-0.5 sm:h-16 lg:h-19">{day && counts[day] > 0 ?
                    <Button variant="unstyled" className={`relative flex h-10 w-full min-w-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-accent/15 sm:h-15 lg:h-18 ${unanswered[day] ? 'text-attention' : ''}`} aria-label={`${day}, событий: ${counts[day]}`} aria-description={[unanswered[day] ? 'Нужен ваш ответ' : '', updated[day] ? 'Обновлено' : ''].filter(Boolean).join('. ') || undefined} onClick={() => {
                      const date = monthRange(month).start.slice(0, 8) + String(day).padStart(2, '0');
                      const events = eventsOnDate(monthEvents, date);
                      if (events.length === 1 && !eventState.more) openEvent(events[0]); else setSelectedDay(day);
                    }}>{day}<span className={`absolute bottom-1 right-2 size-1.5 rounded-full ${unanswered[day] ? 'bg-attention' : 'bg-accent'}`} aria-hidden="true" />{updated[day] > 0 && <span className="absolute bottom-1 left-2 size-1.5 rounded-full bg-focus" aria-hidden="true" />}</Button>
                    : <span className="flex h-10 items-center justify-center rounded-lg bg-canvas sm:h-15 lg:h-18">{day}</span>}</td>;
                })}</tr>
              ))}</tbody>
            </table>
            {Object.values(unanswered).some(count => count > 0) && <p className="mt-4 text-xs text-attention">Красным отмечены дни, где нужен ваш ответ.</p>}
          </Panel>
        </div>
      )}
      {raw && state.kind === 'ready' && <>
        {selectedDate && <DayEvents date={selectedDate} events={eventsOnDate(monthEvents, selectedDate)} incomplete={eventState.more} onOpen={openEvent} onClose={() => setSelectedDay(null)} />}
        {selectedEvent && <EventDetails key={`${raw}:${selectedEvent.chatId}:${selectedEvent.eventId}`} chats={chats} raw={raw} {...selectedEvent} onClose={() => setSelectedEvent(null)} onChanged={refreshEvents} />}
        <EventsPanel chats={chats} raw={raw} month={month} selectedChat={selectedChat} toolbarTarget={toolbarTarget} initialCreation={intent} onOpen={openEvent} revision={attempt} onCreationHandled={() => setCreationConsumed(true)} onLoaded={recordEvents} onCreated={(event) => { setMonth(shiftMonth(new Date(`${event.data.start_date}T12:00:00`), 0)); setSelectedChat(event.chat_id); }} />
        {settingsOpen && <Modal title="Настройки чатов" onClose={() => setSettingsOpen(false)}>{visibleChats.filter((chat) => chat.can_manage).map((chat) => <Panel as="section" className="mt-6" key={chat.id} aria-label={`Настройки: ${chat.title}`}>
          <h2 className="text-sm font-semibold">{chat.title}</h2>
          <SettingsForm chat={chat} raw={raw} onSaved={retry} />
        </Panel>)}</Modal>}
      </>}
      </div>
      <footer className="mt-8 text-xs leading-5 text-muted">Доступ проверяется через Telegram при каждом открытии календаря.</footer>
    </main>
  );
}
