import { Field, TextArea } from '../../../shared/ui/field';
import { Button } from '../../../shared/ui/button';
import { useEffect, useRef, useState } from 'react';
import { ApiFailure, disablePersonalMessages, errorText, eventAction, loadEventDetails, respondEvent, sendCampaign } from '../../../shared/api';
import type { Answer, Campaign, Chat, EventDetails as Details } from '../../../shared/api';
import { requestPersonalMessages, openTelegramMessage } from '../../../shared/telegram';
import { Modal } from '../../../shared/ui/modal';
import { EventForm } from './event-form';
import { formatDate } from '../../../shared/lib/date';
import { revealControl } from '../../../shared/lib/scroll';
import { TextLink } from '../../../shared/ui/text-link';
import { CampaignDelivery } from './campaign-delivery';
import { UnansweredParticipants } from './unanswered-participants';

const labels: Record<Answer, string> = { yes: 'Приду', no: 'Не приду', unanswered: 'Не проголосовали' };
type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: Details };

export function EventDetails({ raw, chatId, eventId, onClose, onChanged, chats = [] }: { raw: string; chatId: string; eventId: string; onClose: () => void; onChanged: () => void; chats?: Chat[] }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [editing, setEditing] = useState(false);
  const [showUnanswered, setShowUnanswered] = useState(false);
  const [audience, setAudience] = useState<Answer | null>(null);
  const [text, setText] = useState('');
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const submitted = useRef<{ key: string; audience: Answer; text: string } | null>(null);
  useEffect(() => {
    for (const element of [notice ? noticeRef.current : null, error ? errorRef.current : null]) {
      const container = element?.closest<HTMLElement>('.event-form-body, .modal-body');
      if (element && container) revealControl(element, container);
    }
  }, [notice, error, audience]);

  useEffect(() => {
    const controller = new AbortController();
    loadEventDetails(raw, chatId, eventId, controller.signal).then(
      (data) => { if (!controller.signal.aborted) { setState({ kind: 'ready', data }); onChanged(); } },
      (cause: unknown) => { if (!controller.signal.aborted) setState({ kind: 'error', message: errorText(cause) }); },
    );
    return () => controller.abort();
  }, [raw, chatId, eventId, attempt, onChanged]);

  async function act(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(errorText(cause)); }
    finally { lock.current = false; setBusy(false); }
  }

  const data = state.kind === 'ready' ? state.data : null;
  const event = data?.event;
  function closeCampaign() {
    if (lock.current) return;
    if (uncertain ? !window.confirm('Рассылка могла быть создана. Закрыть без проверки? Повторное создание может отправить сообщения ещё раз.')
      : text.trim() && !window.confirm('Закрыть форму и потерять несохранённое сообщение?')) return;
    setAudience(null); setText(''); setUncertain(false); submitted.current = null; setError('');
  }
  return <Modal title={event?.data.title ?? 'Событие'} busy={busy} onClose={() => { if (!lock.current && (!uncertain || window.confirm('Рассылка могла быть создана. Закрыть без проверки? Повторное создание может отправить сообщения ещё раз.'))) onClose(); }}>
    {state.kind === 'loading' && <p className="mt-5" role="status">Загружаем событие…</p>}
    {state.kind === 'error' && <div className="mt-5" role="alert"><p>{state.message}</p><Button variant="secondary" className="mt-3" onClick={() => { setState({ kind: 'loading' }); setAttempt((value) => value + 1); }}>Повторить загрузку</Button></div>}
    {event && data && <>
      <p className="mt-4 text-sm text-muted">{event.chat_title} · {event.topic_title}</p>
      <p className="mt-3">{formatDate(event.data.start_date)} · {event.data.start_time ?? 'Весь день'} · {event.timezone}</p>
      <p className="mt-3 break-words">{[event.data.place, event.data.address].filter(Boolean).join(', ')}</p>
      {event.data.description && <p className="mt-3 whitespace-pre-wrap break-words">{event.data.description}</p>}
      {!!event.data.tags?.length && <p className="mt-3 break-words text-xs text-muted">{event.data.tags.join(' ')}</p>}
      {!!event.changes?.length && <section className="mt-5 rounded-xl border border-accent bg-accent/10 p-4" aria-label="Что изменилось">
        <h3 className="font-semibold">Что изменилось</h3>
        <dl className="mt-3 space-y-3">{event.changes.map((change) => <div key={change.field} className="break-words text-sm">
          <dt className="text-muted">{({ title: 'Название', start_date: 'Дата начала', start_time: 'Время начала', end_date: 'Дата окончания', end_time: 'Время окончания', place: 'Место', address: 'Адрес', description: 'Описание', online_url: 'Ссылка подключения', map_url: 'Карта', meeting_format: 'Формат', tags: 'Теги' } as Record<string, string>)[change.field] ?? change.field}</dt>
          <dd className="mt-1"><del className="text-muted">{change.before}</del><span aria-label="теперь"> → </span>{change.after}</dd>
        </div>)}</dl>
      </section>}
      {event.data.online_url && <TextLink className="mt-3" href={event.data.online_url} target="_blank" rel="noreferrer">Подключиться онлайн</TextLink>}
      {event.data.map_url && <TextLink className="mt-3" href={event.data.map_url} target="_blank" rel="noreferrer">Открыть карту</TextLink>}
      {event.message_url && <TextLink className="mt-3" href={event.message_url} onClick={(e) => { if (openTelegramMessage(event.message_url!)) e.preventDefault(); }}>Сообщение в Telegram</TextLink>}
      {event.can_manage && event.status !== 'cancelled' && <div className="mt-4 flex flex-wrap gap-2">
      {chats.some((chat) => chat.id === event.chat_id && chat.can_manage) && <Button onClick={() => setEditing(true)}>Редактировать</Button>}
      <Button variant="danger" disabled={busy} onClick={() => {
        if (!window.confirm(`Удалить событие «${event.data.title}» из календаря и его сообщение в Telegram? История и ответы сохранятся. Telegram может отказать в удалении старого сообщения.`)) return;
        void act(async () => { await eventAction(raw, event, 'cancel'); onChanged(); onClose(); });
      }}>Удалить событие</Button></div>}
      {editing && <EventForm raw={raw} chats={chats} event={event} onClose={() => setEditing(false)} onSaved={(saved, message) => {
        setEditing(false); setNotice(message ?? (saved.version === event.version ? 'Нет изменений.' : 'Изменения сохранены. Статус публикации обновится после обработки очереди.')); setAttempt((value) => value + 1); onChanged();
      }} />}
      {event.status === 'active' ? <>
        <p className={`mt-6 font-semibold ${event.my_response === 'unanswered' ? 'text-attention' : ''}`}>{event.my_response === 'unanswered' ? 'Нужен ваш ответ' : `Ваш ответ: ${labels[event.my_response ?? 'unanswered']}`}</p>
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Ваш ответ">
          {(['yes', 'no', 'unanswered'] as const).filter((answer) => answer !== 'unanswered' || event.my_response !== 'unanswered').map((answer) => <Button variant="secondary" key={answer} className="aria-pressed:bg-accent aria-pressed:text-white" aria-pressed={(event.my_response ?? 'unanswered') === answer} disabled={busy || uncertain} onClick={() => void act(async () => {
            const next = await respondEvent(raw, event, answer); setState({ kind: 'ready', data: next }); setAudience(null); setCampaign(null); submitted.current = null; setText(''); onChanged();
          })}>{answer === 'unanswered' ? 'Сбросить ответ' : labels[answer]}</Button>)}
        </div>
      </> : <p className="mt-5 font-semibold">{event.status === 'cancelled' ? 'Событие отменено' : 'Событие ожидает подтверждения'}</p>}
      {!data.counts ? <p className="mt-5 text-sm text-muted">Результаты станут доступны после вашего ответа — это правило действует и для администраторов.</p> : <section className="mt-6" aria-label="Ответы участников календаря">
        <h3 className="font-semibold">Участники календаря</h3>
        <p className="mt-2 text-xs text-muted">Это известные боту участники календаря, а не полный состав Telegram-чата.</p>
        <div className="mt-3 flex flex-wrap gap-2">{(['yes', 'no', 'unanswered'] as const).map((group) => event.can_manage && event.status === 'active' ?
          <Button variant="secondary" key={group} disabled={busy || uncertain} onClick={() => { setAudience(group); setCampaign(null); setNotice(''); }}>{labels[group]}: {data.counts![group]}</Button> :
          <p className="rounded-xl border border-line p-3 text-sm" key={group}>{labels[group]}: {data.counts![group]}</p>)}</div>
      </section>}
      {data.can_view_unanswered && event.status === 'active' && <Button className="mt-4" onClick={() => setShowUnanswered(true)}>Список непроголосовавших</Button>}
      {showUnanswered && data.can_view_unanswered && <UnansweredParticipants key={event.id} raw={raw} chatId={event.chat_id} eventId={event.id} onClose={() => setShowUnanswered(false)} />}
      {audience && event.can_manage && data.counts && <Modal title={`Сообщение: ${labels[audience]}`} closeLabel="Закрыть форму отправки" busy={busy} onClose={closeCampaign} fullHeight>
        <form className="event-form" onSubmit={(e) => { e.preventDefault(); if (lock.current) return;
        if (!submitted.current && !window.confirm(`Отправить личное сообщение группе «${labels[audience]}»? Получат только участники календаря с разрешёнными сообщениями.`)) return;
        void act(async () => {
          submitted.current ??= { key: crypto.randomUUID(), audience, text: text.trim() };
          setUncertain(true);
          const saved = submitted.current;
          try { setCampaign(await sendCampaign(raw, event, saved.audience, saved.text, saved.key)); }
          catch (cause) { if (cause instanceof ApiFailure && cause.status >= 400 && cause.status < 500) { submitted.current = null; setUncertain(false); } throw cause; }
          submitted.current = null; setUncertain(false); setAudience(null); setText(''); setNotice('Рассылка создана. Это ещё не подтверждение доставки.');
        });
      }}>
        <div className="event-form-body">
        <p className="break-words text-sm text-muted">{event.data.title} · {event.chat_title}</p>
        <Field className="mt-3">Текст сообщения<TextArea required maxLength={1500} value={text} disabled={busy || uncertain} onChange={(e) => setText(e.target.value)} /></Field>
        <p className="mt-2 text-xs text-muted">К сообщению добавится ссылка на событие. Сменившие ответ или вышедшие из чата будут пропущены.</p>
        {error && <p ref={errorRef} className="mt-4 text-sm text-attention" role="alert">{error}</p>}
        </div>
        <div className="event-form-footer">
          <Button disabled={busy} onClick={closeCampaign}>Отмена</Button>
          <Button variant="primary" type="submit" disabled={busy || !text.trim()}>{uncertain ? 'Повторить тот же запрос' : 'Отправить группе'}</Button>
        </div>
      </form></Modal>}
      {campaign && notice && <p ref={noticeRef} className="mt-4 rounded-xl border border-line bg-canvas p-3 text-sm" role="status">{notice}</p>}
      {campaign && <CampaignDelivery key={campaign.id} raw={raw} event={event} id={campaign.id} />}
      <section className="mt-6 border-t border-line pt-4 text-sm" aria-label="Личные уведомления">
        <p>{data.personal_messages_enabled ? 'Личные уведомления включены' : 'Для личных уведомлений разрешите сообщения боту. После /stop включите их снова командой /start в личке.'}</p>
        <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void act(async () => {
          if (data.personal_messages_enabled) { await disablePersonalMessages(raw); setState({ kind: 'ready', data: { ...data, personal_messages_enabled: false } }); }
          else { const allowed = await requestPersonalMessages(); setNotice(allowed ? 'Разрешение принято Telegram. Нажмите «Обновить разрешение» или отправьте /start боту в личке.' : 'Разрешение не получено. Можно отправить /start боту в личке.'); }
        })}>{data.personal_messages_enabled ? 'Отключить уведомления' : 'Разрешить сообщения'}</Button>
        {!data.personal_messages_enabled && <Button disabled={busy} onClick={() => void act(async () => { setState({ kind: 'ready', data: await loadEventDetails(raw, chatId, eventId) }); })}>Обновить разрешение</Button>}
        </div>
      </section>
    </>}
    {!audience && error && <p ref={errorRef} className="mt-4 text-sm text-attention" role="alert">{error}</p>}
    {!campaign && notice && <p ref={noticeRef} className="mt-4 rounded-xl border border-line bg-canvas p-3 text-sm" role="status">{notice}</p>}
  </Modal>;
}
