"""Task assignment module.

This module is intentionally thin in v1: it owns the assignment step and
delegates optimization details to the selected optimizer. Keeping this boundary
separate makes it straightforward to add scheduling-aware assignment later
without changing upstream parsing or requirement generation.
"""

from __future__ import annotations

from typing import List, Optional

from battle_planner.models import PlanResult, TaskRequirement
from battle_planner.planning.optimizer import HybridGroupingOptimizer, Optimizer
from battle_planner.planning.resources import ResourcePool


class TaskAssigner:
    def __init__(self, optimizer: Optional[Optimizer] = None):
        self._optimizer = optimizer or HybridGroupingOptimizer()

    def assign(self, requirements: List[TaskRequirement], pool: ResourcePool) -> PlanResult:
        return self._optimizer.optimize(requirements, pool)

