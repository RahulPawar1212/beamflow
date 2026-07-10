/**
 * @module @beamflow/graph/dag
 *
 * The standalone DAG (Directed Acyclic Graph) model for BeamFlow workflows.
 *
 * Design decisions:
 * - Completely decoupled from React Flow's internal graph model
 * - Pure logic, no UI dependencies — fully testable
 * - Uses Kahn's algorithm for topological sort (O(V+E))
 * - Validation includes cycle detection, orphan detection, port compatibility
 */

import type {
  INodeInstance,
  IConnection,
  INodeDefinition,
  ValidationIssue,
} from '@beamflow/shared';
import { ValidationSeverity, validateGraphStructure } from '@beamflow/shared';
import type { NodeRegistry } from '@beamflow/core';

/**
 * A Directed Acyclic Graph representing a BeamFlow workflow.
 * Nodes are pipeline steps; edges represent data flow between ports.
 */
export class DAG {
  private readonly nodes = new Map<string, INodeInstance>();
  private readonly edges = new Map<string, IConnection>();

  // Adjacency lists for fast traversal
  private readonly outgoing = new Map<string, Set<string>>(); // nodeId → set of edge IDs
  private readonly incoming = new Map<string, Set<string>>(); // nodeId → set of edge IDs

  // ─── Node operations ───────────────────────────────────────────────

  addNode(node: INodeInstance): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node "${node.id}" already exists in the graph.`);
    }
    this.nodes.set(node.id, node);
    this.outgoing.set(node.id, new Set());
    this.incoming.set(node.id, new Set());
  }

  removeNode(id: string): void {
    if (!this.nodes.has(id)) return;

    // Remove all edges connected to this node
    const edgesToRemove = [
      ...(this.outgoing.get(id) || []),
      ...(this.incoming.get(id) || []),
    ];
    for (const edgeId of edgesToRemove) {
      this.removeEdge(edgeId);
    }

    this.nodes.delete(id);
    this.outgoing.delete(id);
    this.incoming.delete(id);
  }

  getNode(id: string): INodeInstance | undefined {
    return this.nodes.get(id);
  }

  getAllNodes(): INodeInstance[] {
    return Array.from(this.nodes.values());
  }

  updateNodeSettings(
    id: string,
    settings: Record<string, unknown>,
  ): void {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Node "${id}" not found.`);
    // Create new immutable instance
    this.nodes.set(id, { ...node, settings: { ...node.settings, ...settings } });
  }

  // ─── Edge operations ───────────────────────────────────────────────

  addEdge(connection: IConnection): void {
    if (this.edges.has(connection.id)) {
      throw new Error(`Edge "${connection.id}" already exists.`);
    }
    if (!this.nodes.has(connection.sourceNodeId)) {
      throw new Error(`Source node "${connection.sourceNodeId}" not found.`);
    }
    if (!this.nodes.has(connection.targetNodeId)) {
      throw new Error(`Target node "${connection.targetNodeId}" not found.`);
    }
    if (connection.sourceNodeId === connection.targetNodeId) {
      throw new Error('Self-loops are not allowed.');
    }

    this.edges.set(connection.id, connection);
    this.outgoing.get(connection.sourceNodeId)!.add(connection.id);
    this.incoming.get(connection.targetNodeId)!.add(connection.id);
  }

  removeEdge(id: string): void {
    const edge = this.edges.get(id);
    if (!edge) return;

    this.outgoing.get(edge.sourceNodeId)?.delete(id);
    this.incoming.get(edge.targetNodeId)?.delete(id);
    this.edges.delete(id);
  }

  getEdge(id: string): IConnection | undefined {
    return this.edges.get(id);
  }

  getAllEdges(): IConnection[] {
    return Array.from(this.edges.values());
  }

  // ─── Graph traversal ──────────────────────────────────────────────

  /**
   * Get all nodes upstream of a given node (i.e., nodes that feed into it).
   */
  getUpstream(nodeId: string): INodeInstance[] {
    const incomingEdges = this.incoming.get(nodeId) || new Set();
    const upstream: INodeInstance[] = [];
    for (const edgeId of incomingEdges) {
      const edge = this.edges.get(edgeId)!;
      const node = this.nodes.get(edge.sourceNodeId);
      if (node) upstream.push(node);
    }
    return upstream;
  }

  /**
   * Get all nodes downstream of a given node (i.e., nodes it feeds into).
   */
  getDownstream(nodeId: string): INodeInstance[] {
    const outgoingEdges = this.outgoing.get(nodeId) || new Set();
    const downstream: INodeInstance[] = [];
    for (const edgeId of outgoingEdges) {
      const edge = this.edges.get(edgeId)!;
      const node = this.nodes.get(edge.targetNodeId);
      if (node) downstream.push(node);
    }
    return downstream;
  }

  /**
   * Get all edges connected to a given node.
   */
  getNodeEdges(nodeId: string): IConnection[] {
    const edgeIds = new Set([
      ...(this.outgoing.get(nodeId) || []),
      ...(this.incoming.get(nodeId) || []),
    ]);
    return Array.from(edgeIds)
      .map((id) => this.edges.get(id))
      .filter((e): e is IConnection => e !== undefined);
  }

  // ─── Topological sort ─────────────────────────────────────────────

  /**
   * Topological sort using Kahn's algorithm.
   * Returns nodes in execution order (dependencies before dependents).
   *
   * @throws Error if the graph contains a cycle.
   */
  topologicalSort(): INodeInstance[] {
    // Build in-degree map
    const inDegree = new Map<string, number>();
    for (const nodeId of this.nodes.keys()) {
      inDegree.set(nodeId, 0);
    }
    for (const edge of this.edges.values()) {
      inDegree.set(
        edge.targetNodeId,
        (inDegree.get(edge.targetNodeId) || 0) + 1,
      );
    }

    // Initialize queue with nodes that have no incoming edges
    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree.entries()) {
      if (degree === 0) queue.push(nodeId);
    }

    const sorted: INodeInstance[] = [];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const node = this.nodes.get(nodeId)!;
      sorted.push(node);

      // Reduce in-degree for downstream nodes
      const outEdges = this.outgoing.get(nodeId) || new Set();
      for (const edgeId of outEdges) {
        const edge = this.edges.get(edgeId)!;
        const newDegree = (inDegree.get(edge.targetNodeId) || 1) - 1;
        inDegree.set(edge.targetNodeId, newDegree);
        if (newDegree === 0) {
          queue.push(edge.targetNodeId);
        }
      }
    }

    if (sorted.length !== this.nodes.size) {
      throw new Error(
        'Graph contains a cycle. Pipelines must be acyclic (DAG).',
      );
    }

    return sorted;
  }

  // ─── Validation ───────────────────────────────────────────────────

  /**
   * Validate the entire graph structure.
   * Checks: cycles, orphans, dangling edges, port compatibility.
   */
  validate(registry?: NodeRegistry): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for cycles
    try {
      this.topologicalSort();
    } catch {
      issues.push({
        severity: ValidationSeverity.Error,
        message: 'The pipeline contains a cycle. Remove circular connections.',
      });
    }

    // Unknown node types get their own error here (registry lookup isn't part
    // of the shared structural check below, which just skips types it can't
    // resolve ports for).
    if (registry) {
      for (const [nodeId, node] of this.nodes) {
        if (node.inlineIR) continue;
        if (!registry.get(node.type)) {
          issues.push({
            severity: ValidationSeverity.Error,
            message: `Unknown node type "${node.type}". The required plugin may not be loaded.`,
            nodeId,
          });
        }
      }
    }

    // Orphan nodes + unconnected required input ports — shared with the
    // editor's live canvas check (packages/shared/src/graph-validation.ts).
    const structureIssues = validateGraphStructure(
      Array.from(this.nodes.values()).map((n) => ({ id: n.id, type: n.type, hasInlineIR: !!n.inlineIR })),
      this.getAllEdges().map((e) => ({
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        targetPortId: e.targetPortId,
      })),
      registry ? (nodeType) => registry.get(nodeType)?.ports : undefined,
    );
    for (const si of structureIssues) {
      issues.push({
        severity: si.severity === 'error' ? ValidationSeverity.Error : ValidationSeverity.Warning,
        message: si.message,
        nodeId: si.nodeId,
      });
    }

    return issues;
  }

  // ─── Utility ──────────────────────────────────────────────────────

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }

  isEmpty(): boolean {
    return this.nodes.size === 0;
  }
}
