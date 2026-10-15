import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, loadChats } from '../../shared/api';
import { initData } from '../../shared/telegram';
import { eventDayCounts, monthDays, shiftMonth } from './model/month';
import type { CalendarEvent } from '../../shared/api';
import { EventsPanel } from './ui/events-panel';
import { SettingsForm } from './ui/settings-form';

type Chats = Awaited<ReturnType<typeof loadChats>>;
type LoadState = { kind: 'loading' } | { kind: 'ready'; chats: Chats } | { kind: 'error'; status: number };

export function CalendarPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [month, setMonth] = useState(() => shiftMonth(new Date(), 0));
  const [selectedChat, setSelectedChat] = useState('all');
  const [counts, setCounts] = useState<Record<number, number>>({});
  const recordEvents = useCallback((events: CalendarEvent[]) => setCounts(eventDayCounts(events, month)), [month]);
  const raw = initData();

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
      <header className="mb-10 flex items-center justify-between gap-4">
        <a className="flex items-center gap-3 font-bold tracking-tight" href="/" aria-label="planerBot — главная">
          <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-accent text-lg text-white">p.</span>
          planerBot
        </a>
        <span className="rounded-full border border-line px-3 py-1.5 text-xs text-muted">Личный календарь</span>
      </header>
      <div className="mb-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted">Ваше время, вместе</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Мой календарь</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-muted">Все ваши встречи в одном месте. Только из чатов, в которых вы состоите.</p>
      </div>

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
        <div className="grid items-start gap-6 md:grid-cols-[1fr_280px]">
          <section className="panel" aria-label="Календарь месяца">
            <div className="mb-6 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold capitalize" aria-live="polite">{title}</h2>
              <div className="flex gap-1">
                <button className="icon-button" aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
                <button className="icon-button" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
              </div>
            </div>
            <table className="w-full table-fixed text-center text-sm" aria-label={title}>
              <thead><tr>{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <th key={day} className="pb-3 text-xs font-medium text-muted" scope="col">{day}</th>)}</tr></thead>
              <tbody>{Array.from({ length: Math.ceil(monthDays(month).length / 7) }, (_, week) => (
                <tr key={week}>{Array.from({ length: 7 }, (_, weekday) => {
                  const day = monthDays(month)[week * 7 + weekday];
                  return <td key={weekday} className="h-11 sm:h-12"><span className="relative inline-flex size-9 items-center justify-center" aria-label={day && counts[day] ? `${day}, событий: ${counts[day]}` : undefined} title={day && counts[day] ? `Событий: ${counts[day]}` : undefined}>{day}{day && counts[day] > 0 ? <span className="absolute bottom-0 size-1.5 rounded-full bg-accent" aria-hidden="true" /> : null}</span></td>;
                })}</tr>
              ))}</tbody>
            </table>
            <div className="mt-5 border-t border-line pt-5">
              <p className="text-sm leading-6 text-muted">События выбранного месяца — под календарём. Место и время указаны в каждой карточке.</p>
            </div>
          </section>
          <aside className="panel" aria-labelledby="chats-title">
            <h2 id="chats-title" className="mb-4 font-semibold">Подключённые чаты</h2>
            {chats.length === 0 ? <p className="text-sm leading-6 text-muted">Доступных чатов пока нет. Попросите администратора выполнить /setup в нужной теме.</p> : <>
              <label className="mb-2 block text-xs text-muted" htmlFor="chat-filter">Показать чат</label>
              <select id="chat-filter" className="mb-5 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm" value={selectedChat} onChange={(event) => setSelectedChat(event.target.value)}>
                <option value="all">Все мои чаты</option>
                {chats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title}</option>)}
              </select>
              <ul className="space-y-5">{visibleChats.map((chat) => <li key={chat.id}>
                <p className="break-words text-sm font-semibold">{chat.title}</p>
                <p className="mt-1 text-xs text-muted">{chat.can_manage ? 'Вы администратор' : 'Вы участник'}</p>
                <ul className="mt-2 space-y-1">{chat.topics.map((topic) => <li className="break-words text-sm text-muted" key={topic.id}># {topic.title}</li>)}</ul>
                {chat.can_manage && <SettingsForm chat={chat} raw={raw} onSaved={retry} />}
              </li>)}</ul>
            </>}
          </aside>
        </div>
      )}
      {raw && state.kind === 'ready' && <EventsPanel key={selectedChat} chats={chats} raw={raw} month={month} selectedChat={selectedChat} onLoaded={recordEvents} onCreated={(event) => { setMonth(shiftMonth(new Date(`${event.data.start_date}T12:00:00`), 0)); setSelectedChat(event.chat_id); }} />}
      <footer className="mt-8 text-xs leading-5 text-muted">Доступ проверяется через Telegram при каждом открытии календаря.</footer>
    </main>
  );
}
