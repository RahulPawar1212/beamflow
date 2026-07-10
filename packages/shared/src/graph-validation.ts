/**
 * @module @beamflow/shared/graph-validation
 *
 * Structural graph validation shared by the server's authoritative `DAG.validate()`
 * (`packages/graph/src/dag.ts`) and the editor's LIVE, design-time canvas check.
 *
 * Two checks, both PURE (no I/O):
 *  - Orphan nodes: a node with no incoming AND no outgoing edge at all — it's
 *    visually present but not actually part of the pipeline.
 *  - Unconnected required input ports: a node whose port definition marks an
 *    input port `required` but no edge targets that port id.
 *
 * These were previously only enforced server-side, surfacing solely as a hard
 * 400 at Generate/Execute time — invisible while editing. Extracting them here
 * lets the editor run the identical logic live, flagging the offending node via
 * the same generic node-issue-badge mechanism used for subflow issues
 * (see `resolveSubflowInputBoundary` / `NodeIssueBadge`), so "this looks wired
 * but isn't" is caught the moment it happens, not just at Generate/Run.
 */

/** Minimal node shape: just an id + type (+ optional flag for inline-IR nodes). */
export interface GraphNodeLite {
  id: string;
  type: string;
  /** Custom/user-authored nodes carry their own IR and have no registry entry —
   *  skip the required-input-port check for them (same as DAG.validate() does). */
  hasInlineIR?: boolean;
}

/** Minimal directed edge shape, with the target port id for port-level checks. */
export interface GraphEdgeLite {
  sourceNodeId: string;
  targetNodeId: string;
  targetPortId: string;
}

/** Minimal port definition: enough to find required input ports. */
export interface GraphPortLite {
  id: string;
  name: string;
  direction: string;
  required: boolean;
}

/** Minimal node-type lookup: given a type string, its ports (or undefined if unknown). */
export type GraphPortLookup = (nodeType: string) => readonly GraphPortLite[] | undefined;

export interface GraphStructureIssue {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly nodeId: string;
}

/**
 * @param nodes         every node in the graph
 * @param edges         every edge in the graph
 * @param resolvePorts  looks up a node type's port definitions; omit to skip
 *   the required-input-port check entirely (orphan detection still runs)
 */
export function validateGraphStructure(
  nodes: readonly GraphNodeLite[],
  edges: readonly GraphEdgeLite[],
  resolvePorts?: GraphPortLookup,
): GraphStructureIssue[] {
  const issues: GraphStructureIssue[] = [];

  const incomingCount = new Map<string, number>();
  const outgoingCount = new Map<string, number>();
  for (const e of edges) {
    outgoingCount.set(e.sourceNodeId, (outgoingCount.get(e.sourceNodeId) ?? 0) + 1);
    incomingCount.set(e.targetNodeId, (incomingCount.get(e.targetNodeId) ?? 0) + 1);
  }

  // Orphan nodes: no connections at all.
  for (const node of nodes) {
    const hasIncoming = (incomingCount.get(node.id) ?? 0) > 0;
    const hasOutgoing = (outgoingCount.get(node.id) ?? 0) > 0;
    if (!hasIncoming && !hasOutgoing) {
      issues.push({
        severity: 'warning',
        message: 'Node is not connected to any other node.',
        nodeId: node.id,
      });
    }
  }

  // Required input ports without a connection.
  if (resolvePorts) {
    for (const node of nodes) {
      if (node.hasInlineIR) continue;

      const ports = resolvePorts(node.type);
      if (!ports) continue; // unknown type — DAG.validate() flags this separately

      const requiredInputPorts = ports.filter((p) => p.direction === 'input' && p.required);
      for (const port of requiredInputPorts) {
        const hasConnection = edges.some(
          (e) => e.targetNodeId === node.id && e.targetPortId === port.id,
        );
        if (!hasConnection) {
          issues.push({
            severity: 'error',
            message: `Required input port "${port.name}" is not connected.`,
            nodeId: node.id,
          });
        }
      }
    }
  }

  return issues;
}
