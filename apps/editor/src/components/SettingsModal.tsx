import React, { useState, useEffect } from 'react';
import { X, Key, Save, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (isOpen) {
      loadProfile();
    }
  }, [isOpen]);

  const loadProfile = async () => {
    setIsLoading(true);
    try {
      const profile = await api.getProfile();
      setApiKey(profile.geminiApiKey || '');
      setSaveStatus('idle');
    } catch (error) {
      console.error('Failed to load profile:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus('idle');
    try {
      await api.updateProfile({ geminiApiKey: apiKey.trim() || undefined });
      setSaveStatus('success');
      setTimeout(() => {
        onClose();
        setSaveStatus('idle');
      }, 1000);
    } catch (error) {
      console.error('Failed to save API key:', error);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-[var(--panel-bg)] w-full max-w-md rounded-2xl shadow-2xl border border-[var(--panel-border)] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-secondary)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">User Settings</h2>
          <button 
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="mb-4">
            <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] mb-2">
              <Key size={16} className="text-indigo-400" />
              Gemini API Key
            </label>
            <p className="text-xs text-[var(--text-secondary)] mb-4 leading-relaxed">
              To use the AI Flow Maker, you need to provide your own Google Gemini API key. 
              This key is stored in your account and is only used when you generate workflows.
            </p>
            
            {isLoading ? (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="animate-spin text-indigo-400" size={24} />
              </div>
            ) : (
              <input
                type="password"
                placeholder="AIzaSy..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-[var(--text-primary)]"
              />
            )}
          </div>
          
          {saveStatus === 'error' && (
            <div className="text-xs text-red-400 mb-4 bg-red-400/10 border border-red-400/20 p-2 rounded">
              Failed to save API key. Please try again.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex items-center justify-end gap-3 bg-[var(--bg-secondary)]">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <><Loader2 size={16} className="animate-spin" /> Saving...</>
            ) : saveStatus === 'success' ? (
              <><CheckCircle2 size={16} /> Saved!</>
            ) : (
              <><Save size={16} /> Save Changes</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
