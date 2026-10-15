import { useRef, useState } from 'react';
import { configureChat, errorText } from '../../../shared/api';
import type { Chat } from '../../../shared/api';

export function SettingsForm({ chat, raw, onSaved }: { chat: Chat; raw: string; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  return <details className="mt-3">
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Настройки чата</summary>
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); if (lock.current) return;
      const fields = new FormData(e.currentTarget);
      lock.current = true; setBusy(true); setError('');
      try {
        await configureChat(raw, chat.id, {
          version: chat.settings_version ?? 1, timezone: String(fields.get('timezone')),
          event_tag: String(fields.get('event_tag')),
          creation_policy: fields.get('creation_policy') === 'members' ? 'members' : 'admins',
          confirmation_required: fields.has('confirmation_required'),
          enabled_topic_ids: fields.getAll('topic').map(Number),
        });
        onSaved();
      } catch (cause) { setError(errorText(cause)); }
      finally { lock.current = false; setBusy(false); }
    }}>
      <fieldset disabled={busy} className="space-y-3">
        <label className="form-label">Часовой пояс IANA<input className="field" name="timezone" required defaultValue={chat.timezone ?? 'UTC'} /></label>
        <label className="form-label">Тег события<input className="field" name="event_tag" required maxLength={33} defaultValue={chat.event_tag ?? '#событие'} /></label>
        <label className="form-label">Кто создаёт из сообщений<select className="field" name="creation_policy" defaultValue={chat.creation_policy ?? 'admins'}><option value="admins">Администраторы</option><option value="members">Все участники</option></select></label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="confirmation_required" defaultChecked={chat.confirmation_required} />Подтверждать импорт администраторов</label>
        <p className="text-xs text-muted">События участников всегда требуют подтверждения.</p>
        <fieldset><legend className="text-sm font-medium">Включённые темы</legend>{chat.topics.map((topic) => <label className="flex min-h-11 items-center gap-2 text-sm" key={topic.id}><input type="checkbox" name="topic" value={topic.id} defaultChecked={topic.enabled !== false} />{topic.title}</label>)}</fieldset>
      </fieldset>
      {error && <p role="alert" className="text-sm">{error}</p>}
      <button className="button w-full" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить настройки'}</button>
    </form>
  </details>;
}
