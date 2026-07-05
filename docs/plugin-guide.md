# BeamFlow — Plugin & Node Developer Guide

This developer guide describes how to create custom node definitions, register them, and build extensible plugins using the **BeamFlow Plugin SDK**.

---

## 🔌 Getting Started

To write custom nodes for BeamFlow, add the `@beamflow/plugin-sdk` workspace dependency or npm dependency to your package:

```json
{
  "dependencies": {
    "@beamflow/plugin-sdk": "workspace:*"
  }
}
```

---

## 🎨 Anatomy of a Node Definition

Every node in BeamFlow must implement the `INodeDefinition` interface. The easiest way to do this is by using the `defineNode` helper:

```typescript
import {
  defineNode,
  inputPort,
  outputPort,
  textSetting,
  selectSetting,
  NodeCategory,
  DataType,
  IRStepType
} from '@beamflow/plugin-sdk';

export const uppercaseTransform = defineNode({
  // 1. Metadata
  type: 'my-plugin:uppercase',
  name: 'Uppercase fields',
  description: 'Converts target string fields of records to uppercase.',
  category: NodeCategory.Transform,
  icon: 'arrow-right-left', // Lucide icon identifier
  version: '1.0.0',
  tags: ['string', 'text', 'transform', 'uppercase'],

  // 2. Ports
  ports: [
    inputPort('in', 'Records', { dataType: DataType.Record, required: true }),
    outputPort('out', 'Transformed Records', { dataType: DataType.Record })
  ],

  // 3. Settings Schema
  settings: [
    textSetting('fields', 'Fields list', {
      description: 'Comma-separated list of fields to upper-case (e.g. name, email).',
      placeholder: 'name, email',
      required: true,
      order: 1
    }),
    selectSetting('mode', 'Strict Mode', [
      { label: 'Skip Missing Fields', value: 'skip' },
      { label: 'Throw on Missing Fields', value: 'strict' }
    ], {
      description: 'Controls behavior when fields do not exist on a record.',
      defaultValue: 'skip',
      order: 2
    })
  ],

  // 4. Custom Parameter Validation
  validate(settings) {
    const issues = [];
    const fieldsStr = settings.fields as string || '';
    if (fieldsStr.trim() === '') {
      issues.push({
        severity: 2, // ValidationSeverity.Error
        message: 'At least one field name is required.',
        settingKey: 'fields'
      });
    }
    return issues;
  },

  // 5. Code Emission Mapping (Intermediate Representation)
  toIR(settings, nodeId) {
    return {
      operation: 'Map',
      stepType: IRStepType.Transform,
      params: {
        expression: `dict((k, v.upper() if k in [f.strip() for f in '${settings.fields}'.split(',')] and isinstance(v, str) else v) for k, v in element.items())`,
      },
      imports: [] // Add extra python packages if required (e.g., 're', 'math')
    };
  }
});
```

---

## ⚓ Port Configurations

Ports represent pipeline data streams. Define ports using helper factories:
* **`inputPort(id, name, options)`**:
  - `id`: unique port identifier (`'in'`).
  - `name`: user-facing port label.
  - `options.dataType`: data stream type (defaults to `DataType.Record`).
  - `options.required`: if set to `true`, the visual graph validator will flag compile errors if the port is left unconnected.
* **`outputPort(id, name, options)`**:
  - `id`: unique port identifier (`'out'`).
  - `name`: user-facing label.

### Stream Compatibility Types
The engine enforces port connection compatibility using the `DataType` enum:
- `Any`: Connects to any port.
- `Record`: Standard structured data dictionary (default).
- `Array`: Multi-value rows.
- `Stream`: Raw byte/string chunks.

---

## ⚙️ Settings Fields & Forms

Settings are translated automatically by the frontend into form controls. The SDK provides helper builders for all standard input types:

### 1. Text / Input Box
`textSetting(key, label, options)`
Renders a standard single-line text input field.
* Options: `placeholder`, `defaultValue`, `required`, `description`, `group` (for collapsible tabs), `order` (for field listing priorities).

### 2. Selection / Dropdown
`selectSetting(key, label, optionsArray, options)`
Renders a dropdown selector field.
* `optionsArray`: List of `{ label: string, value: string }`.

### 3. Number Input
`numberSetting(key, label, options)`
Renders numeric input boxes.
* Options: `min`, `max` validation rules.

### 4. Switch / Boolean Checkbox
`booleanSetting(key, label, options)`
Renders checkboxes for flag controls.

### 5. Expression Editor
`expressionSetting(key, label, options)`
Renders a syntax-highlighted code editor field for writing inline Python scripts or expressions.

---

## ⚡ Packaging as a Plugin

Assemble all custom node definitions into a single plugin package entry point implementing the `IPlugin` interface:

```typescript
import type { IPlugin } from '@beamflow/plugin-sdk';
import { uppercaseTransform } from './transforms/uppercase.js';
import { lowercaseTransform } from './transforms/lowercase.js';

export const stringTransformsPlugin: IPlugin = {
  name: '@my-org/beamflow-string-plugin',
  version: '1.0.0',
  description: 'Utility nodes for text preprocessing and casing changes.',
  register(registerNode) {
    registerNode(uppercaseTransform);
    registerNode(lowercaseTransform);
  }
};
```

---

## 🧪 Testing Your Nodes

Write robust unit tests for your node definitions using Vitest:

```typescript
import { describe, it, expect } from 'vitest';
import { uppercaseTransform } from './uppercase.js';

describe('Uppercase Transform Node', () => {
  it('correctly validates inputs', () => {
    // Missing required field
    const issuesEmpty = uppercaseTransform.validate({ fields: '' });
    expect(issuesEmpty.length).toBe(1);
    expect(issuesEmpty[0].message).toContain('At least one field name');

    // Valid fields
    const issuesValid = uppercaseTransform.validate({ fields: 'name, email' });
    expect(issuesValid.length).toBe(0);
  });

  it('compiles correctly to Intermediate Representation (IR)', () => {
    const irStep = uppercaseTransform.toIR({ fields: 'name' }, 'node_test');
    expect(irStep.operation).toBe('Map');
    expect(irStep.params.expression).toContain('name');
  });
});
```
