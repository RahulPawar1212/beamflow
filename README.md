# BeamFlow

**Visual ETL and ML pipeline builder on Apache Beam.**

BeamFlow is an open-source visual workflow editor that makes Apache Beam accessible through a modern drag-and-drop interface. Design data pipelines visually, generate real Apache Beam code, and execute them locally or on cloud runners.

> 🚧 **Status: MVP / Alpha** — Core architecture is in place. Contributions welcome!

---

## ✨ Features

- 🎨 **Visual Pipeline Editor** — Drag-and-drop nodes on a React Flow canvas
- 🔌 **Plugin Architecture** — All node types are plugins. Nothing is hardcoded
- 🐍 **Python Beam Code Generation** — Generates production-ready Apache Beam Python pipelines
- 📊 **6 Built-in Nodes** — CSV/JSON sources, Filter/Map/GroupBy transforms, CSV output
- ↩️ **Undo/Redo** — 50-level history with full state snapshots
- 💾 **JSON Serialization** — Export/import workflow definitions
- ⚡ **Local Execution** — Run generated pipelines with DirectRunner
- 🌙 **Dark Mode UI** — Premium dark theme with glassmorphism and micro-animations

## 🏗️ Architecture

```
Visual Editor (React Flow + Zustand)
       ↓
  Graph Model (DAG)
       ↓
Intermediate Representation (IR)
       ↓
  Code Generator (Python Beam)
       ↓
  Execution Engine (DirectRunner)
```

The IR layer decouples the visual editor from code generation, enabling future Java/TypeScript Beam generators without modifying the editor.

## 📦 Project Structure

```
beamflow/
├── apps/
│   ├── editor/          # React Flow visual editor (Vite + React + Tailwind)
│   └── server/          # Fastify REST API
├── packages/
│   ├── shared/          # Shared TypeScript types and utilities
│   ├── core/            # Node registry and plugin system
│   ├── graph/           # DAG model, topological sort, serialization
│   ├── ir/              # Intermediate representation (IR) builder & optimizer
│   ├── beam-generator/  # Python Beam code generator
│   ├── execution/       # Pipeline execution engine
│   ├── nodes/           # Built-in node definitions (CSV, JSON, Filter, etc.)
│   ├── plugin-sdk/      # SDK for building external plugins
│   └── tsconfig/        # Shared TypeScript configurations
└── docs/                # Architecture and plugin documentation
```

## 🚀 Quick Start

### Prerequisites

- **Node.js** 20+
- **pnpm** 9+
- **Python** 3.9+ (for pipeline execution)
- **Apache Beam** Python SDK (`pip install apache-beam`)

### Setup

```bash
# Clone the repository
git clone https://github.com/your-org/beamflow.git
cd beamflow

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start development servers (editor + API)
pnpm dev
```

The editor runs at `http://localhost:5173` and the API at `http://localhost:3001`.

### Usage

1. **Drag nodes** from the left palette onto the canvas
2. **Connect nodes** by dragging from output handles to input handles
3. **Configure nodes** by clicking them to open the property panel
4. **Generate code** — click the "Generate" button to see the Python Beam pipeline
5. **Execute** — click "Run" to execute locally with DirectRunner

## 🔌 Creating Plugins

```typescript
import {
  defineNode, inputPort, outputPort, textSetting,
  NodeCategory, IRStepType,
  type IPlugin,
} from '@beamflow/plugin-sdk';

const myTransform = defineNode({
  type: 'my-org:uppercase',
  name: 'Uppercase',
  description: 'Convert a text field to uppercase',
  category: NodeCategory.Transform,
  icon: 'type',
  ports: [inputPort('in', 'Input'), outputPort('out', 'Output')],
  settings: [
    textSetting('field', 'Field Name', { required: true }),
  ],
  toIR(settings) {
    return {
      operation: 'Map',
      stepType: IRStepType.Transform,
      params: {
        expression: `element.get('${settings.field}', '').upper()`,
        outputField: settings.field,
      },
    };
  },
});

export const myPlugin: IPlugin = {
  name: 'my-uppercase-plugin',
  version: '1.0.0',
  description: 'Adds an uppercase transform node',
  register(registerNode) {
    registerNode(myTransform);
  },
};
```

## 🗺️ Roadmap

- [ ] SQL connector nodes (PostgreSQL, MySQL, BigQuery)
- [ ] REST API source/output nodes
- [ ] Streaming pipeline support (Kafka, PubSub)
- [ ] Cloud runner support (Dataflow, Flink, Spark)
- [ ] ML/AI nodes (TensorFlow, Vertex AI)
- [ ] Auto-layout (dagre/elk)
- [ ] Comments and grouping
- [ ] Git-based versioning
- [ ] Collaborative editing

## 📜 License

Apache License 2.0 — See [LICENSE](LICENSE) for details.
