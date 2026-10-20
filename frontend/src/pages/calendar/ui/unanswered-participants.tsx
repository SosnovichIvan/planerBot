import { useEffect, useState } from 'react';
import { errorText, loadUnanswered } from '../../../shared/api';
import type { UnansweredPage } from '../../../shared/api';
import { Button } from '../../../shared/ui/button';
import { Modal } from '../../../shared/ui/modal';

type State = { kind: 'loading' } | { kind: 'error'; scope: string; message: string } | { kind: 'ready'; scope: string; page: UnansweredPage };

export function UnansweredParticipants({ raw, chatId, eventId, onClose }: {
  raw: string; chatId: string; eventId: string; onClose: () => void;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [cursor, setCursor] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const scope = `${raw}:${chatId}:${eventId}`;
  const current: State = state.kind !== 'loading' && state.scope !== scope ? { kind: 'loading' } : state;
  useEffect(() => {
    const controller = new AbortController();
    loadUnanswered(raw, chatId, eventId, cursor, controller.signal).then(
      page => { if (!controller.signal.aborted) setState({ kind: 'ready', scope, page }); },
      (cause: unknown) => { if (!controller.signal.aborted) setState({ kind: 'error', scope, message: errorText(cause) }); },
    );
    return () => controller.abort();
  }, [raw, chatId, eventId, cursor, attempt, scope]);
  return <Modal title="Не проголосовали" onClose={onClose} closeLabel="Закрыть список участников" fullHeight>
    <div className="min-h-0 w-full overflow-y-auto overscroll-contain pb-6">
    <p className="mt-4 text-sm text-muted">Известные боту участники календаря, которые сейчас состоят в чате. Это не полный состав Telegram-чата. Список обновляется при открытии.</p>
    {current.kind === 'loading' && <p className="mt-4" role="status">Загружаем участников…</p>}
    {current.kind === 'error' && <div className="mt-4" role="alert"><p>{current.message}</p><Button className="mt-3" onClick={() => { setState({ kind: 'loading' }); setAttempt(value => value + 1); }}>Повторить загрузку списка</Button></div>}
    {current.kind === 'ready' && <>
      {!current.page.participants.length ? <p className="mt-4">На этой странице нет непроголосовавших участников.</p> :
        <ul className="mt-4 space-y-2" aria-label="Не проголосовавшие участники">{current.page.participants.map(person => <li key={person.user_id} className="rounded-xl border border-line bg-canvas p-3">
          <p className="break-words font-medium">{person.name}</p><p className="mt-1 text-xs text-muted">Telegram ID: {person.user_id}</p>
        </li>)}</ul>}
      <div className="mt-5 flex flex-wrap gap-2">
        {cursor && <Button onClick={() => { setState({ kind: 'loading' }); setCursor(undefined); }}>В начало списка</Button>}
        {current.page.next_cursor && <Button onClick={() => { setState({ kind: 'loading' }); setCursor(current.page.next_cursor ?? undefined); }}>Следующая страница</Button>}
      </div>
    </>}
    </div>
  </Modal>;
}
