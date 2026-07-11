import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { pgTable, text as pgText, integer as pgInteger } from 'drizzle-orm/pg-core';

// ==========================================
// SQLite Schema (Development)
// ==========================================

export const sqliteUsers = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull().default(''),
  geminiApiKey: text('gemini_api_key'),
  createdAt: text('created_at').notNull(),
});

// Organizations are the top-level access scope. Members of an org share its
// projects/workflows/subflows. Nullable FKs elsewhere are backfilled to a single
// "Default Organization" on startup (see ensureDefaultOrg).
export const sqliteOrganizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sqliteMemberships = sqliteTable('memberships', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => sqliteOrganizations.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => sqliteUsers.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'), // 'owner' | 'admin' | 'member'
  createdAt: text('created_at').notNull(),
});

export const sqliteProjects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  // Access scope. Nullable so existing rows can be backfilled on startup.
  orgId: text('org_id').references(() => sqliteOrganizations.id, { onDelete: 'cascade' }),
  // Creator — provenance/attribution, no longer the access gate.
  ownerId: text('owner_id')
    .notNull()
    .references(() => sqliteUsers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sqliteWorkflows = sqliteTable('workflows', {
  id: text('id').primaryKey(),
  // Access scope. Nullable so existing rows can be backfilled on startup.
  orgId: text('org_id').references(() => sqliteOrganizations.id, { onDelete: 'cascade' }),
  // Creator — provenance/attribution, no longer the access gate.
  ownerId: text('owner_id')
    .notNull()
    .references(() => sqliteUsers.id, { onDelete: 'cascade' }),
  // Nullable: existing rows are backfilled to a Default project on startup.
  projectId: text('project_id').references(() => sqliteProjects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  settingsJson: text('settings_json').notNull(), // Serialized JSON string
  isSubflow: integer('is_subflow').notNull().default(0), // 0 or 1
  // Monotonic optimistic-concurrency token; bumped on every clean save.
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sqliteWorkflowVersions = sqliteTable('workflow_versions', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id')
    .notNull()
    .references(() => sqliteWorkflows.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  snapshotJson: text('snapshot_json').notNull(), // Serialized JSON string
  createdAt: text('created_at').notNull(),
  label: text('label'),
});

export const sqliteVariables = sqliteTable('variables', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id')
    .notNull()
    .references(() => sqliteWorkflows.id, { onDelete: 'cascade' }),
  environment: text('environment').notNull().default('default'),
  name: text('name').notNull(),
  value: text('value').notNull(),
  isSecret: integer('is_secret').notNull().default(0), // 0 or 1
});

// ==========================================
// PostgreSQL Schema (Production)
// ==========================================

export const pgUsers = pgTable('users', {
  id: pgText('id').primaryKey(),
  email: pgText('email').unique().notNull(),
  passwordHash: pgText('password_hash').notNull(),
  name: pgText('name').notNull().default(''),
  geminiApiKey: pgText('gemini_api_key'),
  createdAt: pgText('created_at').notNull(),
});

export const pgOrganizations = pgTable('organizations', {
  id: pgText('id').primaryKey(),
  name: pgText('name').notNull(),
  createdAt: pgText('created_at').notNull(),
  updatedAt: pgText('updated_at').notNull(),
});

export const pgMemberships = pgTable('memberships', {
  id: pgText('id').primaryKey(),
  orgId: pgText('org_id')
    .notNull()
    .references(() => pgOrganizations.id, { onDelete: 'cascade' }),
  userId: pgText('user_id')
    .notNull()
    .references(() => pgUsers.id, { onDelete: 'cascade' }),
  role: pgText('role').notNull().default('member'), // 'owner' | 'admin' | 'member'
  createdAt: pgText('created_at').notNull(),
});

export const pgProjects = pgTable('projects', {
  id: pgText('id').primaryKey(),
  orgId: pgText('org_id').references(() => pgOrganizations.id, { onDelete: 'cascade' }),
  ownerId: pgText('owner_id')
    .notNull()
    .references(() => pgUsers.id, { onDelete: 'cascade' }),
  name: pgText('name').notNull(),
  description: pgText('description').notNull().default(''),
  createdAt: pgText('created_at').notNull(),
  updatedAt: pgText('updated_at').notNull(),
});

export const pgWorkflows = pgTable('workflows', {
  id: pgText('id').primaryKey(),
  orgId: pgText('org_id').references(() => pgOrganizations.id, { onDelete: 'cascade' }),
  ownerId: pgText('owner_id')
    .notNull()
    .references(() => pgUsers.id, { onDelete: 'cascade' }),
  // Nullable: existing rows are backfilled to a Default project on startup.
  projectId: pgText('project_id').references(() => pgProjects.id, { onDelete: 'cascade' }),
  name: pgText('name').notNull(),
  description: pgText('description').notNull().default(''),
  settingsJson: pgText('settings_json').notNull(), // Serialized JSON string
  isSubflow: pgInteger('is_subflow').notNull().default(0), // 0 or 1
  // Monotonic optimistic-concurrency token; bumped on every clean save.
  version: pgInteger('version').notNull().default(1),
  createdAt: pgText('created_at').notNull(),
  updatedAt: pgText('updated_at').notNull(),
});

export const pgWorkflowVersions = pgTable('workflow_versions', {
  id: pgText('id').primaryKey(),
  workflowId: pgText('workflow_id')
    .notNull()
    .references(() => pgWorkflows.id, { onDelete: 'cascade' }),
  version: pgInteger('version').notNull(),
  snapshotJson: pgText('snapshot_json').notNull(), // Serialized JSON string
  createdAt: pgText('created_at').notNull(),
  label: pgText('label'),
});

export const pgVariables = pgTable('variables', {
  id: pgText('id').primaryKey(),
  workflowId: pgText('workflow_id')
    .notNull()
    .references(() => pgWorkflows.id, { onDelete: 'cascade' }),
  environment: pgText('environment').notNull().default('default'),
  name: pgText('name').notNull(),
  value: pgText('value').notNull(),
  isSecret: pgInteger('is_secret').notNull().default(0), // 0 or 1
});
