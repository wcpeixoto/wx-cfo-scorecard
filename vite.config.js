/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(function (_a) {
    var command = _a.command;
    return ({
        plugins: [react()],
        base: command === 'serve' ? '/' : '/wx-cfo-scorecard/',
        test: {
            // Pure-function tests only at this stage. No DOM, no jsdom — keep
            // the runner light and the surface explicit.
            environment: 'node',
            globals: false,
        },
    });
});
