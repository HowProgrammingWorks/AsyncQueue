'use strict';

const { EventEmitter } = require('node:events');
const timers = require('node:timers/promises');

class Queue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.count = 0;
    this.waiting = [];
    this.concurrency = options.concurrency || 1;
    this.wait = options.wait || Infinity;
    this.timeout = options.timeout || Infinity;
    const { process, done, success, failure, drain } = options;
    if (process) this.on('process', process);
    if (done) this.on('done', done);
    if (success) this.on('success', success);
    if (failure) this.on('failure', failure);
    if (drain) this.on('drain', drain);
  }

  add(task) {
    const hasChannel = this.count < this.concurrency;
    if (hasChannel) {
      this.next(task);
      return;
    }
    this.waiting.push({ task, start: Date.now() });
  }

  next(task) {
    this.count++;
    let timer = null;
    let finished = false;
    const finish = (err, res) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      this.count--;
      this.finish(err, res);
      if (this.waiting.length > 0) this.takeNext();
    };
    if (this.timeout !== Infinity) {
      timer = setTimeout(() => {
        timer = null;
        const err = new Error('Process timed out');
        finish(err, task);
      }, this.timeout);
    }
    const [process] = this.listeners('process');
    process(task)
      .then((result) => {
        this.finish(null, result);
      })
      .catch((err) => {
        this.finish(err);
      });
  }

  takeNext() {
    const { task, start } = this.waiting.shift();
    if (this.wait !== Infinity) {
      const delay = Date.now() - start;
      if (delay > this.wait) {
        const err = new Error('Waiting timed out');
        this.finish(err, task);
        if (this.waiting.length > 0) this.takeNext();
        return;
      }
    }
    this.next(task);
    return;
  }

  finish(err, res) {
    if (err) {
      this.emit('failure', err);
    } else {
      this.emit('success', res);
    }
    this.emit('done', err, res);
    if (this.count === 0) this.emit('drain');
  }
}

// Usage

const queue = new Queue({
  concurrency: 3,
  wait: 5000,
  timeout: 10000,
  process: async (task) => {
    await timers.setTimeout(task.interval);
    return task;
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
