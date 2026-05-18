var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
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
            // Detached git worktrees live under .claude/worktrees/<name>/ and
            // carry their own src/ copy; without this they get double-counted.
            exclude: __spreadArray(__spreadArray([], configDefaults.exclude, true), ['.claude/**'], false),
        },
    });
});
