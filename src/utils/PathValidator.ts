import { resolve, dirname, relative, isAbsolute } from 'path';

/**
 * Security error for path validation failures
 */
export class SecurityError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
    public readonly violation?: string
  ) {
    super(message);
    this.name = 'SecurityError';
  }
}

/**
 * PathValidator provides security validation for file paths
 * to prevent path traversal attacks and ensure paths stay within allowed boundaries
 */
export class PathValidator {
  /**
   * Validate a file path for security
   * @param filePath - The path to validate
   * @param allowedDirs - Optional array of allowed base directories
   * @returns The normalized absolute path
   * @throws SecurityError if path is invalid or contains traversal sequences
   */
  static validate(filePath: string, allowedDirs?: string[]): string {
    if (!filePath || filePath.trim() === '') {
      throw new SecurityError(
        'File path cannot be empty',
        filePath,
        'empty_path'
      );
    }

    // Normalize the path to resolve any relative references
    const normalized = this.normalize(filePath);

    // Check for path traversal after normalization
    if (this.hasTraversal(filePath)) {
      throw new SecurityError(
        'Path traversal is not allowed for security reasons',
        filePath,
        'path_traversal'
      );
    }

    // If allowed directories are specified, verify the path is within them
    if (allowedDirs && allowedDirs.length > 0) {
      const isWithinAllowed = allowedDirs.some(allowedDir => {
        const resolvedAllowed = resolve(allowedDir);
        const relativePath = relative(resolvedAllowed, normalized);
        
        // Path is within allowed dir if relative path doesn't start with '..'
        return relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath);
      });

      if (!isWithinAllowed) {
        throw new SecurityError(
          `Path is outside allowed directories`,
          filePath,
          'outside_allowed_dirs'
        );
      }
    }

    return normalized;
  }

  /**
   * Normalize and resolve a path to absolute form
   * @param filePath - The path to normalize
   * @returns Absolute path with all relative references resolved
   */
  static normalize(filePath: string): string {
    return resolve(filePath);
  }

  /**
   * Check if path contains traversal sequences
   * @param filePath - The path to check
   * @returns true if path contains '..' sequences
   */
  static hasTraversal(filePath: string): boolean {
    // Check for '..' in the path
    const normalized = dirname(filePath);
    return normalized.includes('..');
  }
}
