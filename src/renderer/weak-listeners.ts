export interface WeakRefLike<T extends object> {
  deref(): T | undefined;
}

export interface WeakListenerRecord<Owner extends object, Event> {
  ownerRef: WeakRefLike<Owner>;
  notify: (owner: Owner, event: Event) => void;
}

export function pruneWeakListenerMap<Owner extends object, Event>(
  listeners: Map<symbol, WeakListenerRecord<Owner, Event>>,
): void {
  for (const [token, listener] of listeners) {
    if (listener.ownerRef.deref() == null) {
      listeners.delete(token);
    }
  }
}

export function emitWeakListeners<Owner extends object, Event>(
  listeners: Map<symbol, WeakListenerRecord<Owner, Event>>,
  event: Event,
): void {
  for (const [token, listener] of [...listeners]) {
    const owner = listener.ownerRef.deref();
    if (owner == null) {
      listeners.delete(token);
      continue;
    }
    listener.notify(owner, event);
  }
}
