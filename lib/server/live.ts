import type { Status } from '../types';

export interface Change {
  id: string;
  status: Status;
}

type Listener = (change: Change) => void;

// Every open dashboard tab is a listener. On globalThis so the upload route,
// the ingest queue and the stream route all share one set.
const g = globalThis as unknown as { __live?: Set<Listener> };
const listeners = (g.__live ??= new Set());

export function publish(change: Change) {
  for (const fn of listeners) {
    try {
      fn(change);
    } catch {
      listeners.delete(fn); // a closed stream; drop it
    }
  }
}

export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
