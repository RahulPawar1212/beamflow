/**
 * @module @beamflow/schema/lineage
 *
 * Column lineage tracker for BeamFlow pipelines.
 *
 * Lineage answers questions like:
 * - "Where did column X originally come from?"
 * - "Which columns depend on column X?" (impact analysis)
 * - "What transformations does column X go through?"
 *
 * This data is used for:
 * - Lineage visualization in the editor
 * - AI explanations ("this Total column was computed from Price and Quantity")
 * - Impact analysis ("if I rename Price, these 3 downstream columns break")
 * - Documentation generation
 */

import type { PipelineSchema, ColumnSchema } from './types.js';

// ─── Lineage Graph Node ───────────────────────────────────────────────────────

/** A column's position in the lineage graph. */
export interface ColumnLineageNode {
  /** The stable column ID. */
  readonly columnId: string;
  /** The column name at this point in the pipeline. */
  readonly columnName: string;
  /** The node that owns this column. */
  readonly nodeId: string;
  /** Column IDs this column was derived from (parents in the lineage graph). */
  readonly parents: readonly string[];
  /** Column IDs that derive from this column (children in the lineage graph). */
  readonly children: string[];
}

/** Full lineage result for a single column. */
export interface ColumnLineage {
  /** The requested column. */
  readonly column: ColumnLineageNode;
  /** All ancestor columns (transitive parents). */
  readonly ancestors: ColumnLineageNode[];
  /** All descendant columns (transitive children). */
  readonly descendants: ColumnLineageNode[];
  /** The original source node and column name. */
  readonly origin: { nodeId: string; columnName: string } | undefined;
}

// ─── Lineage Tracker ──────────────────────────────────────────────────────────

export class LineageTracker {
  /** Map<columnId, ColumnLineageNode> */
  private readonly graph = new Map<string, ColumnLineageNode>();

  /**
   * Index a schema from a node, adding all its columns to the lineage graph.
   * Call this after the propagation engine computes a node's output schema.
   */
  indexSchema(nodeId: string, schema: PipelineSchema): void {
    for (const col of schema.columns) {
      // Create or update the lineage node for this column
      const existing = this.graph.get(col.id);
      const parents = col.derivedFrom ? [...col.derivedFrom] : [];

      const lineageNode: ColumnLineageNode = {
        columnId: col.id,
        columnName: col.name,
        nodeId,
        parents,
        children: existing?.children ?? [],
      };
      this.graph.set(col.id, lineageNode);

      // Register this column as a child of its parents
      for (const parentId of parents) {
        const parent = this.graph.get(parentId);
        if (parent && !parent.children.includes(col.id)) {
          parent.children.push(col.id);
        }
      }
    }
  }

  /**
   * Remove all columns associated with a node (e.g., when a node is removed).
   */
  removeNode(nodeId: string): void {
    for (const [columnId, node] of this.graph) {
      if (node.nodeId === nodeId) {
        // Remove this column as a child from its parents
        for (const parentId of node.parents) {
          const parent = this.graph.get(parentId);
          if (parent) {
            const idx = parent.children.indexOf(columnId);
            if (idx !== -1) parent.children.splice(idx, 1);
          }
        }
        this.graph.delete(columnId);
      }
    }
  }

  /**
   * Get the full lineage for a column (ancestors + descendants).
   * Returns undefined if the column is not in the lineage graph.
   */
  getLineage(columnId: string): ColumnLineage | undefined {
    const column = this.graph.get(columnId);
    if (!column) return undefined;

    const ancestors = this.collectAncestors(columnId);
    const descendants = this.collectDescendants(columnId);
    const origin = this.findOrigin(columnId);

    return { column, ancestors, descendants, origin };
  }

  /**
   * Find all columns that would be affected if the given column changes.
   * Used for impact analysis (e.g., "if I rename this column, what breaks?").
   */
  getImpactedColumns(columnId: string): ColumnLineageNode[] {
    return this.collectDescendants(columnId);
  }

  /**
   * Get all columns in the lineage graph for a specific node.
   */
  getColumnsForNode(nodeId: string): ColumnLineageNode[] {
    return Array.from(this.graph.values()).filter((n) => n.nodeId === nodeId);
  }

  /**
   * Serialize the lineage graph as a list of {source, target} edges.
   * Useful for rendering lineage diagrams.
   */
  getEdges(): Array<{ sourceColumnId: string; targetColumnId: string }> {
    const edges: Array<{ sourceColumnId: string; targetColumnId: string }> = [];
    for (const node of this.graph.values()) {
      for (const childId of node.children) {
        edges.push({ sourceColumnId: node.columnId, targetColumnId: childId });
      }
    }
    return edges;
  }

  /**
   * Clear all lineage data (e.g., when a new workflow is loaded).
   */
  clear(): void {
    this.graph.clear();
  }

  /** Total number of columns tracked. */
  get columnCount(): number {
    return this.graph.size;
  }

  // ─── Private helpers ─────────────────────────────────────────────

  private collectAncestors(columnId: string): ColumnLineageNode[] {
    const result: ColumnLineageNode[] = [];
    const visited = new Set<string>();
    const queue = [...(this.graph.get(columnId)?.parents ?? [])];

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const node = this.graph.get(id);
      if (node) {
        result.push(node);
        queue.push(...node.parents);
      }
    }
    return result;
  }

  private collectDescendants(columnId: string): ColumnLineageNode[] {
    const result: ColumnLineageNode[] = [];
    const visited = new Set<string>();
    const queue = [...(this.graph.get(columnId)?.children ?? [])];

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const node = this.graph.get(id);
      if (node) {
        result.push(node);
        queue.push(...node.children);
      }
    }
    return result;
  }

  private findOrigin(
    columnId: string,
  ): { nodeId: string; columnName: string } | undefined {
    const visited = new Set<string>();
    let current = this.graph.get(columnId);

    while (current && current.parents.length > 0) {
      if (visited.has(current.columnId)) break; // cycle guard
      visited.add(current.columnId);
      // Follow the first parent (primary lineage chain)
      current = this.graph.get(current.parents[0]);
    }

    if (!current) return undefined;
    return { nodeId: current.nodeId, columnName: current.columnName };
  }
}

/** Global default lineage tracker instance. */
export const lineageTracker = new LineageTracker();
