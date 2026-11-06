// An async iterable fed by `push`: the SDK's streaming input, which is read
// for the life of the session and ends when the session closes.

export class InputQueue<T> implements AsyncIterable<T> {
  #items: T[] = [];
  #waiting: ((r: IteratorResult<T>) => void) | null = null;
  #ended = false;

  push(item: T): void {
    if (this.#ended) throw new Error('The session is closed.');
    if (this.#waiting) {
      const resolve = this.#waiting;
      this.#waiting = null;
      resolve({ value: item, done: false });
    } else {
      this.#items.push(item);
    }
  }

  end(): void {
    this.#ended = true;
    if (this.#waiting) {
      const resolve = this.#waiting;
      this.#waiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.#items.shift();
        if (item !== undefined)
          return Promise.resolve({ value: item, done: false });
        if (this.#ended)
          return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.#waiting = resolve;
        });
      },
      return: () => {
        this.end();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
