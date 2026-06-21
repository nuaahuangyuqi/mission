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

Latest completed work on 2026-06-21: implemented staged progress reporting for the two LLM-backed intelligent planning modules. `敌情威胁自动分析 / 基于大模型分析算法` and `作战力量智能编组 / 智能编组算法` now report algorithm-internal progress as `0%-10%` pre-parse and unit-count estimation, `10%-90%` LLM structured parsing with unit-object progress, and `90%-100%` report/artifact generation. Full task execution scales algorithm progress into the overall task progress; realtime single-step execution shows the algorithm's direct `0%-100%`.

Files and areas changed in the latest work:

- Updated `apps/server/src/planning-runtime.js`:
  - Added parsing for Python stderr control lines prefixed by `@@MISSION_PROGRESS@@`.
  - Extended `progress` events with `stepProgress`, `phaseKey`, `phaseLabel`, and `unitProgress`.
  - Added per-step event wrappers so full task execution scales current algorithm progress into the total flow while realtime step execution keeps direct single-algorithm progress.
  - Buffered stderr line parsing so split control lines are not accidentally shown as terminal output.
- Updated `algorithms/enemy-threat-analysis`:
  - Added progress helpers and stderr progress emission.
  - Added an initial LLM unit-count estimation call for enemy target/unit object count.
  - Added streaming JSON target-object completion detection for `targets[]`, with final reconciliation against parsed target count.
  - Report generation or skipped-report artifact finalization now drives the `90%-100%` phase.
- Updated `algorithms/battle-planner`:
  - Added progress helpers and stderr progress emission.
  - Added a friendly unit-count prompt and LLM client method; mock LLM now returns deterministic count output.
  - Added stream progress callbacks for OpenAI-compatible, Ollama, and mock clients.
  - Battle Planner pipeline now reports preparse, unit-count, structured-generation, and artifact-generation phases; friendly unit count treats platform/personnel/unit object entries as units and does not expand `available` quantities or weapons.
- Updated frontend:
  - `apps/web/src/modules/planningWorkflow.js` now stores progress phase, algorithm-internal progress, and unit progress for both full execution and step execution streams.
  - `apps/web/src/components/PlanningExecutionStreamMonitor.vue` now displays current stage and `已解析 X / Y 个敌方/我方单位` alongside total progress.
- Updated tests:
  - `apps/server/src/planning-runtime.support.test.js` covers Python progress control-line forwarding, phase keys, unit progress, and non-regressing full-flow scaled progress.
  - `algorithms/enemy-threat-analysis/tests/test_enemy_threat_analysis.py` covers streaming target-object completion counting.
  - `algorithms/battle-planner/tests/test_battle_planner_pipeline.py` covers friendly unit object counting without quantity expansion.
- Updated docs:
  - `README.md`
  - `agent.md`

Verification completed for the latest work:

- `node --check apps/server/src/planning-runtime.js` passed.
- `node --check apps/web/src/modules/planningWorkflow.js` passed.
- `python3 -m py_compile algorithms/enemy-threat-analysis/enemy_threat_analysis/analyze.py algorithms/enemy-threat-analysis/enemy_threat_analysis/llm_extractor.py algorithms/enemy-threat-analysis/enemy_threat_analysis/progress.py algorithms/battle-planner/battle_planner/pipeline/pipeline.py algorithms/battle-planner/battle_planner/llm/clients.py algorithms/battle-planner/battle_planner/llm/prompts.py algorithms/battle-planner/battle_planner/progress.py` passed.
- `node --test apps/server/src/planning-runtime.support.test.js` passed: 23 tests.
- `node algorithms/run-with-venv.mjs -m pytest algorithms/enemy-threat-analysis/tests algorithms/battle-planner/tests -q` passed: 36 tests.
- `npm run build --workspace @mission/web` passed; Vite still reports the existing large chunk warning.
- `git diff --check` passed.

Remaining risk:

- Real external OpenAI-compatible and Ollama streaming were still not exercised with live credentials/models in this handoff. Automated coverage verifies the event path with deterministic mock LLM and patched local clients.
- The unit progress detector counts completed JSON objects in model output streams; highly unusual provider chunking is tolerated by cumulative scanning, but live provider acceptance should still verify that unit progress advances during long real outputs.

Previous completed work on 2026-06-21: fixed `作战力量智能编组 / 智能编组算法` large-model stream output not appearing in the planning execution monitor. The root cause was twofold: the platform invoked Battle Planner with `stdoutAsLlm: false`, so Python stdout was always sent to the terminal log instead of `llm-chunk`; and the Battle Planner OpenAI/Ollama clients only made non-streaming chat requests, so there were no incremental model fragments to echo.

Files and areas changed in the latest work:

- Updated `apps/server/src/planning-runtime.js`:
  - `buildBattlePlannerConfig` now writes `llm.stream`, `llm.stream_to_stdout`, and `llm.ollama_num_ctx` into the Battle Planner config.
  - `executeLocalForceGrouping` now applies `FORCE_GROUPING_LLM_*` / shared `LLM_*` runtime environment variables and sets `stdoutAsLlm` from `runtimeOptions.llmStream`, defaulting to stream-enabled for the direct intelligent grouping variant.
- Updated `algorithms/battle-planner/battle_planner/models/schemas.py`:
  - Added Battle Planner LLM stream configuration fields.
- Updated `algorithms/battle-planner/battle_planner/llm/clients.py`:
  - OpenAI-compatible and Ollama clients now support streaming chat calls, echo model chunks to stdout when enabled, and still join the chunks for JSON extraction.
  - Mock LLM now emits deterministic stdout chunks when streaming is enabled, giving regression tests a local/offline signal.
- Updated `algorithms/battle-planner/battle_planner/cli.py`:
  - In stream-to-stdout mode, the final CLI summary goes to stderr so it remains terminal output instead of being mixed into the LLM fragment panel.
- Updated `apps/server/src/planning-runtime.support.test.js`:
  - Added a regression asserting that Battle Planner force grouping emits `llm-chunk` events when `llmStream` is enabled.
- Updated docs:
  - `README.md`
  - `agent.md`

Verification completed for the latest work:

- `node --test apps/server/src/planning-runtime.support.test.js` passed: 22 tests.
- `node algorithms/run-with-venv.mjs -m pytest algorithms/battle-planner/tests -q` passed: 4 tests.
- `npm test --workspace @mission/server -- --runInBand` passed: 34 tests.

Remaining risk:

- Real external OpenAI-compatible and Ollama streaming were not exercised with live credentials/models in this handoff; automated coverage verifies the event path with the deterministic mock LLM.

Previous completed work on 2026-06-21: fixed `作战力量智能编组` failing with `智能编组算法 Python 执行失败，退出码 1` when full task execution used the builtin enemy-threat-analysis output. The root cause was that the Battle Planner enemy reader only accepted `planning-artifact-export-v1.output.targetAssessments`, while the builtin threat step emits threat-node collections such as `fireCoverage`, `airDefenseSystem`, `reconEarlyWarning`, `antiAirborneFacilities`, and `deploymentSectors` instead of a direct target list. The platform adapter now normalizes multiple upstream shapes into Battle Planner-readable `targetAssessments` before writing `upstream-threat.json`. The `force-grouping:builtin` compatibility bridge also now keeps the local Battle Planner call on mock LLM unless the direct bridge options explicitly select another backend, preventing nested default runtime options from requiring an OpenAI API key.

Files and areas changed in the latest work:

- Updated `apps/server/src/index.js`:
  - Added `POST /api/planning/realtime/artifacts/bulk-delete` for deleting realtime algorithm artifacts.
  - Realtime artifact deletion validates ids, enforces ownership through `canAccessRealtimeArtifact`, skips already-missing artifacts with `missingArtifactIds`, deletes existing accessible artifacts in a transaction, and lets stale `{ sourceType: "realtime-artifact", id }` refs fail with `PLANNING_MISSING_DATA`.
  - Reused the existing `PATCH /api/planning/realtime/artifacts/:id` path for realtime artifact renaming.
  - Added `POST /api/tasks/bulk-delete` with validation for valid ids, planning-module tasks, and permissions.
  - Only the task's current `latest_run_id` in `created / running` is treated as active and skipped; older stale `running` rows are deleted with the task instead of blocking deletion.
  - Skipped active task runs are reported in `skippedRunningTaskIds / skippedRunningRunIds`; other selected tasks continue through the hard-delete transaction.
  - Deletes `task_results`, `task_runs`, `planning_realtime_artifacts`, `task_attachments`, related `algorithm_call_logs`, and `tasks` in one transaction.
  - Preserves shared resource data by clearing `task_id` on `sources`, `extractions`, `import_batches`, and `import_batch_items` instead of deleting those records.
- Updated `apps/server/src/planning-runtime.js`:
  - Added Battle Planner threat-output extraction and normalization helpers.
  - `buildBattlePlannerThreatArtifact` now accepts plain structured threat output, full step/result wrappers, existing `planning-artifact-export-v1` artifacts, and realtime result payload shapes.
  - If an upstream threat output lacks `targetAssessments`, the adapter builds Battle Planner target assessments from existing threat nodes and red visualization entities via the existing target-candidate normalization path.
  - `force-grouping:builtin` now writes `runtimeOptions.force-grouping-local.llmBackend = mock` for its compatibility bridge unless a direct bridge option overrides it, so the builtin bridge does not unexpectedly require external LLM credentials.
- Updated `apps/server/src/db.js`:
  - Added `MISSION_DB_FILE` support so tests and temporary verification can run against an isolated SQLite file instead of the real demo database.
- Updated `apps/web/src/api.js` and `apps/web/src/modules/planningWorkflow.js`:
  - Added API wiring and workflow helpers for realtime artifact bulk delete and rename.
  - Added task-instance rename helper using `PUT /api/tasks/:id`.
  - Deletes of realtime artifacts now clean `stepExecution.upstreamResults`, selected input refs, current/selected artifact state, selected result refs, and latest result display before reloading upstream candidates.
  - Added bulk-delete API wiring and workflow state cleanup.
  - Fixed the empty `deletedTaskIds` case so skipped running tasks are not removed from local state.
  - After deletion, task instances reload, selected/deleted task state is cleared or moved to a fallback task, run history is refreshed, upstream result candidates reload, and stale selected upstream refs/current step results are removed.
- Updated `apps/web/src/views/planning/PlanningTaskLibraryStep.vue` and `apps/web/src/styles.css`:
  - Added per-card task-instance rename control.
  - Added checkboxes, select-all/cancel-select-all, delete-selected, and per-card delete controls.
  - Replaced the prior visible `归档` action in the task library with actual deletion.
  - Confirmation text now states that running tasks will be skipped.
  - If the selected deletion set includes the currently opened task instance, the confirmation dialog now warns that the task is already open and asks whether to continue.
  - If a task is skipped because it is truly active, the page shows which task ids were skipped instead of silently leaving them in the list.
- Updated `apps/web/src/views/planning/PlanningStepExecutionStep.vue`:
  - Added realtime artifact selection, select-all/cancel-select-all, delete-selected, per-card delete, and per-card rename controls under `当前算法产物`.
  - Deleting an opened realtime artifact shows a dedicated confirmation message and clears stale display state.
  - `task-run-step` archived results can still be opened, but their rename/delete controls are disabled with explanatory titles.
  - Tracks the source ref for opened task-run-step history so deleting its source task clears the displayed result.
- Updated `apps/server/src/index.contract.test.js`:
  - Covers task-instance renaming.
  - Covers realtime artifact renaming, bulk deletion, upstream-result disappearance, missing-artifact skip reporting, and stale realtime-ref failure after deletion.
  - Covers deletion of task attachments, full task run results, realtime artifacts, upstream result disappearance, stale ref failures, mixed active-running/non-running deletion, all-running skip behavior, and archived tasks with stale historical `running` rows.
  - Starts each contract server with a temporary SQLite database and removes it after the test, preventing test-created tasks from appearing in the real task library.
- Updated `apps/server/src/planning-runtime.support.test.js`:
  - Added a full `evaluatePlanning` regression that runs builtin enemy threat analysis followed by the builtin/intelligent grouping bridge, proving that threat-node-only outputs can feed Battle Planner successfully.
- Updated docs:
  - `README.md`
  - `agent.md`

Verification completed for the latest work:

- `node --test apps/server/src/planning-runtime.support.test.js` passed: 21 tests.
- `npm test --workspace @mission/server -- --runInBand` passed: 33 tests.
- `npm run build --workspace @mission/web` passed; Vite still reports the existing large chunk warning.
- Contract tests now run against isolated temporary SQLite databases, so rename/delete verification does not create `delete-*`, `artifact-*`, `contract-task-*`, or `upstream-task-*` records in the real task library.

Remaining risk:

- Manual browser acceptance for rerunning the user's exact task instance after the intelligent grouping fix has not been run in this handoff. Recommended check: execute the same fire-strike task that previously failed at `作战力量智能编组` and confirm the run advances past step 2 into target allocation or finishes normally.
- Real external OpenAI-compatible or Ollama execution was not exercised; automated tests use local/mock execution paths.

Previous completed work on 2026-06-21: added management controls for planning realtime algorithm artifacts and task-instance renaming. `分步执行 / 当前算法产物` now supports renaming realtime artifacts plus single-select, multi-select, select-all, and bulk delete; deleting an opened artifact asks for confirmation, clears the current artifact display, removes stale selected upstream refs, and refreshes the global upstream-result candidates. Archived `task-run-step` results remain immutable because they are embedded in full task run history; deleting the owning task instance is the supported cleanup path. `作战任务库 / 我的任务实例` now also supports task-instance renaming. The prior bulk task delete fix remains in place: only the task's current latest run in `created / running` is skipped, stale historical `running` rows no longer block deletion, and other selected tasks continue deleting.

Previous completed work on 2026-06-21: added the intelligent task planning `分步执行` module as a top-level sibling of `规划算法库` and `作战任务库`. The new route `/planning/step-execution` provides a two-tab `配置 / 运行与结果` workflow for running one algorithm at a time against selected upstream results, including cross-task results the current user can access.

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
