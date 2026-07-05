/**
 * @module @beamflow/core/validation
 *
 * Node-level validation utilities.
 * Validates a node instance's settings against its definition's schema.
 */

import type {
  INodeDefinition,
  ISettingDefinition,
  ValidationIssue,
} from '@beamflow/shared';
import { ValidationSeverity } from '@beamflow/shared';

/**
 * Validate a node instance's settings against its node definition.
 *
 * Checks:
 * 1. Required settings are present and non-empty
 * 2. Numeric settings satisfy min/max constraints
 * 3. Pattern-based settings match their regex
 * 4. The node definition's own validate() method
 *
 * @param definition - The node type definition.
 * @param settings - The current setting values.
 * @returns Array of validation issues (empty = valid).
 */
export function validateNodeSettings(
  definition: INodeDefinition,
  settings: Record<string, unknown>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Validate each setting against its definition
  for (const settingDef of definition.settings) {
    const value = settings[settingDef.key];
    const settingIssues = validateSetting(settingDef, value);
    issues.push(...settingIssues);
  }

  // Run the node definition's own validation
  try {
    const nodeIssues = definition.validate(settings);
    issues.push(...nodeIssues);
  } catch (error) {
    issues.push({
      severity: ValidationSeverity.Error,
      message: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return issues;
}

/**
 * Validate a single setting value against its definition.
 */
function validateSetting(
  settingDef: ISettingDefinition,
  value: unknown,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!settingDef.validation) return issues;

  for (const rule of settingDef.validation) {
    switch (rule.type) {
      case 'required':
        if (value === undefined || value === null || value === '') {
          issues.push({
            severity: ValidationSeverity.Error,
            message: rule.message,
            settingKey: settingDef.key,
          });
        }
        break;

      case 'min':
        if (typeof value === 'number' && typeof rule.value === 'number' && value < rule.value) {
          issues.push({
            severity: ValidationSeverity.Error,
            message: rule.message,
            settingKey: settingDef.key,
          });
        }
        break;

      case 'max':
        if (typeof value === 'number' && typeof rule.value === 'number' && value > rule.value) {
          issues.push({
            severity: ValidationSeverity.Error,
            message: rule.message,
            settingKey: settingDef.key,
          });
        }
        break;

      case 'pattern':
        if (rule.pattern && typeof value === 'string') {
          const regex = new RegExp(rule.pattern);
          if (!regex.test(value)) {
            issues.push({
              severity: ValidationSeverity.Error,
              message: rule.message,
              settingKey: settingDef.key,
            });
          }
        }
        break;

      // Custom validators are resolved at runtime by the execution layer
      case 'custom':
        break;
    }
  }

  return issues;
}

/**
 * Check if a node's settings are fully valid (no errors).
 */
export function isNodeValid(
  definition: INodeDefinition,
  settings: Record<string, unknown>,
): boolean {
  const issues = validateNodeSettings(definition, settings);
  return !issues.some((i) => i.severity === ValidationSeverity.Error);
}
