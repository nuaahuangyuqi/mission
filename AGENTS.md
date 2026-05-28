# Agent Instructions

This repository uses `agent.md` as the persistent handoff memory, `README.md` as the user-facing source of truth, and `开发指南.md` as the developer-facing file map.

Read order for every new agent:
1. `AGENTS.md`
2. `agent.md`
3. `README.md`
4. `开发指南.md`

Before making any code change:
1. Finish the read order above.
2. Treat `agent.md`, `README.md`, and `开发指南.md` as mandatory context for the task.

After making any code change:
1. Update `agent.md` with the technical memory: what changed, what was verified, and any remaining risks.
2. Update `README.md` so the documented behavior, setup steps, feature status, and known issues match the code.
3. Update `开发指南.md` when file responsibilities, entry points, structure, or developer workflows change.
4. Do not finish the task until these files have been reviewed and synced.

If another agent takes over this project, it must start with the same read order above.
