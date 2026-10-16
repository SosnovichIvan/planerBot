import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, loadChats } from '../../shared/api';
import { creationTarget, initData } from '../../shared/telegram';
import { eventDayCounts, eventsOnDate, monthDays, monthRange, shiftMonth } from './model/month';
import type { CalendarEvent } from '../../shared/api';
import { EventsPanel } from './ui/events-panel';
import { SettingsForm } from './ui/settings-form';
import { DayEvents } from './ui/day-events';

type Chats = Awaited<ReturnType<typeof loadChats>>;
type LoadState = { kind: 'loading' } | { kind: 'ready'; chats: Chats } | { kind: 'error'; status: number };

export function CalendarPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [month, setMonth] = useState(() => shiftMonth(new Date(), 0));
  const [selectedChat, setSelectedChat] = useState('all');
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [creationConsumed, setCreationConsumed] = useState(false);
  const [eventState, setEventState] = useState<{ scope: string; events: CalendarEvent[]; more: boolean }>({ scope: '', events: [], more: false });
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const raw = initData();
  const eventsScope = `${raw}:${monthRange(month).start}:${selectedChat}`;
  const recordEvents = useCallback((events: CalendarEvent[], more = false) => setEventState({ scope: eventsScope, events, more }), [eventsScope]);
  const monthEvents = eventState.scope === eventsScope && state.kind === 'ready' ? eventState.events : [];
  const counts = eventDayCounts(monthEvents, month);
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

  return (
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <a className="flex items-center gap-3 font-bold tracking-tight" href="/" aria-label="planerBot — главная">
          <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-accent text-lg text-white">p.</span>
          planerBot
        </a>
        <div ref={setToolbarTarget} />
      </header>
      <h1 className="sr-only">Календарь</h1>

      {!raw ? (
        <section className="panel" aria-labelledby="open-title">
          <h2 id="open-title" className="text-lg font-semibold">Откройте календарь через Telegram</h2>
          <p className="mt-3 text-sm leading-6 text-muted">Отправьте /calendar в подключённом чате и нажмите «Открыть мой календарь».</p>
        </section>
      ) : state.kind === 'loading' ? (
        <section className="panel" role="status"><p>Проверяем доступ к вашим чатам…</p></section>
      ) : state.kind === 'error' ? (
        <section className="panel" role="alert">
          <h2 className="font-semibold">{state.status === 401 ? 'Откройте календарь заново' : 'Не удалось проверить доступ'}</h2>
          <p className="mt-2 text-sm text-muted">{state.status === 401 ? 'Сессия истекла. Вернитесь в чат и нажмите кнопку календаря.' : 'Данные чатов скрыты. Проверьте соединение и попробуйте ещё раз.'}</p>
          {state.status !== 401 && <button className="button mt-5" onClick={retry}>Попробовать снова</button>}
        </section>
      ) : (
        <div>
          <label className="form-label mb-5">Чат
            <select className="field" value={selectedChat} disabled={chats.length === 0} onChange={(event) => { setSelectedDay(null); setSelectedChat(event.target.value); }}>
              <option value="all">Все чаты</option>
              {chats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title}</option>)}
            </select>
          </label>
          {chats.length === 0 && <p className="mb-5 text-sm text-muted">Доступных чатов пока нет. Добавьте бота в чат и назначьте администратором.</p>}
          <section className="panel" aria-label="Календарь месяца">
            <div className="mb-6 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold capitalize" aria-live="polite">{title}</h2>
              <div className="flex gap-1">
                <button className="icon-button" aria-label="Предыдущий месяц" onClick={() => { setSelectedDay(null); setMonth(shiftMonth(month, -1)); }}>‹</button>
                <button className="icon-button" aria-label="Следующий месяц" onClick={() => { setSelectedDay(null); setMonth(shiftMonth(month, 1)); }}>›</button>
              </div>
            </div>
            <table className="w-full table-fixed text-center text-sm" aria-label={title}>
              <thead><tr>{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <th key={day} className="pb-3 text-xs font-medium text-muted" scope="col">{day}</th>)}</tr></thead>
              <tbody>{Array.from({ length: Math.ceil(monthDays(month).length / 7) }, (_, week) => (
                <tr key={week}>{Array.from({ length: 7 }, (_, weekday) => {
                  const day = monthDays(month)[week * 7 + weekday];
                  return <td key={weekday} className="h-11 sm:h-12">{day && counts[day] > 0 ?
                    <button className="relative flex h-11 w-full cursor-pointer items-center justify-center rounded-xl hover:bg-canvas" aria-label={`${day}, событий: ${counts[day]}`} onClick={() => setSelectedDay(day)}>{day}<span className="absolute bottom-1 size-1.5 rounded-full bg-accent" aria-hidden="true" /></button>
                    : <span className="inline-flex size-9 items-center justify-center">{day}</span>}</td>;
                })}</tr>
              ))}</tbody>
            </table>
          </section>
        </div>
      )}
      {raw && state.kind === 'ready' && <>
        {selectedDate && <DayEvents date={selectedDate} events={eventsOnDate(monthEvents, selectedDate)} incomplete={eventState.more} onClose={() => setSelectedDay(null)} />}
        <EventsPanel chats={chats} raw={raw} month={month} selectedChat={selectedChat} toolbarTarget={toolbarTarget} initialCreation={intent} onCreationHandled={() => setCreationConsumed(true)} onLoaded={recordEvents} onCreated={(event) => { setMonth(shiftMonth(new Date(`${event.data.start_date}T12:00:00`), 0)); setSelectedChat(event.chat_id); }} />
        {visibleChats.filter((chat) => chat.can_manage).map((chat) => <section className="panel mt-6" key={chat.id} aria-label={`Настройки: ${chat.title}`}>
          <h2 className="text-sm font-semibold">{chat.title}</h2>
          <SettingsForm chat={chat} raw={raw} onSaved={retry} />
        </section>)}
      </>}
      <footer className="mt-8 text-xs leading-5 text-muted">Доступ проверяется через Telegram при каждом открытии календаря.</footer>
    </main>
  );
}
