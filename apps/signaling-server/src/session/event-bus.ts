export class TypedEmitter<Events extends Record<string, unknown[]>> {
  private listeners: { [K in keyof Events]?: Array<(...args: Events[K]) => void> } = {};

  on<K extends keyof Events>(event: K, cb: (...args: Events[K]) => void): void {
    (this.listeners[event] ??= []).push(cb);
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    for (const cb of this.listeners[event] ?? []) cb(...args);
  }
}
