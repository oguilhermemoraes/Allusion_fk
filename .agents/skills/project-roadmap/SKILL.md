# Skill: Tactical Alignment & Roadmap Access

This skill defines the rules for accessing the project's roadmap and ensuring tactical alignment between planning and the actual codebase.

## Purpose
To ensure the AI agent not only knows "what to do" but also verifies "if it's the right way to do it" by cross-referencing instructions with the existing technology stack.

## Core Directives

### 1. Roadmap Access
- **Source of Truth**: Consult the local roadmap file (path configured per environment).
- **Direct Linkage**: Use `view_file` on the absolute path above. Do not guess or search.
- **Continuous Check**: Consult the roadmap before every major task.

### 2. Tactical Alignment Verification (Crucial)
Before executing any task from the roadmap, the agent **MUST** perform a "Reality Check":
- **Stack Sync**: Is the task's technical approach (e.g., "WAL Mode for SQLite") compatible with the current stack (e.g., "Dexie/IndexedDB")?
- **Dependency Audit**: Does the project have the libraries mentioned in the roadmap?
- **Conflict Warning**: If a task in the roadmap contradicts the codebase (like SQLite vs. Dexie), **STOP** and inform the user immediately. Do not implement based on plans that conflict with the reality of the code.

### 3. Reporting & Adaptation
- If a roadmap task is technically incompatible, propose an **Equivalent Optimization** for the actual stack (e.g., "Instead of SQLite WAL, let's optimize Dexie Indices/Transactions").
- Keep the user informed about these discrepancies before proceeding to the "Writing Plans" phase.

## Workflow
1. **Read Roadmap**: Identify the next task.
2. **Scan Codebase**: Verify the related code and dependencies.
3. **Verify Alignment**: Confirm the task's technical approach matches the code.
4. **Proceed or Alert**: If aligned, start planning; if conflicted, alert the user and propose an alternative.

## Important
- Plans are strategic; Code is reality. The agent's job is to bridge that gap with technical rigor.
- Never blindly follow a roadmap that would lead to broken or incompatible code.
