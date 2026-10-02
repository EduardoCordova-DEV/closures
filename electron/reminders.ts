import type { TodoRecord } from "../shared/model";
import type { Store } from "./store";

export class ReminderScheduler {
  private running = false;
  private stopped = false;
  private retryAfter = new Map<string, number>();
  constructor(
    private store: Store,
    private deliver: (item: TodoRecord) => Promise<void>,
    private beforeWrite: () => void,
    private changed: () => void,
    private reportError: (error: unknown) => void
  ) {}
  stop(): void { this.stopped = true; }
  async check(now = new Date()): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const due = this.store.dueReminders(now);
      const dueIds = new Set(due.map(item => `${item.id}:${item.reminderAt}`));
      for (const key of this.retryAfter.keys()) if (!dueIds.has(key)) this.retryAfter.delete(key);
      for (const item of due) {
        if (this.stopped) break;
        const key = `${item.id}:${item.reminderAt}`;
        if ((this.retryAfter.get(key) || 0) > now.getTime()) continue;
        const current = this.store.pendingReminder(item.id, item.reminderAt!, now);
        if (!current) continue;
        try {
          this.beforeWrite();
          await this.deliver(current);
          if (this.stopped) break;
          this.store.markReminderNotified(item.id, item.reminderAt!, now);
          this.retryAfter.delete(key);
          this.changed();
        } catch (error) {
          if (this.stopped) break;
          this.retryAfter.set(key, now.getTime() + 5 * 60000);
          this.reportError(error);
        }
      }
    } catch (error) { if (!this.stopped) this.reportError(error); }
    finally { this.running = false; }
  }
}
