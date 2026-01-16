import { EventEmitter } from 'events';
import type { AgentMessage } from './MessageTypes';

export class MessageBus extends EventEmitter {
  private static instance: MessageBus;

  static getInstance(): MessageBus {
    if (!MessageBus.instance) {
      MessageBus.instance = new MessageBus();
    }
    return MessageBus.instance;
  }

  publish(message: AgentMessage): void {
    this.emit('message', message);
  }

  subscribe(handler: (message: AgentMessage) => void): void {
    this.on('message', handler);
  }

  unsubscribe(handler: (message: AgentMessage) => void): void {
    this.off('message', handler);
  }

  clear(): void {
    this.removeAllListeners();
  }
}
