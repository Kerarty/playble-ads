import type { PlayableEventMap, PlayableListener } from './types.js';

/**
 * Small typed event bus.
 *
 * Generic over the event map so the same implementation backs the SDK's public
 * events and any internal bus a package needs - the test suite drives a
 * two-event map to exercise the dispatch rules without depending on the ad
 * event names.
 *
 * Two details worth knowing:
 * - listeners are copied before dispatch, so a handler may safely unsubscribe
 *   itself (or others) while an emit is in flight;
 * - a throwing listener never breaks the emit loop for the remaining listeners.
 */
export class Emitter<M extends object = PlayableEventMap> {
  private readonly entries = new Map<keyof M, Entry<M>[]>();

  /** Reports a listener that threw. `Playable` uses this to re-emit `error`. */
  onListenerError: ((cause: unknown, event: keyof M) => void) | undefined = undefined;

  on<K extends keyof M>(event: K, listener: ListenerFor<M, K>): () => void {
    return this.add(event, listener, false);
  }

  once<K extends keyof M>(event: K, listener: ListenerFor<M, K>): () => void {
    return this.add(event, listener, true);
  }

  off<K extends keyof M>(event: K, listener: ListenerFor<M, K>): void {
    const list = this.entries.get(event);
    if (!list) return;
    const next = list.filter((entry) => entry.listener !== listener);
    if (next.length === 0) this.entries.delete(event);
    else this.entries.set(event, next);
  }

  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const list = this.entries.get(event);
    if (!list || list.length === 0) return;

    // Copy: handlers are allowed to mutate the subscription list mid-dispatch.
    for (const entry of [...list]) {
      if (entry.once) this.off(event, entry.listener as ListenerFor<M, K>);
      try {
        entry.listener(payload as never);
      } catch (cause) {
        // A broken game handler must not take the whole ad down with it.
        this.reportListenerError(cause, event);
      }
    }
  }

  listenerCount<K extends keyof M>(event: K): number {
    return this.entries.get(event)?.length ?? 0;
  }

  removeAll(): void {
    this.entries.clear();
  }

  private add<K extends keyof M>(event: K, listener: ListenerFor<M, K>, once: boolean): () => void {
    const list = this.entries.get(event) ?? [];
    list.push({ listener, once });
    this.entries.set(event, list);
    return () => this.off(event, listener);
  }

  private reportListenerError(cause: unknown, event: keyof M): void {
    if (this.onListenerError) {
      this.onListenerError(cause, event);
      return;
    }
    console.error(`[playble] listener for "${String(event)}" threw:`, cause);
  }
}

interface Entry<M extends object> {
  listener: ListenerFor<M, never>;
  once: boolean;
}

/** Handler signature for one event of a given map. */
export type ListenerFor<M extends object, K extends keyof M> = (payload: M[K]) => void;

export type { PlayableListener };
