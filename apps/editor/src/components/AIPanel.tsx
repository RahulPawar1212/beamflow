import React, { useState, useRef, useEffect } from 'react';
import { X, Sparkles, Send, Loader2 } from 'lucide-react';
import { useWorkflowStore } from '../store/workflow-store';
import { api } from '../api/client';
import { nanoid } from 'nanoid';
import dagre from 'dagre';

interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
}

export function AIPanel() {
  const isAIPanelOpen = useWorkflowStore((s) => s.isAIPanelOpen);
  const closeAIPanel = useWorkflowStore((s) => s.closeAIPanel);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const addToast = useWorkflowStore((s) => s.addToast);
  const pipelineId = useWorkflowStore((s) => s.pipelineId);
  const pipelineName = useWorkflowStore((s) => s.pipelineName);

  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!isAIPanelOpen) return null;

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    const userMessage = prompt.trim();
    setPrompt('');
    setMessages((prev) => [...prev, { id: nanoid(), role: 'user', content: userMessage }]);
    setIsGenerating(true);

    try {
      const response = await api.generateFlow(userMessage);
      
      const dagreGraph = new dagre.graphlib.Graph();
      dagreGraph.setDefaultEdgeLabel(() => ({}));
      dagreGraph.setGraph({ rankdir: 'LR', align: 'UL', nodesep: 50, ranksep: 100 });

      // Add nodes to dagre
      response.nodes.forEach((n: any) => {
        dagreGraph.setNode(n.id, { width: 250, height: 100 });
      });

      // Add edges to dagre
      response.edges.forEach((e: any) => {
        dagreGraph.setEdge(e.source, e.target);
      });

      dagre.layout(dagreGraph);

      const formattedNodes = response.nodes.map((n: any) => {
        const nodeWithPosition = dagreGraph.node(n.id);
        return {
          ...n,
          position: { 
            x: nodeWithPosition.x - 125, 
            y: nodeWithPosition.y - 50 
          },
          settings: n.configured_data || {},
        };
      });

      const formattedConnections = response.edges.map((e: any) => ({
        id: `edge_${nanoid(8)}`,
        sourceNodeId: e.source,
        sourcePortId: e.sourceHandle,
        targetNodeId: e.target,
        targetPortId: e.targetHandle,
      }));

      // Load the generated workflow into the canvas
      loadWorkflow({
        schemaVersion: '1.0.0',
        metadata: {
          id: pipelineId || `pipeline_${nanoid(8)}`,
          name: pipelineName || 'Generated Pipeline',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        nodes: formattedNodes,
        connections: formattedConnections,
      });

      setMessages((prev) => [
        ...prev,
        { id: nanoid(), role: 'ai', content: 'Here is your generated pipeline! Let me know if you want to modify it.' }
      ]);
    } catch (err: any) {
      console.error('Failed to generate flow:', err);
      
      const isKeyError = err.message?.includes('GEMINI_API_KEY') || err.message?.includes('API key');
      
      setMessages((prev) => [
        ...prev,
        { 
          id: nanoid(), 
          role: 'ai', 
          content: isKeyError 
            ? 'It looks like you need to add your Gemini API Key in Settings to use the AI Flow Maker.' 
            : 'Oops, something went wrong while generating the pipeline.' 
        }
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="w-80 h-full glass flex flex-col z-50 shadow-2xl border-r border-[var(--color-border)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface-100)]">
        <div className="flex items-center gap-2 text-[var(--text-primary)]">
          <Sparkles size={16} className="text-indigo-400" />
          <span className="text-sm font-semibold">AI Flow Maker</span>
        </div>
        <button
          onClick={closeAIPanel}
          title="Close AI Panel"
          className="p-1 rounded hover:bg-[var(--color-surface-300)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-[var(--bg-primary)]">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="text-center">
              <div className="flex justify-center mb-3">
                <div className="w-12 h-12 bg-indigo-500/10 rounded-full flex items-center justify-center text-indigo-400">
                  <Sparkles size={24} />
                </div>
              </div>
              <h3 className="text-[var(--text-primary)] font-medium mb-1">What would you like to build today?</h3>
              <p className="text-[var(--text-tertiary)] text-xs">Describe your pipeline...</p>
            </div>
            
            <div className="w-full">
              <h4 className="text-[var(--text-secondary)] text-[10px] font-semibold uppercase tracking-wider mb-2 pl-2">Examples</h4>
              <div className="flex flex-col gap-2 w-full">
                {['Import CSV and clean it', 'Read BigQuery and aggregate', 'Merge customer tables', 'Build ML pipeline'].map(ex => (
                  <button 
                    key={ex}
                    onClick={() => {
                      setPrompt(ex);
                    }}
                    className="text-left px-3 py-2 text-xs bg-[var(--color-surface-200)] hover:bg-[var(--color-surface-300)] text-[var(--text-primary)] rounded-lg transition-colors border border-[var(--color-border)] flex items-center gap-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400/50"></span>
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col max-w-[90%] ${msg.role === 'user' ? 'self-end items-end' : 'self-start items-start'}`}
            >
              <div
                className={`px-3 py-2 rounded-2xl text-sm ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-tr-sm'
                    : 'bg-[var(--color-surface-200)] text-[var(--text-primary)] border border-[var(--color-border)] rounded-tl-sm'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))
        )}
        {isGenerating && (
          <div className="flex items-center gap-2 text-[var(--text-tertiary)] self-start bg-[var(--color-surface-200)] px-3 py-2 border border-[var(--color-border)] rounded-2xl rounded-tl-sm text-sm">
            <Loader2 size={14} className="animate-spin text-indigo-400" />
            Generating...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-surface-100)]">
        <div className="relative flex items-center">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleGenerate();
              }
            }}
            placeholder="e.g. Read a CSV and filter rows..."
            className="w-full bg-[var(--bg-primary)] border border-[var(--color-border)] rounded-xl py-2 pl-3 pr-10 text-sm text-[var(--text-primary)] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none overflow-hidden"
            rows={1}
          />
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className="absolute right-2 p-1.5 text-indigo-400 hover:text-indigo-300 disabled:text-gray-500 hover:bg-indigo-500/10 rounded-lg transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
        <div className="text-[10px] text-[var(--text-tertiary)] mt-1.5 text-center">
          Press <kbd className="px-1 bg-[var(--color-surface-300)] rounded border border-[var(--color-border)]">Enter</kbd> to send
        </div>
      </div>
    </div>
  );
}
