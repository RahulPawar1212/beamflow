/**
 * Tests for the formula expression type-checker.
 */
import { describe, it, expect } from 'vitest';
import { typeCheckFormula, getBuiltinFunctionNames } from './formula-parser.js';
import { ColumnDataType } from './types.js';
import type { ColumnSchema } from './types.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const columns: ColumnSchema[] = [
  {
    id: 'col-price',
    name: 'Price',
    type: ColumnDataType.DOUBLE,
    nullable: false,
    sourceNodeId: 'node-1',
  },
  {
    id: 'col-qty',
    name: 'Quantity',
    type: ColumnDataType.INTEGER,
    nullable: false,
    sourceNodeId: 'node-1',
  },
  {
    id: 'col-name',
    name: 'Name',
    type: ColumnDataType.STRING,
    nullable: true,
    sourceNodeId: 'node-1',
  },
  {
    id: 'col-date',
    name: 'OrderDate',
    type: ColumnDataType.DATE,
    nullable: true,
    sourceNodeId: 'node-1',
  },
  {
    id: 'col-active',
    name: 'IsActive',
    type: ColumnDataType.BOOLEAN,
    nullable: false,
    sourceNodeId: 'node-1',
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Formula Parser', () => {

  describe('Arithmetic expressions', () => {
    it('infers double for Price * Quantity', () => {
      const result = typeCheckFormula('Price * Quantity', columns);
      expect(result.outputType).toBe(ColumnDataType.DOUBLE);
      expect(result.errors).toHaveLength(0);
    });

    it('infers integer for integer + integer', () => {
      const result = typeCheckFormula('Quantity + Quantity', columns);
      expect(result.outputType).toBe(ColumnDataType.INTEGER);
      expect(result.errors).toHaveLength(0);
    });

    it('infers integer for integer / integer (static type analysis)', () => {
      // Static type analysis: arithmetic on two INTEGERs returns INTEGER.
      // The runtime value may be a float, but the schema engine uses the
      // most conservative type promotion rules.
      const result = typeCheckFormula('Quantity / Quantity', columns);
      expect(result.outputType).toBe(ColumnDataType.INTEGER);
    });

    it('infers double for double / integer', () => {
      const result = typeCheckFormula('Price / Quantity', columns);
      expect(result.outputType).toBe(ColumnDataType.DOUBLE);
    });

    it('infers double for numeric literal', () => {
      const result = typeCheckFormula('Price + 1.5', columns);
      expect(result.outputType).toBe(ColumnDataType.DOUBLE);
      expect(result.errors).toHaveLength(0);
    });

    it('handles parenthesized sub-expressions', () => {
      const result = typeCheckFormula('(Price + 1) * Quantity', columns);
      expect(result.outputType).toBe(ColumnDataType.DOUBLE);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Type error detection', () => {
    it('reports error for Price + Name (Double + String)', () => {
      const result = typeCheckFormula('Price + Name', columns);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/Cannot apply '\+'/i);
      expect(result.errors[0]).toMatch(/Double/i);
      expect(result.errors[0]).toMatch(/String/i);
    });

    it('reports error for Quantity * Name (Integer * String)', () => {
      const result = typeCheckFormula('Quantity * Name', columns);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('reports error for unknown column reference', () => {
      const result = typeCheckFormula('NonExistentColumn + 1', columns);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/Unknown column/i);
    });

    it('reports error for unknown function', () => {
      const result = typeCheckFormula('BANANA(Price)', columns);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/Unknown function/i);
    });

    it('reports error for empty expression', () => {
      const result = typeCheckFormula('', columns);
      expect(result.errors).toHaveLength(1);
      expect(result.outputType).toBeUndefined();
    });
  });

  describe('Built-in functions', () => {
    it('infers double for ROUND(Price)', () => {
      const result = typeCheckFormula('ROUND(Price)', columns);
      expect(result.outputType).toBe(ColumnDataType.DOUBLE);
      expect(result.errors).toHaveLength(0);
    });

    it('infers integer for FLOOR(Price)', () => {
      const result = typeCheckFormula('FLOOR(Price)', columns);
      expect(result.outputType).toBe(ColumnDataType.INTEGER);
      expect(result.errors).toHaveLength(0);
    });

    it('infers string for UPPER(Name)', () => {
      const result = typeCheckFormula('UPPER(Name)', columns);
      expect(result.outputType).toBe(ColumnDataType.STRING);
      expect(result.errors).toHaveLength(0);
    });

    it('infers integer for LEN(Name)', () => {
      const result = typeCheckFormula('LEN(Name)', columns);
      expect(result.outputType).toBe(ColumnDataType.INTEGER);
      expect(result.errors).toHaveLength(0);
    });

    it('infers string for CONCAT(Name, Name)', () => {
      const result = typeCheckFormula('CONCAT(Name, Name)', columns);
      expect(result.outputType).toBe(ColumnDataType.STRING);
      expect(result.errors).toHaveLength(0);
    });

    it('infers integer for YEAR(OrderDate)', () => {
      const result = typeCheckFormula('YEAR(OrderDate)', columns);
      expect(result.outputType).toBe(ColumnDataType.INTEGER);
      expect(result.errors).toHaveLength(0);
    });

    it('infers datetime for NOW()', () => {
      const result = typeCheckFormula('NOW()', columns);
      expect(result.outputType).toBe(ColumnDataType.DATETIME);
      expect(result.errors).toHaveLength(0);
    });

    it('infers boolean for IS_NULL(Name)', () => {
      const result = typeCheckFormula('IS_NULL(Name)', columns);
      expect(result.outputType).toBe(ColumnDataType.BOOLEAN);
      expect(result.errors).toHaveLength(0);
    });

    it('reports error when numeric function receives string', () => {
      const result = typeCheckFormula('ROUND(Name)', columns);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/numeric/i);
    });

    it('reports error for too few arguments', () => {
      const result = typeCheckFormula('ROUND()', columns);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/requires at least/i);
    });
  });

  describe('Comparison expressions', () => {
    it('infers boolean for Price > 100', () => {
      const result = typeCheckFormula('Price > 100', columns);
      expect(result.outputType).toBe(ColumnDataType.BOOLEAN);
      expect(result.errors).toHaveLength(0);
    });

    it('infers boolean for Name == "hello"', () => {
      const result = typeCheckFormula('Name == "hello"', columns);
      expect(result.outputType).toBe(ColumnDataType.BOOLEAN);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Column reference tracking', () => {
    it('tracks referenced column IDs', () => {
      const result = typeCheckFormula('Price * Quantity', columns);
      expect(result.referencedColumnIds).toContain('col-price');
      expect(result.referencedColumnIds).toContain('col-qty');
    });

    it('tracks nested column references in functions', () => {
      const result = typeCheckFormula('ROUND(Price + Quantity)', columns);
      expect(result.referencedColumnIds).toContain('col-price');
      expect(result.referencedColumnIds).toContain('col-qty');
    });
  });

  describe('Built-in function list', () => {
    it('returns a non-empty list of built-in functions', () => {
      const names = getBuiltinFunctionNames();
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain('ROUND');
      expect(names).toContain('UPPER');
      expect(names).toContain('YEAR');
    });
  });
});
