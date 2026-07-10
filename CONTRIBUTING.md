# Contributing to BeamFlow

First off, thank you for considering contributing to BeamFlow! It is people like you who make open-source tools better for everyone.

This document details the guidelines and steps to set up your environment, follow our coding standards, and submit contributions.

---

## 📜 Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please report any violations or unacceptable behavior to the project maintainers.

## 🔍 How Can I Contribute?

There are many ways to contribute to BeamFlow:
- **Reporting Bugs**: Let us know if something isn't working as expected.
- **Suggesting Enhancements**: Propose new features or design changes.
- **Improving Documentation**: Fix typos, add explanations, or write tutorials.
- **Submitting Code**: Fix open issues, build new features, or create new plugin nodes.

---

## 🛠️ Setting Up Your Local Environment

BeamFlow is structured as a monorepo managed with `pnpm` workspaces and `turbo`.

### Prerequisites

To get started, make sure you have the following installed:
- **Node.js** v20 or newer
- **pnpm** v9 or newer
- **Python** v3.9 or newer (needed for compiling and executing generated Apache Beam pipelines)
- **Apache Beam** Python SDK (`pip install apache-beam`)

### Setup Steps

1. **Fork and Clone the Repository**
   ```bash
   git clone https://github.com/YOUR-USERNAME/beamflow.git
   cd beamflow
   ```

2. **Install Dependencies**
   ```bash
   pnpm install
   ```

3. **Build the Packages**
   BeamFlow relies on internal packages that must be built before running the apps.
   ```bash
   pnpm build
   ```

4. **Run in Development Mode**
   Start both the visual editor frontend and Fastify backend API simultaneously.
   ```bash
   pnpm dev
   ```
   - **Frontend Editor**: `http://localhost:5173`
   - **Backend API Server**: `http://localhost:3001`

---

## 🏗️ Project Structure

BeamFlow uses a monorepo structure:
- `apps/editor`: The visual React Flow node-editor interface (Vite + React + Tailwind).
- `apps/server`: Fastify REST API server managing workflow persistence, compilation, and execution.
- `packages/`: Shared packages, compilers, and SDKs:
  - `packages/core`: Plugin loader and node registry.
  - `packages/graph`: Graph model, topological sorting, and cycle detection.
  - `packages/ir`: Translates the visual graph to Intermediate Representation (IR).
  - `packages/beam-generator`: Compiles the IR into executable Apache Beam Python code.
  - `packages/execution`: Process executor that runs pipelines locally.
  - `packages/plugin-sdk`: Developer SDK containing helpers to define custom plugins and nodes.

---

## 🔌 Writing Plugins & Custom Nodes

BeamFlow is completely modular: all node types are plugins registered via the `plugin-sdk`.
If you want to add new transformations or connectors, please refer to the detailed [Plugin & Node Developer Guide](docs/plugin-guide.md).

---

## 🧪 Testing and Quality Control

Before submitting any code, please ensure it satisfies the following quality checks.
These same checks run in **CI** (`.github/workflows/ci.yml`) on every push and PR:
`pnpm build` (also the typecheck) and `pnpm test` (all suites, including the editor
App mount smoke test).

### Linting and Formatting
> **Not yet set up.** There is currently no ESLint/Prettier config and `pnpm lint`
> is a no-op. Adding ESLint + Prettier (and a real `lint` step in CI) is a planned
> follow-up. Until then, match the style of surrounding code.

### Running Tests
Make sure all existing and new test suites pass.
```bash
# Run tests across all packages
pnpm test
```

---

## 🚀 The Pull Request Process

When you are ready to submit your changes, please follow this workflow:

1. **Create a Branch**: Create a branch off the `main` branch. Use a descriptive name:
   - For features: `feat/add-bigquery-connector`
   - For bug fixes: `fix/dag-cycle-detection`
   - For documentation: `docs/update-architecture`
2. **Make Small, Focused Commits**: Write clear, descriptive commit messages. We encourage the use of [Conventional Commits](https://www.conventionalcommits.org/).
3. **Keep Code Synced**: Rebase or merge `main` into your feature branch regularly to prevent merge conflicts.
4. **Push and Open a Pull Request**: Push your branch to your fork and create a Pull Request (PR) against the `main` branch of the official BeamFlow repository.
5. **Fill Out the PR Template**: Ensure the PR description matches the provided template, explaining *what* was changed, *why*, and *how* it was tested.

Thank you again for contributing to BeamFlow! If you have any questions, feel free to open a discussion or ask on our community channels.
