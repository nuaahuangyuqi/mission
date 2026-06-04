# Agent Instructions

This repository uses `agent.md` as the persistent handoff memory and `README.md` as the user-facing source of truth.

Read order for every new agent:
1. `AGENTS.md`
2. `agent.md`
3. `README.md`

Before making any code change:
1. Finish the read order above.
2. Treat both `agent.md` and `README.md` as mandatory context for the task.

After making any code change:
1. Update `agent.md` with the technical memory: what changed, what was verified, and any remaining risks.
2. Update `README.md` so the documented behavior, setup steps, feature status, and known issues match the code.
3. Do not finish the task until both files have been reviewed and synced.

If another agent takes over this project, it must start with the same read order above.
