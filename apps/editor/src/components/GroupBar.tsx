/**
 * GroupBar — floating action shown when 2+ nodes are selected, letting the
 * user collapse the selection into a reusable composite custom node.
 */

import React, { useState } from 'react';
import { Boxes, Loader2, X } from 'lucide-react';
import { useWorkflowStore } from '../store/workflow-store';

export function GroupBar() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const createSubflowFromSelection = useWorkflowStore((s) => s.createSubflowFromSelection);
  const selectedCount = useWorkflowStore((s) => s.selectedCount());
  const addToast = useWorkflowStore((s) => s.addToast);
  const [isGrouping, setIsGrouping] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  // Only meaningful for 1+ selected nodes.
  if (selectedCount < 1) {
    if (naming) setNaming(false);
    return null;
  }

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const result = await createSubflowFromSelection(name || 'Subflow');
    setBusy(false);
    if (result.ok) {
      addToast('success', `Created subflow "${name || 'Subflow'}"`);
      setNaming(false);
      setName('');
    } else {
      addToast('error', result.error || 'Could not group nodes');
    }
  };

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 animate-fade-in">
      <div className="flex items-center gap-2 pl-3 pr-2 py-2 rounded-xl glass border border-cyan-500/30 shadow-lg">
        <Boxes size={15} className="text-cyan-400" />
        {!naming ? (
          <>
            <span className="text-xs text-gray-300">
              {selectedCount} nodes selected
            </span>
            <button
              onClick={() => setNaming(true)}
              className="text-xs px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 transition-colors"
            >
              Group as node
            </button>
          </>
        ) : (
          <>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') setNaming(false);
              }}
              placeholder="New node name"
              className="text-xs bg-[var(--color-surface-200)] border border-[var(--color-border)]
                rounded-lg px-2 py-1 text-gray-200 placeholder-gray-600 outline-none
                focus:border-cyan-500/50 w-40"
            />
            <button
              onClick={submit}
              disabled={busy}
              className="text-xs px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              Create
            </button>
            <button
              onClick={() => setNaming(false)}
              className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-white/10"
            >
              <X size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
