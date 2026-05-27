# T02 浏览器本地存储盘点与迁移清单

更新时间：2026-04-01  
范围文件：

- `apps/web/src/modules/planningWorkflow.js`
- `apps/web/src/modules/capabilityWorkflow.js`
- `apps/web/src/modules/calculationSharedTask.js`
- `apps/web/src/auth.js`

## 迁移结论

- `任务模板、共同任务、规划结果快照、正式任务状态` 均标记为 **必须服务端化**。
- 仅保留少量纯 UI 偏好（如面板折叠状态）在前端。

## 存储项清单

| 存储项（key） | 文件/模块 | 当前用途 | 数据属性 | 风险级别 | 迁移优先级 | 目标服务端实体 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `mission-planning-custom-tasks` | `planningWorkflow.js` | 保存自定义任务模板（步骤、输入输出、默认绑定） | 业务数据 | 高 | P0 | `task_templates`、`task_versions`、`tasks` | 必须服务端化 |
| `mission-planning-result-history` | `planningWorkflow.js` | 保存规划结果快照历史（用于结果页回看） | 业务数据 | 高 | P0 | `task_runs`、`task_results`、`task_attachments` | 必须服务端化 |
| `mission-capability-workflow-v2` | `capabilityWorkflow.js` | 保存能力任务、指标树、方案分值、版本、模板库 | 业务数据 | 高 | P0 | `tasks`、`task_versions`、`task_templates`、`task_results` | 必须服务端化 |
| `mission-calculation-shared-task-v1` | `calculationSharedTask.js` | 共同任务基线（任务类型、敌我装备、目标说明） | 业务数据 | 高 | P0 | `tasks`、`task_versions` | 必须服务端化 |
| `mission-calculation-shared-task-panel-v1` | `calculationSharedTask.js` | 共同任务面板展开/折叠状态 | UI 偏好 | 低 | P2 | 可选：`user_preferences`（或继续前端） | 允许前端保留 |
| `mission-auth-session` | `auth.js` | 保存 token 和 user 信息 | 会话安全数据 | 高 | P0 | `user_sessions`（服务端）+ `HttpOnly Cookie` | 必须服务端化（前端禁存 token） |

## 迁移兼容策略（避免历史数据丢失）

1. 双读阶段（1 个版本窗口）：
`server-first` 读取；若服务端无数据，再回退读取旧 `localStorage`。

2. 首次登录一次性迁移：
检测旧 key 存在时，将可迁移业务数据打包 `POST /api/storage-migrations/bootstrap`，由服务端落库并返回迁移批次号。

3. 幂等与冲突规则：
按 `updated_at` / `version_no` 进行幂等 upsert；同名模板冲突时保留最新版本并写入 `audit_logs`。

4. 迁移成功后的降级读取：
成功后保留只读兜底 1 个版本；出现服务端不可达时允许只读回退，不允许继续写入旧 key。

5. 清理阶段：
版本窗口结束后删除已迁移业务 key，仅保留允许前端持久化的 UI 偏好 key。

## 建议接口最小集

- `POST /api/storage-migrations/bootstrap`：上传旧浏览器业务数据并返回迁移结果。
- `GET /api/tasks?module=planning|capability`：按用户读取任务列表。
- `GET /api/tasks/:taskId/versions`：读取任务版本。
- `GET /api/tasks/:taskId/runs`：读取执行批次与结果快照。

