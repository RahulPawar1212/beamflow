import React, { useState } from 'react';
import { useAuthStore } from '../lib/auth-store.js';
import { Button } from './ui/button.js';
import { Input } from './ui/input.js';
import { Label } from './ui/label.js';

export function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  
  const { login, register, loading, error, clearError } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegister) {
      await register(email, password, name);
    } else {
      await login(email, password);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-0)] text-[var(--text-primary)] font-sans antialiased p-4">
      {/* Background radial gradient decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.08),transparent_50%),radial-gradient(ellipse_at_bottom_left,rgba(99,102,241,0.03),transparent_50%)] pointer-events-none" />

      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-glass)] backdrop-blur-xl p-8 shadow-2xl transition-all duration-300 hover:border-[var(--border-hover)]">
        <div className="flex flex-col items-center mb-8">
          {/* Logo Icon */}
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 text-white shadow-lg shadow-indigo-500/20 mb-4 animate-bounce-slow">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
            </svg>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-200 via-indigo-100 to-white bg-clip-text text-transparent">
            BeamFlow
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-2 text-center">
            {isRegister ? 'Create your visual ETL pipeline account' : 'Sign in to orchestrate visual ETL pipelines'}
          </p>
        </div>

        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5 flex-shrink-0 text-red-400 mt-0.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <div className="flex-1">
              <div className="font-semibold">Authentication Error</div>
              <div className="text-xs text-red-300/90 mt-1">{error}</div>
            </div>
            <button onClick={clearError} className="text-red-400 hover:text-red-300 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {isRegister && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="bg-[var(--surface-100)] border-[var(--border)] focus:border-indigo-500 text-white rounded-lg px-4 py-2.5 transition-all"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-[var(--surface-100)] border-[var(--border)] focus:border-indigo-500 text-white rounded-lg px-4 py-2.5 transition-all"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="bg-[var(--surface-100)] border-[var(--border)] focus:border-indigo-500 text-white rounded-lg px-4 py-2.5 transition-all"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-indigo-600/20 transition-all duration-200 mt-2"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing...
              </span>
            ) : (
              isRegister ? 'Create Account' : 'Sign In'
            )}
          </Button>
        </form>

        <div className="mt-8 text-center text-xs text-[var(--text-secondary)] border-t border-[var(--border)] pt-6">
          {isRegister ? (
            <span>
              Already have an account?{' '}
              <button
                onClick={() => {
                  setIsRegister(false);
                  clearError();
                }}
                className="text-indigo-400 hover:text-indigo-300 font-semibold underline transition-colors"
              >
                Sign in
              </button>
            </span>
          ) : (
            <span>
              Don't have an account?{' '}
              <button
                onClick={() => {
                  setIsRegister(true);
                  clearError();
                }}
                className="text-indigo-400 hover:text-indigo-300 font-semibold underline transition-colors"
              >
                Create one
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
