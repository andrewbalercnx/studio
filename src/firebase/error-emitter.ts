
// A simple, generic event emitter.
// This is a minimalist implementation for demonstration purposes.
// In a real-world app, you might use a library like 'eventemitter3'.

type Listener = (...args: any[]) => void;

class EventEmitter {
  private events: { [key: string]: Listener[] } = {};

  on(event: string, listener: Listener): () => void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);

    // Return a function to unsubscribe
    return () => this.off(event, listener);
  }

  off(event: string, listener: Listener): void {
    if (!this.events[event]) {
      return;
    }
    this.events[event] = this.events[event].filter(l => l !== listener);
  }

  emit(event: string, ...args: any[]): void {
    if (!this.events[event]) {
      return;
    }
    this.events[event].forEach(listener => listener(...args));
  }
}

export const errorEmitter = new EventEmitter();
