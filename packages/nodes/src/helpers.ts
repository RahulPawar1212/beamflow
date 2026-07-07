/**
 * @module @beamflow/nodes/helpers
 *
 * Helper utilities for defining nodes with less boilerplate.
 * Used internally and exported via the plugin-sdk for external plugin authors.
 */

import type {
  INodeDefinition,
  IPort,
  ISettingDefinition,
  ISettingValidation,
  IRStepDefinition,
  ValidationIssue,
  NodeCategory,
} from '@beamflow/shared';
import {
  PortDirection,
  DataType,
  ValidationSeverity,
  SettingType,
} from '@beamflow/shared';

/** Options for the defineNode helper. */
export interface DefineNodeOptions {
  type: string;
  name: string;
  description: string;
  category: NodeCategory;
  icon: string;
  version?: string;
  ports: IPort[];
  settings: ISettingDefinition[];
  tags?: string[];
  documentation?: string;
  validate?: (settings: Record<string, unknown>) => ValidationIssue[];
  toIR: (settings: Record<string, unknown>, nodeId: string) => IRStepDefinition;
}

/**
 * Ergonomic helper to define a node.
 * Provides sensible defaults and validates the definition at creation time.
 */
export function defineNode(options: DefineNodeOptions): INodeDefinition {
  return {
    type: options.type,
    name: options.name,
    description: options.description,
    category: options.category,
    icon: options.icon,
    version: options.version || '1.0.0',
    ports: options.ports,
    settings: options.settings,
    tags: options.tags,
    documentation: options.documentation,
    validate: options.validate || (() => []),
    toIR: options.toIR,
  };
}

// ─── Port helpers ────────────────────────────────────────────────────────────

export function inputPort(
  id: string,
  name: string,
  opts?: { dataType?: DataType; required?: boolean; multiple?: boolean },
): IPort {
  return {
    id,
    name,
    direction: PortDirection.Input,
    dataType: opts?.dataType ?? DataType.Record,
    required: opts?.required ?? true,
    multiple: opts?.multiple,
  };
}

export function outputPort(
  id: string,
  name: string,
  opts?: { dataType?: DataType; multiple?: boolean },
): IPort {
  return {
    id,
    name,
    direction: PortDirection.Output,
    dataType: opts?.dataType ?? DataType.Record,
    required: false,
    multiple: opts?.multiple,
  };
}

// ─── Setting helpers ─────────────────────────────────────────────────────────

export function textSetting(
  key: string,
  label: string,
  opts?: {
    description?: string;
    defaultValue?: string;
    placeholder?: string;
    required?: boolean;
    fixed?: boolean;
    group?: string;
    order?: number;
  },
): ISettingDefinition {
  const validation: ISettingValidation[] = [];
  if (opts?.required) {
    validation.push({
      type: 'required',
      message: `${label} is required.`,
    });
  }
  return {
    key,
    label,
    description: opts?.description,
    type: SettingType.Text,
    defaultValue: opts?.defaultValue ?? '',
    placeholder: opts?.placeholder,
    validation,
    fixed: opts?.fixed,
    group: opts?.group,
    order: opts?.order,
  };
}

export function fileSetting(
  key: string,
  label: string,
  opts?: {
    description?: string;
    required?: boolean;
    fixed?: boolean;
    group?: string;
    order?: number;
  },
): ISettingDefinition {
  const validation: ISettingValidation[] = [];
  if (opts?.required) {
    validation.push({ type: 'required', message: `${label} is required.` });
  }
  return {
    key,
    label,
    description: opts?.description,
    type: SettingType.File,
    validation,
    fixed: opts?.fixed,
    group: opts?.group,
    order: opts?.order,
  };
}

export function selectSetting(
  key: string,
  label: string,
  options: Array<{ label: string; value: string }>,
  opts?: {
    description?: string;
    defaultValue?: string;
    required?: boolean;
    fixed?: boolean;
    group?: string;
    order?: number;
  },
): ISettingDefinition {
  const validation: ISettingValidation[] = [];
  if (opts?.required) {
    validation.push({ type: 'required', message: `${label} is required.` });
  }
  return {
    key,
    label,
    description: opts?.description,
    type: SettingType.Select,
    defaultValue: opts?.defaultValue ?? options[0]?.value ?? '',
    options,
    validation,
    fixed: opts?.fixed,
    group: opts?.group,
    order: opts?.order,
  };
}

export function booleanSetting(
  key: string,
  label: string,
  opts?: {
    description?: string;
    defaultValue?: boolean;
    fixed?: boolean;
    group?: string;
    order?: number;
  },
): ISettingDefinition {
  return {
    key,
    label,
    description: opts?.description,
    type: SettingType.Boolean,
    defaultValue: opts?.defaultValue ?? false,
    fixed: opts?.fixed,
    group: opts?.group,
    order: opts?.order,
  };
}

export function numberSetting(
  key: string,
  label: string,
  opts?: {
    description?: string;
    defaultValue?: number;
    min?: number;
    max?: number;
    required?: boolean;
    fixed?: boolean;
    group?: string;
    order?: number;
  },
): ISettingDefinition {
  const validation: ISettingValidation[] = [];
  if (opts?.required) {
    validation.push({ type: 'required', message: `${label} is required.` });
  }
  if (opts?.min !== undefined) {
    validation.push({ type: 'min', value: opts.min, message: `${label} must be at least ${opts.min}.` });
  }
  if (opts?.max !== undefined) {
    validation.push({ type: 'max', value: opts.max, message: `${label} must be at most ${opts.max}.` });
  }
  return {
    key,
    label,
    description: opts?.description,
    type: SettingType.Number,
    defaultValue: opts?.defaultValue,
    validation,
    fixed: opts?.fixed,
    group: opts?.group,
    order: opts?.order,
  };
}

export function expressionSetting(
  key: string,
  label: string,
  opts?: {
    description?: string;
    defaultValue?: string;
    placeholder?: string;
    required?: boolean;
    group?: string;
    order?: number;
  },
): ISettingDefinition {
  const validation: ISettingValidation[] = [];
  if (opts?.required) {
    validation.push({ type: 'required', message: `${label} is required.` });
  }
  return {
    key,
    label,
    description: opts?.description,
    type: SettingType.Expression,
    defaultValue: opts?.defaultValue ?? '',
    placeholder: opts?.placeholder,
    validation,
    group: opts?.group,
    order: opts?.order,
  };
}

// ─── Validation helpers ──────────────────────────────────────────────────────

export function requiredError(
  settingKey: string,
  message: string,
): ValidationIssue {
  return {
    severity: ValidationSeverity.Error,
    message,
    settingKey,
  };
}
