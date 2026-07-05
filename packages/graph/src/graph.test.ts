import { describe, it, expect } from 'vitest';
import { DAG } from './dag.js';
import {
  serializeWorkflow,
  deserializeWorkflow,
  createEmptyWorkflow,
  validateSerializedWorkflow,
} from './serializer.js';
import {
  DataType,
  PortDirection,
  ValidationSeverity,
  NodeCategory,
  type INodeInstance,
  type IConnection,
} from '@beamflow/shared';
import { createRegistry } from '@beamflow/core';

const nodeA: INodeInstance = {
  id: 'node_a',
  type: 'beamflow:csv-source',
  settings: { filePath: 'data.csv' },
  position: { x: 0, y: 0 },
};

const nodeB: INodeInstance = {
  id: 'node_b',
  type: 'beamflow:filter',
  settings: { field: 'age', operator: '==', value: '30' },
  position: { x: 200, y: 0 },
};

const nodeC: INodeInstance = {
  id: 'node_c',
  type: 'beamflow:csv-output',
  settings: { filePath: 'out.csv' },
  position: { x: 400, y: 0 },
};

const edgeAB: IConnection = {
  id: 'edge_ab',
  sourceNodeId: 'node_a',
  sourcePortId: 'out',
  targetNodeId: 'node_b',
  targetPortId: 'in',
};

const edgeBC: IConnection = {
  id: 'edge_bc',
  sourceNodeId: 'node_b',
  sourcePortId: 'out',
  targetNodeId: 'node_c',
  targetPortId: 'in',
};

describe('Graph Package', () => {
  describe('DAG Operations', () => {
    it('can build and manipulate a graph', () => {
      const dag = new DAG();
      expect(dag.isEmpty()).toBe(true);

      dag.addNode(nodeA);
      dag.addNode(nodeB);
      expect(dag.nodeCount).toBe(2);
      expect(dag.getNode('node_a')).toEqual(nodeA);

      dag.addEdge(edgeAB);
      expect(dag.edgeCount).toBe(1);
      expect(dag.getEdge('edge_ab')).toEqual(edgeAB);

      // Traversal
      expect(dag.getUpstream('node_b')).toContainEqual(nodeA);
      expect(dag.getDownstream('node_a')).toContainEqual(nodeB);
      expect(dag.getNodeEdges('node_b')).toContainEqual(edgeAB);

      // Remove edge
      dag.removeEdge('edge_ab');
      expect(dag.edgeCount).toBe(0);
      expect(dag.getDownstream('node_a')).toEqual([]);

      // Remove node
      dag.addEdge(edgeAB);
      dag.removeNode('node_a');
      expect(dag.nodeCount).toBe(1);
      expect(dag.edgeCount).toBe(0); // connection should be removed as well
    });

    it('rejects duplicate nodes and self loops', () => {
      const dag = new DAG();
      dag.addNode(nodeA);
      expect(() => dag.addNode(nodeA)).toThrow();

      expect(() =>
        dag.addEdge({
          id: 'self',
          sourceNodeId: 'node_a',
          sourcePortId: 'out',
          targetNodeId: 'node_a',
          targetPortId: 'in',
        }),
      ).toThrow();
    });

    it('performs topological sort correctly', () => {
      const dag = new DAG();
      dag.addNode(nodeC);
      dag.addNode(nodeB);
      dag.addNode(nodeA);
      dag.addEdge(edgeBC);
      dag.addEdge(edgeAB);

      const sorted = dag.topologicalSort();
      expect(sorted.map((n) => n.id)).toEqual(['node_a', 'node_b', 'node_c']);
    });

    it('detects cycles', () => {
      const dag = new DAG();
      dag.addNode(nodeA);
      dag.addNode(nodeB);
      dag.addEdge(edgeAB);

      // Add a back-edge to create a cycle
      dag.addEdge({
        id: 'back_edge',
        sourceNodeId: 'node_b',
        sourcePortId: 'out',
        targetNodeId: 'node_a',
        targetPortId: 'in',
      });

      expect(() => dag.topologicalSort()).toThrow();
      const issues = dag.validate();
      expect(issues.some((i) => i.message.includes('cycle'))).toBe(true);
    });

    it('validates required port connections', () => {
      const registry = createRegistry();
      // Register node type with a required input port
      registry.register({
        type: 'beamflow:filter',
        name: 'Filter',
        description: '',
        category: NodeCategory.Transform,
        icon: '',
        version: '1.0.0',
        ports: [
          { id: 'in', name: 'Input', direction: PortDirection.Input, dataType: DataType.Record, required: true },
        ],
        settings: [],
        validate: () => [],
        toIR: () => ({} as any),
      });

      const dag = new DAG();
      dag.addNode(nodeB); // nodeB has type 'beamflow:filter'

      // nodeB is not connected, validation should complain about missing required port connection
      const issues = dag.validate(registry);
      expect(issues.some((i) => i.message.includes('Required input port'))).toBe(true);
    });
  });

  describe('Serializer', () => {
    it('round-trips serialize and deserialize', () => {
      const dag = new DAG();
      dag.addNode(nodeA);
      dag.addNode(nodeB);
      dag.addEdge(edgeAB);

      const meta = {
        id: 'wf_123',
        name: 'My Workflow',
        description: 'Test flow',
        createdAt: '2026-07-05T09:00:00Z',
        updatedAt: '2026-07-05T09:00:00Z',
      };

      const serialized = serializeWorkflow(dag, meta);
      expect(serialized.schemaVersion).toBe('1.0.0');
      expect(validateSerializedWorkflow(serialized)).toBe(true);

      const { dag: rebuiltDag, metadata: rebuiltMeta } = deserializeWorkflow(serialized);
      expect(rebuiltDag.nodeCount).toBe(2);
      expect(rebuiltDag.edgeCount).toBe(1);
      expect(rebuiltMeta.id).toBe(meta.id);
      expect(rebuiltMeta.name).toBe(meta.name);
    });

    it('creates empty workflow', () => {
      const { dag, metadata } = createEmptyWorkflow('wf_empty', 'Empty');
      expect(dag.isEmpty()).toBe(true);
      expect(metadata.id).toBe('wf_empty');
      expect(metadata.name).toBe('Empty');
    });
  });
});
