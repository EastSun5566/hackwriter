import { promises as fs } from "fs";
import { Logger } from "./Logger.js";

interface PackageJson {
  version: string;
  [key: string]: unknown;
}

/**
 * AsyncPackageLoader loads package.json files asynchronously to avoid blocking the event loop.
 * Caches loaded package data to avoid repeated file reads.
 */
export class AsyncPackageLoader {
  private static cache = new Map<string, PackageJson>();

  /**
   * Load package.json asynchronously
   * @param packagePath - Path to package.json file
   * @returns Package data with at least a version field
   */
  static async load(packagePath: string): Promise<PackageJson> {
    // Check cache first
    const cached = this.cache.get(packagePath);
    if (cached) {
      return cached;
    }

    try {
      const content = await fs.readFile(packagePath, "utf-8");
      const packageData = JSON.parse(content) as PackageJson;

      // Validate that version exists
      if (!packageData.version) {
        Logger.warn("AsyncPackageLoader", `Package at ${packagePath} missing version field`);
        packageData.version = "unknown";
      }

      // Cache the result
      this.cache.set(packagePath, packageData);

      return packageData;
    } catch (error) {
      Logger.error("AsyncPackageLoader", `Failed to load package.json from ${packagePath}`, {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return a default package with unknown version
      const defaultPackage: PackageJson = { version: "unknown" };
      return defaultPackage;
    }
  }

  /**
   * Get cached package data if available
   * @param packagePath - Path to package.json file
   * @returns Cached package data or null if not cached
   */
  static getCached(packagePath: string): PackageJson | null {
    return this.cache.get(packagePath) ?? null;
  }

  /**
   * Clear the cache (useful for testing)
   */
  static clearCache(): void {
    this.cache.clear();
  }
}
