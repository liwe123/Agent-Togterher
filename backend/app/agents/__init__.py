"""Agent orchestration package.

Manager, Worker, Review, and Final Agent implementations will be added in a
later phase. Keeping the package now avoids coupling orchestration to HTTP code.
"""
"""Role-specific building blocks for the multi-Agent workflow."""

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
