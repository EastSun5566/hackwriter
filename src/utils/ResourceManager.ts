/**
 * Interface for resources that need cleanup
 */
export interface Disposable {
  dispose(): Promise<void> | void;
}
