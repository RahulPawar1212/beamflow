/**
 * Toasts — transient notifications anchored bottom-center.
 * Driven by the workflow store's toast queue.
 */

import React from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { useWorkflowStore, type ToastKind } from '../store/workflow-store';

const kindStyles: Record<
  ToastKind,
  { icon: React.ElementType; ring: string; accent: string }
> = {
  success: {
    icon: CheckCircle2,
    ring: 'border-emerald-500/40',
    accent: 'text-emerald-400',
  },
  error: {
    icon: XCircle,
    ring: 'border-red-500/40',
    accent: 'text-red-400',
  },
  info: {
    icon: Info,
    ring: 'border-indigo-500/40',
    accent: 'text-indigo-400',
  },
};

export function Toasts() {
  const toasts = useWorkflowStore((s) => s.toasts);
  const dismiss = useWorkflowStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map((toast) => {
        const style = kindStyles[toast.kind];
        const Icon = style.icon;
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-2.5 pl-3 pr-2 py-2.5
              rounded-xl glass border ${style.ring} shadow-lg animate-fade-in
              min-w-[240px] max-w-[420px]`}
          >
            <Icon size={16} className={`flex-shrink-0 ${style.accent}`} />
            <span className="text-xs text-gray-200 flex-1 leading-snug">
              {toast.message}
            </span>
            <button
              onClick={() => dismiss(toast.id)}
              className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
