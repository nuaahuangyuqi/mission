# Agent Memory

Updated: 2026-06-21

Purpose: keep only the latest handoff-ready status for future agents.

## Repo Agent Protocol

- Repo-level instruction file: `AGENTS.md`
- Required read order for every new agent:
  1. `AGENTS.md`
  2. `agent.md`
  3. `README.md`
- Before making code changes, treat both `agent.md` and `README.md` as mandatory context.
- After any code change, update both `agent.md` and `README.md` before finishing.

## Current Status

Latest completed work on 2026-06-21: added the intelligent task planning `分步执行` module as a top-level sibling of `规划算法库` and `作战任务库`. The new route `/planning/step-execution` provides a two-tab `配置 / 运行与结果` workflow for running one algorithm at a time against selected upstream results, including cross-task results the current user can access.

Files and areas changed in the latest work:

- Updated `apps/server/src/index.js`:
  - Added `GET /api/planning/realtime/upstream-results`, merging `planning_realtime_artifacts` with archived single-step outputs from full planning task runs.
  - Extended realtime single-step execution to accept `inputResultRefs` in addition to legacy `inputArtifactIds`.
  - Resolved `{ sourceType: "realtime-artifact", id }` and `{ sourceType: "task-run-step", taskId, runId, stepId }` refs with permission checks, existence checks, and duplicate-upstream-algorithm validation before injecting results into the realtime stage context.
- Updated `apps/server/src/planning-runtime.js`:
  - Added upstream metadata fields on planning algorithms.
  - Preserved `inputResultRefs` in realtime step results for traceability.
- Updated `apps/web/src/modules/planningWorkflow.js`:
  - Added independent `stepExecution` state, stream handling, upstream result loading, payload building, execution, termination, and artifact selection.
- Added shared frontend components:
  - `apps/web/src/components/PlanningAlgorithmConfigPanel.vue`
  - `apps/web/src/components/PlanningExecutionStreamMonitor.vue`
  - `apps/web/src/components/PlanningSingleAlgorithmResultPanel.vue`
- Added `apps/web/src/views/planning/PlanningStepExecutionStep.vue`:
  - Config tab reuses algorithm configuration controls and adds one-slot-per-upstream result selectors.
  - Run/result tab reuses the stream monitor and embedded single-algorithm result panel, with current and historical realtime products.
- Updated navigation and routing:
  - `apps/web/src/router/index.js`
  - `apps/web/src/views/PlanningView.vue`
- Updated tests:
  - `apps/server/src/index.contract.test.js` covers upstream result listing, task-run-step refs, duplicate refs, and missing refs.
  - `apps/server/src/planning-runtime.support.test.js` covers realtime step execution with injected upstream artifacts and duplicate upstream rejection.
- Updated docs:
  - `README.md`
  - `agent.md`
  - `docs/intelligent-task-planning/00-module-overview.md`

Verification completed for the latest work:

- `npm test --workspace @mission/server -- --runInBand` passed: 28 tests.
- `npm run build --workspace @mission/web` passed; Vite still reports the existing large chunk warning.

Remaining risk:

- Manual browser acceptance for the new `分步执行` page has not been run in this handoff. Recommended checks: no task instance prompt, enemy-threat run without upstream, force grouping with cross-task enemy result, target allocation with enemy + grouping results, stream terminal/LLM display, 3D/result export display, and existing full task execution flow.
- Real external OpenAI-compatible or Ollama execution was not exercised; automated tests use local/mock execution paths.

Previous completed work on 2026-06-20: added strategy-profile comparison for Battle Planner intelligent grouping and intelligent target allocation, then wired the result page so users can click a scheme/plan to display different grouping and allocation results. Both intelligent modules now expose `balanced / loss-minimized / resource-minimized` (`均衡 / 战损最小化 / 资源最小化`) outputs; target allocation carries a separate visualization per compared plan so the 3D situation, 2D group-target diagram, metrics, and assignment list switch together.

Files and areas changed in the latest work:

- Updated `apps/server/src/planning-runtime.js`:
  - Added centralized planning strategy profiles with score weights and legacy alias normalization.
  - `comparisonFocus`, `objectivePreference`, and `planningPreference` now resolve to the same three strategy keys.
  - Force grouping adapts one Battle Planner result into three strategy schemes and marks preferred/system-best schemes.
  - Intelligent target allocation builds three strategy plans, including loss-minimized multi-group reinforcement behavior and resource-minimized reuse/unit-cost pressure.
  - Each compared allocation plan receives its own `visualization`; the top-level visualization follows the selected/preferred plan for compatibility.
- Updated `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`:
  - Added selected target-allocation plan state and plan-card/table-row click handling.
  - The target-allocation situation panel now renders from the selected plan's visualization and synchronizes the 3D map, 2D assignment diagram, stat cards, and assignment list.
- Updated `apps/web/src/views/planning/PlanningAlgorithmsStep.vue`:
  - Force-grouping and target-allocation preference controls now expose `均衡 / 战损最小化 / 资源最小化`.
- Updated `apps/web/src/styles.css`:
  - Added active/interactive styling for allocation plan cards and rows.
- Updated tests:
  - `apps/server/src/planning-runtime.support.test.js` now asserts the three grouping strategies, the three intelligent allocation plans, preferred strategy selection, and per-plan visualization.
- Updated docs: `README.md` and `agent.md`.

Verification completed for the latest work:

- `node algorithms/run-with-venv.mjs -m pytest algorithms/battle-planner/tests -q` passed: 4 tests.
- `npm test --workspace @mission/server` passed: 25 tests.
- `npm run build --workspace @mission/web` passed; Vite still reports the existing large chunk warning.

Previous same-day work remains relevant: Battle Planner target allocation was fixed to preserve original enemy targets and real coordinates in the situation map, suppress duplicate/non-critical labels to avoid Cesium overload, and compute firepower only from loaded weapons; fire-strike assignments without loaded weapons are blocked by validation. Earlier baseline replaced the previous intelligent force-grouping and intelligent target-allocation Python algorithms with the zipped `battle_planner` package.

Files and areas changed in that baseline:

- Added `algorithms/battle-planner/battle_planner/**` from `/Users/hyq/Documents/01-项目/项目-602/编组算法/battle_planner.zip`.
- Added `algorithms/battle-planner/README.md`, `requirements.txt`, and `tests/test_battle_planner_pipeline.py`.
- Deleted old `algorithms/force-grouping` and `algorithms/target-allocation` Python intelligent algorithm directories.
- Updated `algorithms/run-with-venv.mjs` to install/use `algorithms/battle-planner` instead of the deleted old algorithm directories.
- Updated `apps/server/src/planning-runtime.js`:
  - `force-grouping-local / 智能编组算法` now points to `algorithms/battle-planner` and runs `python -m battle_planner.cli`.
  - `force-grouping:builtin` remains as a compatibility bridge to the same Battle Planner path and defaults to mock LLM.
  - The upstream threat output is internally wrapped as `planning-artifact-export-v1`; users no longer upload threat JSON for grouping.
  - Friendly inputs still come from the intelligent grouping step. TXT/MD/JSON/DOCX are passed through; PDF/Excel/CSV are converted to text via the existing import-preview parser.
  - `target-allocation-local / 智能分配算法` no longer runs Python. It adapts `battlePlannerResult.task_groups` into `candidateTargets / groups / platforms / preferredPlan / visualization`.
  - Legacy `builtinMethodKey=intelligent-allocation` now routes to the same Battle Planner allocation adapter.
- Updated `apps/server/src/planning-runtime.support.test.js` to cover Battle Planner registration, grouping execution, allocation adaptation, and missing upstream/input errors.
- Updated frontend result tolerance and display text in:
  - `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`
  - `apps/web/src/components/PlanningForceGroupingPanel.vue`
- Updated docs:
  - `README.md`
  - `algorithms/README.md`
  - `docs/intelligent-task-planning/00-module-overview.md`
  - `docs/intelligent-task-planning/02-force-grouping-design-test.md`
  - `docs/intelligent-task-planning/03-target-allocation-design-test.md`
  - `docs/intelligent-task-planning/07-force-grouping-implementation-idea.md`

Verification completed for that baseline:

- `node algorithms/run-with-venv.mjs -m pytest algorithms/battle-planner/tests -q` passed: 3 tests.
- `npm test --workspace @mission/server` passed: 23 tests.
- `npm run build` passed; Vite reported the existing large-chunk size warning.

Remaining risk:

- Real external OpenAI-compatible or Ollama execution was not exercised; automated tests use Battle Planner mock LLM.
- Battle Planner natively supports TXT/MD/JSON/DOCX friendly files. Platform-side text conversion covers PDF/Excel/CSV, but complex tables/PDF layout fidelity depends on the existing import-preview extraction quality.
