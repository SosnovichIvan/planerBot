import createClient from 'openapi-fetch';
import type { paths } from './schema';

export class ApiFailure extends Error {
  constructor(public readonly status: number) { super('Calendar request failed'); }
}

export async function loadChats(raw: string, signal: AbortSignal) {
  const client = createClient<paths>({ baseUrl: window.location.origin, headers: { Authorization: `tma ${raw}` } });
  const chats = [];
  let cursor: string | undefined;
  do {
    const { data, response } = await client.GET('/api/chats', {
      params: { query: { after: cursor === undefined ? undefined : Number(cursor) } }, signal,
    });
    if (!data) throw new ApiFailure(response.status);
    chats.push(...data.chats);
    cursor = data.next_cursor ?? undefined;
  } while (cursor !== undefined);
  return chats;
}
