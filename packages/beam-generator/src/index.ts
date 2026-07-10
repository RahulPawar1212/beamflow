/**
 * @module @beamflow/beam-generator
 *
 * Public API for the Beam code generation package.
 */

export { generatePythonBeam, registerOperationHandler } from './generator.js';
export type { OperationClassHandler, GenerationContext } from './generator.js';
export { PythonEmitter, toPythonVar, toPythonString } from './python-emitter.js';
