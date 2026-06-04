# Agent Memory

Updated: 2026-06-04

Purpose: keep a handoff-ready memory for future agents working on the data-service, planning, and calculation modules.

## Repo Agent Protocol

- Repo-level instruction file: `AGENTS.md`
- Required read order for every new agent:
  1. `AGENTS.md`
  2. `agent.md`
  3. `README.md`
- After any code change, the agent must update both `agent.md` and `README.md` before finishing the task.

## Current Status

GitHub publication hygiene prepared on 2026-06-04:

- Files:
  - `.gitignore`
  - `apps/web/.env.example`
  - `algorithms/enemy-threat-analysis/enemy_threat_analysis/config.py`
  - `algorithms/enemy-threat-analysis/enemy_threat_analysis/llm_extractor.py`
  - `README.md`
  - `agent.md`
- Notes:
  - Expanded `.gitignore` to exclude dependencies, build output, runtime databases, imported/generated data, temporary files, local map/terrain assets, Python environments/caches, generated algorithm results/archives, OS/editor files, and local Codex/plugin caches.
  - Replaced the tracked Tianditu token example with a placeholder.
  - Removed a hardcoded enemy-threat LLM API key and changed the related configuration errors to direct users to page parameters or environment variables.
  - Remaining untracked source/test/document additions are under 1 MB; local terrain assets (~19 GB), dependencies, runtime database files, and generated algorithm results are excluded.
- Verification:
  - `npm run build --workspace @mission/web`: passed; Vite still emits the existing large chunk warning.
  - `npm test --workspace @mission/server`: 12 tests passed.
  - `node algorithms/run-with-venv.mjs -m pytest algorithms/enemy-threat-analysis/tests/test_enemy_threat_analysis.py algorithms/force-grouping/tests/test_force_grouping.py -q`: 34 tests passed.
  - `git push --dry-run origin main`: passed, confirming the configured GitHub remote accepts the current Git credentials.
- Remaining risk:
  - The Tianditu token existed in earlier repository history and should be rotated if it remains active. The removed LLM key was found only in the previously untracked algorithm source, but it should also be rotated if still valid.

Planning generated-file export controls completed on 2026-06-04:

- Files:
  - `apps/web/src/modules/planningWorkflow.js`
  - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
  - `apps/web/src/views/planning/PlanningTaskExecutionOverview.vue`
  - `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
  - `agent.md`
- Notes:
  - Added a threat-analysis-only `导出分析文件` control to the single-algorithm result header.
  - Threat analysis prefers the existing Python `assessmentDocxBase64 / assessmentDocxFileName` DOCX report and falls back to a structured JSON analysis file when a built-in or archived result has no DOCX.
  - The result page now recognizes threat-analysis generated DOCX, heatmap PNG, target-map PNG, combined-map PNG, and threat-field GeoJSON files.
  - Every declared stage artifact now renders as a file card with its own `导出文件` control. Existing archives whose artifact entries only contain name/description/status are exported as focused JSON artifact files without changing the server archive contract.
  - Every single-algorithm result page also provides an independent full structured-output JSON export.
  - The execution overview and legacy execution panel now expose a separate JSON file export for the result snapshot while retaining the existing browser-local snapshot save action.
  - Shared planning downloads now accept raw base64 and `data:*;base64,...` payloads, so generated binary files and future external algorithm artifacts use the same download path.
- Verification:
  - `npm run build --workspace @mission/web`: passed; Vite still emits the existing large chunk warning.
  - `npm test --workspace @mission/server`: 12 tests passed.
  - In-app browser validation against archived task instance `#23`, run `#50`:
    - enemy-threat result displayed one `导出分析文件`, eight per-file `导出文件` controls, and one full JSON export;
    - generated files were identified as one DOCX, three PNG files, one GeoJSON file, and three JSON stage artifacts;
    - force-grouping result displayed three per-artifact export controls plus the full JSON export and no threat-only analysis button;
    - execution overview displayed separate result-snapshot save and JSON export controls, including the output-package card export action;
    - desktop and 760px narrow layouts had no page-level horizontal overflow; browser console had no warnings or errors.
  - Direct archive payload validation confirmed the DOCX begins with a valid ZIP/DOCX signature, all three images begin with valid PNG signatures, and the GeoJSON contains 6400 features.
- Remaining risk:
  - The Codex in-app browser does not support receiving downloaded files, so click-through could confirm control presence but not capture the browser download itself; binary payload validity and shared download construction were verified from the archived result data and successful production build.

Planning force-grouping multi-scheme result browser completed on 2026-06-04:

- Files:
  - `apps/web/src/components/PlanningForceGroupingPanel.vue`
  - `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`
  - `apps/web/src/views/planning/PlanningTaskExecutionOverview.vue`
  - `apps/web/src/styles.css`
  - `apps/server/src/planning-runtime.js`
  - `README.md`
  - `agent.md`
- Notes:
  - Added a dedicated force-grouping result browser to the single-algorithm result page.
  - The browser renders every available `schemes[]` candidate, moves the `preferredSchemeId` candidate to the first full-width row, and selects it by default. Missing preferred IDs fall back to `systemBestSchemeId`, then highest score.
  - Clicking a scheme switches the visible score, constraint result, capability metrics, functional groups, and unit membership without reloading the page.
  - Each functional group now states `第 i 个编组由 ... 单位构成` and provides a unit table with readable category/role/readiness labels, strength, capability summary, and location when present.
  - Generic force-grouping tables no longer repeat or collapse `schemes` / `preferredScheme.groups` into `X 项`; comparison, rule evidence, and evidence trace remain visible.
  - Historical Python outputs that only provide `methodLabel` now show that label in result headers, preview summaries, and execution overview cards instead of `--` or `待确认方案`. Python candidate counts also fall back to `forceUnitCount / blueIntelligenceCount`.
  - New local Python executions use the same `methodLabel` fallback in server-generated summary and preview text.
- Verification:
  - `npm run build --workspace @mission/web`: completed successfully twice; Vite still emits the existing large chunk warning.
  - `node --check apps/server/src/planning-runtime.js`: passed.
  - `node algorithms/run-with-venv.mjs -m pytest algorithms/force-grouping/tests/test_force_grouping.py -q`: 13 tests passed.
  - `npm test --workspace @mission/server`: 12 tests passed.
  - In-app browser validation against archived task instance `#23`, run `#50`:
    - displayed 3 scheme cards with the preferred scheme first and selected;
    - clicking the other two schemes changed the selected heading and first group composition;
    - preferred view displayed 4 group-composition statements and 12 unit rows;
    - narrow viewport rendered scheme and metric cards in one column with no page-level horizontal overflow;
    - browser console reported no warnings or errors.
  - Restarted `launchctl` label `com.mission.server.dev`; new backend PID `37206` is listening on `http://localhost:3100`, and `/api/health` returned the expected ready response.
- Remaining risk:
  - Archived `outputPreview` strings remain unchanged in stored server payloads, but the current frontend rebuilds the force-grouping preview from structured output during replay, so user-visible historical pages are corrected without migrating archives.

Planning enemy threat heatmap zoom/continuity fix completed on 2026-06-04:

- Files:
  - `apps/web/src/components/CesiumGlobe.vue`
  - `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`
  - `apps/web/vite.config.js`
  - `algorithms/enemy-threat-analysis/enemy_threat_analysis/image_exporter.py`
  - `algorithms/enemy-threat-analysis/enemy_threat_analysis/visualization_builder.py`
  - `algorithms/enemy-threat-analysis/tests/test_enemy_threat_analysis.py`
  - `README.md`
  - `agent.md`
- Notes:
  - Fixed the follow-up issue where the heatmap could disappear when zoomed in and show an empty/hollow center when zoomed out.
  - Root cause:
    - The previous Cesium overlay used a fixed-height rectangle entity (`height=28`) which could be hidden by terrain/depth behavior at close zoom levels.
    - The previous anti-rectangle attempt used a hard percentile display floor, which removed low-but-valid threat cells and could create a transparent hole inside the heat field.
  - `CesiumGlobe.vue` now renders image overlays as `SingleTileImageryProvider` imagery layers instead of rectangle entities, so the heatmap is draped with the base imagery and is not occluded by DEM terrain when zooming.
  - Python heatmap rendering now creates a low-resolution RGBA threat raster, bicubic-resamples it to 960px, applies Gaussian smoothing with transparent padding, and uses a soft alpha falloff instead of a hard cutoff. Low threat fades down, but valid middle-field values remain visible.
  - New Python overlays now carry `displayVersion=soft-continuous-v2`; older archived overlays with no current display version are regenerated from `heatmap.grid` on the frontend instead of reusing stale hard-cut PNGs.
  - The frontend legacy/archived-result heatmap canvas fallback mirrors the same soft display curve, high-quality smoothing, and robust grid-id row/column parsing.
  - `apps/web/vite.config.js` now binds Vite to `0.0.0.0` so both `http://localhost:5173/` and `http://127.0.0.1:5173/` work during development.
  - Regression tests now cover the overlay display version, visible hotspot alpha, transparent/very-low-alpha outer corners, nonempty center alpha, zero-threat transparency, and softened cell boundaries.
- Verification:
  - Generated `tmp/enemy-heatmap-soft-continuous.png` from `examples/mock_extraction.json`; alpha stats were max `215`, center `184`, corner `3`, confirming no center hole and a very faint edge.
  - Static Cesium smoke confirmed `SingleTileImageryProvider` construction works with the installed Cesium package.
  - `node algorithms/run-with-venv.mjs -m pytest algorithms/enemy-threat-analysis/tests/test_enemy_threat_analysis.py -q`: 21 tests passed.
  - `npm run build --workspace @mission/web`: completed successfully; Vite still emits the existing large chunk warning.
  - `npm test --workspace @mission/server`: 12 tests passed.
  - Restarted the frontend dev server with the new Vite host binding; `curl -I http://127.0.0.1:5173/` and `curl -I http://localhost:5173/` both returned `200 OK`.
  - In-app browser opened `http://127.0.0.1:5173/` successfully and showed the login page (`任务规划系统`).
- Remaining risk:
  - Full in-app browser visual click-through to an archived enemy-threat result page was not completed because that requires selecting an existing run after login; validation covers PNG generation, Cesium overlay construction, frontend build, local app load, and HTTP availability.

Planning enemy threat heatmap visibility fix completed on 2026-06-04:

- Files:
  - `apps/web/src/components/CesiumGlobe.vue`
  - `apps/web/src/components/PlanningThreatMapPanel.vue`
  - `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`
  - `algorithms/enemy-threat-analysis/enemy_threat_analysis/image_exporter.py`
  - `algorithms/enemy-threat-analysis/enemy_threat_analysis/visualization_builder.py`
  - `algorithms/enemy-threat-analysis/tests/test_enemy_threat_analysis.py`
  - `README.md`
  - `agent.md`
- Notes:
  - Fixed the follow-up bug where the heatmap could still appear invisible even though `heatmapBase64` existed.
  - Root cause was twofold:
    - Python PNG coloring used absolute `0-100` score scaling; in realistic sample fields with max threat around `35`, the hottest cells only reached low alpha/color contrast.
    - Frontend rendered the image as an imagery layer, which was less reliable for result-panel ordering and basemap refresh interactions.
  - `image_exporter.py` now normalizes heatmap colors against the current heatmap `statistics.maxThreat`, applies a gamma lift, preserves transparent near-zero cells, and guarantees visible hotspot alpha.
  - `visualization_builder.py` now emits heatmap overlay alpha `0.82` plus `normalizedForDisplay=true` for new Python-generated heatmap images.
  - Archived/previous outputs whose overlays do not carry `normalizedForDisplay=true` are enhanced once in the frontend from `heatmap.grid`, so existing result pages do not require rerunning the algorithm just to see the heatmap.
  - `CesiumGlobe.vue` now renders image overlays through a dedicated `imageOverlaySource` using rectangle `ImageMaterialProperty`, inserted above environment/base imagery and below unit/situation entities.
  - Result-page and threat-panel overlay fallbacks now use alpha `0.82`.
- Verification:
  - Generated a sample enemy heatmap PNG from `examples/mock_extraction.json` and inspected it visually; the heatmap is now clearly visible.
  - Sample pixel stats improved from max alpha `86` / mean alpha `48.11` to max alpha `230` / mean alpha `161.21`.
  - `node algorithms/run-with-venv.mjs -m pytest algorithms/enemy-threat-analysis/tests/test_enemy_threat_analysis.py -q`: 20 tests passed.
  - `npm test --workspace @mission/server`: 12 tests passed.
  - `npm run build --workspace @mission/web`: completed successfully; Vite still emits the existing large chunk warning.
  - Static Cesium construction smoke confirmed rectangle `ImageMaterialProperty` is accepted by the installed Cesium package.
- Remaining risk:
  - In-app browser and Chrome visual validation could not be completed because the browser routes/extensions were unavailable or could not connect to the local dev URL in this session; validation is based on generated image inspection, pixel assertions, Cesium construction smoke, tests, and frontend production build.

macOS launcher completed on 2026-06-04:

- Files:
  - `start-macos.command`
  - `README.md`
  - `agent.md`
- Notes:
  - Added a Finder/Terminal-friendly macOS launcher script at the repo root.
  - Default mode is `dev`, which runs the full frontend + backend development stack.
  - Supported modes: `dev`, `web`, `server`, `backend`, `production`, `stop`, and `--check`.
  - The script prepends common Homebrew paths, auto-cd's to the project root, checks Node.js/npm, installs dependencies when `node_modules` is missing, and preserves the existing `PORT` / `MISSION_FORCE_WEB_BUILD` behavior.
  - `stop` closes only processes listening on project ports, defaulting to `5173` and `$PORT` (`3100` by default); custom ports are supported via `./start-macos.command stop 5173 3100`.
- Verification:
  - `chmod +x start-macos.command`
  - `bash -n start-macos.command`
  - `./start-macos.command --check`: passed and reported Node/npm versions.
  - `./start-macos.command stop 65534`: completed safely with no listener.
- Remaining risk:
  - Full long-running startup was not executed to avoid leaving dev/prod servers running in this turn; validation covers syntax, prerequisites, executable permissions, and the stop path on an idle port.

Planning enemy threat static heatmap overlay completed on 2026-06-03:

- Files:
  - `apps/web/src/components/CesiumGlobe.vue`
  - `apps/web/src/components/PlanningThreatMapPanel.vue`
  - `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`
  - `algorithms/enemy-threat-analysis/enemy_threat_analysis/image_exporter.py`
  - `algorithms/enemy-threat-analysis/enemy_threat_analysis/visualization_builder.py`
  - `algorithms/enemy-threat-analysis/tests/test_enemy_threat_analysis.py`
  - `README.md`
  - `agent.md`
- Notes:
  - Enemy-threat heatmaps now use the Python algorithm output as a static transparent PNG plus geospatial bounds instead of frontend real-time grid rendering.
  - Python `visualization_builder.py` emits `visualization.imageOverlays` with `imageBase64Field=heatmapBase64`, normalized `west/south/east/north` bounds, alpha, zIndex, and `single-tile-image` rendering metadata.
  - `image_exporter.py` keeps zero-threat heatmap cells transparent and uses partial alpha for nonzero threat values so the bottom imagery remains readable.
  - `PlanningTaskExecutionResultStep.vue` resolves explicit `visualization.imageOverlays` for new outputs and falls back to `heatmapBase64 + heatmap.bounds` for archived outputs.
  - `PlanningThreatMapPanel.vue` binds the “威胁场” switch to Cesium image overlays: on adds the heatmap texture, off removes it; filtering no longer depends on the coverage-circle switch.
  - `CesiumGlobe.vue` normalizes overlay bounds from both frontend and Python field names, sorts overlays by zIndex, applies alpha/opacity, and renders them as `SingleTileImageryProvider` imagery layers above the basemap and below entity data sources.
- Verification:
  - `node algorithms/run-with-venv.mjs -m pytest algorithms/enemy-threat-analysis/tests/test_enemy_threat_analysis.py -q`: 19 tests passed.
  - `npm test --workspace @mission/server`: 12 tests passed.
  - `npm run build --workspace @mission/web`: completed successfully; Vite still emits the existing large chunk warning.
- Remaining risk:
  - In-app browser visual validation could not be completed because the Browser plugin reported no available browser route for this session; validation is based on Python image/overlay regressions, server tests, and successful frontend production build.

Planning enemy threat visualization type rules completed on 2026-06-03:

- Files:
  - `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`
  - `algorithms/enemy-threat-analysis/enemy_threat_analysis/llm_extractor.py`
  - `algorithms/enemy-threat-analysis/enemy_threat_analysis/visualization_builder.py`
  - `algorithms/enemy-threat-analysis/tests/test_enemy_threat_analysis.py`
  - `README.md`
  - `agent.md`
- Notes:
  - Fixed the follow-up issue where every parsed target received a coverage circle after the result-page bridge fix.
  - Frontend derived enemy threat entities now use category-specific visualization rules:
    - `fire_unit / fireCoverage`, `air_defense / airDefenseSystem`, `recon_sensor / electronic_warfare / reconEarlyWarning` may render coverage circles.
    - `command_control`, `mobility_unit`, `logistics_support`, `fortification / antiAirborneFacilities`, and `unknown` default to point/symbol visualization only.
    - Explicit `visualizationType`, `coverageTypes`, and `hasCoverage` can override the default rules when an algorithm result has stronger evidence.
  - Enemy result pages now prefer the frontend-derived threat entities for enemy-threat results, preventing old Python `visualization.entities` from reintroducing all-target coverage circles.
  - LLM prompt instructions now explicitly tell the model not to invent coverage ranges for point-only categories.
  - `_coerce_coverage()` now normalizes every parsed LLM payload before validation and no longer defaults non-coverage categories to an 8 km coverage radius.
  - Python `visualization_builder.py` only emits coverage circle entities for coverage-capable categories with `hasCoverage=true`.
- Verification:
  - `node algorithms/run-with-venv.mjs -m pytest algorithms/enemy-threat-analysis/tests/test_enemy_threat_analysis.py -q`: 17 tests passed.
  - `npm run build --workspace @mission/web`: completed successfully; Vite still emits the existing large chunk warning.
  - `npm test --workspace @mission/server`: 12 tests passed.
- Remaining risk:
  - Browser visual click-through was not repeated for this follow-up; validation is based on parser regressions, frontend production build, and server tests.

Planning enemy threat map target bridge fix completed on 2026-06-03:

- Files:
  - `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`
  - `apps/web/src/components/PlanningThreatMapPanel.vue`
  - `README.md`
  - `agent.md`
- Notes:
  - Fixed the result-page mismatch where the enemy algorithm parsed 12 structured targets but the 3D threat panel showed `目标 0 / 类别 0` and no map markers.
  - Root cause:
    - The 3D side panel only counted `threatField.targets` / `situationMap.targets`, while the Python algorithm stores located targets primarily in `targetAssessments` and the structured sections (`fireCoverage`, `airDefenseSystem`, `reconEarlyWarning`, `antiAirborneFacilities`).
    - Existing Python `visualization.entities` can carry layer keys such as `fireCoverage`, `airDefense`, or `sensors`, but `CesiumGlobe` visibility only recognizes keys like `units`, `detection`, `symbols`, and `orders`, so those entities could be passed in but hidden.
  - `PlanningTaskExecutionResultStep.vue` now derives locatable threat targets from `targetEntities`, `targetAssessments`, and the structured threat sections; it generates target point entities and coverage circle entities with Cesium-visible layer keys.
  - `PlanningThreatMapPanel.vue` now normalizes legacy/algorithm-specific entity layer keys to visible Cesium layers before filtering.
  - Heatmap bounds are normalized from Python-style `minLon/minLat/maxLon/maxLat` to frontend overlay-style `west/south/east/north`.
- Verification:
  - `npm run build --workspace @mission/web`: completed successfully; Vite still emits the existing large chunk warning.
  - `npm test --workspace @mission/server`: 12 tests passed.
  - Browser login/navigation automation was attempted; the app loaded the login page without console errors, but the automated login click timed out in the in-app browser session, so final visual confirmation is based on build/static path verification rather than a screenshot.
- Remaining risk:
  - The user should refresh/reopen the planning result page so Vite/HMR or the rebuilt client loads the new bridge logic for archived results.

Planning enemy LLM equipment quantity repair completed on 2026-06-03:

- Files:
  - `algorithms/enemy-threat-analysis/enemy_threat_analysis/llm_extractor.py`
  - `algorithms/enemy-threat-analysis/tests/test_enemy_threat_analysis.py`
  - `README.md`
  - `agent.md`
- Notes:
  - Fixed the current execution failure where the enemy-threat LLM returned `equipment[].quantity` as text values such as `estimated`, `multiple`, or `various`; Pydantic expected integers and rejected the extraction.
  - `_coerce_equipment()` now normalizes quantities to integers, maps common vague English/Chinese quantity terms to conservative counts, extracts embedded numbers such as `约 3 套`, and normalizes scalar `capabilityTags` to lists.
  - README now documents this LLM schema tolerance alongside the existing `spatialContext` normalization.
- Verification:
  - `node --check apps/server/src/planning-runtime.js`
  - `node --check algorithms/run-with-venv.mjs`
  - `node algorithms/run-with-venv.mjs -m pytest algorithms/enemy-threat-analysis/tests/test_enemy_threat_analysis.py -q`: 15 tests passed.
  - `npm test --workspace @mission/server`: 12 tests passed.
  - Restarted `launchctl` label `com.mission.server.dev`; new backend PID `78855` is listening on `http://localhost:3100`.
  - `curl http://localhost:3100/api/not-found` returned the expected JSON auth response (`401`, `未登录或登录状态已失效`).
- Remaining risk:
  - Browser click-through was not repeated after restart; validation is based on the pasted execution trace, parser regression tests, server tests, and HTTP availability.

Planning local Python venv bootstrap completed on 2026-06-03:

- Files:
  - `apps/server/src/planning-runtime.js`
  - `algorithms/run-with-venv.mjs`
  - `algorithms/requirements.txt`
  - `.gitignore`
  - `algorithms/README.md`
  - `README.md`
  - `agent.md`
- Notes:
  - The planning local Python runner now defaults to the Node-based `algorithms/run-with-venv.mjs` wrapper instead of directly spawning `python3`.
  - The wrapper creates/reuses `algorithms/.venv`, installs/syncs root and sub-algorithm requirements, sets `VIRTUAL_ENV`, `PATH`, `PYTHONPATH`, and `PYTHONIOENCODING`, then runs the requested Python module or script through the venv interpreter.
  - `PLANNING_PYTHON_BIN` still overrides the default wrapper; `PLANNING_PYTHON_BOOTSTRAP_BIN` can select the base Python used for first-time venv creation.
  - Added root `algorithms/requirements.txt` for shared airlanding dependencies (`numpy`, `pyproj`) and ignored generated venv/cache directories.
- Verification:
  - `node --check apps/server/src/planning-runtime.js`
  - `node --check algorithms/run-with-venv.mjs`
  - `node algorithms/run-with-venv.mjs -c "import sys, numpy, pyproj, pydantic, docx, pypdf, openpyxl, PIL; print(sys.executable); print('venv-ok')"` created `algorithms/.venv`, installed dependencies, and printed the venv interpreter path plus `venv-ok`.
  - `node algorithms/run-with-venv.mjs -m py_compile algorithms/enemy-threat-analysis/enemy_threat_analysis/cli.py algorithms/force-grouping/force_grouping/cli.py algorithms/airlanding_zone/main.py algorithms/airlanding_zone/candidate_generator.py`
  - `npm test --workspace @mission/server`: 12 tests passed.
- Remaining risk:
  - First execution may take time while pip downloads dependencies; optional `rasterio` remains intentionally unpinned because airlanding treats it as an optional enhanced DEM path.

Planning Python venv enforcement fix completed on 2026-06-03:

- Files:
  - `apps/server/src/planning-runtime.js`
  - `algorithms/enemy-threat-analysis/enemy_threat_analysis/llm_extractor.py`
  - `algorithms/enemy-threat-analysis/tests/test_enemy_threat_analysis.py`
  - `README.md`
  - `algorithms/README.md`
  - `agent.md`
- Notes:
  - Fixed a runtime footgun where an inherited `PLANNING_PYTHON_BIN=python3` could bypass `algorithms/run-with-venv.mjs` and run the local enemy algorithm without `python-docx`, causing `ModuleNotFoundError: No module named 'docx'`.
  - Local Python planning execution now uses the algorithms venv by default even when `PLANNING_PYTHON_BIN` is present; that variable is passed through as the venv bootstrap Python instead.
  - Direct bare-Python execution is now opt-in via `PLANNING_PYTHON_USE_VENV=0`.
  - While verifying the enemy CLI, fixed a follow-on LLM schema tolerance issue where `spatialContext.terrain` or `spatialContext.weather` returned as scalar strings failed validation; these are now coerced to list items before Pydantic validation.
- Verification:
  - `node --check apps/server/src/planning-runtime.js`
  - `node --check algorithms/run-with-venv.mjs`
  - `node algorithms/run-with-venv.mjs -m pytest algorithms/enemy-threat-analysis/tests/test_enemy_threat_analysis.py -q`: 14 tests passed.
  - `node algorithms/run-with-venv.mjs -m enemy_threat_analysis.cli --files algorithms/enemy-threat-analysis/examples/sample_enemy_report.txt --output "$tmpdir/enemy.json" --artifact-dir "$tmpdir/artifacts" --skip-assessment`: succeeded with `ok=true`, `implementationStatus=implemented`, `threatScore=34.89`, confirming `docx` imports through the venv.
  - `npm test --workspace @mission/server`: 12 tests passed.
  - Restarted `launchctl` label `com.mission.server.dev`; new backend PID `76737` is listening on `http://localhost:3100`.
  - `curl http://localhost:3100/api/not-found` returned the expected JSON auth response (`401`, `未登录或登录状态已失效`), confirming the backend is responding after restart.
- Remaining risk:
  - Browser click-through was not repeated after the backend restart; validation is based on direct CLI reproduction, unit tests, server tests, and HTTP availability.

Intelligent task planning local Python algorithm integration completed on 2026-06-03:

- Files:
  - `apps/server/src/algorithm-gateway.js`
  - `apps/server/src/planning-runtime.js`
  - `apps/server/src/index.js`
  - `apps/server/src/planning-runtime.support.test.js`
  - `apps/web/src/api.js`
  - `apps/web/src/modules/planningWorkflow.js`
  - `apps/web/src/views/planning/PlanningTaskExecutionOverview.vue`
  - `apps/web/src/styles.css`
  - `algorithms/airlanding_zone/threat_field.py`
  - `README.md`
  - `agent.md`
- Notes:
  - Registered three active `external-model` local Python variants without changing built-in defaults:
    - `enemy-threat-analysis:enemy-threat-analysis-local` / `基于大模型分析算法`
    - `force-grouping:force-grouping-local` / `智能编组算法`
    - `airborne-landing-site-selection:airlanding-zone-local` / `机降地域优化选择 Python 算法`
  - Added a planning local Python runner that creates per-run temp workdirs, materializes explicitly selected resource-library data, uploaded files, and upstream outputs, runs `python3` (override via `PLANNING_PYTHON_BIN`), reads algorithm JSON outputs, redacts API keys in persisted result config, and cleans temp dirs after execution.
  - Added `POST /api/planning/evaluate/stream` as a `text/event-stream` endpoint while keeping `POST /api/planning/evaluate`; stream events include `run-start`, `validation`, `step-start`, `progress`, `terminal`, `llm-chunk`, `step-complete`, `final`, `error`, and `done`.
  - Frontend planning execution now uses the stream endpoint and displays an embedded monitor with progress, current step, per-step statuses, terminal logs, and LLM fragments. Historical result replay and single-algorithm result pages continue to use archived server results.
  - `airlanding_zone/threat_field.py` now falls back to an internal distance-decay threat evaluator when the optional `theat_analyze/threat_analyzer.py` dependency is absent, allowing `algorithms/airlanding_zone/main.py` to run standalone with planning targets.
  - Current local dev state: Vite is listening on `http://localhost:5173`; backend was relaunched through `launchctl` label `com.mission.server.dev` and is listening on `http://localhost:3100`.
- Verification:
  - `node --check apps/server/src/planning-runtime.js`
  - `node --check apps/server/src/index.js`
  - `node --check apps/server/src/algorithm-gateway.js`
  - `node --check apps/web/src/modules/planningWorkflow.js`
  - `python3 -m py_compile algorithms/airlanding_zone/threat_field.py`
  - `npm test --workspace @mission/server`: 12 tests passed, including new local Python variant registration and validation coverage
  - `npm run build --workspace @mission/web`: completed successfully; Vite still emits the existing large chunk warning
  - Python smoke:
    - enemy `analyze(..., extraction_json=..., generate_assessment=False)` returned `implementationStatus=implemented`, `threatScore=31.04`, `fireCoverage=1`
    - force CLI with `--mock-extraction` returned `implementationStatus=implemented` and a `preferredScheme`
    - airlanding CLI against `apps/web/public/terrain` returned `zones=1`, `candidates=10`, `landingGroups=1`
  - Authenticated curl confirmed planning template exposes the three local active variants and `/api/planning/evaluate/stream` emits SSE events with structured validation/error/done payloads.
- Remaining risk:
  - Browser automation tools were not available in this thread, so final visual validation of the execution monitor was not captured by screenshot; validation is based on Vite build, API checks, and local server availability.
  - Enemy and force live LLM calls were not exercised to avoid invoking a real external model/key during smoke tests; stream plumbing was verified by endpoint behavior and stdout handling code paths.
  - Backend service is currently running via `launchctl submit`; if it needs to be stopped manually, remove label `com.mission.server.dev`.

Data-service Cesium basemap fallback fix completed on 2026-06-03:

- Files:
  - `apps/web/src/components/CesiumGlobe.vue`
  - `README.md`
  - `agent.md`
- Notes:
  - Diagnosed the black map on macOS/in-app browser as a failed external TianDiTu imagery path: direct tile requests to `https://t0.tianditu.gov.cn/DataServer?...` returned HTTP `418`, so Cesium was adding unavailable imagery layers over the local scene.
  - `refreshBasemap()` now probes a representative TianDiTu image tile before using TianDiTu imagery; if the token/service/network path is unavailable, `auto` and explicit TianDiTu selections fall back to available offline tiles or the built-in grid demo basemap instead of leaving a black globe.
  - The TianDiTu probe is cached briefly to avoid repeated slow tile checks while still allowing a later retry.
  - DEM mode now keeps Cesium globe lighting disabled so the data-service/situation workbench remains readable regardless of time-of-day lighting when using offline terrain.
- Verification:
  - `curl -I` against TianDiTu image/label tile URLs returned HTTP `418`, reproducing the external imagery failure.
  - `curl -I http://localhost:5173/terrain/layer.json` returned HTTP `200`, confirming local terrain metadata is present.
  - `npm run build --workspace @mission/web` completed successfully; Vite still emits the existing large chunk warning.
- Remaining risk:
  - The in-app Browser automation endpoint was unavailable during the final visual retry, so final validation is based on source inspection, HTTP reproduction, successful Vite build, and dev-server HMR rather than a fresh screenshot.
  - If a real TianDiTu token/network path becomes reachable again, users may need to click the TianDiTu control again or refresh after the short probe cache expires.

Intelligent task planning algorithm design documentation completed on 2026-05-30:

- Files:
  - `docs/intelligent-task-planning/00-module-overview.md`
  - `docs/intelligent-task-planning/01-enemy-threat-analysis-design-test.md`
  - `docs/intelligent-task-planning/02-force-grouping-design-test.md`
  - `docs/intelligent-task-planning/03-target-allocation-design-test.md`
  - `docs/intelligent-task-planning/04-airborne-landing-site-selection-design-test.md`
  - `docs/intelligent-task-planning/05-method-planning-design-test.md`
  - `docs/intelligent-task-planning/06-support-planning-design-test.md`
  - `README.md`
  - `agent.md`
- Notes:
  - Documented the current intelligent task planning module location, registration path, execution chain, front/back-end API flow, task-instance persistence path, unified input/output envelopes, status/error handling, result package format, and upstream/downstream model.
  - Documented all 6 current planning algorithms from `apps/server/src/planning-runtime.js`: `enemy-threat-analysis`, `force-grouping`, `target-allocation`, `airborne-landing-site-selection`, `method-planning`, and `support-planning`.
  - Each algorithm document includes positioning, input options, frontend/backend sources, complete current `structuredOutput` field groups, generation logic, real-algorithm replacement guidance, pseudocode, test cases, and acceptance criteria.
  - The docs call out current compatibility risks found during analysis: `.txt` appears in planning supported file extensions but `normalizePlanningUpload()` currently does not parse `.txt`; some result-page table specs still reference legacy aliases such as `candidates`, `comparedPlans`, and `validationFindings` while current outputs use `rankedCandidates`, `methodComparison`, and `validation`.
  - README now links the new planning algorithm design/test documentation set.
- Verification:
  - Read required repo context in order: `AGENTS.md`, `agent.md`, `README.md`.
  - Inspected planning runtime, frontend workflow/pages, API adapter, HTTP routes, task attachment handling, and existing server tests.
  - Ran a black-box `evaluatePlanning()` sample for `air-assault-task` with CSV uploads after installing minimal Node globals for `pdfjs-dist` import compatibility; observed 6 execution steps, 4 output packages, and consolidated outputs for all 6 algorithm result groups.
- Remaining risk:
  - No production build or full test suite was run because this was a documentation-only pass.
  - The sample `evaluatePlanning()` command emitted a non-fatal `@napi-rs/canvas` native binding warning from the PDF preview dependency path; the planning response still completed.

Tactical-Visualizer 2.0 enemy-threat external integration removal completed on 2026-05-17:

- Files:
  - `apps/server/src/planning-runtime.js`
  - `apps/web/src/modules/planningWorkflow.js`
  - `apps/web/src/views/planning/PlanningTaskExecutionOverview.vue`
  - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
  - `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`
  - `apps/web/src/components/PlanningThreatMapPanel.vue`
  - `package.json`
  - `.gitignore`
  - `start-backend.bat`
  - `README.md`
  - `agent.md`
- Deleted:
  - `apps/planning-python/`
  - `scripts/start-server-with-planning-python.ps1`
  - `start-planning-python.bat`
  - `start-planning-python-server.bat`
  - `start-planning-python-stack.bat`
  - `外部算法集成.md`
- Notes:
  - planning external project registration is now empty (`PLANNING_EXTERNAL_ALGORITHM_PROJECTS = []`)
  - `enemy-threat-analysis` now defaults to `enemy-threat-analysis:builtin`; removed external variants fall back to the first available built-in variant instead of blocking old task views
  - `tactical-visualizer2.0`-specific runtime parameters, frontend LLM configuration, default binding behavior, planning Python adapter scripts, and planning Python npm scripts were removed
  - `threatAssessmentDocx` / `敌情二次研判报告` output package handling was removed from the planning output UI and runtime package count
  - generic 3D threat-field visualization was intentionally kept per user clarification: `PlanningTaskExecutionResultStep.vue` still builds a generic `threatField` from `heatmapBase64`, `heatmapGeojson`, `bounds`, `targetEntities`, `pointThreatEvaluation`, and `situationMap`
  - `PlanningThreatMapPanel.vue` no longer uses Tactical-Visualizer-specific ids; generic target ids now use `threat-target-*`, and the heatmap overlay id is `threat-spatial-field`
  - spatial export still includes generic `consolidatedOutputs.threatAnalysis.heatmapGeojson` features when present
  - README now describes the current state as built-in planning algorithms only, with the external gateway retained as a future extension point
- Verification:
  - `node --check apps/server/src/planning-runtime.js`
  - `node --check apps/web/src/modules/planningWorkflow.js`
  - `cmd /c npm run build --workspace @mission/server`
  - `rg` over active source/config files found no remaining `tactical-visualizer2.0`, `planning-python`, `PLANNING_PYTHON`, `start-planning-python`, or `threatAssessmentDocx` references outside `README.md`/`agent.md` historical documentation and `package-lock.json` hash text
- Remaining risk:
  - historical entries below still describe the removed Tactical-Visualizer integration for chronology; treat this top entry as the current source of truth
  - `cmd /c npm test --workspace @mission/server` could not complete because `node_modules` is absent and `mammoth` cannot be resolved
  - `cmd /c npm run build --workspace @mission/web` could not complete because `node_modules` is absent and `vite` cannot be resolved
  - browser screenshot/click-through has not yet been run for this removal pass

Workspace slimming cleanup completed on 2026-05-17:

- Files:
  - `.gitignore`
  - `README.md`
  - `agent.md`
- Deleted local/generated artifacts:
  - root `node_modules` dependency install directory
  - `apps/web/dist` production build output, including the copied `dist/tiles` payload
  - `algorithms/tactical-visualizer2.0/frontend/node_modules`
  - `algorithms/tactical-visualizer2.0/frontend/dist`
  - `algorithms/tactical-visualizer2.0/backend/node_modules`
  - `algorithms/tactical-visualizer2.0/backend/uploads`
  - `algorithms/tactical-visualizer2.0/backend/tactical.db`
  - `algorithms/tactical-visualizer2.0/ai_engine/venv`
  - `algorithms/tactical-visualizer2.0/ai_engine/generated_reports`
  - `algorithms/tactical-visualizer2.0/ai_engine/stage_inputs`
  - local log files and most Python `__pycache__` directories
  - `apps/web/public/terrain/terrain1.zip`, which was an already-expanded source archive not used by the Cesium terrain loader
  - `apps/web/public/terrain/.tmp`, a temporary expanded terrain staging directory
- Notes:
  - `.gitignore` now covers Python caches, external Tactical-Visualizer local dependencies/builds/uploads/reports/demo DB, and terrain staging archives under `apps/web/public/terrain`
  - retained `apps/server/data/mission-demo.sqlite*` because it is the current local demo/runtime database
  - retained the converted Cesium terrain runtime asset under `apps/web/public/terrain` (`layer.json`, `meta.json`, level directories `0` through `14`, and `README.txt`), because the frontend reads those files for offline DEM
  - final measured large retained payload is `apps/web/public/terrain` at about `8719.85 MB`; this is no longer duplicate archive/temp data
- Verification:
  - final cleanup snapshot confirmed removed paths for `node_modules`, `apps/web/dist`, external Tactical-Visualizer `node_modules`, `dist`, `venv`, uploads, generated reports, stage inputs, and demo DB
  - `rg` found no references to `terrain1.zip` / `terrain1` outside the terrain asset directory before deleting the archive
  - final retained directory snapshot:
    - `apps/web/public/terrain`: `8719.85 MB`, `3557957` files
    - `apps/server/data`: `60.75 MB`, `3` files
    - `algorithms/tactical-visualizer2.0/ai_engine/__pycache__`: `0.04 MB`, `4` files
- Remaining risk:
  - build/tests were not run after cleanup because root `node_modules` and build outputs were intentionally removed; run `npm install` before normal development/build/test commands
  - 4 Python cache files remain under `algorithms/tactical-visualizer2.0/ai_engine/__pycache__` because a running Python process denied deletion; they are negligible and now ignored
  - this workspace has no `.git` directory available, so `git status` could not be used as a final diff safety check

Planning resource-source explicit selection fix completed on 2026-05-17:

- Files:
  - `apps/server/src/planning-runtime.js`
  - `apps/server/src/planning-runtime.support.test.js`
  - `apps/web/src/views/planning/PlanningAlgorithmsStep.vue`
  - `README.md`
  - `agent.md`
- Notes:
  - Resource-library checkboxes in planning algorithm configuration now have literal selection semantics: an empty `selectedSourceIds` list means no resource-library data, not "use every existing source"
  - `buildSourceBundle()` now returns selected sources/previews/extractions/environment only for explicitly selected source ids; `buildSelectedIntelligence()` consequently returns no red/blue intelligence when no resource ids are selected
  - `enemy-threat-analysis` validation now requires at least one selected resource source or at least one uploaded local file; existing database data alone no longer lets threat analysis run
  - the planning algorithm detail copy now says that unselected data sources are not used and local upload is an alternative
  - README now documents that external planning payloads contain only explicitly selected resource subsets
- Verification:
  - `node --check apps/server/src/planning-runtime.js`
  - `cmd /c npm test --workspace @mission/server`
    - observed result: 10 tests passed, including the new explicit resource selection regression
  - `cmd /c npm run build --workspace @mission/web`
    - completed successfully; Vite still emits the existing large chunk warning
- Remaining risk:
  - this behavior also narrows `force-grouping` resource-library input because it shares `buildSourceBundle()`; this matches the same checkbox semantics, but existing tasks that relied on empty selection as implicit full-library input must now explicitly select sources or upload files

Enemy threat math-field visualization consolidation completed on 2026-05-17:

- Files:
  - `apps/web/src/components/CesiumGlobe.vue`
  - `apps/web/src/components/PlanningThreatMapPanel.vue`
  - `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
  - `agent.md`
- Notes:
  - `敌情威胁自动分析` no longer renders Tactical-Visualizer math output as a separate list-heavy `数学威胁场` panel below the 3D map
  - `PlanningTaskExecutionResultStep.vue` now passes `heatmap`, `heatmapBase64`, `heatmapGeojson`, `bounds`, `situationMap`, `targetEntities`, and `pointThreatEvaluation` into `PlanningThreatMapPanel` as `threatField`
  - `PlanningThreatMapPanel.vue` now has a Tactical-Visualizer-style result mode for `敌情威胁自动分析 三维结果`: category tabs (`全部`, category-derived labels such as 防空/火力/预警/反机降/C2), heatmap/coverage/sector toggles, target ranking cards, and side tabs for targets, Situation Map, matrix, and point-threat details
  - target ranking cards now set `activeEntityId` so clicking a target flies the Cesium view to the corresponding `tv20-target-*` entity
  - `CesiumGlobe.vue` now accepts optional `imageOverlays`; the threat result panel uses this to add `heatmapBase64` as a `SingleTileImageryProvider` over the returned geographic `bounds`
  - removed the obsolete standalone `planning-threat-field-*` CSS panel styling and added responsive styling for the integrated 3D workbench
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
    - completed successfully; Vite still emits the existing large chunk warning
- Remaining risk:
  - no browser screenshot/click-through was run in this pass; validation is based on source inspection and successful Vite production build
  - heatmap placement depends on Python returning valid `bounds` with `heatmapBase64`; if those are absent, the panel still shows targets/matrix details but cannot render the raster overlay

Tactical-Visualizer 2.0 result visibility and frontend LLM configuration follow-up completed on 2026-05-17:

- Files:
  - `apps/server/src/planning-runtime.js`
  - `apps/web/src/views/planning/PlanningAlgorithmsStep.vue`
  - `apps/web/src/views/planning/PlanningTaskFlowStep.vue`
  - `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`
  - `apps/web/src/styles.css`
  - `apps/planning-python/app/services/llm_extraction.py`
  - `apps/planning-python/app/services/tactical_threat_analysis.py`
  - `README.md`
  - `agent.md`
- Notes:
  - `situationMap` is now explicitly populated in `tactical_threat_analysis.py` even when LLM is disabled, missing dependencies, or returns no targets; fallback output uses `extraction_source="rule-fallback"` and includes force type basis, anchor, summary, targets, deployment sectors, and evidence count
  - frontend runtime options now include LLM fields (`llmBackend`, `llmModel`, `ollamaHost`, `openaiBaseUrl`, `openaiApiKey`, `llmMaxTokens`), and both the algorithm-library detail page and task-flow binding page render them as a separate `LLM 结构化抽取配置` panel instead of burying them in the math/runtime parameter grid
  - `openaiApiKey` uses password inputs on both runtime configuration pages and is redacted as `configured` in `algorithmModel.llmConfig` and `appliedOptions`
  - superseded by the later 2026-05-17 visualization consolidation: Tactical-Visualizer math output was initially surfaced in a dedicated `数学威胁场` panel, then moved into `敌情威胁自动分析 三维结果`
  - planning local-file allowlist and frontend accept string now include `.txt`, matching the documented `.docx/.txt` LLM/document extraction path
- Verification:
  - `node --check apps/server/src/planning-runtime.js`
  - `node --check apps/web/src/modules/planningWorkflow.js`
  - `cmd /c npm run build --workspace @mission/planning-python`
  - `cmd /c npm run build --workspace @mission/server`
  - `cmd /c npm run build --workspace @mission/web`
  - Python gateway smoke with frontend-style OpenAI-compatible LLM runtime options and a fake API base:
    - observed fallback behavior with missing `openai` dependency: `ok=true`, `situationSource=rule-fallback`, `situationTargetCount=1`, `llmMode=enabled`, `llmBackend=openai`, `llmConfigApiKey=configured`, `appliedApiKey=configured`, `matrixResolution=96`, `heatmapBase64Len=16132`, `geojsonFeatures=269`, `pointThreatSources=1`, `docxAvailable=true`
  - Python gateway smoke with Unicode `.txt` uploaded evidence and LLM disabled:
    - observed `ok=true`, `targetCount=4`, target types `air-defense/fire-coverage/recon-warning/anti-airborne`, `situationTargetCount=4`, `heatmapMode=spatial-decay-field`, `projectionMode=local-meter-fallback`, `matrixResolution=96`, `matrixSourceCount=4`, `heatmapBase64Len=11952`, `geojsonFeatures=159`, `pointThreatNormalized=0.688713`, `pointThreatSources=4`
- Remaining risk:
  - live Ollama/OpenAI-compatible calls were not exercised in this environment; the smoke test intentionally verified graceful fallback and redaction when the configured OpenAI-compatible path cannot import/call the SDK
  - browser manual click-through/screenshot verification was not run; validation is based on Vite build success, template/source inspection, and backend/Python black-box smoke tests
  - `projection.mode` in smoke tests remained `local-meter-fallback`; install and exercise `pyproj` in the target Python environment to validate true UTM transformation end to end
  - `cmd /c npm run build --workspace @mission/web` still emits the existing large chunk warning, but completes successfully

Tactical-Visualizer 2.0 remaining threat-analysis integration completed on 2026-05-17:

- Files:
  - `apps/planning-python/app/services/threat_math.py`
  - `apps/planning-python/app/services/llm_extraction.py`
  - `apps/planning-python/app/services/assessment_report.py`
  - `apps/planning-python/app/services/tactical_threat_analysis.py`
  - `apps/planning-python/app/main.py`
  - `apps/planning-python/requirements.txt`
  - `apps/server/src/planning-runtime.js`
  - `apps/web/src/modules/planningWorkflow.js`
  - `apps/web/src/views/planning/PlanningTaskExecutionOverview.vue`
  - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
  - `README.md`
  - `agent.md`
- Notes:
  - `apps/planning-python` now contains a real Tactical-Visualizer-style threat math module with WGS84 -> UTM projection via optional `pyproj`, local-meter fallback projection, AHP factor limits, Gaussian/truncated spatial decay, point threat contribution, matrix normalization/smoothing, PNG heatmap rendering, and GeoJSON sampled grid output
  - `threat_math.py` now also accepts the original external `geo_math.py` coordinate formats including decimal degrees, reversed lon/lat forms, and DMS strings such as `23°17′18.6″N, 114°0′28.1″E`
  - FastAPI exposes `POST /planning/threat/evaluate-point`; the request accepts direct `longitude/latitude + targets`, `point.longitude/latitude`, or `structuredOutput.targetEntities`, and returns total threat, normalized threat, contributing sources, distances, and projection metadata
  - `tactical_threat_analysis.py` now publishes `heatmapBase64`, `heatmapGeojson`, `heatmap.matrixSummary`, `pointThreatEvaluation`, and `assessmentReport` inside the planning `structuredOutput`
  - optional LLM extraction is controlled by `TV20_LLM_BACKEND`, `TV20_LLM_MODEL`, `TV20_OLLAMA_HOST`, `TV20_OPENAI_BASE_URL`, `TV20_OPENAI_API_KEY`, and `TV20_LLM_MAX_TOKENS`; supported backends are local Ollama and OpenAI-compatible chat completions
  - LLM extraction is intentionally opt-in: without env configuration the adapter does not call a model and falls back to deterministic document/resource extraction
  - target extraction modes now support `hybrid`, `llm-first`, `llm-only`, and `document-first` so LLM targets can be merged with or replace deterministic extraction depending on project options
  - DOCX secondary assessment reporting is integrated as `assessmentReport.docxBase64`, with a rule fallback and optional OpenAI-compatible LLM assessment text when configured
  - Node planning output packages now support binary `contentBase64`, include Tactical-Visualizer threat field GeoJSON features in the spatial export, and add `threatAssessmentDocx` when the Python adapter returns a DOCX report
  - Web planning downloads now decode `contentBase64` into `Uint8Array`; the execution overview and legacy execution panel both show/download `敌情二次研判报告`
  - `apps/planning-python/requirements.txt` now includes `numpy`, `pyproj`, `Pillow`, `python-docx`, `openai`, and `ollama` in addition to the existing FastAPI/import dependencies
- Verification:
  - `python -c "import ast,pathlib; ..."` over `threat_math.py`, `main.py`, `tactical_threat_analysis.py`, `llm_extraction.py`, and `assessment_report.py`
  - DMS coordinate parser smoke from `apps/planning-python`: observed `23.2885 114.007806`
  - `node --check apps/server/src/planning-runtime.js`
  - `node --check apps/web/src/modules/planningWorkflow.js`
  - `cmd /c npm run build --workspace @mission/planning-python`
  - `cmd /c npm run build --workspace @mission/server`
  - `cmd /c npm run build --workspace @mission/web`
  - direct FastAPI endpoint function smoke via `app.main.evaluate_threat_point(...)`
    - observed result: `ok=True`, `sourceCount=1`, `total_threat_normalized=0.514745`, `projection.mode=local-meter-fallback`
  - black-box Python planning gateway smoke via `dispatch_planning_request(...)`
    - observed result: `ok=true`, `model=tactical-visualizer2.0`, `llmMode=disabled`, `targets=2`, `heatmapMode=spatial-decay-field`, `projectionMode=local-meter-fallback`, `heatmapBase64Len=14024`, `geojsonFeatures=196`, `pointThreatNormalized=0.922633`, `docxAvailable=true`, `docxBase64Len=50420`
- Remaining risk:
  - current environment did not have a configured Ollama/OpenAI-compatible endpoint, so the LLM extraction and LLM assessment paths were code-inspected but not exercised against a live model in this pass
  - smoke verification used `projection.mode=local-meter-fallback`; install `pyproj` from `apps/planning-python/requirements.txt` to exercise the real UTM path in a fresh Python environment
  - no browser manual click-through was run for the new DOCX download action; validation is based on Vite build success and binary package decoding code inspection
  - `cmd /c npm run build --workspace @mission/web` emitted the existing large chunk warning, but completed successfully

Planning algorithm-library external implementation naming and per-project parameters completed on 2026-05-17:

- Files:
  - `apps/server/src/algorithm-gateway.js`
  - `apps/server/src/planning-runtime.js`
  - `apps/planning-python/app/services/planning_gateway.py`
  - `apps/planning-python/app/services/tactical_threat_analysis.py`
  - `apps/web/src/modules/planningWorkflow.js`
  - `apps/web/src/views/planning/PlanningAlgorithmsStep.vue`
  - `apps/web/src/views/planning/PlanningTaskFlowStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
  - `agent.md`
- Notes:
  - planning external implementations are now registered by `D:\mission\algorithms` project name instead of language placeholders; the current external planning project is `tactical-visualizer2.0` from `algorithms/tactical-visualizer2.0`
  - `buildRuntimeCatalog()` no longer exposes planning variants labeled `Python 外部算法模型` or `C++ 外部算法模型`; `enemy-threat-analysis` now gets the external variant `enemy-threat-analysis:tactical-visualizer2.0`
  - legacy persisted bindings such as `enemy-threat-analysis:python-service` are still normalized to `enemy-threat-analysis:tactical-visualizer2.0` in both server and web workflow code
  - external project metadata now carries `projectName`, `projectPath`, `supportedAlgorithmIds`, `projectAlgorithms`, `parameterSchema`, and `defaultOptions`
  - `PlanningAlgorithmsStep.vue` renders an external project parameter panel from `variant.parameterSchema`; `PlanningTaskFlowStep.vue` renders the same parameter controls when a step is bound to an external project
  - project-specific parameter values persist under `algorithmInput.options.runtimeOptions[tactical-visualizer2.0]`
  - Tactical-Visualizer 2.0 parameters currently include adapter profile, target extraction mode, max target count, coordinate fallback, AHP profile, threat-field resolution, coverage radius scale, point-threat evaluation toggle, point longitude/latitude, and evidence segment minimum length
  - the Python planning adapter now merges `runtimeOptions[tactical-visualizer2.0]` into applied options and uses those parameters for extraction limits/mode, coordinate fallback, AHP weights, coverage radius scaling, heatmap resolution, and optional point-threat evaluation
- Verification:
  - `node --check apps/server/src/planning-runtime.js`
  - `node --check apps/server/src/algorithm-gateway.js`
  - `python -m py_compile apps/planning-python/app/services/tactical_threat_analysis.py apps/planning-python/app/services/planning_gateway.py`
  - `cmd /c npm run build --workspace @mission/web`
  - `cmd /c npm run build --workspace @mission/server`
  - `cmd /c npm run build --workspace @mission/planning-python`
  - black-box template check via `node --input-type=module` importing `getPlanningTemplate()`
    - observed result: `enemy-threat-analysis` external runtime keys `["tactical-visualizer2.0"]`, external name `tactical-visualizer2.0`, project path `algorithms/tactical-visualizer2.0`, parameter count `11`
- Remaining risk:
  - no browser-side manual click-through was run for the new parameter panels; validation in this pass is based on Vite build success and template-shape checks
  - only `algorithms/tactical-visualizer2.0` is currently registered; future external projects still need explicit metadata/parameter schema registration in `apps/server/src/planning-runtime.js`

Planning execution per-algorithm result pages + Tactical-Visualizer 2.0 enemy threat adapter completed on 2026-05-11:

- Files:
  - `apps/web/src/router/index.js`
  - `apps/web/src/views/PlanningView.vue`
  - `apps/web/src/views/planning/PlanningTasksStep.vue`
  - `apps/web/src/views/planning/PlanningTaskExecuteStep.vue`
  - `apps/web/src/views/planning/PlanningTaskExecutionOverview.vue`
  - `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`
  - `apps/web/src/styles.css`
  - `apps/planning-python/app/services/planning_gateway.py`
  - `apps/planning-python/app/services/tactical_threat_analysis.py`
  - `README.md`
  - `agent.md`
- Notes:
  - planning execution review is now split into an overview route and a per-algorithm detail route:
    - `/planning/tasks/execute`
    - `/planning/tasks/execute/step/:stepId`
  - `PlanningTaskExecuteStep.vue` is now the execution-stage shell with task/status summary and nested `<router-view />`
  - `PlanningTaskExecutionOverview.vue` owns execution controls, run history, output package actions, and result-step cards only; it no longer renders all algorithm details on one page
  - `PlanningTaskExecutionResultStep.vue` resolves a single execution step by `stepId` or algorithm id and renders only that algorithm's metrics, preview, artifacts, evidence tables, optional 3D visualization, structured tables, and JSON detail
  - planning top-level navigation and task sub-navigation now treat `planning-tasks-execute-step` as part of the existing `任务执行` stage
  - `enemy-threat-analysis` in `apps/planning-python` now routes through `tactical_threat_analysis.py`, a platform adapter for `algorithms/tactical-visualizer2.0`
  - the adapter consumes platform `payload.dataset` and `algorithmInput.uploadedFiles`, applies Tactical-Visualizer-style target extraction, helicopter-threat AHP factor weights, vector threat field output, fire coverage, air-defense, recon-warning, anti-airborne and impact-analysis generation, then returns the existing gateway `structuredOutput` shape
  - the adapter intentionally does not preserve the external mini-system's hardcoded API key defaults and does not require its standalone frontend/backend/venv to run
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
  - `cmd /c npm run build --workspace @mission/planning-python`
  - `cmd /c npm run build --workspace @mission/server`
  - black-box Python gateway smoke check via `python -` importing `dispatch_planning_request(...)`
    - observed result: `ok=true`, `algorithmModel.name=tactical-visualizer2.0`, `threatLevel=中`, `targetEntities=4`, `fireCoverage=4`, `airDefenseSystem=3`
- Remaining risk:
  - no browser-side manual click-through or screenshot regression was run for the new nested execution routes in this pass
  - the Python adapter uses deterministic platform extraction and AHP/spatial scoring logic; it does not call the original LLM extraction path unless a future pass adds explicit environment-driven LLM configuration

README startup-mode batch launchers completed on 2026-05-10:

- Files:
  - `start-dev.bat`
  - `start-web-dev.bat`
  - `start-server-dev.bat`
  - `start-production.bat`
  - `start-planning-python.bat`
  - `start-planning-python-server.bat`
  - `start-planning-python-stack.bat`
  - `README.md`
  - `agent.md`
- Notes:
  - added explicit root-level Windows batch launchers for the README startup modes:
    - full development stack: `start-dev.bat` -> `npm run dev`
    - frontend dev only: `start-web-dev.bat` -> `npm run dev:web`
    - backend dev only: `start-server-dev.bat` -> `npm run dev:server`
    - production build + start: `start-production.bat` -> `npm run build`, then `npm run start`
    - Planning Python service only: `start-planning-python.bat` -> `npm run dev:planning-python`
    - Node backend with Planning Python gateway env: `start-planning-python-server.bat` -> `npm run dev:server:planning-python`
    - full Planning Python integration stack: `start-planning-python-stack.bat` -> `npm run dev:planning-python-stack`
  - each new launcher switches to the repo root, checks `Node.js`/`npm`, installs Node dependencies when `node_modules` is missing, and supports `--check`
  - Planning Python launchers additionally check `python` plus importability of `fastapi` and `uvicorn`, and point users to `pip install -r apps/planning-python/requirements.txt` when missing
  - README quick-start now lists the Windows startup script matrix and updates the project-structure notes from `start-backend.bat` to root-level `start-*.bat` launchers
- Verification:
  - `cmd /c start-dev.bat --check`
  - `cmd /c start-web-dev.bat --check`
  - `cmd /c start-server-dev.bat --check`
  - `cmd /c start-production.bat --check`
  - `cmd /c start-planning-python.bat --check`
  - `cmd /c start-planning-python-server.bat --check`
  - `cmd /c start-planning-python-stack.bat --check`
    - observed result: all checks passed
- Remaining risk:
  - the scripts delegate to existing npm commands; long-running launch behavior should match the underlying README commands, but this pass avoids leaving those servers active during verification

Windows one-click backend launcher completed on 2026-05-10:

- Files:
  - `start-backend.bat`
  - `README.md`
  - `agent.md`
- Notes:
  - added a root-level Windows batch launcher so users can double-click `start-backend.bat` to start the local production backend via `npm run start`
  - the launcher automatically switches to the repo root, checks `Node.js` and `npm`, installs dependencies with `npm install` when `node_modules` is missing, and prints the local access URL
  - supported launcher modes:
    - default: `npm run start`, serving the production backend and existing/build web artifact at `http://localhost:3100`
    - `dev`: `npm run dev:server`
    - `planning-python`: `npm run dev:server:planning-python`
    - `--check`: prerequisite check only
  - updated README quick-start and project-structure docs to document the new one-click Windows startup path
- Verification:
  - `cmd /c start-backend.bat --check`
    - observed result: check passed and Node.js/npm were available
- Remaining risk:
  - did not launch the long-running server in this pass to avoid leaving a background process active in the workspace; the launcher delegates to existing validated `npm run start` / dev scripts

Import-preview mojibake cleanup + large web artifact cleanup completed on 2026-05-07:

- Files:
  - `apps/server/src/import-preview.js`
  - `apps/server/src/import-preview.test.js`
  - `apps/server/package.json`
  - `.gitignore`
  - `README.md`
  - `agent.md`
- Notes:
  - rewrote the runtime-visible Chinese strings in `apps/server/src/import-preview.js` so Word / PDF / Excel / CSV preview titles, summaries, extraction-draft labels, and validation/parse errors no longer return historical mojibake
  - tightened the CSV/Excel header-only preview branch so a one-row CSV such as `name,count` is treated as a header-only sheet with readable columns and summary instead of falling back to generic `列 1 / 列 2`
  - added `apps/server/src/import-preview.test.js` covering:
    - CSV workbook preview payloads and extraction drafts
    - header-only CSV summaries
    - Word text preview without binary extraction
    - unsupported Excel/PDF extension validation messages
    - a mojibake-token regression scan over the generated preview payloads
  - added the new import-preview regression test to `@mission/server`'s `test` script
  - removed local large web verification/generated data directories:
    - `apps/web/dist-check-final`
    - `apps/web/dist-check-next`
    - `apps/web/dist-check-ui`
    - `apps/web/dist-auth-check`
    - `apps/web/public/tiles`
  - kept `apps/web/public/dem` and `apps/web/public/terrain`
  - updated `.gitignore` to ignore `dist-*`, `apps/web/dist-*`, and generated/sample `apps/web/public/tiles`
- Verification:
  - `node apps/server/src/import-preview.test.js`
    - observed result: `4` tests passed
  - `node --check apps/server/src/import-preview.js`
  - direct `node --test apps/server/src/import-preview.test.js` still failed in the current sandbox with `spawn EPERM`; direct script execution of the same test file passed
- Remaining risk:
  - full `cmd /c npm test --workspace @mission/server` was not rerun to completion after this pass because this environment has repeatedly failed Node's test-runner child-process spawn with `EPERM`
  - `apps/web/public/tiles` is now absent by default; run `npm run tiles:sample` or place real demo tiles back under that ignored path when offline base-map tiles are needed

Project naming cleanup completed on 2026-04-15:

- Files:
  - `README.md`
  - `apps/web/index.html`
  - `apps/web/src/config/branding.js`
  - `apps/web/src/views/AuthView.vue`
  - `agent.md`
- Notes:
  - unified the visible project name to `任务规划系统`
  - updated the README title to `任务规划系统（学习交流版）`
  - updated the browser document title, shared branding config, and login page title so the new name renders consistently in the main web entry points
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
  - searched `README.md`, `apps/web/index.html`, `apps/web/src`, `apps/web/dist`, and `agent.md` for legacy project-name variants; no remaining matches found
- Remaining risk:
  - no browser-side click-through was run after the rename; validation for this pass is based on build success and text-level search of source plus generated web assets

Planning FastAPI external-engine scaffold + `enemy-threat-analysis` integration completed on 2026-04-15:

- Files:
  - `apps/planning-python/package.json`
  - `apps/planning-python/requirements.txt`
  - `apps/planning-python/app/__init__.py`
  - `apps/planning-python/app/main.py`
  - `apps/planning-python/app/services/planning_gateway.py`
  - `apps/planning-python/app/services/enemy_threat_analysis.py`
  - `apps/planning-python/app/utils/files.py`
  - `apps/server/src/planning-runtime.js`
  - `package.json`
  - `scripts/start-server-with-planning-python.ps1`
  - `README.md`
  - `agent.md`
- Notes:
  - added a new local Python service under `apps/planning-python` using `FastAPI`, with `GET /health` and `POST /planning`
  - the Python service currently implements the `enemy-threat-analysis` template algorithm and returns the same outer gateway contract the Node planning runtime already expects: `ok / result / meta`
  - `enemy-threat-analysis` in the Python service now produces a planning-compatible `structuredOutput`, including:
    - `implementationStatus`
    - `threatLevel / threatScore / enemyUnitCount`
    - `deploymentSectors / fireCoverage / airDefenseSystem / reconEarlyWarning / antiAirborneFacilities`
    - `selectedSources / importedFiles / evidenceTrace / visualization`
  - `apps/server/src/planning-runtime.js` now packages a filtered resource bundle into external planning requests via `payload.dataset`, including:
    - `selectedSources`
    - `selectedPreviews`
    - `selectedExtractions`
    - `selectedEnvironment`
    - `intelligence.red / intelligence.blue`
  - this fixes the earlier external-planning gap where a Python service could receive uploaded files but not the selected resource-library data it needed for real threat analysis
  - when `PLANNING_PYTHON_URL` is configured and active, new built-in planning task templates now default the `enemy-threat-analysis` step to `python-service`; later planning steps still keep their existing builtin bindings and can be changed in flow orchestration
  - added root/local dev helpers:
    - `npm run dev:planning-python`
    - `npm run dev:server:planning-python`
    - `npm run dev:planning-python-stack`
  - `scripts/start-server-with-planning-python.ps1` injects `PLANNING_PYTHON_URL`, `PLANNING_PYTHON_VERSION`, and `ALGORITHM_GATEWAY_TIMEOUT_MS` defaults before starting the Node server
  - changed `apps/planning-python` build validation to an AST syntax check instead of `compileall`, so validation no longer leaves `__pycache__` artifacts in the repo
- Verification:
  - `node --check apps/server/src/planning-runtime.js`
  - `cmd /c npm test --workspace @mission/server`
  - `cmd /c npm run build --workspace @mission/planning-python`
  - black-box Python algorithm spot check via `python -` importing `app.services.enemy_threat_analysis.run_enemy_threat_analysis(...)`
    - observed result: produced non-empty `fireCoverage`, `airDefenseSystem`, and `identifiedThreatNodeCount`
  - black-box Python gateway spot check via `python -` importing `app.services.planning_gateway.dispatch_planning_request(...)`
    - observed result: returned `{"ok": true, "meta.status": "succeeded", "structuredOutput.implementationStatus": "implemented"}`
- Remaining risk:
  - browser-side end-to-end interaction was not run yet, so the new-task default binding to `python-service` and the execution-page visual output have been verified by runtime/test spot checks only, not by a manual UI click-through
  - the new Python threat-analysis implementation is a template-grade heuristic engine intended for integration and payload-shape alignment; it is not yet equivalent to the full Node builtin threat-analysis logic and may diverge on richer Word/PDF/Excel corpora
  - `apps/planning-python` requires separate Python dependency installation (`pip install -r apps/planning-python/requirements.txt`); this repo still does not automate Python environment provisioning

Task-center task-id synchronization fix completed on 2026-04-03:

- Files:
  - `apps/web/src/views/PlanningView.vue`
  - `apps/web/src/views/CapabilityView.vue`
  - `apps/web/src/views/ActionView.vue`
  - `apps/web/src/views/ConsumptionView.vue`
  - `apps/web/src/modules/calculationSharedTask.js`
  - `apps/web/src/components/CalculationSharedTaskPanel.vue`
  - `README.md`
  - `agent.md`
- Notes:
  - fixed the mismatch where users opened a task from task center detail and then landed in planning / capability / action / consumption with a different previously persisted task binding
  - `PlanningView.vue` now consumes `route.query.taskId` after workflow initialization and on later route-query changes, then calls `selectTaskInstance()` so planning execution follows the exact task-center task instance instead of local-storage fallback
  - `CapabilityView.vue`, `ActionView.vue`, and `ConsumptionView.vue` now consume `route.query.taskId` and call `loadRemoteTask(..., { allowAnyModule: true })` so the calculation shared-context panel and downstream action/consumption workflows sync to the same task-center context on entry
  - `calculationSharedTask.js` now preserves raw remote `moduleKey` values in binding metadata, allows route-synced loading of non-calculation tasks such as `planning`, and protects `saveRemoteTask()` from overwriting a foreign-module task by creating a new calculation task unless the bound task already belongs to `capability / action / consumption`
  - `CalculationSharedTaskPanel.vue` now includes a `planning` label so cross-module task bindings render correctly in the shared-context status area
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass verified compile/build only; no browser-side click-through was run yet to confirm the exact route-jump behavior across every task-center entry combination and in-module tab switch
  - capability module currently syncs the shared global context from task center, but its own capability-task working set still remains local to the capability workflow and is not yet fully server-task-instance-driven like planning

Data-service intake/archive merge completed on 2026-04-03:

- Files:
  - `apps/web/src/components/ResourceWorkbench.vue`
  - `apps/web/src/styles.css`
  - `README.md`
  - `agent.md`
- Notes:
  - merged the `多源数据接入` and `数据源与批量归档` cards into one top-level intake/archive work area
  - the merged card now contains import actions, pending batch queue, loaded-source list, and batch execution history together, so the page no longer splits tightly related ingest/archive work across two separate boxes
  - removed the standalone left archive sidebar from the operating grid; the lower data-service workspace now focuses on `空间主舞台 + 证据与编辑侧舱`
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass changes data-service page structure and column distribution; no browser-side visual review has been run yet to confirm the new vertical density of the merged intake/archive card on the user's target viewport

Home hero panel removal completed on 2026-04-03:

- Files:
  - `apps/web/src/views/HomeView.vue`
  - `README.md`
  - `agent.md`
- Notes:
  - removed the entire homepage hero panel rather than only hiding its internal `notice-strip`, because the hero title, CTA buttons, and top metrics repeated information already present in the homepage entry sections
  - homepage now starts with the top account/stats bar and then goes straight into `任务与业务入口` and `最近任务`, keeping the actual navigation intact while cutting the duplicated explanation layer
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass is still a homepage-first-screen deletion only; no browser-side visual review has been run yet to confirm the vertical rhythm feels balanced after removing the full hero block

Home hero notice-strip removal completed on 2026-04-03:

- Files:
  - `apps/web/src/views/HomeView.vue`
  - `README.md`
  - `agent.md`
- Notes:
  - removed the homepage hero `notice-strip` block under `从任务中心进入数据、评估与规划全链路`
  - kept the hero title, primary entry buttons, and metrics area unchanged so the homepage remains task-center-first while reducing explanatory noise
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this is a small hero-copy deletion only; no browser-side visual review has been run yet to confirm the remaining hero spacing feels ideal after the strip removal

Planning execution overview simplification completed on 2026-04-03:

- Files:
  - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
  - `apps/web/src/styles.css`
  - `README.md`
  - `agent.md`
- Notes:
  - removed the `推荐结果概览` card from the planning task execution page after user feedback that the block was unnecessary
  - expanded the `执行记录` card to occupy the former overview area so the run-history table and archive context now use the full first reading band
  - updated the README planning-execution description to match the new first-screen order
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass changes first-screen layout density only; no browser-side manual review has been run yet to confirm the widened execution-record card feels balanced with long run-history rows

Phase-3 calculation-module framework unification completed on 2026-04-03:

- Files:
  - `apps/web/src/components/CalculationModuleFrame.vue`
  - `apps/web/src/components/CalculationSharedTaskPanel.vue`
  - `apps/web/src/views/CapabilityView.vue`
  - `apps/web/src/views/ActionView.vue`
  - `apps/web/src/views/ConsumptionView.vue`
  - `apps/web/src/modules/calculationSharedTask.js`
  - `apps/web/src/modules/consumptionWorkflow.js`
  - `apps/web/src/styles.css`
  - `README.md`
  - `agent.md`
- Notes:
  - replaced the three duplicated parent shells for capability / action / consumption with one shared `CalculationModuleFrame.vue`, keeping existing routes but centralizing the hero deck, module switcher, left flow rail, main stage shell, and account block
  - rewrote `CalculationSharedTaskPanel.vue` into a true global-context component: it now keeps `任务目标 / 任务说明 / 作战类型 / 敌我装备规模 / 敌情火力强度 / 服务端绑定状态` visible above the fold instead of behaving like a mostly hidden helper form
  - cleaned user-facing copy in `calculationSharedTask.js` and the remaining visible consumption-workflow defaults so the unified shell/global-context layer no longer emits the historical mojibake strings from this path
  - added new calculation-module shell styles in `apps/web/src/styles.css` instead of trying a risky large cleanup of the older module styles; legacy styles remain in place for now but the new framework overrides the calculation-shell presentation
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass verified compile/build only; no browser-side visual walkthrough was run yet to tune sticky behavior, step-rail height, or context-panel density on the user's preferred viewport
  - the old calculation-shell CSS and class families still exist alongside the new framework styles, so a later cleanup pass should remove dead selectors after manual visual confirmation that no legacy routes depend on them

Phase-2 benchmark-page redesign for `数据服务工作台` and `规划执行页` completed on 2026-04-03:

- Files:
  - `apps/web/src/components/ResourceWorkbench.vue`
  - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
  - `apps/web/src/views/planning/PlanningTaskExecuteStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
  - `agent.md`
- Notes:
  - data-service page now has a new top-level command deck plus a clearer three-part workbench structure: source intake rail, spatial main stage, and evidence/editor side cabin
  - `ResourceWorkbench.vue` now surfaces selected-source context, work-mode checklist, extraction counts, and stage-level layer toggles directly in the main workspace instead of treating import/map/detail as equal-weight blocks
  - planning execution page now starts with an execution command deck and overview grid; recommendation summary and run history are shown before the long-form per-algorithm details
  - `PlanningTaskExecutionPanel.vue` now groups the long result page into explicit reading layers (`态势研判层 / 方案筹划层 / 保障收束层 / 执行审计层`) so the page reads like an operator console instead of a flat report
  - `PlanningTaskExecuteStep.vue` was fully rewritten to remove the remaining mojibake and provide a proper stage-brief header with task/status/step summary
  - no new obvious root-level temporary artifacts matching the prior `.codex-* / *.log / *.tmp / *.err / test-results / .build-temp` cleanup targets were found during this pass, so no additional cleanup deletion was applied
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass verified compile/build only; no browser-side visual review was run yet to tune spacing, scroll behavior, and perceived hierarchy on the user's exact screen sizes
  - the planning execution page still contains a large amount of legacy result-detail content in one component; the new information architecture is clearer, but the component remains structurally large and could benefit from later section extraction
  - repository temp-file scanning was constrained by the current Windows shell/tooling environment (`git` unavailable in PATH, broad recursive temp-pattern scans timing out), so cleanup confidence is high only for obvious root-level artifacts and not for every deep nested path

Data-service benchmark-page simplification completed on 2026-04-03:

- Files:
  - `apps/web/src/components/ResourceWorkbench.vue`
  - `apps/web/src/styles.css`
  - `README.md`
  - `agent.md`
- Notes:
  - removed the newly added `数据服务工作台` top summary deck after user feedback that the information was repetitive / low-value
  - moved the `多源数据接入` form block into the former top position as a standalone full-width intake card, so import actions become the first visible task on the page
  - left column now focuses on `数据源与批量归档` only, which reduces stacking pressure and makes the lower workspace less cramped
  - retained the spatial-stage focus strip and the evidence/editor side cabin because they still support concrete operator tasks rather than repeating counts
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass again validated build only; the requested simplification is implemented, but exact visual balance still has not been manually reviewed in-browser on the user's preferred viewport

Top-level credibility repair + task-center routing activation + temporary artifact cleanup completed on 2026-04-03:

- Files:
  - `apps/web/src/config/branding.js`
  - `apps/web/src/router/index.js`
  - `apps/web/src/components/ModuleCard.vue`
  - `apps/web/src/components/CesiumGlobe.vue`
  - `apps/web/src/views/AuthView.vue`
  - `apps/web/src/views/HomeView.vue`
  - `apps/web/src/views/DataServiceView.vue`
  - `apps/web/src/views/CapabilityView.vue`
  - `apps/web/src/views/ConsumptionView.vue`
  - `apps/web/src/views/planning/PlanningTaskLibraryStep.vue`
  - `apps/web/src/views/tasks/TaskCenterListView.vue`
  - `apps/web/src/views/tasks/TaskCenterDetailView.vue`
  - `apps/web/src/styles.css`
  - `README.md`
  - `agent.md`
- Notes:
  - formalized the previously orphaned task-center UI by adding `/tasks` and `/tasks/:id` routes, so the existing task-center list/detail pages are now reachable from the app
  - rewrote the home page into a task-center-first workspace entry: homepage now highlights task center, recent tasks, and module responsibilities instead of only showing sparse module cards
  - normalized visible credibility-critical copy on the brand header, login page, task-center pages, capability shell, consumption shell, planning task-library page, data-service top bar, and Cesium measurement draft labels
  - extended `ModuleCard.vue` to support descriptions and meta text so the homepage can communicate module purpose instead of only title/status
  - removed obvious root-level temporary artifacts generated by prior verification work:
    - `.codex-home.png`
    - `.codex-manual-regression.spec.cjs`
    - `.codex-persistence-check.mjs`
    - `.codex-persistence-check.ps1`
    - `.codex-planning-ui.err.log`
    - `.codex-planning-ui.log`
    - `.codex-tree-after.png`
    - `.codex-tree-before.png`
    - `.codex-tree-lines.err.log`
    - `.codex-tree-lines.log`
    - `.codex-vite.err.log`
    - `.codex-vite.log`
    - `test-results/.last-run.json`
    - `.build-temp/addSituation.tmp`
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - first-stage credibility repair intentionally focused on top-level entry pages and navigation shells; deeper planning pages, especially `apps/web/src/views/planning/PlanningAlgorithmsStep.vue`, may still contain historical mojibake outside this pass
  - no browser-side manual walkthrough was run after the homepage/task-center information-architecture change, so route discoverability and copy quality were verified by build only in this pass

Capability workflow text/encoding cleanup completed on 2026-04-02:

- Files:
  - `apps/web/src/modules/capabilityWorkflow.js`
  - `README.md`
  - `agent.md`
- Notes:
  - cleaned the remaining real mojibake and `????` placeholder strings in the capability workflow state module instead of leaving generic safe prompts behind
  - restored readable Chinese for local-storage warnings, legacy/default scheme names, default task/template/indicator labels, duplicate-task suffixes, template naming, confirm/cancel prompts, evaluate fallback names, and import/export warnings
  - preserved workflow logic and data flow; this pass only normalized user-facing text and error copy in the capability module
- Verification:
  - `rg -n "\?\?\?\?|娴|鑳|璇勪及|妯℃澘|鍓湰|褰撳墠|涓€绾|浜岀骇|涓夌骇|浠诲姟|鎸囨爣|瀵硅薄|锛\?|€\?|鈥|�" apps/web/src apps/server/src`
  - `node --check apps/web/src/modules/capabilityWorkflow.js`
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass targeted the known capability workflow residue and repository-level known-token scans; no browser-side click-through was run for every confirm/export/import branch in the capability UI
  - repo-wide encoding debt now looks substantially reduced under current scan rules, but future edits on Windows should still keep explicit `UTF-8` handling to avoid reintroducing mojibake

Planning task attachment decoupling + API 404 contract + server test baseline repair completed on 2026-04-02:

- Files:
  - `apps/server/src/db.js`
  - `apps/server/src/index.js`
  - `apps/server/src/index.contract.test.js`
  - `apps/server/src/planning-runtime.support.test.js`
  - `apps/server/package.json`
  - `apps/web/src/modules/planningWorkflow.js`
  - `README.md`
  - `agent.md`
- Notes:
  - added server-side `task_attachments` persistence for planning task local uploads; task create/update now strips `uploadedFiles[].fileContentBase64` out of `tasks.planning_algorithm_inputs` and stores each upload separately as an attachment payload
  - added startup migration that moves legacy inline planning uploads out of `tasks.planning_algorithm_inputs` into `task_attachments`, so existing tasks stop carrying base64 file bodies inside the main task row after the server starts
  - `GET /api/tasks` now returns summary payloads without `planningTaskDefinition / planningBindings / planningAlgorithmInputs`; planning detail and execution paths still hydrate attachment-backed algorithm inputs when loading a specific task
  - planning front-end task-instance loading now detects summary-only list records and lazily fetches full task detail before restoring bindings, algorithm inputs, and persisted task definitions
  - added explicit JSON `404` fallback for authenticated unknown `/api/*` routes so logged-in bad API paths no longer fall through to the SPA `index.html`
  - repaired the existing support-planning dependency test expectation to match current upstream-validation behavior and added server contract tests covering API 404 behavior plus the new “task list hides attachment blobs while detail rehydrates uploads” contract
- Verification:
  - `node --check apps/server/src/index.js`
  - `node --check apps/web/src/modules/planningWorkflow.js`
  - `cmd /c npm test --workspace @mission/server`
  - `cmd /c npm run build --workspace @mission/web`
  - `cmd /c npm run build --workspace @mission/server`
- Remaining risk:
  - task detail endpoints still return full attachment payloads, including `fileContentBase64`, because planning execution still depends on that hydrated structure; this pass removes the blob from list/sync paths, but not yet from detail/evaluate payload memory footprint
  - the startup migration rewrites legacy planning tasks in-place on first server start after upgrade; it is deterministic and covered by current attachment merge logic, but no separate offline rollback tool was added in this pass
  - other modules still have separate historical text-garble debt outside this P0 scope, especially legacy strings in `apps/web/src/modules/capabilityWorkflow.js`

Action-module encoding normalization + Cesium risk-color mojibake fix completed on 2026-04-02:

- Files:
  - `apps/server/src/action.js`
  - `apps/web/src/components/ActionChartsPanel.vue`
  - `apps/web/src/components/CesiumGlobe.vue`
  - `apps/web/src/views/ActionView.vue`
  - `apps/web/src/views/action/ActionTaskStep.vue`
  - `apps/web/src/views/action/ActionModelStep.vue`
  - `apps/web/src/views/action/ActionResultsStep.vue`
  - `apps/web/src/views/action/ActionValidationStep.vue`
  - `apps/web/src/modules/actionWorkflow.js`
  - `README.md`
  - `agent.md`
- Notes:
  - normalized the action-calculation front-end/server source files to explicit `UTF-8 with BOM` so Windows-side editors/terminal chains stop mis-decoding large blocks of Chinese copy as mojibake
  - action module source text itself was intact when decoded as UTF-8; this pass targeted file encoding persistence rather than rewriting the action workflow copy/logic
  - while verifying the web build, found and fixed an unrelated historical mojibake syntax break in `apps/web/src/components/CesiumGlobe.vue` where risk-level matching strings (`高/中/低/危`) had been truncated into invalid JS literals
- Verification:
  - byte-level BOM check via `node` confirmed `action.js`, `ActionView.vue`, `ActionTaskStep.vue`, `ActionModelStep.vue`, `ActionResultsStep.vue`, `ActionValidationStep.vue`, `ActionChartsPanel.vue`, and `actionWorkflow.js` are now `utf8-bom`
  - `cmd /c npm run build --workspace @mission/web`
  - `cmd /c npm run build --workspace @mission/server`
- Remaining risk:
  - this pass validates encoding normalization and production build only; no browser-side manual sweep was run across every action subpage on the user’s exact Windows editor/browser combination
  - other non-action modules may still contain separate historical mojibake leftovers (for example, prior scans still showed garbled strings in `apps/web/src/modules/capabilityWorkflow.js`), but they were outside this task scope

Capability tree canvas input-visibility + direct-edit fix completed on 2026-04-02:

- Files:
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
  - `agent.md`
- Notes:
  - capability tree node inputs now keep local edit drafts for both weights and tertiary indicator scores, so users can type decimals or score adjustments without the field snapping back before commit
  - weight and score edits now commit on blur, enter, and native change events instead of relying on a single late change path; tertiary indicator values remain constrained to `0-100` with invalid input reverting to `80`
  - tree node metric layout was widened and switched to a single-column label/value arrangement so weight decimals are fully visible on the canvas, especially on tertiary nodes
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass validated compile/build only; no browser-side manual interaction pass was run yet to confirm the exact typing feel across Chromium/WebKit and wheel-step behavior on number inputs
  - the capability tree still uses native `input[type=number]`, so locale-specific decimal separators are still browser-dependent and remain constrained by the host browser's number-input behavior

Capability weight manual-adjustment + action-step simplification completed on 2026-04-02:

- Files:
  - `apps/web/src/router/index.js`
  - `apps/web/src/views/ActionView.vue`
  - `apps/web/src/views/action/ActionModelStep.vue`
  - `apps/web/src/views/action/ActionResultsStep.vue`
  - `apps/web/src/modules/capabilityShared.js`
  - `apps/web/src/modules/capabilityWorkflow.js`
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/views/capability/CapabilityInputStep.vue`
  - `apps/web/src/views/capability/CapabilityResultsStep.vue`
  - `README.md`
  - `agent.md`
- Notes:
  - action module flow was simplified from four visible steps to three visible steps: generated chain -> model configuration -> results; the former `action-validation` route now redirects into modeling instead of exposing a separate logic-check page
  - capability tree weight editing no longer auto-normalizes sibling branches to sum `1` during task creation, template apply/restore, import, tree rebuild, or value import; existing weights are preserved as entered/imported
  - capability weight inputs still enforce `0-1`, and per-branch editing still prevents the sibling sum from exceeding `1`, but the UI no longer exposes the `自动校准权重` shortcut
  - capability results generation still blocks when any branch weight sum is not exactly `1`, leaving final weight adjustment to the user instead of auto-filling missing weight
- Verification:
  - `node --check apps/web/src/modules/capabilityShared.js`
  - `node --check apps/web/src/modules/capabilityWorkflow.js`
  - `node --check apps/web/src/router/index.js`
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - historical persisted tasks/templates that were already auto-normalized in earlier versions remain normalized in storage; this pass stops future auto-normalization but does not reconstruct prior manual intent
  - the orphaned `ActionValidationStep.vue` file still exists in the repo as a dormant view asset, but is no longer reachable through active routing
  - while stabilizing legacy mojibake-damaged source text in `apps/web/src/modules/capabilityWorkflow.js`, several non-critical feedback/version-note strings were normalized to generic safe prompts rather than fully restored Chinese copy

Calculation shared-task server save/load rollout completed on 2026-04-02:

- Files:
  - `apps/web/src/modules/calculationSharedTask.js`
  - `apps/web/src/components/CalculationSharedTaskPanel.vue`
  - `apps/web/src/views/CapabilityView.vue`
  - `apps/web/src/views/ActionView.vue`
  - `apps/web/src/views/ConsumptionView.vue`
  - `README.md`
  - `agent.md`
- Notes:
  - the shared task panel used by capability/action/consumption now reuses the existing server `tasks` persistence instead of only keeping the mission draft in browser storage
  - added explicit server-side save/load workflow in `calculationSharedTask.js`: create/update via `api.createTask` / `api.updateTask`, list/load via `api.getTasks({ mine: true })` / `api.getTask`
  - shared task UI now shows `保存任务 / 读取任务` actions, current bound server task id/module, server save/load feedback, and a load list that only includes calculation-module tasks (`capability/action/consumption`)
  - each module now passes its own `task-module` flag into the shared panel, so new saves keep the originating calculation module while loaded tasks can still be reused across the three calculation submodules
  - browser local storage remains in place only for unsaved draft content, panel collapse state, and the currently bound server task id; authoritative task persistence is now server-side through the existing `tasks.shared_context`
- Verification:
  - `node --check apps/web/src/modules/calculationSharedTask.js`
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass validated syntax/build only; no manual browser walkthrough was executed for the new save/load interaction, especially the overwrite-on-load path and cross-module reuse flow
  - the shared task panel currently exposes save/load only; it does not yet provide in-panel delete/rename-history management for previously saved server tasks

T13 data-import stability + T14 evidence-trace first rollout closure completed on 2026-04-01:

- Files:
  - `apps/server/src/db.js`
  - `apps/server/src/index.js`
  - `apps/server/src/import-preview.js`
  - `apps/server/src/planning-runtime.js`
  - `apps/web/src/api.js`
  - `apps/web/src/views/DataServiceView.vue`
  - `apps/web/src/components/ResourceWorkbench.vue`
  - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
  - `README.md`
  - `agent.md`
- Notes:
  - completed batch-import persistence model (`import_batches`, `import_batch_items`) with per-item status, failure reason, retry count, and result summary
  - import flow now supports optional task-instance association (`task_id`) for sources, extraction rows, and batch records, enabling task-scoped data traceability
  - `Word/PDF/Excel/CSV` parser errors are now normalized into readable user-facing messages (invalid encoding / parse failure context)
  - planning runtime now propagates extraction evidence metadata (`sourceName/sourceType/fileName/extractedAt`) and emits `evidenceTrace` in key outputs (`threatAnalysis`, `forceGrouping`)
  - data-service and planning-result UIs now expose evidence entries and trace tables for replay and review
  - this pass additionally fixed a pagination edge case in `GET /api/resource-import-batches`: empty pages now return the real `total` count instead of hardcoded `0`
- Verification:
  - syntax checks:
    - `node --check apps/server/src/db.js`
    - `node --check apps/server/src/index.js`
    - `node --check apps/server/src/import-preview.js`
    - `node --check apps/server/src/planning-runtime.js`
    - `node --check apps/web/src/api.js`
  - builds:
    - `cmd /c npm run build --workspace @mission/server`
    - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass validates syntax/build and API-level behavior only; no full browser-side manual walkthrough was executed for all batch-import and evidence-trace UI branches
  - `resource-import-batches` history currently has no dedicated server-side retention policy; long-running environments may need archive/cleanup strategy

T15 external-algorithm gateway standardization closure + T16 core prompt cleanup completed on 2026-04-01:

- Files:
  - `apps/server/src/algorithm-gateway.js`
  - `apps/server/src/db.js`
  - `apps/server/src/capability.js`
  - `apps/server/src/action.js`
  - `apps/server/src/consumption.js`
  - `apps/server/src/planning-runtime.js`
  - `apps/server/src/index.js`
  - `apps/web/src/api.js`
  - `apps/web/src/modules/actionWorkflow.js`
  - `README.md`
  - `agent.md`
- Notes:
  - completed unified external algorithm gateway across capability/action/consumption/planning execution, including shared request contract (`algorithm-gateway-v1`), timeout/error normalization, version/source/runtime fields, and call metadata output
  - completed call-record persistence model `algorithm_call_logs` (schema + migration + indexes) and module-side write-in for builtin/external executions
  - capability/action/consumption evaluate routes now consistently return structured error payloads (`error.code/type/status/details`) and preserve compatibility with existing frontend error handling
  - cleaned remaining user-facing prompt inconsistencies in `index.js` core paths (login/permission/import/execute/archive/delete) by normalizing to readable Chinese
  - fixed a real mojibake leftover in intelligence default readiness (`瀵板懏婧€ -> 待命`)
  - unified frontend fallback request error copy in `apps/web/src/api.js` (`Request failed` -> `请求失败`)
- Verification:
  - syntax checks:
    - `node --check apps/server/src/index.js`
    - `node --check apps/web/src/api.js`
  - builds:
    - `cmd /c npm run build --workspace @mission/server`
    - `cmd /c npm run build --workspace @mission/web`
  - black-box checks via temporary server + HTTP:
    - login with `admin`
    - verified capability template engines expose unified `key/source/runtime/version/status` for `builtin/python-service/cpp-service`
    - verified capability builtin evaluate returns `algorithmGateway` meta
    - verified external-not-ready path returns structured error (`status=400`, `type=missing_data`, code from gateway/module mapping)
    - verified `algorithm_call_logs` latest rows include `module/algorithm/engine source/runtime/version/status`
    - verified normalized Chinese messages on core endpoints:
      - `/api/tasks/0` -> `任务 ID 无效`
      - `DELETE /api/resource-sources/999999` -> `未找到对应数据源`
      - invalid intelligence `sourceId` -> `数据源 ID 无效`
- Remaining risk:
  - this pass validates build + API black-box behavior only; no full-browser screenshot regression for every core path state was executed
  - `algorithm_call_logs` has server-side persistence but still lacks a dedicated read/query API for operations UI

Planning T07-T09 completion verification, blocking fix, and planning-related text-garble cleanup completed on 2026-04-01:

- Files:
  - `apps/server/src/index.js`
  - `README.md`
  - `agent.md`
- Notes:
  - verified T07/T08/T09 against real API behavior (task instantiation, server persistence, run/result archive, validation + structured error contract) and found a blocking gap in `POST /api/tasks`
  - fixed the `tasks` insert SQL placeholder mismatch (`15 values for 16 columns`), which previously caused planning task instance creation to fail even though front-end workflow logic was already wired for server persistence
  - normalized remaining mojibake strings in `index.js` that could surface in planning/auth/user-facing prompts and module labels
  - kept the existing planning workflow/runtime implementation unchanged; this pass focused on server endpoint correctness and visible text quality
- Verification:
  - `node --check apps/server/src/index.js`
  - `cmd /c npm run build --workspace @mission/web`
  - black-box end-to-end verification via temporary server + HTTP requests:
    - login with `admin`
    - create planning task instance from template
    - update and reload same task to confirm template/stage/binding/input restore
    - run `/api/planning/validate`
    - run `/api/planning/evaluate` twice for the same task and confirm independent run records/results
    - query `/api/tasks/:id/runs` and `/api/tasks/:id/runs/:runId` for history replay payload
    - force `missing_upstream` and `permission_denied` scenarios to confirm unified `error.code/type`
  - observed result summary:
    - restore checks: `template/stage/bindings/inputs/steps = true`
    - run history: `2` records with independent `runId` and `hasResult = true`
    - run detail: result payload present
    - error typing: `PLANNING_MISSING_UPSTREAM` and `PLANNING_PERMISSION_DENIED` returned as expected
- Remaining risk:
  - this pass validated API behavior and build/syntax only; no manual browser screenshot regression was run for every planning subpage state
  - result “save snapshot” in execution panel remains browser-local auxiliary storage; authoritative archive is now server-side `task_runs/task_results`

Capability tree-step text cleanup completed on 2026-04-01:

- Files:
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `README.md`
  - `agent.md`
- Notes:
  - cleaned all remaining mojibake text in the capability tree-input page, including the canvas header, node metric labels, drag/drop hints, task/object/version/template panels, and import/export section copy
  - fixed partially converted mixed strings where readable Chinese and mojibake fragments were present in the same sentence
  - no workflow logic changes were made; this pass only updates static UI copy
- Verification:
  - targeted line checks with `Get-Content` on `CapabilityTreeStep.vue` confirmed restored labels in task/object/version/template/import sections
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass validated text cleanup and build only; no browser-side manual walkthrough was run for each tree-step panel state

Task-center front-end rollback and capability-tree list-selection update completed on 2026-04-01:

- Files:
  - `apps/web/src/router/index.js`
  - `apps/web/src/views/HomeView.vue`
  - `apps/web/src/views/CapabilityView.vue`
  - `apps/web/src/views/ActionView.vue`
  - `apps/web/src/views/ConsumptionView.vue`
  - `apps/web/src/views/PlanningView.vue`
  - `apps/web/src/views/planning/PlanningTasksStep.vue`
  - `apps/web/src/views/planning/PlanningTaskLibraryStep.vue`
  - `apps/web/src/views/planning/PlanningTaskFlowStep.vue`
  - `apps/web/src/views/planning/PlanningTaskExecuteStep.vue`
  - `apps/web/src/modules/planningWorkflow.js`
  - `apps/web/src/modules/calculationSharedTask.js`
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
  - `agent.md`
- Notes:
  - removed task-center-first navigation from the home page; capability and planning now re-enter directly from their original module routes
  - removed `taskId/taskCenter` query propagation and binding code from capability/action/consumption/planning shells and planning task subpages
  - removed planning/shared-task task-center coupling (`bindTaskCenterTask`, `taskCenterId`, and shared-context auto-sync callbacks) while keeping existing shared mission local persistence behavior
  - removed `/tasks` and `/tasks/:id` routes from front-end router, so the task-center pages are no longer part of active navigation
  - capability tree “指标体系列表” was refactored from nested cards into a flat list with level filters and a single “选中后添加” action; leaf indicators now explicitly require their parent secondary indicator to exist before adding
  - fixed historical mojibake-corrupted strings in `CapabilityTreeStep.vue` and `calculationSharedTask.js` that were causing template/script parse failures during build
- Verification:
  - `node --check apps/web/src/router/index.js`
  - `node --check apps/web/src/modules/planningWorkflow.js`
  - `node --check apps/web/src/modules/calculationSharedTask.js`
  - `cmd /c npm run build --workspace @mission/web`
  - `cmd /c npm run build --workspace @mission/server`
- Remaining risk:
  - this pass validated syntax/build only; no browser-side manual interaction pass was run for the new flat indicator list workflow across all responsive breakpoints
  - task-center back-end APIs and view files still exist in codebase as dormant assets; only front-end routing/entry coupling was removed in this pass

Historical (superseded) note - T04-T06 task-center integration closure completed on 2026-04-01:

- Files:
  - `apps/web/src/modules/calculationSharedTask.js`
  - `apps/web/src/modules/planningWorkflow.js`
  - `apps/web/src/views/CapabilityView.vue`
  - `apps/web/src/views/ActionView.vue`
  - `apps/web/src/views/ConsumptionView.vue`
  - `apps/web/src/views/PlanningView.vue`
  - `apps/web/src/views/planning/PlanningTasksStep.vue`
  - `apps/web/src/views/planning/PlanningTaskLibraryStep.vue`
  - `apps/web/src/views/planning/PlanningTaskFlowStep.vue`
  - `apps/web/src/views/planning/PlanningTaskExecuteStep.vue`
  - `README.md`
  - `agent.md`
- Notes:
  - `calculationSharedTask` now exports `bindTaskCenterTask()`, so capability/action/consumption views can explicitly bind to a task-center `taskId` on entry
  - capability/action/consumption shells now read `route.query.taskId`, bind server `sharedContext` before workflow initialization, and preserve `taskId` when switching steps/submodules
  - planning workflow now supports `bindTaskCenterTask()`: when entered with `taskId`, it loads the task-center task, applies the linked `planningTemplateId`, and aligns planning assessment name to task name
  - planning evaluate payload now includes `taskCenterId` when bound, enabling `/api/planning/evaluate` to append task-run summaries that show in task-center recent execution records
  - planning sub-navigation (`任务模板/流程编排/任务执行`) now preserves the bound `taskId` query to avoid losing task-center context during in-module navigation
- Verification:
  - `node --check apps/web/src/modules/calculationSharedTask.js`
  - `node --check apps/web/src/modules/planningWorkflow.js`
  - `cmd /c npm run build --workspace @mission/web`
  - `cmd /c npm run build --workspace @mission/server`
- Remaining risk:
  - this pass validated syntax/build only; it did not include browser-side E2E checks for task-center bound navigation across all modules
  - task-center detail page still edits the core shared fields (`name/missionType/objective/description`) while enemy/friendly equipment refinement is primarily maintained in the shared-task panel after module entry

S1 session/local-storage isolation hardening completed on 2026-04-01:

- Files:
  - `apps/server/src/index.js`
  - `apps/web/src/auth.js`
  - `apps/web/src/api.js`
  - `apps/web/src/router/index.js`
  - `apps/web/src/modules/planningWorkflow.js`
  - `apps/web/src/modules/capabilityWorkflow.js`
  - `apps/web/src/modules/calculationSharedTask.js`
  - `README.md`
  - `agent.md`
- Notes:
  - authentication session transport was switched from front-end persisted bearer token to server-managed `HttpOnly` cookie (`SameSite=Lax`, `Secure` enabled automatically for HTTPS requests)
  - server auth routes now set/clear session cookie and no longer return token fields in login/register payloads; auth token resolution supports cookie first and still accepts bearer header for backward compatibility
  - web request pipeline now sends credentials by default; route guards now restore session on first navigation and use `authState.user` (not `authState.token`) for access decisions
  - planning/capability/shared-task browser persistence keys are now scoped by logged-in user id (`<legacy-key>:user-<id>`) to prevent same-browser cross-account leakage
  - legacy unscoped workflow keys are now dropped when a logged-in user session is present, prioritizing isolation over implicit cross-account migration
  - capability/shared-task storage writes now handle quota/write failures without crashing core workflows, and expose warning state in memory
  - server-side `????` placeholder error messages in auth/user/intelligence/situation routes were replaced with readable Chinese messages
- Verification:
  - `node --check apps/server/src/index.js`
  - `node --check apps/web/src/auth.js`
  - `node --check apps/web/src/api.js`
  - `node --check apps/web/src/router/index.js`
  - `node --check apps/web/src/modules/planningWorkflow.js`
  - `node --check apps/web/src/modules/capabilityWorkflow.js`
  - `node --check apps/web/src/modules/calculationSharedTask.js`
  - `cmd /c npm run build --workspace @mission/web`
  - `cmd /c npm run build --workspace @mission/server`
  - `rg -n "\\?{3,}" apps/server/src/index.js` (no matches)
- Remaining risk:
  - planning custom tasks/result snapshots and capability/shared-task states remain browser-local (now per-user isolated) and are still not server-shared across devices
  - this pass validated syntax/build only; it did not include browser-side login/session regression with manual cookie inspection

T01-T03 baseline delivery completed on 2026-04-01:

- Files:
  - `docs/t01-bug-ledger.md`
  - `docs/t02-localstorage-migration-inventory.md`
  - `docs/t03-task-center-data-model.md`
  - `docs/t03-task-center-schema-draft.sql`
  - `README.md`
  - `agent.md`
- Notes:
  - established a unified S1/S2 bug ledger baseline with reproducible steps and validation methods, prioritizing permissions/session boundaries and cross-account data isolation
  - completed a localStorage inventory for planning/capability/shared-task/auth and marked business payloads (`task templates`, `shared mission`, `planning result snapshots`, `formal task states`) as mandatory server-side migration targets
  - produced a first-pass task-center schema draft covering `tasks`, `task_templates`, `task_versions`, `task_runs`, `task_results`, `task_approvals`, `task_attachments`, and `audit_logs`, including PK/FK, status, owner, versioning, timestamps, and index strategy
- Verification:
  - `Get-ChildItem docs`
  - `rg -n "BUG-S1|BUG-S2" docs/t01-bug-ledger.md`
  - `rg -n "mission-planning-custom-tasks|mission-capability-workflow-v2|mission-calculation-shared-task-v1|mission-auth-session" docs/t02-localstorage-migration-inventory.md`
  - `rg -n "CREATE TABLE IF NOT EXISTS (tasks|task_templates|task_versions|task_runs|task_results|task_approvals|task_attachments|audit_logs)" docs/t03-task-center-schema-draft.sql`
- Remaining risk:
  - this pass is documentation/schema planning only; runtime code paths in `db.js`, `index.js`, and front-end workflows are not yet wired to the new task-center tables
  - S1/S2 issues identified in the ledger are not yet fixed in this pass and still need implementation + regression verification

Shared mission panel collapse-by-default completed on 2026-03-31:

- Files:
  - `apps/web/src/components/CalculationSharedTaskPanel.vue`
  - `apps/web/src/modules/calculationSharedTask.js`
  - `apps/web/src/styles.css`
  - `README.md`
- Notes:
  - the shared mission surface used by capability / action / consumption now defaults to a compact summary card instead of always exposing the full task form and equipment inputs
  - users can expand the panel only when they need to edit mission name, mission type, objective, description, or enemy/blue equipment inputs, then collapse it again to reduce vertical clutter
  - the panel collapse state now persists in browser local storage, so moving between the three calculation submodules keeps the shared mission window in the user-selected open/closed state
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass verified compile/build only; it did not include a browser-side visual check for the collapsed summary density across all responsive breakpoints

Capability results-step algorithm checklist overflow fix completed on 2026-03-31:

- Files:
  - `apps/web/src/styles.css`
  - `README.md`
- Notes:
  - the `算法与生成控制` strip now uses a stable two-row grid: `intro + actions` on the first row, with the three method checkboxes/cards spanning their own full-width row beneath
  - inline method cards now use a smaller responsive minimum width plus `min-width: 0` and text wrapping safeguards, so the three algorithm options no longer squeeze into the action area or visually cover following content
  - the responsive breakpoint at `1280px` now stacks `copy -> methods -> actions`, keeping the results-step control strip readable across mid-width desktop layouts
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass still lacks a browser-side visual check, so final spacing on real persisted data and uncommon zoom levels remains unverified

Capability results-step control bar reposition completed on 2026-03-31:

- Files:
  - `apps/web/src/views/capability/CapabilityResultsStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
- Notes:
  - the `算法与生成控制` block was moved out of the right-side results column and placed above `融合结果` inside the main results column
  - the control area now uses a horizontal layout: `intro copy + method toggles + generate/export actions`, with responsive fallback to stacked layout on narrower widths
  - the right-side column now focuses only on `对象切换`, so result reading and control actions are visually separated without sending the user’s eye back and forth between sidebars
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass verified the Vue build path only; it did not include a browser-side visual pass to confirm the new horizontal control bar spacing feels balanced across all desktop breakpoints

Shared mission drive across capability / action / consumption completed on 2026-03-31:

- Files:
  - `apps/web/src/modules/calculationSharedTask.js`
  - `apps/web/src/modules/actionWorkflow.js`
  - `apps/web/src/modules/consumptionWorkflow.js`
  - `apps/web/src/views/ActionView.vue`
  - `apps/web/src/views/ConsumptionView.vue`
  - `apps/web/src/views/consumption/ConsumptionScenarioStep.vue`
  - `apps/server/src/action.js`
  - `README.md`
- Notes:
  - the shared-task state now exposes both `missionSignature` and `missionSyncSignature`; name/objective/description edits only mark results dirty, while mission-type or enemy/blue-equipment changes trigger real baseline resync
  - action workflow now treats the shared mission as the authoritative task source, keeps the assessment name aligned to the shared task, and rebuilds the fixed function-chain scheme baseline when the shared mission type or force inputs change
  - action server selection now understands `payload.missionContext.missionType`, so callers that send only shared mission context can still resolve the correct built-in fixed chain (`fire-strike -> helicopter-fire-strike`, `air-assault -> helicopter-air-assault`)
  - consumption workflow now derives scenario schemes through `mergeConsumptionSchemesWithSharedTask`, sends `missionContext` to the evaluate API, and rewrites the scenario entry step around `共同任务驱动 -> 方案派生 -> 细化建模`
  - action and consumption top-level shells now center the topbar on `当前步骤 / 共同任务 / 作战类型`, reducing the earlier duplicated per-submodule task/plan context while keeping the shared panel as the single mission-edit surface
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
  - `node --check apps/server/src/action.js`
  - `node --check apps/web/src/modules/consumptionWorkflow.js`
  - black-box action runtime check via `node --input-type=module` calling `evaluateAction({ missionContext: { missionType: 'air-assault' } })`
  - black-box consumption runtime check via `node --input-type=module` calling `evaluateConsumption()` with a custom single-scheme payload plus `missionContext`
  - observed result:
    - action runtime resolved `taskId=helicopter-air-assault` from `missionContext.missionType`
    - consumption runtime returned `rankingCount=1` and `recommendedSchemeId=test` for the custom shared-mission payload
- Remaining risk:
  - this pass verified build and targeted runtime behavior only; it did not include a browser-side visual review for the new shared-task-first action/consumption shells
  - capability submodule currently uses the shared mission as the common background/context entry, but the indicator-tree algorithm itself is still not deeply re-parameterized by shared mission fields

Capability module shell de-clutter and fixed-theme pass completed on 2026-03-31:

- Files:
  - `apps/web/src/views/CapabilityView.vue`
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/views/capability/CapabilityResultsStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
- Notes:
  - the capability outer shell now removes the sidebar `可录入状态` / `当前任务结构` summary blocks and the duplicated step-head context cards, leaving a single top-level location for `当前步骤 / 当前任务 / 评估对象数量`
  - the flow-rail active-state copy now uses `进行中` instead of repeating `当前步骤`, which reduces visual duplication while keeping progress readable
  - the tree step no longer repeats `当前任务` / `当前对象` in its page-head pills, and the object-management copy was tightened to `对象切换` / `对象数` so the editing workspace is less noisy
  - the results step removed the extra console-side four-metric summary grid and simplified `当前对象` / `评估对象结果切换` wording into less repetitive labels
  - capability step briefs and the tree step major panels now share one consistent blue accent treatment, so switching between `指标库管理 / 构建指标树并录入 / 生成评估结果` no longer flips the surrounding theme color
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass verified compile/build only; it did not include a browser-side visual pass to confirm the reduced summary density and fixed accent treatment feel balanced on both desktop and smaller responsive layouts

Capability module step merge and tree-inline input completed on 2026-03-31:

- Files:
  - `apps/web/src/modules/capabilityWorkflow.js`
  - `apps/web/src/router/index.js`
  - `apps/web/src/views/CapabilityView.vue`
  - `apps/web/src/views/capability/CapabilityLibraryStep.vue`
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/views/capability/CapabilityResultsStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
- Notes:
  - capability flow navigation was compressed from `5` evaluation steps down to `3`: `指标库管理 -> 构建指标树并录入 -> 生成评估结果`; the old `capability-framework` and `capability-input` routes now redirect into the tree step for backward compatibility
  - tree step now absorbs the formerly separate task configuration, object management, template/version management, and input import/export controls into the right-side tool panel, while the canvas header exposes direct object switching for tree-inline score entry
  - indicator cards on the tree canvas are now editable: first-/second-/third-level nodes accept inline weight edits, and third-level nodes accept inline score edits for the currently selected scheme
  - score validation now treats blank / non-numeric / out-of-range tree input as invalid and automatically resets that leaf score to `80`; valid manual score input remains constrained to `0-100`
  - weight editing is now constrained to `0-1` for manual tree input, and when a newly entered weight would push the sibling-group total above `1`, only the new weight is reduced to the remaining available value so existing sibling weights stay unchanged
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass verified compile/build only; it did not add browser-side regression coverage for the new inline number-entry behavior, especially around blur/change timing and very dense trees with many simultaneously editable leaf cards

Capability module tree viewport auto-fit and node-summary refresh completed on 2026-03-31:

- Files:
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
- Notes:
  - capability tree now derives a display-value map from the current selected scheme on the task and recursively aggregates first-/second-level node values from their children, so every node on the tree canvas can show a meaningful current indicator value instead of only leaves having direct numbers
  - tree node cards on the canvas were reduced to `indicator name + weight + indicator value`; the earlier level badges, codes, and child-count copy were removed from the canvas cards to improve density and readability
  - the canvas viewport now auto-fits the rendered tree on initial mount, task switch, tree-structure change, and viewport resize, and a manual `适配` control was added alongside the existing zoom buttons
  - tree spacing was tightened again across the canvas: root width, core/secondary/leaf card widths, branch gaps, offsets, and action-button sizing were all reduced so a full indicator tree is more likely to stay visible while the card contents remain legible
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass verified compile/build only; it did not include a browser screenshot or manual interaction pass to confirm the new auto-fit scale remains comfortable on unusually deep or wide persisted trees across multiple viewport sizes

Capability module indicator-library management and hierarchy-constrained selection completed on 2026-03-31:

- Files:
  - `apps/web/src/modules/capabilityWorkflow.js`
  - `apps/web/src/router/index.js`
  - `apps/web/src/views/CapabilityView.vue`
  - `apps/web/src/views/capability/CapabilityLibraryStep.vue`
  - `apps/web/src/views/capability/CapabilityFrameworkStep.vue`
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/views/capability/CapabilityInputStep.vue`
  - `apps/web/src/views/capability/CapabilityResultsStep.vue`
  - `README.md`
- Notes:
  - capability workflow now keeps an independent browser-persisted indicator library instead of treating `template.indicators` as a read-only source; the library supports CRUD for first-, second-, and third-level indicators while preserving explicit `core -> secondary -> leaf` parent-child relationships
  - a new `指标库管理` step was added ahead of the existing capability flow, with its own route and page for maintaining indicator names, descriptions, and leaf units before building any task tree
  - `构建指标体系` no longer creates blank second-/third-level indicators inside the task; additions now come from library-backed selectors scoped to the current parent node, so a core can only add its own library secondaries and a secondary can only add its own library leaves
  - `创建指标树` now exposes library leaves in the right-side source list, supports dragging/adding all three levels from the library, and no longer allows cross-parent rehang that would violate library relationships; secondaries stay within their owning core and leaves stay within their owning secondary
  - capability shell step navigation and step labels were updated from four steps to five, and the input/results step numbering was shifted accordingly
- Verification:
  - `node --check apps/web/src/modules/capabilityWorkflow.js`
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - the indicator library remains browser-local like the existing task/template persistence; edits are not yet synchronized to a shared server-side repository, so different browsers or machines still maintain separate capability indicator catalogs

Support-planning hardening completed on 2026-03-28:

- Files:
  - `apps/server/src/planning-runtime.js`
  - `apps/server/package.json`
  - `apps/server/src/planning-runtime.support.test.js`
  - `apps/web/src/views/planning/PlanningAlgorithmsStep.vue`
  - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
  - `README.md`
- Notes:
  - `support-planning` no longer fabricates a hidden `low / medium / high` battle-damage estimate inside the executor; it now normalizes an explicit structured damage-forecast input with `equipmentLossRate / casualtyRate / damagedEquipmentCount / woundedCount / criticalWindowCount`
  - the support algorithm now models a real support resource pool instead of `demand * factor`: resource stock and dispatch capacity are part of the algorithm options, and the plan is constrained by `stock -> transport throughput -> support-node capacity`
  - support allocations are now bound to actual grouped outputs when present, expand into multiple node-level rows, and expose per-resource constraint labels / bottlenecks / stock status rather than a single direct quantity echo
  - support execution now validates upstream dependencies before planning; missing grouping results, missing method-planning routes/phases, missing airborne landing results for air-assault tasks, or missing non-zero support-pool inputs now return explicit `400` errors instead of producing a seemingly complete default plan
  - planning algorithm configuration now exposes support-specific damage and resource-pool inputs on the web side, and the execution panel now renders damage inputs, resource-pool status, allocation notes, and bottleneck counts
  - formal server-side coverage was added through `node --test` for constrained support planning and dependency validation
- Verification:
  - `node --check apps/server/src/planning-runtime.js`
  - `cmd /c npm run test --workspace @mission/server`
  - `cmd /c npm run build --workspace @mission/server`
  - `cmd /c npm run build --workspace @mission/web`
  - black-box support-planning checks via `node --input-type=module`:
    - custom constrained fire-strike run with `createDatabase()` and a deliberately tight support pool confirmed `coverageRate=8.2`, `gapCount=6`, `bottleneckCount=6`, with `firstRequirement.supplied=11.7` capped by stock / transport / node limits rather than demand
    - default fire-strike run with `createDatabase()` confirmed the new default support pool no longer collapses into full-shortage output and produced `coverageRate=65.7`, `gapCount=3`, `bottleneckCount=3`
- Remaining risk:
  - the support resource pool is still manually configured per planning run and is not yet auto-synchronized from a shared server-side logistics inventory repository; node-capacity modeling is therefore still heuristic rather than backed by a calibrated external logistics system

Capability module tree empty-state and connector-cap fix completed on 2026-03-28:

- Files:
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
- Notes:
  - capability tree canvas no longer renders the root card on an untouched task; when the current indicator tree is empty, the page now starts from a true empty-canvas state and waits for the user to add indicators from the right-side source list
  - connector “line head” artifacts were reduced by trimming the vertical spines to slot-center start/end positions and by changing the line corner treatment from large rounded caps to tighter `2px` radii
  - the main spine now resolves to `top/bottom = 28px` inside the root branch stack, while secondary and leaf vertical spines resolve to `12px`, matching the slot centers and removing the extra protruding tails
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
  - ad hoc Playwright check against local server `http://localhost:3100` in a fresh browser context:
    - preload admin session
    - clear `mission-capability-workflow-v2`
    - open `/capability/evaluation/tree`
    - confirm `hasRootCard=false`, `hasEmptyShell=true`, `coreCount=0`
    - add one first-level block from the library
    - confirm connector pseudo-element values `branchTop=28px`, `branchBottom=28px`, `secondaryTop=12px`, `secondaryBottom=12px`, `leafTop=12px`, `leafBottom=12px`, with all checked radii at `2px`
- Remaining risk:
  - this pass verified empty-state behavior and computed connector geometry, but did not add screenshot-based regression coverage for future tree-canvas visual changes

Capability module tree-connector visibility refinement completed on 2026-03-28:

- Files:
  - `apps/web/src/styles.css`
  - `README.md`
- Notes:
  - capability tree connector styling was strengthened without changing the DOM structure: root, first-level, second-level, and third-level links now use brighter level-colored lines with thicker strokes and soft glow, so branch ownership is easier to read on the canvas
  - the horizontal branch joins and vertical spines now render at `3px` instead of the earlier faint `2px` treatment, and each level keeps its own cyan / lime / orange hierarchy color
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
  - ad hoc Playwright check against local server `http://localhost:3100`:
    - preload admin session
    - open `/capability/evaluation/tree`
    - auto-add one first-level block if the current task tree is empty
    - confirm connector pseudo-element styles resolved to `rootHeight=3px`, `branchWidth=3px`, `secondaryWidth=3px`, `leafHeight=3px`
    - confirm connector shadows were present on all checked levels rather than `none`
- Remaining risk:
  - this pass verified rendered CSS values, but did not add screenshot-based visual regression coverage for future connector-style changes

Capability module tree-canvas viewport and spacing fix completed on 2026-03-28:

- Files:
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
- Notes:
  - capability tree canvas now keeps its own viewport state instead of relying on browser overflow alone; the page adds `Zoom +/-`, `100%` reset, wheel-to-zoom, and blank-area drag panning for the left tree workbench
  - the canvas content layer now uses a transformed viewport wrapper, so users can move around the indicator tree without the old “super-wide static sheet” behavior
  - tree layout spacing was tightened substantially at the style layer: root/core/secondary/leaf card widths, branch offsets, and row/column gaps were all reduced so the hierarchy reads as an actual compact tree instead of a stretched diagram
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
  - ad hoc Playwright smoke against the existing local server on port `3100`:
    - preload admin session
    - open `/capability/evaluation/tree`
    - ensure at least one first-level block exists in the tree
    - click canvas zoom-in control and confirm transform/zoom label changed from `Zoom 100%` to `Zoom 110%`
    - drag the blank canvas area and confirm the tree transform updated to a translated state
    - measured layout gaps after render: `rootToCore=103.4`, `coreToSecondary=81.4`, `secondaryToLeaf=66`
- Remaining risk:
  - this pass browser-smoked desktop mouse interaction only; touch pinch gestures and very large persisted trees still do not have automated regression coverage

Capability module tree-canvas rebuild completed on 2026-03-27:

- Files:
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
- Notes:
  - capability tree page was rebuilt against the user-provided reference, replacing the earlier “guide + focus panel” workbench with a `left canvas + right indicator-system list + right-side tool panel` structure
  - the old “专业用户会先问什么” prompt block was removed entirely; the main page now opens directly on a grid-backed tree canvas
  - left canvas now renders the indicator tree as connected blocks: root -> first-level -> second-level -> third-level nodes are arranged as branch lanes and visually linked by connector lines rather than stacked cards
  - right-side indicator-system list now acts as the source palette: first-level and second-level indicators can be dragged into the canvas or inserted by button, while versions/templates/import-export remain in a separate tool panel below
  - hierarchy editing still uses the existing workflow move/remove helpers, but is now exposed directly on each block via `上移 / 下移 / 拖动 / 删除`; second-level indicators can still move across first-level blocks and third-level indicators can still move across second-level blocks
- Verification:
  - `node --check apps/web/src/modules/capabilityWorkflow.js`
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass validated compile/build only; the rebuilt canvas tree still needs browser-side smoke coverage to verify connector rendering, overflow behavior, and drag-drop ergonomics in real interaction

Capability module tree-focus usability refinement completed on 2026-03-27:

- Files:
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
- Notes:
  - capability tree page now behaves more like a professional editing workbench instead of a pure drag canvas: clicking any root/core/secondary/leaf node immediately switches the right-side panel into the current hierarchy context
  - the new focus panel shows current level, structure path, parent node, child counts, and exposes direct `上移 / 下移 / 新增空白下级 / 删除当前节点` actions so users do not have to hunt inside the tree for the next valid operation
  - root focus now recommends missing first-level capability blocks, while first-level focus only recommends the missing second-level blocks under that selected core, making “补整树” and “补当前一级块” explicit
  - tree cards now have stronger selected-state styling and clearer level badges (`一级 / 二级 / 三级`), reducing ambiguity about which node is being edited
  - the top review card was rewritten around professional-user questions such as “我现在在编辑哪一层 / 我补的是整棵树还是当前一级块 / 拖错后如何快速修正”, keeping guidance short but operational
- Verification:
  - `node --check apps/web/src/modules/capabilityWorkflow.js`
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass validated compile/build only; the new focus-selection flow and drag-after-select behavior still need browser-side smoke coverage to confirm no event-propagation quirks remain in real use

Capability module drag-tree workbench refinement completed on 2026-03-27:

- Files:
  - `apps/web/src/modules/capabilityWorkflow.js`
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
- Notes:
  - capability tree construction was upgraded from a button-driven preview flow into a drag-enabled workbench: library cores and secondaries can now be dragged into the canvas, and existing first-/second-/third-level nodes can be dragged again to reorder within the tree
  - tree deletion constraints were relaxed; root cores, secondaries, and leaves can now all be removed directly instead of blocking deletion when a node is the last sibling
  - `capabilityWorkflow` now exposes structure-edit helpers for insert/move operations (`insertCoreFromLibrary`, `insertSecondaryFromLibrary`, `moveCoreNode`, `moveSecondaryNode`, `moveLeafNode`) and uses a shared tree-rebuild path after structural changes
  - framework-step sizing was tuned at the style layer: the right utility column is wider, tertiary cards now use auto-fit widths instead of a fixed three-column squeeze, and long task/template/object text now wraps more cleanly instead of being clipped or cramped
- Verification:
  - `node --check apps/web/src/modules/capabilityWorkflow.js`
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - this pass validated compile/build only; the new drag-and-drop tree interactions still need browser-side smoke coverage to catch any event-handling regressions on specific browsers or touch devices

Capability module unit restoration completed on 2026-03-27:

- Files:
  - `apps/web/src/modules/capabilityShared.js`
  - `apps/web/src/modules/capabilityWorkflow.js`
  - `apps/web/src/views/capability/CapabilityFrameworkStep.vue`
  - `apps/web/src/views/capability/CapabilityInputStep.vue`
  - `apps/web/src/styles.css`
  - `apps/server/src/capability.js`
  - `README.md`
- Notes:
  - restored a shared common-unit catalog for capability indicators and removed the front-end regressions that were forcing new or imported third-level indicators back to `分`
  - framework-step unit editing now uses a `common-unit select + custom input` interaction instead of a plain text box, so users can pick frequent units directly and only type when necessary
  - `sanitizeTask()` now rebuilds a template leaf-unit lookup and migrates persisted system-template tasks/version trees away from the legacy all-`分` fallback when the template carries a more specific unit
  - the server-side built-in capability template now reapplies leaf-level unit mappings such as `%` / `秒` / `分钟` / `米` / `次`, so fresh tasks again start from varied, meaningful units
  - input-step display no longer pretends missing units are `分`; blank units are shown as `未设置`
- Verification:
  - `node --check apps/server/src/capability.js`
  - `node --check apps/web/src/modules/capabilityWorkflow.js`
  - `node --check apps/web/src/modules/capabilityShared.js`
  - `cmd /c npm run build --workspace @mission/web`
  - `cmd /c npm run build --workspace @mission/server`
  - `node --input-type=module` black-box template check confirmed `leafCount=54`, `uniqueUnits=['%','分','分钟','次','秒','米']`, with sampled leaves such as `recon-fusion-latency=分钟` and `command-order-latency=秒`
- Remaining risk:
  - persisted custom templates created during the regression are intentionally not auto-overwritten, so any user-saved custom template that was already flattened to all `分` will keep its stored units until the user updates or recreates that template

Latest implementation pass completed on 2026-03-27:

Capability module copy cleanup follow-up completed on 2026-03-27:

- Files:
  - `apps/web/src/components/CapabilityFilterPanel.vue`
  - `apps/web/src/views/capability/CapabilityFrameworkStep.vue`
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/views/capability/CapabilityInputStep.vue`
  - `apps/web/src/views/capability/CapabilityResultsStep.vue`
  - `README.md`
- Notes:
  - removed the newly introduced explanatory hero copy such as “先明确任务，再围绕一个指标块进行聚焦编辑” / “左侧构建树，右侧管理资产...” from the four capability steps
  - each step brief now keeps only a concise title plus status pills / metric cards, reducing interface noise
  - `CapabilityFilterPanel` summary paragraph now renders only when a non-empty description is passed, allowing quieter filter bars where needed
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
- Remaining risk:
  - other secondary helper descriptions inside section cards remain in place; this follow-up only removed the most prominent prompt-like hero copy requested by the user

Capability module UI refinement follow-up completed on 2026-03-27:

- Files:
  - `apps/web/src/components/CapabilityFilterPanel.vue`
  - `apps/web/src/views/CapabilityView.vue`
  - `apps/web/src/views/capability/CapabilityFrameworkStep.vue`
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/views/capability/CapabilityInputStep.vue`
  - `apps/web/src/views/capability/CapabilityResultsStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
- Notes:
  - capability shell was simplified again: the left side now behaves more like a slim progress rail, while task/object/template counts moved into a compact context strip above the active step workspace
  - `CapabilityFilterPanel` was redesigned into a two-stage focus bar that explicitly guides `select first-level block -> select second-level block`, with current path summary rendered inline
  - framework step now uses a `main editor column + right utility column` layout; task management and template reuse were merged into one tabbed utility panel instead of two full-width sections
  - tree step now uses a stronger workbench hierarchy: left library for building, one right-side utility deck for `versions / templates / import-export`, and one focused preview area below
  - input step now uses a `left navigation rail + right editor` structure; object switching and import/export were condensed into one top toolbar above the editor rather than separate full-width cards
  - results step now uses a dedicated right-side control console that combines algorithm selection, result generation, and export actions, while object switching remains separate and subordinate
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
  - ad hoc Playwright browser validation against the existing local server on port `3100`:
    - login as `admin`
    - open `/capability/evaluation/tree`
    - add two first-level capability blocks from the indicator library
    - capture screenshots for `/capability/evaluation/tree`, `/capability/evaluation/framework`, `/capability/evaluation/input`
    - open `/capability/evaluation/results`, generate results, and capture the rendered page
- Observed result:
  - screenshots in `%TEMP%\\mission-capability-ui-validate\\` showed non-empty framework/tree/input/results pages with a visibly stronger main-workspace hierarchy and less equal-weight card stacking
  - results rendering completed successfully after generation and the screenshot showed populated summary cards, ranking table, and charts in the new layout
- Remaining risk:
  - visual verification is still ad hoc; there is still no committed browser regression suite for capability-module layout changes
  - the refinement improves density and action grouping, but very long task names / template names / indicator descriptions still lack dedicated truncation or overflow assertions

Capability module UI refactor completed on 2026-03-27:

- Files:
  - `apps/web/src/components/CapabilityFilterPanel.vue`
  - `apps/web/src/modules/capabilityWorkflow.js`
  - `apps/web/src/modules/capabilityShared.js`
  - `apps/web/src/views/CapabilityView.vue`
  - `apps/web/src/views/capability/CapabilityFrameworkStep.vue`
  - `apps/web/src/views/capability/CapabilityTreeStep.vue`
  - `apps/web/src/views/capability/CapabilityInputStep.vue`
  - `apps/web/src/views/capability/CapabilityResultsStep.vue`
  - `apps/web/src/styles.css`
  - `README.md`
- Notes:
  - removed the old cross-step indicator filter state from `capabilityWorkflow`; capability filters are no longer shared across framework/tree/input steps and are no longer persisted into browser storage
  - added `CapabilityFilterPanel` and replaced the old dropdown multi-select with always-visible chip/tab filtering for first-level and second-level capability blocks
  - framework step now focuses editing on one current first-level capability block at a time instead of rendering all filtered blocks in one long stack
  - tree step was reorganized into a workbench layout: indicator-library construction on the left, version/template/import-export controls on the right, and a focused preview panel below
  - input step now uses a focused workspace: current-object switch remains separate, while the main editor only expands one first-level block and one second-level block at a time with simplified third-level cards
  - results step now prioritizes result reading with a main results column and a right-side control rail for algorithm toggles, exports, and object switching
  - capability shell navigation now locks input/results until a usable indicator tree exists, trims repeated sidebar statistics, and narrows the sidebar to return more width to the main workspace
  - removed the obsolete `CapabilityMultiSelect.vue` component and the unused `filterAnnotatedTree()` helper
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
  - temporary local production server via `npm run start`
  - ad hoc Playwright smoke:
    - login as `admin`
    - open `/capability/evaluation/tree`
    - add several first-level capability blocks from the indicator library
    - open `/capability/evaluation/input` and edit a third-level indicator value
    - open `/capability/evaluation/results` and generate results
- Observed result:
  - the smoke flow reached the refactored results page and rendered `resultCards=2`, `rankingRows=3`, `topScheme=评估对象 B（打击强化型）`
  - a separate smoke run that first landed on `/` observed an unrelated `HomeView getUsers` fetch error during startup, but the capability direct-path flow still rendered and completed
- Remaining risk:
  - no committed automated visual-regression suite exists for the new capability layouts; verification still relies on build checks plus ad hoc browser smoke
  - responsive behavior was adjusted for mobile/tablet breakpoints, but this pass did not add device-specific automated assertions beyond the updated layout rules

Method-planning follow-up completed on 2026-03-27:

- Files:
  - `apps/server/src/planning-runtime.js`
  - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
  - `README.md`
- Notes:
  - method-planning no longer relies on the old fixed waypoint templates in the main execution path; `A*` / `Dijkstra` now run on a coarse 2D cost grid and `RRT` now uses seeded random expansion with threat/environment-aware edge screening
  - route generation now first resolves real `group-target-wave` tasks from target-allocation results when assignments exist, and only falls back to target anchors when the upstream allocation sample contains no usable assignments
  - route cost evaluation now includes planning-field cost, threat / terrain / weather / electromagnetic penalties, and the upstream allocation match / feasibility context instead of only post-hoc threat scoring
  - route timelines are now derived from per-route start windows and checkpoint offsets; preferred-plan output now includes route windows, checkpoint counts, planning-basis metadata, and 3D threat/environment overlays
  - the execution panel now shows planning-basis pills, richer method comparison columns, per-route wave/platform/time-window fields, and a dedicated checkpoint table
- Verification:
  - `node --check apps/server/src/planning-runtime.js`
  - `cmd /c npm run build --workspace @mission/web`
  - black-box `evaluatePlanning()` checks via `node --input-type=module` for `fire-strike-task` and `air-assault-task`
- Observed result:
  - both black-box samples returned `comparedPlans=3`, `routeCount=3`, `checkpointCount=12`, and non-empty `preferredPlan.visualization.environment`
  - `A*` / `Dijkstra` / `RRT` now produce distinguishable route-level distance / field-cost summaries instead of the previous template-equivalent output path
  - the default demo dataset still produced `targetAllocation.preferredPlan.assignments=0` and `systemBestPlan.assignments=0`, so method-planning exercised its documented fallback route-task generation path in that sample
- Remaining risk:
  - the grid / sampled-RRT implementation is still a demo-grade planner; it is not connected to calibrated terrain rasters or a real operational routing engine
  - when upstream target allocation has no viable assignments, method-planning can only fall back to objective anchors and therefore cannot render real assigned-platform names in that sample

Planning route-recovery follow-up completed on 2026-03-27:

- Files:
  - `apps/web/src/router/index.js`
  - `README.md`
- Notes:
  - added a router-level recovery handler for failed lazy-loaded chunks; when a stale browser page tries to open a planning sub-route after a fresh web rebuild, the app now detects the dynamic-import failure and performs a one-time hard reload to the target route
  - this was added after the user reported that `作战任务库` suddenly could not be opened, while fresh-load reproduction against `http://localhost:3100/planning/tasks/library` still worked
- Verification:
  - `cmd /c npm run build --workspace @mission/web`
  - Playwright smoke check: login -> `/planning` -> click `作战任务库` -> confirmed final URL `/planning/tasks/library` and visible task cards
- Remaining risk:
  - the automatic recovery only applies after the browser has loaded the updated router bundle at least once; a currently open stale tab may still need one manual refresh before the new safeguard is active

1. `作战目标自动分配` now has a real platform-level allocation runtime with strict/standard validation and richer result visualization.
   - Files:
     - `apps/server/src/planning-runtime.js`
     - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
     - `apps/web/src/views/planning/PlanningAlgorithmsStep.vue`
     - `README.md`
   - Notes:
     - target allocation no longer truncates candidate targets to the top 8; all threat-derived candidate targets remain available to the solver
     - the runtime now flattens grouping output into per-platform profiles with group context, range, readiness, per-platform assignment capacity, and per-group load limits instead of treating the whole group as one platform
     - `validationMode` now affects actual runtime thresholds through `strict` / `standard` validation profiles, including high-priority coverage, minimum match score, minimum feasibility, and max reach utilization
     - `hungarian` is now a multi-wave global matching solver, `ant-colony` is now a pheromone-based collaborative constructor, and `multi-objective` now uses Pareto-style population search instead of a single greedy pass
     - output now includes `groups`, `validationProfile`, `validationSummary`, platform/group load summaries, per-target coverage summaries, package progress, feasibility, distance, and richer adjustment suggestions
     - task execution UI now shows `可用平台` / `涉及编组`, richer algorithm comparison columns, per-assignment group/feasibility/distance/package fields, and a dedicated target-coverage summary table
     - algorithm option label `单群组最大任务数` was renamed to `单编组最大分配数` to match the runtime semantics
   - Verification:
     - `node --check apps/server/src/planning-runtime.js`
     - `cmd /c npm run build --workspace @mission/server`
     - `cmd /c npm run build --workspace @mission/web`
     - black-box `evaluatePlanning()` check via `node --input-type=module` with a mock `fire-strike-task` dataset
   - Observed result:
     - the black-box sample produced `candidateTargets=5`, `platforms=5`, `groups=4`
     - all three target-allocation methods were returned in `comparedPlans`
     - the strict sample selected `multi-objective` as the preferred plan and returned validation findings instead of silently emitting a low-quality allocation
   - Remaining risk:
     - strict validation is intentionally conservative; sparse demo datasets may yield very few assignments when range and feasibility are poor
     - no browser-driven interaction regression was run for the richer allocation tables, only the Vue production build path

2. Planning algorithm library now defaults to a compact algorithm list and only expands the full configuration card after an algorithm is selected; task-library stage headers now use explicit previous/next step actions.
   - Files:
     - `apps/web/src/views/planning/PlanningAlgorithmsStep.vue`
     - `apps/web/src/views/planning/PlanningTaskLibraryStep.vue`
     - `apps/web/src/views/planning/PlanningTaskFlowStep.vue`
     - `apps/web/src/views/planning/PlanningTaskExecuteStep.vue`
     - `apps/web/src/styles.css`
   - Notes:
     - the algorithm page now renders concise list cards first, then switches into a dedicated full-card detail view for the selected algorithm instead of expanding the detail below the list
     - full algorithm inputs, built-in method selection, source/file configuration, and implementation lists are only shown inside that dedicated algorithm detail view
     - task-template / flow / execute headers now use explicit `previous` / `next` step labels consistently, with the first-step previous action disabled and the last-step next action disabled
     - the task-template page keeps the task-template creation action in a separate toolbar so the create flow remains available while the step navigation stays explicit
   - Verification:
     - `cmd /c npm run build --workspace @mission/web`
   - Remaining risk:
     - this pass validated the Vue compile/build path only; no browser screenshot or interaction regression was run for the new list/detail interaction and step buttons

Previous implementation pass completed on 2026-03-26:

1. Planning runtime now implements `作战方法自动规划`、`作战保障自动规划` 和 `机降地域优化选择` as real built-in algorithms.
   - Files:
     - `apps/server/src/planning-runtime.js`
   - Notes:
     - `method-planning` now compares `A*` / `Dijkstra` / `RRT` route plans and outputs routes, phases, key actions, and 3D globe entities
     - `support-planning` now derives ammo / fuel / maintenance / medical / airspace / command requirements, allocations, and matching analysis
     - new algorithm id: `airborne-landing-site-selection`
     - new built-in task template: `air-assault-task`
     - final planning result aggregation now exposes `airborneLandingSiteSelection` in `consolidatedOutputs`

2. Planning front end now exposes configuration and execution views for the new planning algorithms and visual outputs.
   - Files:
     - `apps/web/src/views/planning/PlanningAlgorithmsStep.vue`
     - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
     - `apps/web/src/components/PlanningThreatMapPanel.vue`
   - Notes:
     - algorithm config step now includes controls for landing-site bias, helicopter model, route preference, altitude profile, battle-damage expectation, reserve ratio, and airspace control
     - execution step now renders dedicated result sections for landing-site selection, method planning, and support planning
     - 3D planning panels now show order polylines because `orders` visibility is enabled in `PlanningThreatMapPanel`

3. Intelligence create/update routes now validate `sourceId` before writes and return structured JSON `400` errors for invalid or missing sources.
   - File:
     - `apps/server/src/index.js`
   - Notes:
     - shared source validation now lives in `resolveExistingSourceId()`
     - create/update routes also catch fallback foreign-key failures and avoid Express HTML error pages

4. Production startup now reuses the existing web build by default.
   - File:
     - `scripts/start-production.mjs`
   - Notes:
     - the launcher now builds `@mission/web` only when `apps/web/dist/client/index.html` is missing
     - forced rebuild is available through `MISSION_FORCE_WEB_BUILD=1`

5. Planning custom task templates now persist across refresh and re-initialization in the current browser.
   - File:
      - `apps/web/src/modules/planningWorkflow.js`
   - Notes:
      - custom templates are stored in browser `localStorage`
      - storage key: `mission-planning-custom-tasks`
      - persistence is browser-local only; templates are not stored in the server database

6. Planning task library now supports editing existing custom task templates after creation.
   - File:
      - `apps/web/src/views/planning/PlanningTaskLibraryStep.vue`
   - Notes:
      - custom task cards now expose an explicit edit action
      - the template dialog now switches between create/edit titles and submit labels
      - saving an edited custom task re-selects that template and routes back into the flow step

7. Enemy threat analysis now uses normal Chinese threat dictionaries so uploaded resource-library documents and local files can drive structured threat extraction instead of only influencing summaries.
   - Files:
     - `apps/server/src/planning-runtime.js`
     - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
     - `apps/web/src/components/CesiumGlobe.vue`
   - Notes:
     - threat intent, threat-node, deployment-direction, and base node extraction keywords were rewritten with readable Chinese terms
     - threat runtime now merges document-derived deployment sectors / fire coverage / air defense / recon early warning / anti-airborne facilities into the final structured output
     - execution panel now shows selected sources, imported files, applied options, and detailed node tables with evidence references
     - Cesium environment overlays now honor planning heatmap colors and layered threat styles from runtime metadata

8. Planning module navigation now treats `规划算法库` and `作战任务库` as parallel top-level submodules, while `作战任务库` internally follows `任务模板 -> 流程编排 -> 任务执行`.
   - Files:
     - `apps/web/src/views/PlanningView.vue`
     - `apps/web/src/views/planning/PlanningTasksStep.vue`
     - `apps/web/src/views/planning/PlanningTaskLibraryStep.vue`
   - Notes:
     - top-level previous/next step semantics between algorithm library and task library were removed
     - task-library sub-navigation now displays explicit stage ordering and locks later stages until a task template is selected
     - task-template view no longer jumps directly to execution from the first stage

9. Verification completed in this pass.
   - Commands / checks:
     - `cmd /c npm run build --workspace @mission/web`
     - `cmd /c npm run build --workspace @mission/server`
     - document-only black-box check via `node --input-type=module` calling `evaluatePlanning()` with a custom one-step task and an uploaded `.xlsx` file
   - Observed result:
     - with no database dataset and only the uploaded workbook, `enemy-threat-analysis` produced `deploymentSectors=1`, `fireCoverage=1`, `airDefenseSystem=1`, `reconEarlyWarning=1`, `antiAirborneFacilities=1`, `identifiedThreatNodeCount=4`
   - Remaining risk:
     - this pass explicitly verified the local `Excel/xlsx` upload path; `Word` / `PDF` / resource-library selections still rely on the same extraction pipeline but were not separately black-box tested in this pass

10. The earlier five fixes from the previous review pass remain in place.

11. `force-grouping` now has a substantially richer built-in implementation and the document-only upload path has been completed.
   - Files:
     - `apps/server/src/planning-runtime.js`
     - `apps/server/src/import-preview.js`
     - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
   - Notes:
     - grouping runtime now derives a rule-evidence bundle from selected sources, uploaded files, blue-force intelligence, and threat-analysis handoff
     - rule resolution now produces `resolvedRuleProfile`, `weightSummary`, `primarySignals`, `ruleEvidence`, and effective `actualGroupCount`
     - `genetic-optimization` is now a real iterative population-based solver with `optimizationMeta` and `optimizationTrace`
     - CSV import now decodes UTF-8 text through the string path before workbook parsing, avoiding mojibake in uploaded grouping source files
     - document-derived grouping candidates are now extracted per row/segment instead of per whole sheet, so doc-only uploads can form multi-group schemes
     - task execution UI now shows grouping input summary, rule-profile weights/signals, selected/uploaded file tables, and richer comparison details
   - Verification:
     - `node --check apps/server/src/planning-runtime.js`
     - `node --check apps/server/src/import-preview.js`
     - `cmd /c npm run build --workspace @mission/web`
     - mixed-data black-box check via `node --input-type=module` calling `evaluatePlanning()` for a one-step `force-grouping` task
     - resource-library-only black-box check via `node --input-type=module`
     - document-only black-box check via `node --input-type=module`
     - observed result:
       - resource-library-only scenario: `selectedSourceCount=1`, `blueIntelligenceCount=20`, `actualGroupCount=4`, `preferredGroups=4`
       - mixed scenario with demo blue-force data plus an uploaded CSV: `candidateCount=63`, `documentCandidateCount=6`, `actualGroupCount=5`, and `preferredScheme.optimizationMeta` with `populationSize=30`, `generations=32`
       - document-only scenario with only an uploaded UTF-8 CSV: `blueIntelligenceCount=0`, `documentCandidateCount=5`, `actualGroupCount=4`, and `preferredGroups=['空中突击群','护航掩护群','侦察引导群','保障指挥群']`
   - Remaining risk:
     - Word / PDF local upload paths share the same planning upload framework, but this pass specifically black-box verified the `CSV` path for grouping rather than separately testing `Word` / `PDF`

12. Planning outputs now follow the `1 main storage + 3 export types` scheme, and `force-grouping` exposes a registry-based constraint-model extension point.
   - Files:
     - `apps/server/src/planning-runtime.js`
     - `apps/web/src/modules/planningWorkflow.js`
     - `apps/web/src/views/planning/PlanningAlgorithmsStep.vue`
     - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
   - Notes:
     - grouping runtime now registers constraint models in `GROUPING_CONSTRAINT_MODELS` and resolves evaluator functions through `GROUPING_CONSTRAINT_EVALUATORS`
     - built-in default model key: `baseline-constraints`
     - built-in default model label: `基础编组约束`
     - grouping results now expose `constraintModel`, `appliedOptions.constraintModelKey`, `constraintSummary`, per-scheme `constraintEvaluation`, and comparison-table constraint columns
     - planning runtime now builds `outputPackages` for:
       - `storageSnapshot` (`json`)
       - `reportExport` (`html`)
       - `spatialExport` (`geojson`)
       - `comparisonExport` (`csv`)
     - front-end planning workflow now supports saving the current result snapshot into browser `localStorage` and downloading each export package from the execution panel
     - result snapshot storage key: `mission-planning-result-history`
   - Verification:
     - `node --check apps/server/src/planning-runtime.js`
     - `node --check apps/web/src/modules/planningWorkflow.js`
     - `cmd /c npm run build --workspace @mission/server`
     - `cmd /c npm run build --workspace @mission/web`
     - black-box `evaluatePlanning()` spot check confirmed:
       - `outputPackages` keys: `storageSnapshot`, `reportExport`, `spatialExport`, `comparisonExport`
       - `storageSnapshot.format === 'json'`
       - `reportExport.format === 'html'`
       - `spatialExport.meta.featureCount === 60`
       - `comparisonExport.meta.rowCount === 13`
       - `forceGrouping.appliedOptions.constraintModelKey === 'baseline-constraints'`
       - `forceGrouping.constraintModel.label === '基础编组约束'`
       - `forceGrouping.constraintSummary.score === 68`
   - Remaining risk:
     - planning result snapshots are browser-local only and are not yet synchronized into a shared server-side result repository

13. Planning module UI copy has been normalized back to readable Chinese, removing the historical mojibake from the algorithm-config page, execution-results page, and shared planning error prompts.
   - Files:
     - `apps/web/src/views/planning/PlanningAlgorithmsStep.vue`
     - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
     - `apps/web/src/modules/planningWorkflow.js`
     - `README.md`
   - Notes:
     - the planning algorithm configuration page now uses Chinese labels for task name, source selection, local-file upload, algorithm preferences, and implementation status
     - the planning execution page now uses Chinese labels for result summary, threat/grouping/allocation/landing-site/method/support sections, export actions, and execution-step trace
     - grouping comparison headers were aligned with the rendered column count while cleaning the result table copy
     - shared planning workflow defaults and error prompts now return readable Chinese instead of garbled strings
   - Verification:
     - `node --check apps/web/src/modules/planningWorkflow.js`
     - `cmd /c npm run build --workspace @mission/web`
     - ad hoc `node -` string scan confirmed no remaining known mojibake markers in:
       - `apps/web/src/views/planning/PlanningAlgorithmsStep.vue`
       - `apps/web/src/components/PlanningTaskExecutionPanel.vue`
       - `apps/web/src/modules/planningWorkflow.js`
   - Remaining risk:
     - this pass focused on planning-module interface text; it did not perform a full browser screenshot regression across unrelated modules

Previously resolved items:

1. Demo seed records no longer overwrite existing user-edited records on every startup.
   - File: `apps/server/src/db.js`
   - Change: startup seeding for `sources`, `source_contents`, `intelligence`, `environment`, and `extractions` now uses `INSERT OR IGNORE` instead of `INSERT OR REPLACE`.

2. Action evaluation now follows the declared task topology instead of raw node array order.
   - File: `apps/server/src/action.js`
   - Change: `evaluateScheme()` now executes node prediction against `topologicalSort(task.nodes, task.links).order`.

3. The misleading AHP "consistency check" has been replaced by a weight-structure summary in the UI flow.
   - Files:
     - `apps/server/src/capability.js`
     - `apps/web/src/modules/capabilityWorkflow.js`
   - Change: AHP results now expose `weightSummary`; the workflow insight card now shows group count and max dominant weight instead of fake CR values.

4. Knowledge-graph search now uses normalized matching.
   - File: `apps/server/src/db.js`
   - Change: `filterKnowledgeGraph()` now normalizes both the query and node text through `normalizeGraphText()`.

5. Capability and action modules now support external Python/C++ HTTP engines in the same style as the consumption module.
   - Files:
     - `apps/server/src/capability.js`
     - `apps/server/src/action.js`
     - `apps/server/src/index.js`
   - Change:
     - both templates build engine catalogs dynamically from environment variables
     - both evaluate routes are now async and can await remote engines
     - both server modules can POST `{ module, payload }` to external services

## Architecture Snapshot

- Monorepo root:
  - `AGENTS.md`
  - `agent.md`
  - `README.md`
  - `package.json`
  - workspaces: `apps/web`, `apps/server`

- Front end:
  - stack: Vue 3, Vue Router, ECharts, Cesium
  - router: `apps/web/src/router/index.js`
  - API wrapper: `apps/web/src/api.js`

- Back end:
  - stack: Express + SQLite
  - server entry: `apps/server/src/index.js`
  - database and data-service logic: `apps/server/src/db.js`
  - import preview parsing: `apps/server/src/import-preview.js`
  - planning runtime: `apps/server/src/planning-runtime.js`

- Production serving path:
  - Vite build output: `apps/web/dist/client`
  - server static lookup: `apps/server/src/index.js`
  - production launcher: `scripts/start-production.mjs`

## Main Front-End Entry Points

- Data service view:
  - `apps/web/src/views/DataServiceView.vue`
  - main workbench: `apps/web/src/components/ResourceWorkbench.vue`

- Capability flow:
  - `apps/web/src/views/CapabilityView.vue`
  - state module: `apps/web/src/modules/capabilityWorkflow.js`

- Action flow:
  - `apps/web/src/views/ActionView.vue`
  - state module: `apps/web/src/modules/actionWorkflow.js`

- Consumption flow:
  - `apps/web/src/views/ConsumptionView.vue`
  - state module: `apps/web/src/modules/consumptionWorkflow.js`

- Planning flow:
  - `apps/web/src/views/PlanningView.vue`
  - state module: `apps/web/src/modules/planningWorkflow.js`
  - algorithm config step: `apps/web/src/views/planning/PlanningAlgorithmsStep.vue`
  - task library step: `apps/web/src/views/planning/PlanningTaskLibraryStep.vue`
  - task execution step: `apps/web/src/views/planning/PlanningTaskExecuteStep.vue`
  - execution overview: `apps/web/src/views/planning/PlanningTaskExecutionOverview.vue`
  - execution result step: `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`
  - 3D planning panel: `apps/web/src/components/PlanningThreatMapPanel.vue`

## Main Back-End API Entry Points

- Capability:
  - `GET /api/capability/template`
  - `POST /api/capability/evaluate`

- Action:
  - `GET /api/action/template`
  - `POST /api/action/evaluate`

- Consumption:
  - `GET /api/consumption/template`
  - `POST /api/consumption/evaluate`

- Planning:
  - `GET /api/planning/template`
  - `POST /api/planning/evaluate`

- Data service:
  - `GET /api/overview`
  - `GET /api/resource-sources`
  - `GET /api/resource-sources/:id/preview`
  - `POST /api/resource-sources/import`
  - `DELETE /api/resource-sources/:id`
  - `GET /api/intelligence`
  - `POST /api/intelligence`
  - `PUT /api/intelligence/:id`
  - `DELETE /api/intelligence/:id`
  - `GET /api/environment`
  - `POST /api/environment`
  - `PUT /api/environment/:id`
  - `DELETE /api/environment/:id`
  - `GET /api/extractions`
  - `GET /api/knowledge-graph`
  - `GET /api/situation-entities`
  - `POST /api/situation-entities`
  - `PUT /api/situation-entities/:id`
  - `DELETE /api/situation-entities/:id`

## External Engine Integration

Capability module:

- env vars:
  - `CAPABILITY_PYTHON_URL`
  - `CAPABILITY_CPP_URL`
- server file:
  - `apps/server/src/capability.js`

Action module:

- env vars:
  - `ACTION_PYTHON_URL`
  - `ACTION_CPP_URL`
- server file:
  - `apps/server/src/action.js`

Consumption module:

- env vars:
  - `CONSUMPTION_PYTHON_URL`
  - `CONSUMPTION_CPP_URL`
- server file:
  - `apps/server/src/consumption.js`

Planning module:

- current state:
  - no external planning project is registered
  - `apps/planning-python` and the previous `tactical-visualizer2.0` adapter have been removed
  - `enemy-threat-analysis` and the other planning algorithms default to built-in variants
- server file:
  - `apps/server/src/planning-runtime.js`
- future integration note:
  - register new planning projects through `PLANNING_EXTERNAL_ALGORITHM_PROJECTS`
  - provide project name, supported algorithm ids, gateway env vars, parameter schema, and default options
  - old persisted planning bindings that no longer match a registered variant fall back to the first available built-in variant

Current HTTP contract used by all externally-routed engines:

- request:
  - method: `POST`
  - content-type: `application/json`
  - body shape:

```json
{
  "module": "capability-calculation | action-calculation | consumption-calculation",
  "payload": {}
}
```

- expectation:
  - the external service returns the same JSON shape the front end already expects from the built-in engine for that module

## Suggested Reading Order For Future Agents

If the task is about data import, graph search, or stored records:

1. `apps/server/src/db.js`
2. `apps/server/src/index.js`
3. `apps/web/src/components/ResourceWorkbench.vue`
4. `apps/web/src/api.js`

If the task is about capability algorithms or weight handling:

1. `apps/server/src/capability.js`
2. `apps/web/src/modules/capabilityWorkflow.js`
3. `apps/web/src/views/capability/CapabilityResultsStep.vue`

If the task is about action-chain validation or prediction:

1. `apps/server/src/action.js`
2. `apps/web/src/modules/actionWorkflow.js`
3. `apps/web/src/views/action/ActionValidationStep.vue`
4. `apps/web/src/views/action/ActionResultsStep.vue`

If the task is about external engine integration:

1. `apps/server/src/consumption.js`
2. `apps/server/src/capability.js`
3. `apps/server/src/action.js`

If the task is about planning algorithms, task templates, or planning result rendering:

1. `apps/server/src/planning-runtime.js`
2. `apps/web/src/modules/planningWorkflow.js`
3. `apps/web/src/views/planning/PlanningTaskLibraryStep.vue`
4. `apps/web/src/views/planning/PlanningAlgorithmsStep.vue`
5. `apps/web/src/views/planning/PlanningTaskExecutionOverview.vue`
6. `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue`
7. `apps/web/src/components/PlanningThreatMapPanel.vue`

## Verification History

Build and syntax checks completed after the fixes:

- `node --check apps/server/src/index.js`
- `node --check apps/server/src/action.js`
- `node --check apps/server/src/capability.js`
- `npm run build --workspace @mission/server`
- `npm run build --workspace @mission/web`

Additional verification completed on 2026-03-26:

- build smoke checks:
  - `cmd /c npm run build --workspace @mission/web`
  - `cmd /c npm run build --workspace @mission/server`
- planning runtime syntax check:
  - `node --check apps/server/src/planning-runtime.js`
- planning runtime spot checks with a local `createDatabase()` instance:
  - evaluated `fire-strike-task`
  - evaluated `air-assault-task`
  - observed result summary:
    - fire-strike: `implementedSteps=5`, `placeholderSteps=0`, `methodRoutes=3`
    - air-assault: `implementedSteps=6`, `placeholderSteps=0`, `methodMissionType=air-assault`
- black-box API check with a temporary server on port `3111`:
  - confirmed invalid `sourceId` on `POST /api/intelligence` now returns JSON `400`
  - response shape now includes `{"message":"Source not found"}`
- production launcher check:
  - ad hoc runner started `scripts/start-production.mjs` with an existing `dist/client`
  - confirmed startup log contains `Reusing existing web build artifact at apps/web/dist/client.`
- planning custom task persistence check:
  - temporary Playwright flow created a custom planning task, reloaded `/planning/tasks/library`, and confirmed the task still existed
  - persistence scope confirmed as browser-local storage rather than server-side storage
- planning custom task edit check:
  - temporary production server launched on port `3113`
  - ad hoc Playwright flow created a custom planning task, reopened it from `/planning/tasks/library`, edited the template name/description, and confirmed the updated card rendered after save
  - temporary verification spec was deleted after the check

Targeted runtime checks completed:

- action topology check:
  - reversed node order in a custom task payload still evaluated in topological order
- capability result check:
  - `methods.ahp.weightSummary` exists
  - `methods.ahp.consistency === null`
- browser-side manual regression:
  - temporary runtime tooling installed for verification:
    - `npm install --no-save @playwright/test`
    - `cmd /c npx --yes playwright install chromium --only-shell`
  - ad hoc spec:
    - `.codex-manual-regression.spec.cjs`
  - executed command:
    - `cmd /c npx playwright test .codex-manual-regression.spec.cjs --reporter=line`
  - result:
    - `1 passed`
  - covered flows:
    - admin login
    - `/data-service`
    - data-service editor create/delete temp intelligence record
    - data-service graph search interaction
    - `/capability/evaluation/results` generate results
    - `/capability/action/results` generate results
    - `/capability/consumption/results` generate results
- black-box persistence experiment after editing sample data:
  - ad hoc script:
    - `.codex-persistence-check.mjs`
  - executed command:
    - `node .codex-persistence-check.mjs`
  - experiment method:
    - login through HTTP API
    - modify demo intelligence `id=101` and environment `id=301`
    - verify edits before restart
    - kill and restart `apps/server/src/index.js`
    - verify both edits persisted across restart
    - restore both records to their pre-test baseline
    - restart again and verify the restore also persisted
  - result:
    - passed with process exit code `0`
    - current health endpoint still reports `{"ok":true,"message":"mission-learning-sandbox api ready"}`

## Remaining Gaps

- No automated unit/integration test suite exists yet for these modules.
- Manual browser regression and persistence verification currently rely on ad hoc `.codex-*` scripts rather than committed regression tests.
- Planning custom task templates persist only in the current browser's `localStorage`; they are not shared across users, machines, or browsers.
- The new planning algorithms are heuristic built-in demo models; they are not yet connected to calibrated terrain cost layers, external simulators, or real logistics resource systems.
- Production startup now reuses existing web builds, but deployment is still oriented toward local demo usage rather than a fully separated CI build / runtime serve pipeline.

