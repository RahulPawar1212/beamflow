/**
 * Tests for the schema validation engine.
 */
import { describe, it, expect } from 'vitest';
import { SchemaValidator } from './validation.js';
import { ColumnDataType, SchemaValidationSeverity } from './types.js';
import type { PipelineSchema } from './types.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeSchema(
  cols: Array<{ name: string; type: ColumnDataType }>,
  version = 1,
): PipelineSchema {
  return {
    version,
    columns: cols.map((c, i) => ({
      id: `col-${i}-${c.name}`,
      name: c.name,
      type: c.type,
      nullable: true,
      sourceNodeId: 'test-node',
    })),
  };
}

const salesSchema = makeSchema([
  { name: 'Region', type: ColumnDataType.STRING },
  { name: 'Sales', type: ColumnDataType.DOUBLE },
  { name: 'Quantity', type: ColumnDataType.INTEGER },
]);

const productSchema = makeSchema([
  { name: 'ProductId', type: ColumnDataType.INTEGER },
  { name: 'ProductName', type: ColumnDataType.STRING },
  { name: 'Price', type: ColumnDataType.DOUBLE },
]);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SchemaValidator', () => {
  const validator = new SchemaValidator();

  // ─── Column existence ──────────────────────────────────────────────

  describe('validateColumnsExist', () => {
    it('passes when all columns exist', () => {
      const issues = validator.validateColumnsExist(salesSchema, ['Region', 'Sales']);
      expect(issues).toHaveLength(0);
    });

    it('reports error for missing column', () => {
      const issues = validator.validateColumnsExist(salesSchema, ['Region', 'Revenue']);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe(SchemaValidationSeverity.Error);
      expect(issues[0].message).toMatch(/Revenue/);
    });

    it('is case-insensitive', () => {
      const issues = validator.validateColumnsExist(salesSchema, ['region', 'SALES']);
      expect(issues).toHaveLength(0);
    });
  });

  // ─── Duplicate detection ───────────────────────────────────────────

  describe('validateNoDuplicates', () => {
    it('passes for clean schema', () => {
      const issues = validator.validateNoDuplicates(salesSchema);
      expect(issues).toHaveLength(0);
    });

    it('reports duplicate column names', () => {
      const dupeSchema = makeSchema([
        { name: 'Region', type: ColumnDataType.STRING },
        { name: 'Region', type: ColumnDataType.STRING },
      ]);
      const issues = validator.validateNoDuplicates(dupeSchema);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe(SchemaValidationSeverity.Error);
    });
  });

  // ─── Join validation ───────────────────────────────────────────────

  describe('validateJoin', () => {
    it('passes for compatible join keys', () => {
      const leftSchema = makeSchema([
        { name: 'OrderId', type: ColumnDataType.INTEGER },
        { name: 'Amount', type: ColumnDataType.DOUBLE },
      ]);
      const rightSchema = makeSchema([
        { name: 'OrderId', type: ColumnDataType.INTEGER },
        { name: 'CustomerName', type: ColumnDataType.STRING },
      ]);

      const issues = validator.validateJoin(leftSchema, rightSchema, 'OrderId', 'OrderId');
      expect(issues).toHaveLength(0);
    });

    it('reports error when left join key does not exist', () => {
      const issues = validator.validateJoin(salesSchema, productSchema, 'NonExistent', 'ProductId');
      expect(issues.some((i) => i.severity === SchemaValidationSeverity.Error)).toBe(true);
      expect(issues.some((i) => i.message.match(/NonExistent/))).toBe(true);
    });

    it('reports error when right join key does not exist', () => {
      const issues = validator.validateJoin(salesSchema, productSchema, 'Region', 'Missing');
      expect(issues.some((i) => i.message.match(/Missing/))).toBe(true);
    });

    it('reports error for type-incompatible join (String vs Integer)', () => {
      // Region (String) joined to ProductId (Integer)
      const issues = validator.validateJoin(salesSchema, productSchema, 'Region', 'ProductId');
      expect(issues.some((i) => i.severity === SchemaValidationSeverity.Error)).toBe(true);
      expect(issues.some((i) => i.message.match(/mismatch|incompatible/i))).toBe(true);
    });

    it('warns for compatible but non-identical types (Integer vs Double)', () => {
      const leftSchema = makeSchema([{ name: 'Key', type: ColumnDataType.INTEGER }]);
      const rightSchema = makeSchema([{ name: 'Key', type: ColumnDataType.DOUBLE }]);
      const issues = validator.validateJoin(leftSchema, rightSchema, 'Key', 'Key');
      // Should warn but not error
      expect(issues.some((i) => i.severity === SchemaValidationSeverity.Warning)).toBe(true);
      expect(issues.some((i) => i.severity === SchemaValidationSeverity.Error)).toBe(false);
    });
  });

  // ─── Union validation ──────────────────────────────────────────────

  describe('validateUnion', () => {
    it('passes for identical schemas', () => {
      const schema1 = makeSchema([
        { name: 'Region', type: ColumnDataType.STRING },
        { name: 'Sales', type: ColumnDataType.DOUBLE },
      ]);
      const schema2 = makeSchema([
        { name: 'Region', type: ColumnDataType.STRING },
        { name: 'Sales', type: ColumnDataType.DOUBLE },
      ]);
      const issues = validator.validateUnion([schema1, schema2]);
      expect(issues).toHaveLength(0);
    });

    it('reports error for schemas with different column counts', () => {
      const schema1 = makeSchema([{ name: 'A', type: ColumnDataType.STRING }]);
      const schema2 = makeSchema([
        { name: 'A', type: ColumnDataType.STRING },
        { name: 'B', type: ColumnDataType.STRING },
      ]);
      const issues = validator.validateUnion([schema1, schema2]);
      expect(issues.some((i) => i.severity === SchemaValidationSeverity.Error)).toBe(true);
    });

    it('reports error for missing column in second schema', () => {
      const schema1 = makeSchema([{ name: 'Region', type: ColumnDataType.STRING }]);
      const schema2 = makeSchema([{ name: 'Country', type: ColumnDataType.STRING }]);
      const issues = validator.validateUnion([schema1, schema2]);
      expect(issues.some((i) => i.severity === SchemaValidationSeverity.Error)).toBe(true);
      expect(issues.some((i) => i.message.match(/Region/))).toBe(true);
    });

    it('warns for type mismatches between compatible schemas', () => {
      const schema1 = makeSchema([{ name: 'Value', type: ColumnDataType.DOUBLE }]);
      const schema2 = makeSchema([{ name: 'Value', type: ColumnDataType.INTEGER }]);
      const issues = validator.validateUnion([schema1, schema2]);
      // Warn but don't error (same column name, different numeric type)
      expect(issues.some((i) => i.severity === SchemaValidationSeverity.Warning)).toBe(true);
    });

    it('requires at least 2 schemas', () => {
      const issues = validator.validateUnion([salesSchema]);
      expect(issues.some((i) => i.severity === SchemaValidationSeverity.Error)).toBe(true);
    });
  });

  // ─── Formula validation ────────────────────────────────────────────

  describe('validateFormula', () => {
    it('passes for a valid numeric formula', () => {
      const issues = validator.validateFormula('Sales + Quantity', salesSchema, 'Total');
      expect(issues).toHaveLength(0);
    });

    it('reports error for type-incompatible formula', () => {
      const issues = validator.validateFormula('Sales + Region', salesSchema, 'BadCol');
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe(SchemaValidationSeverity.Error);
      expect(issues[0].message).toMatch(/Double.*String|String.*Double/i);
    });

    it('includes the output column name in the error', () => {
      const issues = validator.validateFormula('Sales + Region', salesSchema, 'MyOutput');
      expect(issues[0].message).toMatch(/MyOutput/);
    });
  });

  // ─── Aggregate validation ──────────────────────────────────────────

  describe('validateAggregate', () => {
    it('passes for valid group-by + aggregation configuration', () => {
      const issues = validator.validateAggregate(
        salesSchema,
        ['Region'],
        [
          { column: 'Sales', func: 'SUM', outputName: 'TotalSales' },
          { column: 'Quantity', func: 'AVG', outputName: 'AvgQty' },
        ],
      );
      expect(issues).toHaveLength(0);
    });

    it('reports error for invalid group-by column', () => {
      const issues = validator.validateAggregate(
        salesSchema,
        ['NonExistent'],
        [{ column: 'Sales', func: 'SUM', outputName: 'Total' }],
      );
      expect(issues.some((i) => i.message.match(/NonExistent/))).toBe(true);
    });

    it('reports error for SUM on string column', () => {
      const issues = validator.validateAggregate(
        salesSchema,
        ['Region'],
        [{ column: 'Region', func: 'SUM', outputName: 'SumRegion' }],
      );
      expect(issues.some((i) => i.severity === SchemaValidationSeverity.Error)).toBe(true);
      expect(issues.some((i) => i.message.match(/numeric/i))).toBe(true);
    });

    it('passes COUNT on string column (COUNT is type-agnostic)', () => {
      const issues = validator.validateAggregate(
        salesSchema,
        [],
        [{ column: 'Region', func: 'COUNT', outputName: 'RegionCount' }],
      );
      expect(issues.every((i) => i.severity !== SchemaValidationSeverity.Error)).toBe(true);
    });
  });

  // ─── Rename validation ─────────────────────────────────────────────

  describe('validateRename', () => {
    it('passes for valid renames', () => {
      const issues = validator.validateRename(
        salesSchema,
        [{ from: 'Region', to: 'Territory' }],
      );
      expect(issues).toHaveLength(0);
    });

    it('reports error for renaming a non-existent column', () => {
      const issues = validator.validateRename(
        salesSchema,
        [{ from: 'Ghost', to: 'NewName' }],
      );
      expect(issues.some((i) => i.message.match(/Ghost/))).toBe(true);
    });

    it('reports error for empty target name', () => {
      const issues = validator.validateRename(
        salesSchema,
        [{ from: 'Region', to: '' }],
      );
      expect(issues.some((i) => i.severity === SchemaValidationSeverity.Error)).toBe(true);
    });
  });
});
