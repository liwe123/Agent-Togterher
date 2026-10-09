"""Agent orchestration package.

Role-specific building blocks for the multi-Agent workflow: manager planning,
worker execution, review and final-result assembly. Keeping the package boundary
avoids coupling orchestration to HTTP code.
"""

from app.agents.final_agent import build_final_result
from app.agents.manager_agent import (
    ManagerPlan,
    ManagerPlanError,
    ManagerSubtask,
    generate_plan,
    parse_manager_plan,
    serialize_manager_plan,
)
from app.agents.review_agent import review_results
from app.agents.worker_agent import execute_subtask, worker_name_for_task_type

__all__ = [
    "ManagerPlan",
    "ManagerPlanError",
    "ManagerSubtask",
    "build_final_result",
    "execute_subtask",
    "generate_plan",
    "parse_manager_plan",
    "review_results",
    "serialize_manager_plan",
    "worker_name_for_task_type",
]
