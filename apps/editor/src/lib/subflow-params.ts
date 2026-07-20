/**
 * @module subflow-params
 *
 * Thin re-export: `effectiveSubflowParameters` now lives in `@beamflow/shared`
 * (subflow-auto-params) so the editor and the headless CLI share ONE pure
 * implementation. Keeping this local module as the editor's import site avoids
 * churning every call site (PropertyPanel, schema-store, CustomNodes).
 */
export { effectiveSubflowParameters } from '@beamflow/shared';
export type { SubflowDocLite } from '@beamflow/shared';
