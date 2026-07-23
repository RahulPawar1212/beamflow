/**
 * @module @beamflow/shared/types
 *
 * Core type definitions for BeamFlow. Every package depends on these interfaces.
 * Changes here require careful versioning as they affect the entire ecosystem.
 *
 * Architecture note: These types define the contracts between layers:
 * - UI layer uses INodeDefinition to render nodes and ISettingDefinition for forms
 * - Graph layer uses INodeInstance and IConnection to build the DAG
 * - IR layer uses INodeDefinition.toIR() to build the intermediate representation
 * - Serialization layer uses SerializedWorkflow for persistence
 */

// ─── Enums ──────────────────────────────────────────────────────────────────────

/**
 * Categories for organizing nodes in the palette.
 * Extensible — plugins can register nodes under any category.
 */
export enum NodeCategory {
  Source = 'source',
  Transform = 'transform',
  Arithmetic = 'arithmetic',
  Logical = 'logical',
  ML = 'ml',
  Output = 'output',
  Custom = 'custom',
}

/** Direction of a port on a node. */
export enum PortDirection {
  Input = 'input',
  Output = 'output',
}

/** Data types that can flow between node ports. */
export enum DataType {
  Any = 'any',
  String = 'string',
  Number = 'number',
  Boolean = 'boolean',
  Record = 'record',
  Array = 'array',
  Stream = 'stream',
}

/** Types of UI controls that can be rendered for a setting. */
export enum SettingType {
  Text = 'text',
  Number = 'number',
  Boolean = 'boolean',
  Select = 'select',
  MultiSelect = 'multi-select',
  SQL = 'sql',
  Expression = 'expression',
  File = 'file',
  Connection = 'connection',
  Date = 'date',
  TextArea = 'textarea',
  KeyValue = 'key-value',
  /**
   * A repeatable list of structured rows (array of objects). The row shape is
   * declared via `ISettingDefinition.itemFields`. Used for settings like
   * Aggregate `aggregations`, Derived Column `formulas`, and Projection
   * `selections`. The stored value is `Array<Record<string, unknown>>`.
   */
  List = 'list',
}

/** UI control for one field within a `SettingType.List` row. */
export type ListItemFieldType = 'text' | 'number' | 'select' | 'column' | 'boolean';

/** Describes one field of a repeatable list row (see `SettingType.List`). */
export interface IListItemField {
  /** Key within the row object. */
  readonly key: string;
  /** Human-readable label (shown as a column header / placeholder). */
  readonly label: string;
  /** Which control to render for this field. `column` renders a dropdown of upstream columns. */
  readonly type: ListItemFieldType;
  /** Options for `select` fields. */
  readonly options?: ReadonlyArray<{ label: string; value: string }>;
  /** Placeholder text. */
  readonly placeholder?: string;
  /** Default value for a newly added row. */
  readonly defaultValue?: unknown;
}

/** Execution state of a pipeline run. */
export enum ExecutionStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

// ─── Port Interfaces ────────────────────────────────────────────────────────────

/** Defines an input or output connection point on a node. */
export interface IPort {
  /** Unique identifier for this port within its parent node. */
  readonly id: string;
  /** Human-readable label. */
  readonly name: string;
  /** Direction: input or output. */
  readonly direction: PortDirection;
  /** Data type this port accepts or emits. */
  readonly dataType: DataType;
  /** Whether a connection is required for the node to be valid. */
  readonly required: boolean;
  /** Whether this port accepts multiple connections (fan-in / fan-out). */
  readonly multiple?: boolean;
}

// ─── Setting Interfaces ─────────────────────────────────────────────────────────

/** Validation rule for a setting value. */
export interface ISettingValidation {
  /** Validation type. */
  readonly type: 'required' | 'min' | 'max' | 'pattern' | 'custom';
  /** Value for comparison-based validations (min, max). */
  readonly value?: number | string;
  /** Regex pattern string for 'pattern' type. */
  readonly pattern?: string;
  /** Error message when validation fails. */
  readonly message: string;
  /** Custom validation function name (resolved at runtime). */
  readonly customValidator?: string;
}

/** Defines a configurable setting on a node. */
export interface ISettingDefinition {
  /** Unique key within the node. */
  readonly key: string;
  /** Human-readable label. */
  readonly label: string;
  /** Description / help text. */
  readonly description?: string;
  /** UI control type. */
  readonly type: SettingType;
  /** Default value. */
  readonly defaultValue?: unknown;
  /** Options for select/multi-select controls. */
  readonly options?: ReadonlyArray<{ label: string; value: string }>;
  /** Validation rules. */
  readonly validation?: ReadonlyArray<ISettingValidation>;
  /**
   * If true, this setting is fixed and cannot be edited by workflow users.
   * Used for building secure, reusable organizational workflows.
   */
  readonly fixed?: boolean;
  /** Placeholder text for text inputs. */
  readonly placeholder?: string;
  /** Group name for organizing settings in the UI. */
  readonly group?: string;
  /** Display order within its group (lower = higher). */
  readonly order?: number;
  /**
   * Conditional visibility — show this setting only when another setting
   * has a specific value. Example: { key: 'format', value: 'csv' }
   */
  readonly dependsOn?: {
    readonly key: string;
    readonly value: unknown;
  };
  /**
   * Row-field descriptors for a `SettingType.List` setting. Ignored for other
   * setting types. Each entry declares one column of the repeatable list.
   */
  readonly itemFields?: ReadonlyArray<IListItemField>;
}

// ─── Node Definition Interface ──────────────────────────────────────────────────

/**
 * The central contract every node type must implement.
 * This interface is used by:
 * - The registry to catalog available node types
 * - The UI to render nodes and their settings
 * - The IR builder to generate intermediate representation
 * - The serializer for persistence
 */
export interface INodeDefinition {
  /** Unique type identifier, e.g. 'beamflow:csv-source'. Use namespace:name format. */
  readonly type: string;
  /** Human-readable name. */
  readonly name: string;
  /** Description of what this node does. */
  readonly description: string;
  /** Category for palette organization. */
  readonly category: NodeCategory;
  /**
   * Optional finer-grained grouping within a category, used by the palette to
   * render sub-headers (e.g. Transform → "Filtering" / "Shaping" /
   * "Aggregation"). Nodes without a subcategory group under the category directly.
   */
  readonly subcategory?: string;
  /** Icon identifier (icon library name or SVG path). */
  readonly icon: string;
  /** Semantic version of this node definition. */
  readonly version: string;
  /** Node's input and output ports. */
  readonly ports: ReadonlyArray<IPort>;
  /** Configurable settings. */
  readonly settings: ReadonlyArray<ISettingDefinition>;
  /** Documentation URL or markdown content. */
  readonly documentation?: string;
  /** Tags for search and discovery. */
  readonly tags?: ReadonlyArray<string>;

  /**
   * Validate the current settings of a node instance.
   * @returns Array of validation issues (empty = valid).
   */
  validate(settings: Record<string, unknown>): ValidationIssue[];

  /**
   * Convert this node instance to its IR representation.
   * This is the bridge between the visual graph and code generation.
   */
  toIR(settings: Record<string, unknown>, nodeId: string): IRStepDefinition;
}

// ─── Node Instance Interface ────────────────────────────────────────────────────

/**
 * A single self-contained IR step embedded in a node instance.
 *
 * Used by user-authored custom nodes: because their definitions live only in
 * the editor (not in the server-side registry), the node instance carries the
 * IR it compiles to. Same shape as {@link IRStepDefinition} plus an optional
 * label used when a composite expands into multiple internal steps.
 */
export interface InlineIRStep extends IRStepDefinition {
  /** Optional label for this step (used for composite expansion). */
  readonly label?: string;
  /**
   * For composite (grouped) nodes only: the index of the internal step this
   * step's input(s) should connect to within the same inline array. Omitted
   * for the first step, which receives the node's external input.
   */
  readonly inputRefs?: ReadonlyArray<number>;
}

/** A placed node on the canvas with its configured values. */
export interface INodeInstance {
  /** Unique instance ID (generated). */
  readonly id: string;
  /** Reference to the node definition type. */
  readonly type: string;
  /** Current setting values. */
  readonly settings: Record<string, unknown>;
  /** Position on the canvas. */
  readonly position: { x: number; y: number };
  /** Optional user-defined label override. */
  readonly label?: string;
  /**
   * Optional pre-compiled IR carried by the instance itself. Set for
   * user-authored custom nodes whose definition is not in the server registry.
   * A single step for a simple custom node, or an ordered array of steps for a
   * grouped/composite node (expanded inline at build time).
   */
  readonly inlineIR?: InlineIRStep | InlineIRStep[];
}

// ─── Connection Interface ───────────────────────────────────────────────────────

/** An edge between two node ports in the workflow. */
export interface IConnection {
  /** Unique edge ID. */
  readonly id: string;
  /** Source node instance ID. */
  readonly sourceNodeId: string;
  /** Source port ID on the source node. */
  readonly sourcePortId: string;
  /** Target node instance ID. */
  readonly targetNodeId: string;
  /** Target port ID on the target node. */
  readonly targetPortId: string;
}

// ─── Workflow Interface ─────────────────────────────────────────────────────────

/** Metadata about a workflow. */
export interface IWorkflowMetadata {
  /** Unique workflow ID. */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** Description. */
  readonly description?: string;
  /** Creation timestamp (ISO 8601). */
  readonly createdAt: string;
  /** Last modified timestamp (ISO 8601). */
  readonly updatedAt: string;
  /** Author identifier. */
  readonly author?: string;
  /** Workflow tags. */
  readonly tags?: string[];
  /** Whether this workflow is meant to be used as a nested subflow. */
  readonly isSubflow?: boolean;
  /** Exposed parameters from internal nodes when used as a subflow. */
  readonly parameters?: ReadonlyArray<ISubflowParameter>;
  /** The project this workflow/subflow belongs to. */
  readonly projectId?: string;
  /** The organization this workflow/subflow belongs to (access scope). */
  readonly orgId?: string;
  /**
   * Monotonic per-workflow revision counter used as the optimistic-concurrency
   * token. The editor sends the version it loaded; the server rejects a save
   * (409) if the stored version has moved on, then bumps it on a clean write.
   * Undefined for never-saved (client-only) workflows.
   */
  readonly version?: number;
}

/** A project groups an organization's workflows and subflows. */
export interface IProject {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Owning organization id (access scope). */
  readonly orgId: string;
  /** Creating user id — provenance/attribution, not an access gate. */
  readonly ownerId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An organization is the top-level access scope; its members share its data. */
export interface IOrganization {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A user's membership in an organization. */
export interface IMembership {
  readonly id: string;
  readonly orgId: string;
  readonly userId: string;
  readonly role: 'owner' | 'admin' | 'member';
  readonly createdAt: string;
}

/**
 * Definition of a parameter exposed from a subflow's internal node.
 *
 * Two id conventions coexist:
 *  - `param_<nanoid>` — manually exposed via the link toggle in the editor.
 *  - `auto_<nodeId>_<settingKey>` — auto-derived because the target setting is
 *    required but unfilled inside the subflow (see shared
 *    `deriveAutoParameters`). Auto params are re-derived on every subflow
 *    save, never carried over, so their deterministic ids keep parent-side
 *    values (`proxySettings[param.id]`) stable across saves.
 */
export interface ISubflowParameter {
  /** Unique parameter ID, e.g. param_1 */
  readonly id: string;
  /** Human-readable parameter name */
  readonly name: string;
  /** Data type of the parameter */
  readonly type: 'string' | 'number' | 'boolean' | 'enum';
  /** The internal node ID to inject the value into */
  readonly targetNodeId: string;
  /** The setting key on the internal node */
  readonly targetSettingKey: string;
  /** Whether the target setting is required (drives parent-side validation). */
  readonly required?: boolean;
  /** Choices for enum params, copied from the target setting definition. */
  readonly options?: ReadonlyArray<{ label: string; value: string }>;
  /** The target setting definition's default value (display/prefill hint). */
  readonly defaultValue?: unknown;
}

/** Complete workflow document (nodes + connections + metadata). */
export interface IWorkflow {
  readonly metadata: IWorkflowMetadata;
  readonly nodes: ReadonlyArray<INodeInstance>;
  readonly connections: ReadonlyArray<IConnection>;
}

// ─── Serialization ──────────────────────────────────────────────────────────────

/** Schema version for forward/backward compatibility. */
export const SCHEMA_VERSION = '1.0.0';

/** The JSON-serializable form of a workflow for persistence. */
export interface SerializedWorkflow {
  /** Schema version for migration support. */
  readonly schemaVersion: string;
  /** Workflow metadata. */
  readonly metadata: IWorkflowMetadata;
  /** Serialized node instances. */
  readonly nodes: INodeInstance[];
  /** Serialized connections. */
  readonly connections: IConnection[];
}

// ─── IR Types (shared subset) ───────────────────────────────────────────────────

/** IR step types — abstract operations independent of target language. */
export enum IRStepType {
  Read = 'read',
  Transform = 'transform',
  Write = 'write',
  Combine = 'combine',
}

/**
 * The IR output from a single node's toIR() method.
 * The IR builder assembles these into a complete IRPipeline.
 */
export interface IRStepDefinition {
  /** The Beam operation name, e.g. 'ReadFromText', 'Filter', 'WriteToText'. */
  readonly operation: string;
  /** Step type classification. */
  readonly stepType: IRStepType;
  /** Operation parameters. */
  readonly params: Record<string, unknown>;
  /** Required Python/Java imports for this step. */
  readonly imports?: ReadonlyArray<string>;
}

// ─── Validation ─────────────────────────────────────────────────────────────────

/** Severity of a validation issue. */
export enum ValidationSeverity {
  Error = 'error',
  Warning = 'warning',
  Info = 'info',
}

/** A validation issue found during node or graph validation. */
export interface ValidationIssue {
  /** Severity level. */
  readonly severity: ValidationSeverity;
  /** Human-readable message. */
  readonly message: string;
  /** Setting key that caused the issue (if applicable). */
  readonly settingKey?: string;
  /** Node ID that caused the issue (if applicable). */
  readonly nodeId?: string;
}

// ─── Execution ──────────────────────────────────────────────────────────────────

/** Result of pipeline code generation. */
export interface GeneratedPipeline {
  /** Generated source code. */
  readonly code: string;
  /** Suggested filename. */
  readonly filename: string;
  /** Language of the generated code. */
  readonly language: 'python' | 'typescript' | 'java';
  /** Required package dependencies. */
  readonly requirements: string[];
  /** The IR pipeline this was generated from (for debugging). */
  readonly irPipeline: unknown;
}

/** Configuration for a pipeline runner. */
export interface RunnerConfig {
  /** Runner type. */
  readonly type: 'direct' | 'dataflow' | 'flink' | 'spark';
  /** Runner-specific options. */
  readonly options?: Record<string, unknown>;
}

/** Result of a pipeline execution. */
export interface ExecutionResult {
  /** Unique execution ID. */
  readonly id: string;
  /** Current status. */
  readonly status: ExecutionStatus;
  /** Start timestamp. */
  readonly startedAt: string;
  /** End timestamp (if completed/failed). */
  readonly completedAt?: string;
  /** stdout log lines. */
  readonly logs: string[];
  /** stderr error lines. */
  readonly errors: string[];
  /** Exit code (if completed). */
  readonly exitCode?: number;
}

// ─── Plugin Interface ───────────────────────────────────────────────────────────

/**
 * Interface that all BeamFlow plugins must implement.
 * Plugins register their node definitions with the registry during startup.
 */
export interface IPlugin {
  /** Unique plugin name, e.g. '@beamflow/builtin-nodes'. */
  readonly name: string;
  /** Semantic version. */
  readonly version: string;
  /** Description of what this plugin provides. */
  readonly description: string;

  /**
   * Called during plugin loading. Register all node definitions here.
   * @param registerNode — callback to register a node definition with the registry.
   */
  register(registerNode: (definition: INodeDefinition) => void): void;
}
