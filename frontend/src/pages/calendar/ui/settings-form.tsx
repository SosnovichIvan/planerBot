import { Button } from '../../../shared/ui/button';
import { Field, Input, Checkbox } from '../../../shared/ui/field';
import { useRef, useState } from 'react';
import { configureChat, errorText } from '../../../shared/api';
import type { Chat } from '../../../shared/api';
import { Disclosure } from '../../../shared/ui/disclosure';

export function SettingsForm({ chat, raw, onSaved }: { chat: Chat; raw: string; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  return <Disclosure title="Настройки чата" className="mt-3">
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); if (lock.current) return;
      const fields = new FormData(e.currentTarget);
      lock.current = true; setBusy(true); setError('');
      try {
        await configureChat(raw, chat.id, {
          version: chat.settings_version ?? 1, timezone: String(fields.get('timezone')),
          event_tag: String(fields.get('event_tag')),
          creation_policy: 'admins',
          confirmation_required: fields.has('confirmation_required'),
          enabled_topic_ids: fields.getAll('topic').map(Number),
        });
        onSaved();
      } catch (cause) { setError(errorText(cause)); }
      finally { lock.current = false; setBusy(false); }
    }}>
      <fieldset disabled={busy} className="space-y-3">
        <Field>Часовой пояс IANA<Input name="timezone" required defaultValue={chat.timezone ?? 'UTC'} /></Field>
        <Field>Тег события<Input name="event_tag" required maxLength={33} defaultValue={chat.event_tag ?? '#событие'} /></Field>
        <label className="flex min-h-11 items-center gap-2 text-sm"><Checkbox  name="confirmation_required" defaultChecked={chat.confirmation_required} />Подтверждать импорт администраторов</label>
        <p className="text-xs text-muted">Создавать события могут только администраторы.</p>
        <fieldset><legend className="text-sm font-medium">Включённые темы</legend>{chat.topics.map((topic) => <label className="flex min-h-11 items-center gap-2 text-sm" key={topic.id}><Checkbox  name="topic" value={topic.id} defaultChecked={topic.enabled !== false} />{topic.title}</label>)}</fieldset>
      </fieldset>
      {error && <p role="alert" className="text-sm">{error}</p>}
      <Button variant="primary" type="submit" className="w-full" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить настройки'}</Button>
    </form>
  </Disclosure>;
}
