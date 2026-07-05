/**
 * @module @beamflow/ir/optimizer
 *
 * IR optimization passes.
 *
 * The optimizer transforms an IRPipeline to improve the generated code.
 * Passes are composable — each takes an IRPipeline and returns a new one.
 *
 * MVP passes:
 * - Fuse adjacent filters into a single compound filter
 * - Detect and warn on dead branches (steps with no downstream consumers)
 *
 * Extension point: add new passes by implementing the IRPass interface
 * and registering them with the optimizer.
 */

import type { IRPipeline, IRStep } from './types.js';

/**
 * An optimization pass that transforms an IRPipeline.
 */
export interface IRPass {
  /** Human-readable name for logging. */
  readonly name: string;
  /** Apply the optimization pass. */
  apply(pipeline: IRPipeline): IRPipeline;
}

/**
 * Fuse adjacent filter steps into a single compound filter.
 *
 * Before: Source → Filter(A) → Filter(B) → Output
 * After:  Source → Filter(A && B) → Output
 */
export const fuseFilters: IRPass = {
  name: 'fuse-filters',
  apply(pipeline: IRPipeline): IRPipeline {
    // For MVP, identify simple linear filter chains
    const steps = [...pipeline.steps];
    const fusedIds = new Set<string>();
    const fusedToDownstream = new Map<string, string>();
    const newSteps: IRStep[] = [];

    for (const step of steps) {
      if (fusedIds.has(step.id)) continue;

      if (step.operation === 'Filter' && step.inputs.length === 1) {
        // Check if the input is also a filter with only this as output
        const inputStep = steps.find((s) => s.id === step.inputs[0]);
        if (
          inputStep &&
          inputStep.operation === 'Filter' &&
          !fusedIds.has(inputStep.id)
        ) {
          // Count how many steps depend on the input filter
          const dependents = steps.filter((s) =>
            s.inputs.includes(inputStep.id),
          );
          if (dependents.length === 1) {
            // Fuse: combine filter conditions
            const fusedStep: IRStep = {
              ...step,
              params: {
                conditions: [
                  ...(Array.isArray(inputStep.params.conditions)
                    ? inputStep.params.conditions
                    : [inputStep.params]),
                  ...(Array.isArray(step.params.conditions)
                    ? step.params.conditions
                    : [step.params]),
                ],
                fused: true,
              },
              inputs: inputStep.inputs,
            };
            fusedIds.add(inputStep.id);
            fusedToDownstream.set(inputStep.id, step.id);
            newSteps.push(fusedStep);
            continue;
          }
        }
      }

      newSteps.push(step);
    }

    // Update connections to skip and redirect fused steps
    const connections: any[] = [];
    for (const conn of pipeline.connections) {
      if (fusedToDownstream.get(conn.fromStepId) === conn.toStepId) {
        continue;
      }

      let from = conn.fromStepId;
      let to = conn.toStepId;

      while (fusedToDownstream.has(from)) {
        from = fusedToDownstream.get(from)!;
      }
      while (fusedToDownstream.has(to)) {
        to = fusedToDownstream.get(to)!;
      }

      if (from === to) {
        continue;
      }

      connections.push({ fromStepId: from, toStepId: to });
    }

    return {
      ...pipeline,
      steps: newSteps.filter((s) => !fusedIds.has(s.id)),
      connections,
    };
  },
};

/**
 * Detect dead branches — steps whose output is never consumed.
 * This doesn't remove them (the user may want them), but logs warnings.
 */
export const detectDeadBranches: IRPass = {
  name: 'detect-dead-branches',
  apply(pipeline: IRPipeline): IRPipeline {
    const consumedBy = new Set<string>();
    for (const step of pipeline.steps) {
      for (const inputId of step.inputs) {
        consumedBy.add(inputId);
      }
    }

    const deadBranches = pipeline.steps.filter(
      (step) =>
        step.type !== 'write' && // Write steps are terminal — not dead
        !consumedBy.has(step.id),
    );

    if (deadBranches.length > 0) {
      console.warn(
        `[IR Optimizer] Dead branches detected: ${deadBranches.map((s) => s.label).join(', ')}`,
      );
    }

    return pipeline; // Don't modify, just warn
  },
};

/**
 * Run all optimization passes on an IR pipeline.
 *
 * @param pipeline - The unoptimized IR pipeline.
 * @param passes - Optimization passes to apply (default: all built-in passes).
 * @returns The optimized IR pipeline.
 */
export function optimizeIR(
  pipeline: IRPipeline,
  passes: IRPass[] = [fuseFilters, detectDeadBranches],
): IRPipeline {
  let result = pipeline;
  for (const pass of passes) {
    result = pass.apply(result);
  }
  return result;
}
