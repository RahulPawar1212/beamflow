/**
 * @module @beamflow/schema/formula-parser
 *
 * Design-time formula expression parser and type-checker.
 *
 * This module analyses formula expressions (e.g., "Price * Quantity",
 * "UPPER(Name)") WITHOUT executing them. It:
 *   1. Tokenizes the expression string
 *   2. Parses it into an AST
 *   3. Type-checks against the input schema
 *   4. Returns inferred output type + any errors
 *
 * Supported syntax:
 *   - Column references: identifiers that match a column name
 *   - Numeric literals: 42, 3.14
 *   - String literals: "hello", 'world'
 *   - Arithmetic operators: +, -, *, /
 *   - Comparison operators: ==, !=, <, >, <=, >= (return BOOLEAN)
 *   - Numeric functions: ROUND, ABS, FLOOR, CEIL, SQRT
 *   - String functions:  UPPER, LOWER, TRIM, LEN, CONCAT, SUBSTRING
 *   - Date functions:    YEAR, MONTH, DAY, NOW, DATE_DIFF, DATE_ADD
 *   - Boolean functions: IF, COALESCE, IS_NULL
 *   - Parenthesized sub-expressions
 *
 * No Beam execution occurs. This is pure static analysis.
 */

import type { ColumnSchema, FormulaTypeCheckResult } from './types.js';
import { ColumnDataType, isNumericType, isStringType, arithmeticResultType } from './types.js';

// ─── Token Types ──────────────────────────────────────────────────────────────

type TokenKind =
  | 'identifier'
  | 'number'
  | 'string'
  | 'operator'
  | 'comma'
  | 'lparen'
  | 'rparen'
  | 'eof';

interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

// ─── Known Functions ──────────────────────────────────────────────────────────

interface FunctionDef {
  /** Minimum number of arguments. */
  minArgs: number;
  /** Maximum number of arguments (Infinity = variadic). */
  maxArgs: number;
  /** Accepted argument type category; 'any' skips type checking on args. */
  argType: 'numeric' | 'string' | 'temporal' | 'any';
  /** The output type this function always produces. */
  outputType: ColumnDataType;
}

const FUNCTIONS: Record<string, FunctionDef> = {
  // Numeric
  ROUND:  { minArgs: 1, maxArgs: 2, argType: 'numeric', outputType: ColumnDataType.DOUBLE },
  ABS:    { minArgs: 1, maxArgs: 1, argType: 'numeric', outputType: ColumnDataType.DOUBLE },
  FLOOR:  { minArgs: 1, maxArgs: 1, argType: 'numeric', outputType: ColumnDataType.INTEGER },
  CEIL:   { minArgs: 1, maxArgs: 1, argType: 'numeric', outputType: ColumnDataType.INTEGER },
  SQRT:   { minArgs: 1, maxArgs: 1, argType: 'numeric', outputType: ColumnDataType.DOUBLE },
  // String
  UPPER:     { minArgs: 1, maxArgs: 1, argType: 'string', outputType: ColumnDataType.STRING },
  LOWER:     { minArgs: 1, maxArgs: 1, argType: 'string', outputType: ColumnDataType.STRING },
  TRIM:      { minArgs: 1, maxArgs: 1, argType: 'string', outputType: ColumnDataType.STRING },
  LEN:       { minArgs: 1, maxArgs: 1, argType: 'string', outputType: ColumnDataType.INTEGER },
  CONCAT:    { minArgs: 2, maxArgs: Infinity, argType: 'string', outputType: ColumnDataType.STRING },
  SUBSTRING: { minArgs: 2, maxArgs: 3, argType: 'any', outputType: ColumnDataType.STRING },
  // Date
  YEAR:      { minArgs: 1, maxArgs: 1, argType: 'temporal', outputType: ColumnDataType.INTEGER },
  MONTH:     { minArgs: 1, maxArgs: 1, argType: 'temporal', outputType: ColumnDataType.INTEGER },
  DAY:       { minArgs: 1, maxArgs: 1, argType: 'temporal', outputType: ColumnDataType.INTEGER },
  NOW:       { minArgs: 0, maxArgs: 0, argType: 'any', outputType: ColumnDataType.DATETIME },
  DATE_DIFF: { minArgs: 2, maxArgs: 3, argType: 'temporal', outputType: ColumnDataType.INTEGER },
  DATE_ADD:  { minArgs: 2, maxArgs: 3, argType: 'any', outputType: ColumnDataType.DATE },
  // Boolean / Control
  IF:       { minArgs: 3, maxArgs: 3, argType: 'any', outputType: ColumnDataType.STRING },
  COALESCE: { minArgs: 2, maxArgs: Infinity, argType: 'any', outputType: ColumnDataType.STRING },
  IS_NULL:  { minArgs: 1, maxArgs: 1, argType: 'any', outputType: ColumnDataType.BOOLEAN },
};

// ─── Lexer ────────────────────────────────────────────────────────────────────

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    // Whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // String literals
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < expr.length && expr[j] !== quote) j++;
      tokens.push({ kind: 'string', value: expr.slice(i + 1, j), pos: i });
      i = j + 1;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(expr[i + 1] ?? ''))) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      tokens.push({ kind: 'number', value: expr.slice(i, j), pos: i });
      i = j;
      continue;
    }

    // Identifiers / keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[a-zA-Z0-9_]/.test(expr[j])) j++;
      tokens.push({ kind: 'identifier', value: expr.slice(i, j), pos: i });
      i = j;
      continue;
    }

    // Two-char operators
    if (i + 1 < expr.length) {
      const two = expr.slice(i, i + 2);
      if (['==', '!=', '<=', '>='].includes(two)) {
        tokens.push({ kind: 'operator', value: two, pos: i });
        i += 2;
        continue;
      }
    }

    // Single-char operators and punctuation
    if (['+', '-', '*', '/', '<', '>'].includes(ch)) {
      tokens.push({ kind: 'operator', value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === '(') { tokens.push({ kind: 'lparen', value: ch, pos: i }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen', value: ch, pos: i }); i++; continue; }
    if (ch === ',') { tokens.push({ kind: 'comma',  value: ch, pos: i }); i++; continue; }

    // Unknown — skip with error tracking via pos
    i++;
  }

  tokens.push({ kind: 'eof', value: '', pos: expr.length });
  return tokens;
}

// ─── Parser + Type-checker ────────────────────────────────────────────────────

/**
 * Recursive-descent parser that simultaneously infers types.
 * Returns the inferred ColumnDataType, or throws a descriptive error string.
 */
class TypeCheckingParser {
  private pos = 0;
  readonly errors: string[] = [];
  readonly warnings: string[] = [];
  readonly referencedColumnIds: string[] = [];

  constructor(
    private readonly tokens: Token[],
    private readonly columns: readonly ColumnSchema[],
  ) {}

  private peek(): Token { return this.tokens[this.pos]; }
  private consume(): Token { return this.tokens[this.pos++]; }

  private columnByName(name: string): ColumnSchema | undefined {
    // Case-insensitive lookup
    return this.columns.find(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
  }

  /** Top-level: parse a comparison or arithmetic expression. */
  parseExpression(): ColumnDataType | undefined {
    const left = this.parseAddSub();
    const op = this.peek();
    if (op.kind === 'operator' && ['==', '!=', '<', '>', '<=', '>='].includes(op.value)) {
      this.consume();
      this.parseAddSub(); // right side (type not checked for comparisons)
      return ColumnDataType.BOOLEAN;
    }
    return left;
  }

  private parseAddSub(): ColumnDataType | undefined {
    let left = this.parseMulDiv();
    while (this.peek().kind === 'operator' && ['+', '-'].includes(this.peek().value)) {
      const op = this.consume();
      const right = this.parseMulDiv();
      if (left !== undefined && right !== undefined) {
        const result = arithmeticResultType(left, right);
        if (result === undefined) {
          this.errors.push(
            `Cannot apply '${op.value}' to ${this.typeName(left)} and ${this.typeName(right)}.`,
          );
          left = undefined;
        } else {
          left = result;
        }
      } else {
        left = undefined;
      }
    }
    return left;
  }

  private parseMulDiv(): ColumnDataType | undefined {
    let left = this.parseUnary();
    while (this.peek().kind === 'operator' && ['*', '/'].includes(this.peek().value)) {
      const op = this.consume();
      const right = this.parseUnary();
      if (left !== undefined && right !== undefined) {
        const result = arithmeticResultType(left, right);
        if (result === undefined) {
          this.errors.push(
            `Cannot apply '${op.value}' to ${this.typeName(left)} and ${this.typeName(right)}.`,
          );
          left = undefined;
        } else {
          left = result;
        }
      } else {
        left = undefined;
      }
    }
    return left;
  }

  private parseUnary(): ColumnDataType | undefined {
    if (this.peek().kind === 'operator' && this.peek().value === '-') {
      this.consume();
      const inner = this.parsePrimary();
      if (inner !== undefined && !isNumericType(inner)) {
        this.errors.push(`Unary minus cannot be applied to ${this.typeName(inner)}.`);
        return undefined;
      }
      return inner;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ColumnDataType | undefined {
    const tok = this.peek();

    // Parenthesized expression
    if (tok.kind === 'lparen') {
      this.consume();
      const inner = this.parseExpression();
      if (this.peek().kind === 'rparen') this.consume();
      return inner;
    }

    // Number literal
    if (tok.kind === 'number') {
      this.consume();
      return tok.value.includes('.')
        ? ColumnDataType.DOUBLE
        : ColumnDataType.INTEGER;
    }

    // String literal
    if (tok.kind === 'string') {
      this.consume();
      return ColumnDataType.STRING;
    }

    // Boolean literals
    if (tok.kind === 'identifier' && (tok.value.toUpperCase() === 'TRUE' || tok.value.toUpperCase() === 'FALSE')) {
      this.consume();
      return ColumnDataType.BOOLEAN;
    }

    // Null literal
    if (tok.kind === 'identifier' && tok.value.toUpperCase() === 'NULL') {
      this.consume();
      return undefined; // null has no type
    }

    // Function call or column reference
    if (tok.kind === 'identifier') {
      this.consume();
      const upper = tok.value.toUpperCase();

      // Function call
      if (this.peek().kind === 'lparen') {
        return this.parseFunctionCall(upper, tok.pos);
      }

      // Column reference
      const col = this.columnByName(tok.value);
      if (col) {
        if (!this.referencedColumnIds.includes(col.id)) {
          this.referencedColumnIds.push(col.id);
        }
        return col.type;
      }

      this.errors.push(`Unknown column or function: "${tok.value}".`);
      return undefined;
    }

    if (tok.kind !== 'eof') {
      this.errors.push(`Unexpected token "${tok.value}" at position ${tok.pos}.`);
      this.consume();
    }
    return undefined;
  }

  private parseFunctionCall(name: string, pos: number): ColumnDataType | undefined {
    this.consume(); // consume '('

    const funcDef = FUNCTIONS[name];
    if (!funcDef) {
      this.errors.push(`Unknown function: ${name}().`);
      // Consume arguments to recover
      let depth = 1;
      while (this.peek().kind !== 'eof' && depth > 0) {
        if (this.peek().kind === 'lparen') depth++;
        if (this.peek().kind === 'rparen') depth--;
        this.consume();
      }
      return undefined;
    }

    // Parse arguments
    const argTypes: (ColumnDataType | undefined)[] = [];
    while (this.peek().kind !== 'rparen' && this.peek().kind !== 'eof') {
      argTypes.push(this.parseExpression());
      if (this.peek().kind === 'comma') this.consume();
    }
    if (this.peek().kind === 'rparen') this.consume();

    // Validate arg count
    if (argTypes.length < funcDef.minArgs) {
      this.errors.push(
        `${name}() requires at least ${funcDef.minArgs} argument(s), got ${argTypes.length}.`,
      );
      return funcDef.outputType;
    }
    if (argTypes.length > funcDef.maxArgs) {
      this.errors.push(
        `${name}() accepts at most ${funcDef.maxArgs} argument(s), got ${argTypes.length}.`,
      );
      return funcDef.outputType;
    }

    // Validate arg types
    for (let i = 0; i < argTypes.length; i++) {
      const argType = argTypes[i];
      if (argType === undefined) continue; // already errored on that arg
      if (funcDef.argType === 'numeric' && !isNumericType(argType)) {
        this.errors.push(
          `Argument ${i + 1} of ${name}() must be numeric, got ${this.typeName(argType)}.`,
        );
      } else if (funcDef.argType === 'string' && !isStringType(argType)) {
        this.errors.push(
          `Argument ${i + 1} of ${name}() must be a string, got ${this.typeName(argType)}.`,
        );
      }
    }

    // Special: IF(cond, trueVal, falseVal) — return type matches trueVal
    if (name === 'IF' && argTypes.length === 3 && argTypes[1] !== undefined) {
      return argTypes[1];
    }

    // Special: COALESCE — return type of first non-null arg
    if (name === 'COALESCE' && argTypes.length > 0 && argTypes[0] !== undefined) {
      return argTypes[0];
    }

    return funcDef.outputType;
  }

  private typeName(type: ColumnDataType | undefined): string {
    if (type === undefined) return 'unknown';
    const names: Record<ColumnDataType, string> = {
      [ColumnDataType.STRING]: 'String',
      [ColumnDataType.INTEGER]: 'Integer',
      [ColumnDataType.DOUBLE]: 'Double',
      [ColumnDataType.BOOLEAN]: 'Boolean',
      [ColumnDataType.DATE]: 'Date',
      [ColumnDataType.DATETIME]: 'DateTime',
      [ColumnDataType.TIME]: 'Time',
      [ColumnDataType.DECIMAL]: 'Decimal',
      [ColumnDataType.BYTES]: 'Bytes',
    };
    return names[type];
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Type-check a formula expression against an input schema.
 *
 * @param expression - The formula string, e.g. "Price * Quantity" or "UPPER(Name)"
 * @param columns - The columns available in the input schema
 * @returns Type-check result including inferred output type and any errors
 *
 * @example
 * const result = typeCheckFormula('Price * Quantity', schema.columns);
 * // result.outputType === ColumnDataType.DOUBLE
 * // result.errors === []
 *
 * @example
 * const result = typeCheckFormula('Price + Name', schema.columns);
 * // result.outputType === undefined
 * // result.errors === ["Cannot apply '+' to Double and String."]
 */
export function typeCheckFormula(
  expression: string,
  columns: readonly ColumnSchema[],
): FormulaTypeCheckResult {
  const trimmed = expression.trim();
  if (!trimmed) {
    return {
      outputType: undefined,
      errors: ['Formula expression is empty.'],
      warnings: [],
      referencedColumnIds: [],
    };
  }

  const tokens = tokenize(trimmed);
  const parser = new TypeCheckingParser(tokens, columns);
  const outputType = parser.parseExpression();

  return {
    outputType,
    errors: parser.errors,
    warnings: parser.warnings,
    referencedColumnIds: parser.referencedColumnIds,
  };
}

/**
 * Returns a list of all built-in function names, useful for autocomplete.
 */
export function getBuiltinFunctionNames(): string[] {
  return Object.keys(FUNCTIONS);
}

/**
 * Returns function metadata for a given function name (for autocomplete hints).
 */
export function getFunctionDef(name: string): FunctionDef | undefined {
  return FUNCTIONS[name.toUpperCase()];
}
