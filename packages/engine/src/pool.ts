/**
 * Object pool.
 *
 * In a playable, garbage collection is not a background detail: a stutter during
 * a merge animation is a stutter the user sees and blames on the game. Blocks,
 * particles and floating labels all come from a pool so steady-state gameplay
 * allocates nothing.
 */
export class Pool<T> {
  private readonly items: T[] = [];
  private createdCount = 0;

  /**
   * @param factory  creates a new instance on demand
   * @param reset    returns an instance to a clean state before it is reused
   * @param prewarm  how many instances to create up front
   */
  constructor(
    private readonly factory: () => T,
    private readonly reset: (item: T) => void,
    prewarm = 0,
  ) {
    for (let i = 0; i < prewarm; i += 1) {
      this.items.push(this.factory());
      this.createdCount += 1;
    }
  }

  get(): T {
    const item = this.items.pop();
    if (item !== undefined) return item;

    this.createdCount += 1;
    return this.factory();
  }

  release(item: T): void {
    this.reset(item);
    this.items.push(item);
  }

  /** Everything currently parked in the pool. */
  get idleCount(): number {
    return this.items.length;
  }

  /** Total instances ever created. Compare across runs to check for churn. */
  get allocatedCount(): number {
    return this.createdCount;
  }

  clear(): void {
    this.items.length = 0;
  }
}
