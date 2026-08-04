/**
 * A bounded "have I already applied this event?" set.
 *
 * The awareness socket's delivery is at-least-once in practice (a reconnect can
 * replay, and NOTIFY plus REST resync can overlap), and its events mutate
 * COUNTERS — an unread bump applied twice leaves a badge that no amount of
 * reading will clear. So every event is keyed and checked before it is applied.
 *
 * Memory has to stay bounded, and how it's bounded matters: clearing the whole
 * set on overflow drops every recent key at once, so an event replayed just
 * after a clear reads as new and double-counts. Evicting only the OLDEST key
 * keeps the recent window — the only part that can actually be replayed — intact.
 */
export class SeenKeys {
  private readonly keys = new Set<string>();

  constructor(private readonly max = 4000) {}

  /** True the first time a key is offered; false for every repeat. */
  add(key: string): boolean {
    if (this.keys.has(key)) return false;
    // A Set iterates in insertion order, so the first entry is the oldest.
    if (this.keys.size >= this.max) {
      const oldest = this.keys.values().next().value;
      if (oldest !== undefined) this.keys.delete(oldest);
    }
    this.keys.add(key);
    return true;
  }

  get size(): number {
    return this.keys.size;
  }
}
