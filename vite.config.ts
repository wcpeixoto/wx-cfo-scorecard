/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'serve' ? '/' : '/wx-cfo-scorecard/',
  test: {
    // Pure-function tests only at this stage. No DOM, no jsdom — keep
    // the runner light and the surface explicit.
    environment: 'node',
    globals: false,
    // Detached git worktrees live under .claude/worktrees/<name>/ and
    // carry their own src/ copy; without this they get double-counted.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
}));
