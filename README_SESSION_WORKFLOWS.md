# Wx CFO Workflow Operating System

This repo contains the final split workflow system.

## Files

### `PROJECT_CONFIG.md`

Shared source of truth.

Use for:

- project config
- required reads
- locked files
- source-of-truth rules
- Notion backlog location
- arc signals
- irreversible-action rules

### `TASK_PROMPT_TEMPLATE.md`

Use when drafting implementation prompts for Claude Code (the executor). See `PROJECT_CONFIG.md` → **AI Roles and Prompt Routing**.

Contains:

- Universal Task Prompt
- UI Task Module
- prompt delivery discipline
- diagnosis-first execution rules

### `SESSION_CLOSE_WORKFLOW.md`

Use when closing a coding/project session.

Contains:

- trigger model
- trigger ordering
- dirty-state buckets
- continuation close
- cross-agent stub
- time budgets
- close examples

## Rule

Do not duplicate project configuration across files.

`PROJECT_CONFIG.md` owns shared project state.
