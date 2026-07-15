import { promises as fs } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export class SecurityError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
    public readonly violation?: string,
  ) {
    super(message);
    this.name = "SecurityError";
  }
}

function isWithin(root: string, target: string): boolean {
  const difference = relative(root, target);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

export class PathValidator {
  static async validateExisting(filePath: string, workDir: string): Promise<string> {
    this.assertNotEmpty(filePath);
    const root = await fs.realpath(resolve(workDir));
    const requested = resolve(root, filePath);
    let actual: string;
    try {
      actual = await fs.realpath(requested);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new SecurityError("Path does not exist", filePath, "not_found");
      }
      throw error;
    }
    this.assertWithin(root, actual, filePath);
    return actual;
  }

  static async validateForWrite(filePath: string, workDir: string): Promise<string> {
    this.assertNotEmpty(filePath);
    const root = await fs.realpath(resolve(workDir));
    const requested = resolve(root, filePath);

    try {
      const actual = await fs.realpath(requested);
      this.assertWithin(root, actual, filePath);
      return actual;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    let existingParent = dirname(requested);
    while (true) {
      try {
        existingParent = await fs.realpath(existingParent);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const next = dirname(existingParent);
        if (next === existingParent) throw error;
        existingParent = next;
      }
    }
    this.assertWithin(root, existingParent, filePath);
    // The lexical target is safe because every existing ancestor, including any
    // symlink, was collapsed by realpath before the containment check.
    return requested;
  }

  /** Legacy lexical validation retained for callers outside the file tools. */
  static validate(filePath: string, allowedDirs: string[] = []): string {
    this.assertNotEmpty(filePath);
    const normalized = resolve(filePath);
    if (allowedDirs.length > 0 && !allowedDirs.some((dir) => isWithin(resolve(dir), normalized))) {
      throw new SecurityError("Path is outside allowed directories", filePath, "outside_allowed_dirs");
    }
    return normalized;
  }

  static normalize(filePath: string): string {
    return resolve(filePath);
  }

  static hasTraversal(filePath: string): boolean {
    return filePath.split(/[\\/]+/u).includes("..");
  }

  private static assertNotEmpty(filePath: string): void {
    if (!filePath || filePath.trim() === "") {
      throw new SecurityError("File path cannot be empty", filePath, "empty_path");
    }
  }

  private static assertWithin(root: string, target: string, original: string): void {
    if (!isWithin(root, target)) {
      throw new SecurityError(
        "Path is outside the working directory",
        original,
        "outside_working_directory",
      );
    }
  }
}
