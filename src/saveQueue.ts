/**
 * Saves an editor's text one write at a time, oldest first. Each save holds the
 * whole note, so a newer one replaces any older one that failed. The newest text
 * is never dropped: if its save fails, it waits for the next flush.
 */
export class SaveQueue {
  private unsaved: string | null = null;
  private tail: Promise<void> = Promise.resolve();
  private newest = 0;
  private inFlight = 0;

  constructor(
    private save: (text: string) => Promise<void>,
    private onSettled: (failed: boolean) => void,
  ) {}

  change(text: string) {
    this.unsaved = text;
  }

  /** True while there is text that hasn't reached storage. */
  get busy() {
    return this.unsaved !== null || this.inFlight > 0;
  }

  get hasUnsaved() {
    return this.unsaved !== null;
  }

  /** Resolves, without rejecting, once every save so far has finished. */
  flush(): Promise<void> {
    const pending = this.unsaved;
    if (pending === null) return this.tail;
    this.unsaved = null;
    this.inFlight += 1;
    this.newest += 1;
    const id = this.newest;
    this.tail = this.tail.then(async () => {
      let failed = false;
      try {
        await this.save(pending);
      } catch {
        failed = true;
        if (id === this.newest) this.unsaved ??= pending;
      }
      this.inFlight -= 1;
      // A failure that a newer save has replaced isn't worth reporting.
      if (!failed || id === this.newest) this.onSettled(failed);
    });
    return this.tail;
  }
}
