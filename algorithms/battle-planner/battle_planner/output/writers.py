"""Write planning results to JSON, Markdown, and CSV."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Iterable, List, Union

from battle_planner.models import PlanResult, TaskGroup


def write_outputs(result: PlanResult, output_dir: Union[str, Path]) -> None:
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    _write_json(result, directory / "grouping_result.json")
    _write_markdown(result, directory / "grouping_result.md")
    _write_task_groups_csv(result, directory / "task_groups.csv")
    _write_remaining_csv(result, directory / "remaining_resources.csv")


def _write_json(result: PlanResult, path: Path) -> None:
    path.write_text(
        json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _write_markdown(result: PlanResult, path: Path) -> None:
    lines: List[str] = [
        "# 智能任务编组与兵力优化分配结果",
        "",
        f"- 生成时间：{result.generated_at}",
        f"- 总编组数量：{result.total_groups}",
        f"- 任务组数量：{len(result.task_groups)}",
    ]
    if result.warnings:
        lines.extend(["", "## 告警"])
        lines.extend(f"- {warning}" for warning in result.warnings)

    lines.extend(["", "## 目标处置"])
    for target, groups in _target_dispositions(result).items():
        lines.append(f"### {target}")
        for group in groups:
            lines.append(
                f"- 被 {group.group_id} {group.group_name} 执行 {group.task_type}；"
                f"处置方式：{group.disposition}；"
                f"平台：{_join_platforms(group.platforms)}；"
                f"武器：{_join_weapons(group.weapons)}；"
                f"人员：{_join_personnel(group.personnel)}；"
                f"预计效果：{group.expected_effect}"
            )

    lines.extend(["", "## 任务组"])
    for group in result.task_groups:
        lines.extend(_group_markdown(group))

    if result.reserve_group:
        lines.extend(["", "## 预备队"])
        lines.extend(_group_markdown(result.reserve_group))

    lines.extend(["", "## 剩余资源"])
    lines.append("### 直升机")
    lines.extend(f"- {name}：{count} 架" for name, count in result.remaining_resources.helicopters.items())
    lines.append("### 武器")
    lines.extend(f"- {name}：{count}" for name, count in result.remaining_resources.weapons.items())
    lines.append("### 人员")
    lines.extend(f"- {name}：{count} 名" for name, count in result.remaining_resources.personnel.items())
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _group_markdown(group: TaskGroup) -> List[str]:
    lines = [
        "",
        f"### {group.group_id} {group.group_name}",
        f"- 任务类型：{group.task_type}",
        f"- 负责目标：{', '.join(group.responsible_targets) if group.responsible_targets else '无'}",
        f"- 目标处置方式：{group.disposition}",
        f"- 预计效果：{group.expected_effect}",
        f"- 预计战损率：{group.estimated_loss_rate:.1%}",
        f"- 任务优先级：{group.priority}",
        f"- 支援关系：{', '.join(group.support_relations) if group.support_relations else '无'}",
        f"- 直升机平台组成：{_join_platforms(group.platforms)}",
        f"- 武器组成：{_join_weapons(group.weapons)}",
        f"- 人员组成：{_join_personnel(group.personnel)}",
    ]
    if group.issues:
        lines.append(f"- 未满足/降级项：{'; '.join(issue.message for issue in group.issues)}")
    return lines


def _target_dispositions(result: PlanResult) -> dict:
    grouped = {}
    for group in result.task_groups:
        for target in group.responsible_targets or ["无目标"]:
            grouped.setdefault(target, []).append(group)
    return grouped


def _join_platforms(platforms: Iterable) -> str:
    items = [f"{item.model} {item.count}架({item.role})" for item in platforms if item.count > 0]
    return "，".join(items) if items else "未分配"


def _join_weapons(weapons: Iterable) -> str:
    items = [f"{item.name} {item.quantity}" for item in weapons if item.quantity > 0]
    return "，".join(items) if items else "无"


def _join_personnel(personnel: Iterable) -> str:
    items = [f"{item.role} {item.count}名" for item in personnel if item.count > 0]
    return "，".join(items) if items else "无"


def _write_task_groups_csv(result: PlanResult, path: Path) -> None:
    rows = list(result.task_groups)
    if result.reserve_group:
        rows.append(result.reserve_group)
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=[
                "group_id",
                "group_name",
                "task_type",
                "targets",
                "disposition",
                "platforms",
                "weapons",
                "personnel",
                "expected_effect",
                "estimated_loss_rate",
                "priority",
                "support_relations",
                "issues",
            ],
        )
        writer.writeheader()
        for group in rows:
            writer.writerow(
                {
                    "group_id": group.group_id,
                    "group_name": group.group_name,
                    "task_type": group.task_type,
                    "targets": ";".join(group.responsible_targets),
                    "disposition": group.disposition,
                    "platforms": _join_platforms(group.platforms),
                    "weapons": _join_weapons(group.weapons),
                    "personnel": _join_personnel(group.personnel),
                    "expected_effect": group.expected_effect,
                    "estimated_loss_rate": group.estimated_loss_rate,
                    "priority": group.priority,
                    "support_relations": ";".join(group.support_relations),
                    "issues": ";".join(issue.message for issue in group.issues),
                }
            )


def _write_remaining_csv(result: PlanResult, path: Path) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["category", "name", "remaining"])
        writer.writeheader()
        for name, count in result.remaining_resources.helicopters.items():
            writer.writerow({"category": "helicopter", "name": name, "remaining": count})
        for name, count in result.remaining_resources.weapons.items():
            writer.writerow({"category": "weapon", "name": name, "remaining": count})
        for name, count in result.remaining_resources.personnel.items():
            writer.writerow({"category": "personnel", "name": name, "remaining": count})
