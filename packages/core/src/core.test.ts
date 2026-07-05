import { describe, it, expect, vi } from 'vitest';
import { createRegistry } from './registry.js';
import { createPluginLoader } from './plugin.js';
import { validateNodeSettings, isNodeValid } from './validation.js';
import {
  NodeCategory,
  DataType,
  PortDirection,
  SettingType,
  IRStepType,
  ValidationSeverity,
  type INodeDefinition,
  type IPlugin,
} from '@beamflow/shared';

// Create a dummy node definition for testing
const testNodeDef: INodeDefinition = {
  type: 'test:node',
  name: 'Test Node',
  description: 'A node for testing',
  category: NodeCategory.Transform,
  icon: 'test-icon',
  version: '1.0.0',
  ports: [
    { id: 'in', name: 'In', direction: PortDirection.Input, dataType: DataType.Record, required: true },
    { id: 'out', name: 'Out', direction: PortDirection.Output, dataType: DataType.Record, required: false },
  ],
  settings: [
    {
      key: 'reqField',
      label: 'Required Field',
      type: SettingType.Text,
      validation: [{ type: 'required', message: 'reqField is required' }],
    },
    {
      key: 'numField',
      label: 'Number Field',
      type: SettingType.Number,
      validation: [
        { type: 'min', value: 5, message: 'Must be at least 5' },
        { type: 'max', value: 10, message: 'Must be at most 10' },
      ],
    },
    {
      key: 'patternField',
      label: 'Pattern Field',
      type: SettingType.Text,
      validation: [{ type: 'pattern', pattern: '^[0-9]+$', message: 'Must be digits' }],
    },
  ],
  validate: (settings) => {
    const issues = [];
    if (settings.customError) {
      issues.push({
        severity: ValidationSeverity.Error,
        message: 'Custom error triggered',
        settingKey: 'reqField',
      });
    }
    return issues;
  },
  toIR: (settings, id) => {
    return {
      operation: 'TestOp',
      stepType: IRStepType.Transform,
      params: settings,
    };
  },
};

describe('Core Package', () => {
  describe('NodeRegistry', () => {
    it('can register and retrieve definitions', () => {
      const registry = createRegistry();
      expect(registry.size).toBe(0);

      registry.register(testNodeDef);
      expect(registry.size).toBe(1);
      expect(registry.has('test:node')).toBe(true);
      expect(registry.get('test:node')).toBe(testNodeDef);

      const all = registry.getAll();
      expect(all).toContain(testNodeDef);

      const byCat = registry.getByCategory(NodeCategory.Transform);
      expect(byCat).toContain(testNodeDef);
    });

    it('throws error when registering duplicate type', () => {
      const registry = createRegistry();
      registry.register(testNodeDef);
      expect(() => registry.register(testNodeDef)).toThrow();
    });

    it('can unregister definitions', () => {
      const registry = createRegistry();
      registry.register(testNodeDef);
      expect(registry.unregister('test:node')).toBe(true);
      expect(registry.unregister('test:node')).toBe(false);
      expect(registry.size).toBe(0);
    });

    it('can subscribe to events', () => {
      const registry = createRegistry();
      const listener = vi.fn();
      const unsubscribe = registry.subscribe(listener);

      registry.register(testNodeDef);
      expect(listener).toHaveBeenCalledWith({
        type: 'registered',
        definition: testNodeDef,
      });

      registry.unregister('test:node');
      expect(listener).toHaveBeenCalledWith({
        type: 'unregistered',
        definition: testNodeDef,
      });

      unsubscribe();
      registry.register(testNodeDef);
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('PluginLoader', () => {
    it('loads plugins and registers their nodes', () => {
      const registry = createRegistry();
      const loader = createPluginLoader(registry);

      const dummyPlugin: IPlugin = {
        name: 'test-plugin',
        version: '1.2.3',
        description: 'Test plugin desc',
        register: (registerNode) => {
          registerNode(testNodeDef);
        },
      };

      const result = loader.load(dummyPlugin);
      expect(result.name).toBe('test-plugin');
      expect(result.version).toBe('1.2.3');
      expect(result.nodeCount).toBe(1);
      expect(loader.isLoaded('test-plugin')).toBe(true);
      expect(loader.getLoaded('test-plugin')).toBeDefined();
      expect(registry.has('test:node')).toBe(true);

      // Duplicate load throws
      expect(() => loader.load(dummyPlugin)).toThrow();
    });
  });

  describe('Validation', () => {
    it('validates required fields', () => {
      const issues = validateNodeSettings(testNodeDef, {});
      expect(issues.length).toBe(1);
      expect(issues[0].message).toBe('reqField is required');
      expect(isNodeValid(testNodeDef, {})).toBe(false);
    });

    it('validates min/max number ranges', () => {
      const issues1 = validateNodeSettings(testNodeDef, { reqField: 'val', numField: 4 });
      expect(issues1.length).toBe(1);
      expect(issues1[0].message).toBe('Must be at least 5');

      const issues2 = validateNodeSettings(testNodeDef, { reqField: 'val', numField: 11 });
      expect(issues2.length).toBe(1);
      expect(issues2[0].message).toBe('Must be at most 10');

      const issues3 = validateNodeSettings(testNodeDef, { reqField: 'val', numField: 7 });
      expect(issues3.length).toBe(0);
    });

    it('validates patterns', () => {
      const issues1 = validateNodeSettings(testNodeDef, { reqField: 'val', patternField: 'abc' });
      expect(issues1.length).toBe(1);
      expect(issues1[0].message).toBe('Must be digits');

      const issues2 = validateNodeSettings(testNodeDef, { reqField: 'val', patternField: '123' });
      expect(issues2.length).toBe(0);
    });

    it('runs custom validation', () => {
      const issues = validateNodeSettings(testNodeDef, { reqField: 'val', customError: true });
      expect(issues.length).toBe(1);
      expect(issues[0].message).toBe('Custom error triggered');
    });
  });
});
