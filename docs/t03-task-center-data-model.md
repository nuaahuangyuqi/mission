# T03 总任务中心数据模型设计（首版草案）

更新时间：2026-04-01  
涉及代码上下文：

- `apps/server/src/db.js`（现有 SQLite 表）
- `apps/server/src/index.js`（现有 API 与鉴权）
- `apps/server/src/planning.js` / `planning-runtime.js`（规划任务模板与执行链路）

## 设计目标

1. 建立“任务（task）”为一级主对象，统一归属规划、能力、行动、消耗数据。
2. 支持一个任务：
- 多次执行（`task_runs`）
- 多个版本（`task_versions`）
- 多次审批记录（`task_approvals`）
3. 与现有 `users`、鉴权会话、规划执行输出兼容，支持后续把前端 `localStorage` 数据迁移到服务端。

## 实体关系（ER）

- `tasks` 1 - N `task_templates`
- `tasks` 1 - N `task_versions`
- `task_versions` 1 - N `task_runs`
- `task_runs` 1 - N `task_results`
- `task_versions` 1 - N `task_approvals`
- `tasks/task_versions/task_runs/task_approvals` 1 - N `task_attachments`
- `audit_logs` 记录上述所有实体的变更轨迹

## 表草案清单

- `tasks`
- `task_templates`
- `task_versions`
- `task_runs`
- `task_results`
- `task_approvals`
- `task_attachments`
- `audit_logs`

完整 SQL 草案见：[t03-task-center-schema-draft.sql](/d:/mission/docs/t03-task-center-schema-draft.sql)。

## 关键字段覆盖（验收对齐）

1. 主键与外键：
- 所有表均有主键 `id`。
- `task_templates.task_id`、`task_versions.task_id`、`task_runs.task_id/version_id`、`task_results.run_id` 等均建立外键。

2. 状态字段：
- `tasks.status`、`task_versions.status`、`task_runs.status`、`task_results.status`、`task_approvals.status`。

3. 创建/更新时间：
- 各表统一包含 `created_at`、`updated_at`（审批与执行表另含 `requested_at/decided_at`、`started_at/finished_at`）。

4. 责任人（owner）：
- `tasks.owner_user_id` 作为任务归属责任人。
- 版本、执行、审批、附件均带 `created_by/triggered_by/approver_user_id/uploaded_by`。

5. 版本号：
- `task_templates.version_no`、`task_versions.version_no`、`task_runs.run_no`。
- 通过 `UNIQUE(task_id, version_no)` 与 `UNIQUE(task_id, run_no)` 保证序列唯一。

6. 支持多执行、多版本、多审批：
- 单任务可关联多个 `task_versions` 和 `task_runs`。
- `task_approvals` 可按阶段多条累计，不覆盖历史。

## 与现有规划链路的映射建议

1. 现有 `planning-runtime` 的 `taskDefinition` / `taskId`：
- 映射到 `tasks + task_versions + task_templates`。

2. 现有执行响应中的 `execution.steps`、`result.outputPackages`：
- 映射到 `task_runs + task_results + task_attachments`。

3. 前端“保存结果快照”动作：
- 从浏览器 `localStorage` 写入迁移为 `POST /api/tasks/:taskId/runs/:runId/results`。

## API 初稿（建议）

- `GET /api/tasks`
- `POST /api/tasks`
- `GET /api/tasks/:taskId`
- `GET /api/tasks/:taskId/versions`
- `POST /api/tasks/:taskId/versions`
- `POST /api/tasks/:taskId/runs`
- `GET /api/tasks/:taskId/runs`
- `GET /api/tasks/:taskId/runs/:runId/results`
- `POST /api/tasks/:taskId/versions/:versionId/approvals`
- `GET /api/audit-logs?entityType=task&entityId=...`

## 风险与边界

- 本次为“首版模型草案”，尚未落库到 `db.js` 与 `index.js` 运行路径。
- 当前仓库仍以演示数据结构为主，真实落地需补充迁移脚本、回填策略、接口鉴权细化与回归测试。

