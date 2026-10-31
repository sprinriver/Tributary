/** Caps concurrent heavy queries (ARCHITECTURE §6); waiters run in arrival order. */
export class Semaphore {
  #free: number;
  readonly #waiting: (() => void)[] = [];
  constructor(size: number) {
    this.#free = size;
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#free > 0) this.#free--;
    else await new Promise<void>((resolve) => this.#waiting.push(resolve));
    try {
      return await work();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#free++;
    }
  }
}

/** Small LRU for page results of immutable inputs (key: sqlHash + page). */
export class ResultCache<T> {
  readonly #map = new Map<string, T>();
  readonly size: number;
  constructor(size: number) {
    this.size = size;
  }
  get(key: string): T | undefined {
    const value = this.#map.get(key);
    if (value !== undefined) {
      this.#map.delete(key);
      this.#map.set(key, value);
    }
    return value;
  }
  set(key: string, value: T): void {
    this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.size) this.#map.delete(this.#map.keys().next().value!);
  }
}
