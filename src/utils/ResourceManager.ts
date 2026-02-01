import { Logger } from "./Logger.js";

/**
 * Interface for resources that need cleanup
 */
export interface Disposable {
  dispose(): Promise<void> | void;
}

/**
 * ResourceManager provides centralized resource lifecycle management.
 * Ensures all registered resources are properly cleaned up on application exit.
 */
export class ResourceManager {
  private resources = new Set<Disposable>();
  private disposed = false;
  private readonly disposeTimeoutMs = 5000; // 5 seconds timeout for disposal

  /**
   * Register a resource for cleanup
   */
  register(resource: Disposable): void {
    if (this.disposed) {
      Logger.warn("ResourceManager", "Attempted to register resource after disposal");
      return;
    }
    this.resources.add(resource);
  }

  /**
   * Unregister a resource (useful if manually disposed)
   */
  unregister(resource: Disposable): void {
    this.resources.delete(resource);
  }

  /**
   * Dispose a specific resource
   */
  async dispose(resource: Disposable): Promise<void> {
    if (!this.resources.has(resource)) {
      return;
    }

    try {
      const disposePromise = Promise.resolve(resource.dispose());
      await this.withTimeout(disposePromise, this.disposeTimeoutMs);
      this.resources.delete(resource);
    } catch (error) {
      Logger.error("ResourceManager", "Failed to dispose resource", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Dispose all registered resources
   * Continues disposing other resources even if one fails
   */
  async disposeAll(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const errors: Error[] = [];

    Logger.debug("ResourceManager", `Disposing ${this.resources.size} resources`);

    // Convert to array to avoid modification during iteration
    const resourceArray = Array.from(this.resources);

    for (const resource of resourceArray) {
      try {
        const disposePromise = Promise.resolve(resource.dispose());
        await this.withTimeout(disposePromise, this.disposeTimeoutMs);
        this.resources.delete(resource);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push(err);
        Logger.error("ResourceManager", "Failed to dispose resource", {
          error: err.message,
        });
      }
    }

    if (errors.length > 0) {
      Logger.error("ResourceManager", `Failed to dispose ${errors.length} resource(s)`);
      // Throw the first error, but all errors have been logged
      throw errors[0];
    }

    Logger.debug("ResourceManager", "All resources disposed successfully");
  }

  /**
   * Get the number of registered resources
   */
  getResourceCount(): number {
    return this.resources.size;
  }

  /**
   * Check if the manager has been disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Wrap a promise with a timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Disposal timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }
}
