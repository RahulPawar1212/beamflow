import { describe, it, expect, vi } from 'vitest';
import {
  generateId,
  deepClone,
  timestamp,
  isDefined,
  groupBy,
  safeJsonParse,
  debounce,
} from './utils.js';

describe('Shared Utilities', () => {
  describe('generateId', () => {
    it('generates an ID with correct prefix and size', () => {
      const id = generateId('test', 10);
      expect(id.startsWith('test_')).toBe(true);
      expect(id.length).toBe(15); // 'test_' + 10 characters
    });

    it('generates an ID without prefix', () => {
      const id = generateId(undefined, 8);
      expect(id.length).toBe(8);
    });
  });

  describe('deepClone', () => {
    it('creates a deep copy of an object', () => {
      const original = { a: 1, b: { c: 2 } };
      const copy = deepClone(original);
      expect(copy).toEqual(original);
      expect(copy).not.toBe(original);
      expect(copy.b).not.toBe(original.b);
    });
  });

  describe('timestamp', () => {
    it('returns a valid ISO timestamp', () => {
      const ts = timestamp();
      expect(() => new Date(ts)).not.toThrow();
      expect(typeof ts).toBe('string');
    });
  });

  describe('isDefined', () => {
    it('correctly filters null and undefined', () => {
      expect(isDefined(1)).toBe(true);
      expect(isDefined('test')).toBe(true);
      expect(isDefined(null)).toBe(false);
      expect(isDefined(undefined)).toBe(false);
    });
  });

  describe('groupBy', () => {
    it('groups an array of objects by a key', () => {
      const list = [
        { id: 1, type: 'a' },
        { id: 2, type: 'b' },
        { id: 3, type: 'a' },
      ];
      const grouped = groupBy(list, (item) => item.type);
      expect(grouped).toEqual({
        a: [
          { id: 1, type: 'a' },
          { id: 3, type: 'a' },
        ],
        b: [{ id: 2, type: 'b' }],
      });
    });
  });

  describe('safeJsonParse', () => {
    it('parses valid JSON', () => {
      const result = safeJsonParse('{"x": 1}', { x: 0 });
      expect(result).toEqual({ x: 1 });
    });

    it('returns fallback for invalid JSON', () => {
      const result = safeJsonParse('{invalid}', { x: 0 });
      expect(result).toEqual({ x: 0 });
    });
  });

  describe('debounce', () => {
    it('debounces calls', () => {
      vi.useFakeTimers();
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      debounced();
      debounced();

      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });
});
