/**
 * Builds a NodeRegistry populated with BeamFlow's built-in nodes — the same
 * registry the server constructs in app.ts, minus HTTP/DB. Custom nodes carry
 * their own compiled `inlineIR` in the saved workflow JSON, so they need no
 * registry entry (identical to the server's assumption).
 */
import { createRegistry, createPluginLoader, type NodeRegistry } from '@beamflow/core';
import { builtinNodesPlugin } from '@beamflow/nodes';

export function buildRegistry(): NodeRegistry {
  const registry = createRegistry();
  createPluginLoader(registry).load(builtinNodesPlugin);
  return registry;
}
