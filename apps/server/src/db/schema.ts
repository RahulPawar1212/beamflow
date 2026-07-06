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
  createdAt: text('created_at').notNull(),
});

export const sqliteWorkflows = sqliteTable('workflows', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => sqliteUsers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  settingsJson: text('settings_json').notNull(), // Serialized JSON string
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
  createdAt: pgText('created_at').notNull(),
});

export const pgWorkflows = pgTable('workflows', {
  id: pgText('id').primaryKey(),
  ownerId: pgText('owner_id')
    .notNull()
    .references(() => pgUsers.id, { onDelete: 'cascade' }),
  name: pgText('name').notNull(),
  description: pgText('description').notNull().default(''),
  settingsJson: pgText('settings_json').notNull(), // Serialized JSON string
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
