/** Keep writes in request order, including when an earlier request fails. */
export class SerialTasks {
  private tail: Promise<unknown> = Promise.resolve();
  pending = 0;

  run<T>(task: () => Promise<T>): Promise<T> {
    this.pending++;
    const operation = this.tail.catch(() => {}).then(task);
    const settled = operation.finally(() => { this.pending--; });
    this.tail = settled;
    // Callers handle their operation; avoid an unhandled rejection before flush.
    void settled.catch(() => {});
    return settled;
  }

  async flush(): Promise<void> {
    // Include writes added while an earlier request was in flight.
    let observed: Promise<unknown>;
    do { observed = this.tail; await observed; } while (observed !== this.tail);
  }
}
