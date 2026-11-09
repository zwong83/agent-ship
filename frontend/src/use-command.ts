import { useRef, useState } from 'react';
import { ApiError, request } from './api';

export function useCommand(csrf: string) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const previous = useRef<{ fingerprint: string; key: string } | null>(null);

  async function send<T>(path: string, method: 'POST' | 'PATCH', body: object) {
    if (inFlight.current) throw new Error('Command already in flight');
    const fingerprint = JSON.stringify([path, method, body]);
    const key = previous.current?.fingerprint === fingerprint ? previous.current.key : crypto.randomUUID();
    previous.current = { fingerprint, key };
    inFlight.current = true;
    setPending(true);
    try {
      const result = await request<T>(path, { method, body, csrf, commandKey: key });
      previous.current = null;
      return result;
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) previous.current = null;
      throw err;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { send, pending };
}
