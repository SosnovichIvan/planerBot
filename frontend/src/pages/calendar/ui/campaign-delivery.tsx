import { useEffect, useState } from 'react';
import { campaignStatus, errorText } from '../../../shared/api';
import type { CalendarEvent } from '../../../shared/api';
import { Button } from '../../../shared/ui/button';

const labels: Record<string, string> = { pending: 'В очереди', sending: 'Отправляется', sent: 'Отправлено', skipped: 'Пропущено', failed: 'Ошибка', unknown: 'Доставка неизвестна' };
type State = { kind: 'loading' } | { kind: 'ready'; statuses: Record<string, number> } | { kind: 'error'; message: string };

export function CampaignDelivery({ raw, event, id }: { raw: string; event: CalendarEvent; id: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    async function refresh() {
      try {
        const data = await campaignStatus(raw, event, id, controller.signal);
        if (controller.signal.aborted) return;
        const statuses = data.statuses ?? {};
        setState({ kind: 'ready', statuses });
        if ((statuses.pending ?? 0) + (statuses.sending ?? 0) > 0) timer = window.setTimeout(() => { void refresh(); }, 3000);
      } catch (cause) {
        if (!controller.signal.aborted) setState({ kind: 'error', message: errorText(cause) });
      }
    }
    void refresh();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [raw, event, id, attempt]);
  return <section className="mt-5 text-sm" aria-label="Доставка рассылки">
    <h3 className="font-semibold">Доставка личных сообщений</h3>
    <div className="mt-2 space-y-1" role="status" aria-live="polite" aria-atomic="true">
      {state.kind === 'loading' ? <p>Проверяем доставку…</p> : state.kind === 'error' ? <p>{state.message} Статус недоступен; это не означает отмену рассылки.</p> :
        Object.values(state.statuses).every(count => count === 0) ? <p>В выбранной группе нет получателей. Сообщения не отправлялись.</p> :
          Object.entries(state.statuses).map(([status, count]) => <p key={status}>{labels[status] ?? status}: {count}</p>)}
    </div>
    <Button variant="secondary" className="mt-3" onClick={() => { setState({ kind: 'loading' }); setAttempt(value => value + 1); }}>Проверить доставку</Button>
    <p className="mt-2 text-xs text-muted">Сообщения приходят в личку от бота, не в общий чат. «Отправлено» означает подтверждение Telegram, не прочтение.</p>
    <p className="mt-2 text-xs text-muted">«Пропущено»: нет разрешения, изменился ответ или доступ. Ошибка — проверьте, что участник начал диалог и не заблокировал бота. Неизвестный исход автоматически не повторяется.</p>
  </section>;
}
