import { promises as fs } from 'fs';
import { Logger } from './Logger.js';

interface BatchWriterOptions {
  maxBatchSize?: number;      // Default: 50
  flushIntervalMs?: number;   // Default: 1000
  maxFlushDelayMs?: number;   // Default: 100
}

interface BatchRecord {
  data: string;
  timestamp: number;
}

/**
 * BatchWriter buffers write operations to reduce I/O overhead
 * Automatically flushes based on size and time constraints
 */
export class BatchWriter {
  private filePath: string;
  private buffer: BatchRecord[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isClosed = false;
  
  private readonly maxBatchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxFlushDelayMs: number;

  constructor(filePath: string, options?: BatchWriterOptions) {
    this.filePath = filePath;
    this.maxBatchSize = options?.maxBatchSize ?? 50;
    this.flushIntervalMs = options?.flushIntervalMs ?? 1000;
    this.maxFlushDelayMs = options?.maxFlushDelayMs ?? 100;
  }

  /**
   * Add data to write buffer
   * Automatically flushes if buffer reaches maxBatchSize
   */
  async write(data: string): Promise<void> {
    if (this.isClosed) {
      throw new Error('BatchWriter is closed');
    }

    this.buffer.push({
      data,
      timestamp: Date.now(),
    });

    // Flush immediately if buffer is full
    if (this.buffer.length >= this.maxBatchSize) {
      await this.flush();
    } else {
      // Schedule auto-flush
      this.scheduleFlush();
    }
  }

  /**
   * Force flush pending writes to disk
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    // Clear any pending flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const recordsToFlush = this.buffer.splice(0);
    
    try {
      // Skip file operations for memory mode
      if (this.filePath === ':memory:') {
        Logger.debug('BatchWriter', `Flushed ${recordsToFlush.length} records (memory mode)`);
        return;
      }

      // Combine all records into single write
      const content = recordsToFlush.map(r => r.data).join('');
      
      // Use appendFile for atomic writes
      await fs.appendFile(this.filePath, content, 'utf-8');
      
      Logger.debug('BatchWriter', `Flushed ${recordsToFlush.length} records to ${this.filePath}`);
    } catch (error) {
      // On error, put records back in buffer for retry
      this.buffer.unshift(...recordsToFlush);
      
      Logger.error('BatchWriter', 'Flush failed, records preserved in buffer', error);
      
      // Retry once
      try {
        const retryContent = recordsToFlush.map(r => r.data).join('');
        await fs.appendFile(this.filePath, retryContent, 'utf-8');
        
        // Remove from buffer on successful retry
        this.buffer.splice(0, recordsToFlush.length);
        
        Logger.debug('BatchWriter', 'Retry flush succeeded');
      } catch (retryError) {
        Logger.error('BatchWriter', 'Retry flush also failed', retryError);
        throw retryError;
      }
    }
  }

  /**
   * Close writer and flush remaining data
   */
  async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;

    // Clear any pending timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining data
    await this.flush();
  }

  /**
   * Get unflushed data (for recovery)
   */
  getUnflushedData(): string[] {
    return this.buffer.map(r => r.data);
  }

  /**
   * Schedule auto-flush based on idle time
   */
  private scheduleFlush(): void {
    // Don't schedule if already scheduled
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      
      // Check if oldest record exceeds max delay
      if (this.buffer.length > 0) {
        const oldestTimestamp = this.buffer[0].timestamp;
        const age = Date.now() - oldestTimestamp;
        
        if (age >= this.maxFlushDelayMs) {
          void this.flush().catch(error => {
            Logger.error('BatchWriter', 'Auto-flush failed', error);
          });
        }
      }
    }, this.flushIntervalMs);
  }
}
