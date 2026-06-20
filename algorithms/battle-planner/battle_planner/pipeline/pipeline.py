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

        enemy = read_enemy_situations(resolved_enemy_files)
        friendly_document = read_friendly_documents(resolved_friendly_files)

        raw_rules = self.llm_client.extract_disposition_rules(enemy.targets)
        rules, rule_warnings = normalize_disposition_rules(raw_rules, enemy.targets)

        raw_friendly = self.llm_client.generate_friendly_structure(friendly_document, enemy.targets, rules)
        friendly = normalize_friendly_forces(raw_friendly, friendly_document, self.config.algorithm)

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
        return result


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
