/**
 * @module @beamflow/shared/subflow-outputs
 *
 * Resolve which internal node(s) of a subflow feed its output boundary.
 *
 * A subflow returns data to its parent through its output boundary. Historically
 * that boundary was an explicit `system:subflow-output` node the user managed —
 * but a subflow can end up with none (grouping a "tail", or the user deleting the
 * node). This classifier decides the output routing from the subflow's internal
 * graph so the boundary can be **auto-derived** for the unambiguous case, while
 * genuinely ambiguous cases surface a clear, node-named error instead of silently
 * dropping a branch.
 *
 * It is a PURE function (no I/O) shared by the server expander (authoritative,
 * throws on error) and the editor's design-time expander (propagates the valid
 * outputs, flags the error node — never blanks everything). Callers adapt their
 * own node/edge shapes to the normalized inputs below.
 *
 * Rules:
 *  - ≥1 explicit output node, every terminal routes to one → use the explicit outputs.
 *  - 0 output nodes, exactly 1 terminal → derive: route that terminal out.
 *  - 0 output nodes, 0 or >1 terminals → error (no clear output).
 *  - ≥1 output node but a terminal reaches none (orphan) → error naming the orphan.
 *
 * "Terminal" = an active (non-boundary) node that is not the source of any internal
 * edge to another active node. "Orphan" = a terminal that has no edge into an
 * output node.
 */

/** Minimal node shape: just an id (+ optional label for messages). */
export interface SubflowNodeLite {
  id: string;
  label?: string;
}

/** Minimal directed edge shape. */
export interface SubflowEdgeLite {
  from: string;
  to: string;
}

/** A resolved routing: this internal node's output feeds the subflow boundary. */
export interface SubflowOutputRouting {
  /** Internal node id whose output crosses the boundary. */
  sourceId: string;
  /** The explicit output node id this routes through, if any (else derived). */
  viaOutputNodeId?: string;
}

export interface SubflowOutputResolution {
  /** Valid output routings (may be non-empty even when `error` is set). */
  outputs: SubflowOutputRouting[];
  /** Present when the subflow's outputs are ambiguous/broken. */
  error?: { nodeId: string; message: string };
}

/**
 * @param activeNodes  internal nodes excluding boundary (subflow-input/-output) nodes
 * @param outputNodes  the subflow-output boundary nodes (may be empty)
 * @param edges        internal edges, normalized to { from, to } on active/output ids
 */
export function resolveSubflowOutputs(
  activeNodes: SubflowNodeLite[],
  outputNodes: SubflowNodeLite[],
  edges: SubflowEdgeLite[],
): SubflowOutputResolution {
  const outputIds = new Set(outputNodes.map((n) => n.id));
  const activeIds = new Set(activeNodes.map((n) => n.id));

  // A terminal active node has no outgoing edge to ANOTHER active node.
  const terminals = activeNodes.filter(
    (n) => !edges.some((e) => e.from === n.id && activeIds.has(e.to) && e.to !== n.id),
  );

  // ── Explicit outputs present ──────────────────────────────────────────────
  if (outputNodes.length > 0) {
    // Each active node feeding an output node is a valid routing.
    const routings: SubflowOutputRouting[] = [];
    for (const e of edges) {
      if (activeIds.has(e.from) && outputIds.has(e.to)) {
        routings.push({ sourceId: e.from, viaOutputNodeId: e.to });
      }
    }
    // Any terminal that doesn't reach an output node is an orphan.
    const orphan = terminals.find(
      (t) => !edges.some((e) => e.from === t.id && outputIds.has(e.to)),
    );
    if (orphan) {
      return {
        outputs: routings,
        error: {
          nodeId: orphan.id,
          message: `Terminal node ${nodeRef(orphan)} has no output — add a Subflow Output node for it or connect it to one.`,
        },
      };
    }
    return { outputs: routings };
  }

  // ── No explicit outputs → derive ──────────────────────────────────────────
  if (terminals.length === 1) {
    return { outputs: [{ sourceId: terminals[0].id }] };
  }
  if (terminals.length === 0) {
    return {
      outputs: [],
      error: {
        nodeId: activeNodes[0]?.id ?? '',
        message: 'This subflow has no clear output. Add a Subflow Output node to mark which result to return.',
      },
    };
  }
  // >1 terminals, no output nodes → ambiguous: name the first for the UI to point at.
  return {
    outputs: [],
    error: {
      nodeId: terminals[0].id,
      message:
        `This subflow has ${terminals.length} possible outputs and none is marked. ` +
        `Add a Subflow Output node to each result you want to return.`,
    },
  };
}

function nodeRef(n: SubflowNodeLite): string {
  return n.label ? `"${n.label}" (${n.id})` : n.id;
}

/**
 * Resolve whether a subflow's incoming external data is actually usable.
 *
 * A `system:subflow` proxy's `in` port is optional: a subflow may be fed from
 * upstream, or may be self-contained (its own source node inside) — both are
 * valid. But if a parent wires an external node into the proxy while the
 * subflow has no `system:subflow-input` node to receive it, that data is
 * silently ignored (Beam does not detect or warn about a PTransform that
 * never touches its incoming pcoll). The subflow's own internal data wins in
 * that case — this is intentional, not an error — but the user must be told.
 *
 * PURE function (no I/O), so it can run identically wherever the two inputs
 * are known (currently the editor's design-time schema expansion).
 */
export interface SubflowInputBoundaryResolution {
  /** True when external data is wired in but has nowhere to go inside. */
  readonly danglingExternalInput: boolean;
}

/**
 * @param hasExternalEdge  whether the parent's system:subflow proxy has at
 *   least one incoming edge (i.e. external data is being wired in)
 * @param inputNodeCount   number of system:subflow-input nodes inside the
 *   referenced subflow
 */
export function resolveSubflowInputBoundary(
  hasExternalEdge: boolean,
  inputNodeCount: number,
): SubflowInputBoundaryResolution {
  return { danglingExternalInput: hasExternalEdge && inputNodeCount === 0 };
}
