'use strict';

class Queue {
  #execute = null;
  #done = null;
  #success = null;
  #failure = null;
  #drain = null;
  #count = 0;
  #waiting = [];
  #concurrency = 1;
  #wait = Infinity;
  #timeout = Infinity;

  constructor(options = {}) {
    const { concurrency, wait, timeout } = options;
    if (concurrency) this.#concurrency = concurrency;
    if (wait) this.#wait = wait;
    if (timeout) this.#timeout = timeout;
    const { execute, done, success, failure, drain } = options;
    if (execute) this.#execute = execute;
    if (done) this.#done = done;
    if (success) this.#success = success;
    if (failure) this.#failure = failure;
    if (drain) this.#drain = drain;
  }

  add(task) {
    const hasChannel = this.#count < this.#concurrency;
    if (hasChannel) return void this.#next(task);
    this.#waiting.push({ task, start: Date.now() });
  }

  async #next(task) {
    this.#count++;
    let timer = null;
    let finished = false;
    const finish = (err, res) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      this.#count--;
      this.#finish(err, res);
      if (this.#waiting.length > 0) this.#takeNext();
    };
    if (this.#timeout !== Infinity) {
      timer = setTimeout(() => {
        timer = null;
        const err = new Error('execute timed out');
        finish(err, task);
      }, this.#timeout);
    }

    try {
      const result = await this.#execute(task);
      this.#finish(null, result);
    } catch (err) {
      this.#finish(err);
    }
  }

  #takeNext() {
    const { task, start } = this.#waiting.shift();
    if (this.#wait !== Infinity) {
      const delay = Date.now() - start;
      if (delay > this.#wait) {
        const err = new Error('Waiting timed out');
        this.#finish(err, task);
        if (this.#waiting.length > 0) this.#takeNext();
        return;
      }
    }
    this.#next(task);
  }

  #finish(err, res) {
    if (err) {
      if (this.#failure) this.#failure(err);
    } else if (this.#success) { this.#success(res); }
    if (this.#done) this.#done(err, res);
    if (this.#count === 0 && this.#drain) this.#drain();
  }
}

// Usage

const queue = new Queue({
  concurrency: 3,
  wait: 5000,
  timeout: 10000,
  execute: async (task) => {
    const { promise, resolve } = Promise.withResolvers();
    setTimeout(() => resolve(task), task.interval);
    return promise;
  },
  done: (error, task) => {
    console.log('Done:', { error, task });
  },
  success: (task) => {
    console.log('Success:', { task });
  },
  failure: (err, task) => {
    console.log('Failure:', { err, task });
  },
  drain: () => {
    console.log('Queue drain');
  },
});

for (let i = 0; i < 10; i++) {
  const task = { name: `Task${i}`, interval: i * 1000 };
  console.log('Add:', task);
  queue.add(task);
}
