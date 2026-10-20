import { Button } from '../../../shared/ui/button';
import { Field, Input, Checkbox, TextArea } from '../../../shared/ui/field';
import { useEffect, useId, useRef, useState } from 'react';
import { Modal } from '../../../shared/ui/modal';
import { Select } from '../../../shared/ui/select';
import { DateTimeField } from '../../../shared/ui/date-time-field';
import { ApiFailure, createEvent, editEvent, errorText } from '../../../shared/api';
import type { CalendarEvent, Chat, EventDraft } from '../../../shared/api';
import { revealControl } from '../../../shared/lib/scroll';

export function EventForm({ chats, raw, event, initialChatId, initialTopicId, onSaved, onClose }: {
  chats: Chat[]; raw: string; event?: CalendarEvent;
  initialChatId?: string;
  initialTopicId?: string;
  onSaved: (event: CalendarEvent, message?: string) => void; onClose: () => void;
}) {
  const manageable = chats.filter((chat) => chat.can_manage);
  const [chatId, setChatId] = useState(event?.chat_id ?? manageable.find((chat) => chat.id === initialChatId)?.id ?? manageable[0]?.id ?? '');
  const chat = manageable.find((item) => item.id === chatId);
  const topics = chat?.topics.filter((topic) => topic.enabled !== false) ?? [];
  const [topicId, setTopicId] = useState(event?.data.topic_id.toString() ?? (initialTopicId ? topics.find((topic) => topic.id === initialTopicId)?.id ?? '' : topics[0]?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error && errorRef.current?.parentElement) {
      errorRef.current.focus({ preventScroll: true });
      revealControl(errorRef.current, errorRef.current.parentElement);
    }
  }, [error]);
  const [notice, setNotice] = useState('');
  const [allDay, setAllDay] = useState(!!event && !event.data.start_time);
  const [confirmNotify, setConfirmNotify] = useState(false);
  const notifyApproved = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();
  const lock = useRef(false);
  const dirty = useRef(false);
  const key = useRef(crypto.randomUUID());
  const submitted = useRef<EventDraft | null>(null);
  const data = event?.data;

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
      online_url: value('online_url'), place_pending: false,
      tags: value('tags').split(/\s+/).filter(Boolean),
      notify_members: fields.get('notify_members') === 'on',
    };
    if (!draft.start_date) { setError('Выберите дату начала'); return; }
    if (!draft.place && !draft.address && !draft.map_url && !draft.online_url) {
      setError('Укажите место встречи или ссылку подключения');
      return;
    }
    if (data && !Object.entries(draft).some(([name, value]) => name !== 'notify_members' && JSON.stringify(value ?? '') !== JSON.stringify(data[name as keyof EventDraft] ?? ''))) {
      setNotice('Нет изменений.'); return;
    }
    if (event && draft.notify_members && !notifyApproved.current && !uncertain) { setConfirmNotify(true); return; }
    submitted.current = draft;
    lock.current = true; setBusy(true); setError('');
    try {
      if (event) {
        const saved = await editEvent(raw, event, draft);
        onSaved(saved, saved.version === event.version ? 'Нет изменений.' : draft.notify_members ? 'Изменения сохранены. Уведомления поставлены в очередь.' : 'Изменения сохранены. Уведомления не отправлялись.');
      } else onSaved(await createEvent(raw, chatId, draft, key.current));
    } catch (cause) {
      setUncertain(!(cause instanceof ApiFailure));
      setError(errorText(cause));
    } finally { lock.current = false; setBusy(false); notifyApproved.current = false; }
  }

  if (!chat) return <Modal title="Создание недоступно" onClose={onClose}><p role="alert">Нет прав администратора. Обновите календарь.</p></Modal>;
  return <Modal title={event ? 'Редактировать событие' : 'Создать событие'} onClose={close} busy={busy} closeLabel="Закрыть форму" fullHeight>
    <form id={formId} ref={formRef} className="event-form" onChange={() => { dirty.current = true; }} onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }}>
    <div className="event-form-body">
    <p className="text-sm text-muted">Часовой пояс: {event?.timezone ?? chat.timezone ?? 'UTC'}. {event ? 'Изменения появятся в календаре. Личное уведомление — только по вашему выбору.' : 'Карточка будет опубликована в выбранном чате.'}</p>
    {!topics.length && <p className="mt-4 text-sm" role="status">Нет доступных тем для публикации. Включите тему в настройках чата и откройте форму заново.</p>}
    {initialTopicId && !topicId && topics.length > 0 && <p className="mt-4 text-sm" role="status">Исходная тема недоступна. Выберите другую включённую тему.</p>}
      <fieldset disabled={busy || uncertain} className="space-y-4 disabled:opacity-70">
        <Field>Чат<Select label="Чат" value={chatId} disabled={!!event} onChange={(value) => {
          dirty.current = true; setChatId(value);
          setTopicId(manageable.find((c) => c.id === value)!.topics.find((t) => t.enabled !== false)?.id ?? '');
        }} options={manageable.map((c) => ({ value: c.id, label: c.title }))} /></Field>
        <Field>Тема<Select label="Тема" value={topicId} disabled={!!event} onChange={(value) => { dirty.current = true; setTopicId(value); }} options={[{ value: '', label: 'Выберите тему', disabled: true }, ...topics.map((t) => ({ value: t.id, label: t.title }))]} /></Field>
        {event && <p className="text-xs text-muted">Для переноса в другую тему создайте новое событие и отмените прежнее.</p>}
        <Field>Название<Input name="title" required maxLength={120} defaultValue={data?.title} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>Дата начала<DateTimeField label="Дата начала" type="date" name="start_date" required defaultValue={data?.start_date} onChange={() => { dirty.current = true; }} /></Field>
          <Field>Время начала<DateTimeField label="Время начала" type="time" name="start_time" disabled={allDay} defaultValue={data?.start_time ?? ''} onChange={() => { dirty.current = true; }} /></Field>
          <Field>Дата окончания<DateTimeField label="Дата окончания" type="date" name="end_date" defaultValue={data?.end_date ?? ''} onChange={() => { dirty.current = true; }} /></Field>
          <Field>Время окончания<DateTimeField label="Время окончания" type="time" name="end_time" disabled={allDay} defaultValue={data?.end_time ?? ''} onChange={() => { dirty.current = true; }} /></Field>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox  checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />Весь день</label>
        <Field>Формат встречи<Select label="Формат встречи" name="meeting_format" defaultValue={data?.meeting_format ?? 'offline'} onChange={() => { dirty.current = true; }} options={[{ value: 'offline', label: 'Офлайн' }, { value: 'online', label: 'Онлайн' }, { value: 'hybrid', label: 'Гибридная' }]} /></Field>
        <Field>Место встречи<Input name="place" maxLength={120} defaultValue={data?.place} /></Field>
        <Field>Адрес<Input name="address" maxLength={300} defaultValue={data?.address} /></Field>
        <Field>Ссылка на карту<Input type="url" name="map_url" maxLength={400} defaultValue={data?.map_url} /></Field>
        <Field>Ссылка подключения<Input type="url" name="online_url" maxLength={400} defaultValue={data?.online_url} /></Field>
        <Field>Описание<TextArea className="min-h-24" name="description" maxLength={1200} defaultValue={data?.description} /></Field>
        <Field>Теги через пробел<Input name="tags" defaultValue={data?.tags?.join(' ')} placeholder="#встреча #команда" /></Field>
        {event ? <Field className="flex items-start gap-3"><Checkbox className="mt-1 size-5 shrink-0" name="notify_members" />Уведомить участников об изменениях</Field> :
          <p className="text-sm text-muted">Уведомление о новом событии отправится автоматически известным участникам календаря, разрешившим личные сообщения боту.</p>}
      </fieldset>
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-xl border border-attention/50 bg-attention/10 p-3 text-sm font-medium text-attention outline-none">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      </div>
      <div className="event-form-footer">
        <Button variant="secondary" type="button" disabled={busy} onClick={close}>Отмена</Button>
        <Button variant="primary" type="submit" disabled={busy || !topicId}>{busy ? 'Сохраняем…' : event ? 'Сохранить изменения' : 'Создать и опубликовать'}</Button>
      </div>
    </form>
    {confirmNotify && <Modal title="Уведомить об изменениях?" onClose={() => setConfirmNotify(false)} footer={<>
      <Button variant="secondary" type="button" onClick={() => setConfirmNotify(false)}>Отмена</Button>
      <Button variant="primary" type="button" onClick={() => { notifyApproved.current = true; setConfirmNotify(false); formRef.current?.requestSubmit(); }}>Сохранить и уведомить</Button>
    </>}><p className="text-sm text-muted">Личные сообщения получат только участники календаря этого чата, разрешившие сообщения боту. Очередь не означает доставку всем участникам Telegram-чата.</p></Modal>}
  </Modal>;
}
