"""End-to-end planning pipeline."""

from __future__ import annotations

from pathlib import Path
from typing import Optional, Sequence, Union

from battle_planner.io import load_config, read_enemy_situations, read_friendly_documents
from battle_planner.llm import LLMClient, build_llm_client
from battle_planner.models import AppConfig, PlanResult
from battle_planner.output import write_outputs
from battle_planner.pipeline.normalization import normalize_disposition_rules, normalize_friendly_forces
from battle_planner.planning import ResourcePool, TaskAssigner, TaskRequirementGenerator
from battle_planner.progress import count_friendly_unit_objects, count_friendly_unit_objects_in_text, emit_progress


class PlanningPipeline:
    def __init__(self, config: AppConfig, llm_client: Optional[LLMClient] = None):
        self.config = config
        self.llm_client = llm_client or build_llm_client(config)
        self.requirement_generator = TaskRequirementGenerator(config.algorithm)
        self.task_assigner = TaskAssigner()

    @classmethod
    def from_config(cls, path: str) -> "PlanningPipeline":
        return cls(load_config(path))

    def run(
        self,
        enemy_file: Optional[str] = None,
        friendly_file: Optional[str] = None,
        output_dir: Optional[str] = None,
        enemy_files: Optional[Sequence[Union[str, Path]]] = None,
        friendly_files: Optional[Sequence[Union[str, Path]]] = None,
    ) -> PlanResult:
        resolved_enemy_files = _resolve_files(enemy_file, enemy_files, "敌情威胁 JSON")
        resolved_friendly_files = _resolve_files(friendly_file, friendly_files, "己方信息文档")

        emit_progress(2, "preparse", "正在预解析敌情与我方资料")
        enemy = read_enemy_situations(resolved_enemy_files)
        friendly_document = read_friendly_documents(resolved_friendly_files)
        emit_progress(
            6,
            "preparse",
            "敌情与我方资料预解析完成",
            message=f"已载入 {len(resolved_enemy_files)} 份敌情文件和 {len(resolved_friendly_files)} 份我方资料。",
        )

        friendly_unit_total = self.llm_client.count_friendly_units(friendly_document)
        emit_progress(
            10,
            "unit-count",
            "已完成我方单位总数预解析",
            unit_progress={
                "kind": "friendly",
                "total": friendly_unit_total,
                "completed": 0,
                "currentName": "",
            },
            message=f"我方单位对象总数预估为 {friendly_unit_total} 个。",
        )

        emit_progress(18, "structured-generation", "正在生成敌方目标处置规则")
        raw_rules = self.llm_client.extract_disposition_rules(enemy.targets)
        rules, rule_warnings = normalize_disposition_rules(raw_rules, enemy.targets)
        emit_progress(
            30,
            "structured-generation",
            "敌方目标处置规则生成完成，正在解析我方单位结构",
            unit_progress={
                "kind": "friendly",
                "total": friendly_unit_total,
                "completed": 0,
                "currentName": "",
            },
        )

        friendly_progress = _FriendlyStreamProgress(friendly_unit_total)
        raw_friendly = self.llm_client.generate_friendly_structure(
            friendly_document,
            enemy.targets,
            rules,
            progress_callback=friendly_progress.update,
        )
        friendly_progress.finish(count_friendly_unit_objects(raw_friendly))
        friendly = normalize_friendly_forces(raw_friendly, friendly_document, self.config.algorithm)

        emit_progress(92, "artifact-generation", "正在生成编组方案产物")
        requirements = self.requirement_generator.generate(enemy.targets, rules, friendly)
        pool = ResourcePool(friendly)
        result = self.task_assigner.assign(requirements, pool)
        result.warnings = rule_warnings + friendly.warnings + result.warnings
        result.metadata.update(
            {
                "enemy_file": str(Path(resolved_enemy_files[0])),
                "friendly_file": str(Path(resolved_friendly_files[0])),
                "enemy_files": [str(Path(path)) for path in resolved_enemy_files],
                "friendly_files": [str(Path(path)) for path in resolved_friendly_files],
                "enemy_file_count": len(resolved_enemy_files),
                "friendly_file_count": len(resolved_friendly_files),
                "llm_provider": self.config.llm.provider,
                "task_requirement_count": len(requirements),
            }
        )

        if output_dir:
            write_outputs(result, output_dir)
        emit_progress(100, "artifact-generation", "编组方案产物生成完成")
        return result


class _FriendlyStreamProgress:
    def __init__(self, estimated_total: int):
        self.total = max(0, int(estimated_total or 0))
        self.completed = 0

    def update(self, content: str) -> None:
        completed = count_friendly_unit_objects_in_text(content)
        if completed <= self.completed:
            return
        self.completed = completed
        self.total = max(self.total, self.completed)
        step_progress = 30 + (60 * self.completed / max(1, self.total))
        emit_progress(
            min(step_progress, 90),
            "structured-generation",
            "正在解析我方单位结构化信息",
            unit_progress={
                "kind": "friendly",
                "total": self.total,
                "completed": self.completed,
                "currentName": "",
            },
        )

    def finish(self, actual_total: int) -> None:
        self.total = max(self.total, int(actual_total or 0), self.completed)
        self.completed = max(self.completed, int(actual_total or 0))
        emit_progress(
            90,
            "structured-generation",
            "我方单位结构化信息解析完成",
            unit_progress={
                "kind": "friendly",
                "total": self.total,
                "completed": self.completed,
                "currentName": "",
            },
        )


def _resolve_files(
    single_file: Optional[str],
    multiple_files: Optional[Sequence[Union[str, Path]]],
    label: str,
) -> Sequence[Union[str, Path]]:
    if multiple_files:
        return multiple_files
    if single_file:
        return [single_file]
    raise ValueError(f"缺少{label}文件")
