import { describe, it, expect } from 'vitest';
import { createRegistry } from '@beamflow/core';
import { builtinNodes, builtinNodesPlugin } from './index.js';

describe('@beamflow/nodes package', () => {
  describe('builtinNodes array', () => {
    it('contains the 6 built-in nodes', () => {
      expect(builtinNodes).toHaveLength(6);
    });

    it('has a unique type for every node', () => {
      const types = builtinNodes.map((n) => n.type);
      expect(new Set(types).size).toBe(types.length);
    });

    it('every node exposes the required INodeDefinition surface', () => {
      for (const node of builtinNodes) {
        expect(node.type).toMatch(/^beamflow:/);
        expect(typeof node.name).toBe('string');
        expect(typeof node.toIR).toBe('function');
        expect(typeof node.validate).toBe('function');
        expect(Array.isArray(node.ports)).toBe(true);
        expect(Array.isArray(node.settings)).toBe(true);
      }
    });
  });

  describe('builtinNodesPlugin', () => {
    it('registers every node in builtinNodes into a fresh registry', () => {
      const registry = createRegistry();
      const registered: string[] = [];
      builtinNodesPlugin.register((def) => {
        registry.register(def);
        registered.push(def.type);
      });

      expect(registry.size).toBe(builtinNodes.length);
      expect(registered.sort()).toEqual(builtinNodes.map((n) => n.type).sort());
      // Spot-check a couple are retrievable.
      expect(registry.get('beamflow:csv-source')).toBeDefined();
      expect(registry.get('beamflow:group-by')).toBeDefined();
    });
  });
});
