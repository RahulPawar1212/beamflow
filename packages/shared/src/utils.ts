/**
 * @module @beamflow/shared/utils
 *
 * Shared utility functions used across BeamFlow packages.
 */

import { nanoid } from 'nanoid';

/**
 * Generate a unique ID suitable for node instances, connections, and workflows.
 * Uses nanoid for URL-safe, collision-resistant IDs.
 *
 * @param prefix - Optional prefix for readability (e.g., 'node', 'edge', 'wf').
 * @param size - ID length (default: 12).
 * @returns A unique string ID.
 */
export function generateId(prefix?: string, size = 12): string {
  const id = nanoid(size);
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Deep clone an object using structured clone.
 * Safer than JSON.parse(JSON.stringify()) for most types.
 */
export function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}

/**
 * Create a timestamp in ISO 8601 format.
 */
export function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Type guard to check if a value is not null or undefined.
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Group an array of items by a key extractor function.
 */
export function groupBy<T, K extends string>(
  items: ReadonlyArray<T>,
  keyFn: (item: T) => K,
): Record<K, T[]> {
  return items.reduce(
    (groups, item) => {
      const key = keyFn(item);
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
      return groups;
    },
    {} as Record<K, T[]>,
  );
}

/**
 * Safely parse JSON with a fallback value.
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Debounce a function call.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}
