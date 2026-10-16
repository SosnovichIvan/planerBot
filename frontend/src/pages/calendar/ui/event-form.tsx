import { useEffect, useId, useRef, useState } from 'react';
import { ApiFailure, createEvent, editEvent, errorText } from '../../../shared/api';
import type { CalendarEvent, Chat, EventDraft } from '../../../shared/api';

export function EventForm({ chats, raw, event, initialChatId, initialTopicId, onSaved, onClose }: {
  chats: Chat[]; raw: string; event?: CalendarEvent;
  initialChatId?: string;
  initialTopicId?: string;
  onSaved: (event: CalendarEvent) => void; onClose: () => void;
}) {
  const manageable = chats.filter((chat) => chat.can_manage);
  const [chatId, setChatId] = useState(event?.chat_id ?? manageable.find((chat) => chat.id === initialChatId)?.id ?? manageable[0].id);
  const chat = manageable.find((item) => item.id === chatId)!;
  const topics = chat.topics.filter((topic) => topic.enabled !== false);
  const [topicId, setTopicId] = useState(event?.data.topic_id.toString() ?? (initialTopicId ? topics.find((topic) => topic.id === initialTopicId)?.id ?? '' : topics[0]?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const dirty = useRef(false);
  const key = useRef(crypto.randomUUID());
  const submitted = useRef<EventDraft | null>(null);
  const data = event?.data;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current!;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    headingRef.current?.focus();
    return () => { dialog.close(); document.body.style.overflow = overflow; };
  }, []);

  function close() {
    if (lock.current) return;
    if ((dirty.current || uncertain) && !window.confirm(uncertain
      ? 'Сохранение могло состояться. После закрытия сначала обновите календарь, чтобы не создать дубликат. Закрыть форму?'
      : 'Закрыть форму и потерять несохранённые изменения?')) return;
    onClose();
  }

  async function submit(form: HTMLFormElement) {
    if (lock.current) return;
    const fields = new FormData(form);
    const value = (name: string) => String(fields.get(name) ?? '').trim();
    const draft: EventDraft = uncertain && submitted.current ? submitted.current : {
      topic_id: Number(topicId), title: value('title'), start_date: value('start_date'),
      start_time: value('start_time') || null, end_date: value('end_date') || null,
      end_time: value('end_time') || null, description: value('description'),
      meeting_format: value('meeting_format') as EventDraft['meeting_format'],
      place: value('place'), address: value('address'), map_url: value('map_url'),
      online_url: value('online_url'), place_pending: fields.has('place_pending'),
      tags: value('tags').split(/\s+/).filter(Boolean),
    };
    submitted.current = draft;
    lock.current = true; setBusy(true); setError('');
    try {
      onSaved(event ? await editEvent(raw, event, draft) : await createEvent(raw, chatId, draft, key.current));
    } catch (cause) {
      setUncertain(!(cause instanceof ApiFailure));
      setError(errorText(cause));
    } finally { lock.current = false; setBusy(false); }
  }

  return <dialog ref={dialogRef} className="event-dialog" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); close(); }}>
    <div className="flex items-start justify-between gap-3">
      <h2 ref={headingRef} tabIndex={-1} id={titleId} className="text-xl font-semibold">{event ? 'Изменить событие' : 'Создать событие'}</h2>
      <button className="secondary-button shrink-0" type="button" disabled={busy} onClick={close} aria-label="Закрыть форму">Закрыть</button>
    </div>
    <p className="mt-2 text-sm text-muted">Время в часовом поясе {event?.timezone ?? chat.timezone ?? 'UTC'}. После сохранения карточка будет отправлена в выбранный чат и тему.</p>
    {!topics.length && <p className="mt-4 text-sm" role="status">Нет доступных тем для публикации. Включите тему в настройках чата и откройте форму заново.</p>}
    {initialTopicId && !topicId && topics.length > 0 && <p className="mt-4 text-sm" role="status">Исходная тема недоступна. Выберите другую включённую тему.</p>}
    <form className="mt-5 space-y-4" onChange={() => { dirty.current = true; }} onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }}>
      <fieldset disabled={busy || uncertain} className="space-y-4 disabled:opacity-70">
        <label className="form-label">Чат<select aria-label="Чат" className="field" value={chatId} disabled={!!event} onChange={(e) => {
          setChatId(e.target.value);
          setTopicId(manageable.find((c) => c.id === e.target.value)!.topics.find((t) => t.enabled !== false)?.id ?? '');
        }}>{manageable.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label className="form-label">Тема<select aria-label="Тема" className="field" value={topicId} required disabled={!!event} onChange={(e) => setTopicId(e.target.value)}>
          <option value="" disabled>Выберите тему</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select></label>
        {event && <p className="text-xs text-muted">Для переноса в другую тему создайте новое событие и отмените прежнее.</p>}
        <label className="form-label">Название<input className="field" name="title" required maxLength={120} defaultValue={data?.title} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="form-label">Дата начала<input className="field" type="date" name="start_date" required defaultValue={data?.start_date} /></label>
          <label className="form-label">Время начала<input className="field" type="time" name="start_time" defaultValue={data?.start_time ?? ''} /></label>
          <label className="form-label">Дата окончания<input className="field" type="date" name="end_date" defaultValue={data?.end_date ?? ''} /></label>
          <label className="form-label">Время окончания<input className="field" type="time" name="end_time" defaultValue={data?.end_time ?? ''} /></label>
        </div>
        <p className="text-xs text-muted">Без времени начала — событие на весь день.</p>
        <label className="form-label">Формат встречи<select aria-label="Формат встречи" className="field" name="meeting_format" defaultValue={data?.meeting_format ?? 'offline'}>
          <option value="offline">Офлайн</option><option value="online">Онлайн</option><option value="hybrid">Гибридная</option>
        </select></label>
        <label className="form-label">Место встречи<input className="field" name="place" maxLength={120} defaultValue={data?.place} /></label>
        <label className="form-label">Адрес<input className="field" name="address" maxLength={300} defaultValue={data?.address} /></label>
        <label className="form-label">Ссылка на карту<input className="field" type="url" name="map_url" maxLength={400} defaultValue={data?.map_url} /></label>
        <label className="form-label">Ссылка подключения<input className="field" type="url" name="online_url" maxLength={400} defaultValue={data?.online_url} /></label>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="place_pending" defaultChecked={data?.place_pending ?? false} />Место уточняется</label>
        <label className="form-label">Описание<textarea className="field min-h-24" name="description" maxLength={1200} defaultValue={data?.description} /></label>
        <label className="form-label">Теги через пробел<input className="field" name="tags" defaultValue={data?.tags?.join(' ')} placeholder="#встреча #команда" /></label>
      </fieldset>
      {error && <p role="alert" className="text-sm font-medium">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button className="button" type="submit" disabled={busy || !topicId}>{busy ? 'Сохраняем…' : event ? 'Сохранить изменения' : 'Создать и опубликовать'}</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={close}>Отмена</button>
      </div>
    </form>
  </dialog>;
}
