"""
================================================================
UQU Academic Assistant — Tools Execution Router
================================================================
Exposes an endpoint for the frontend to manually trigger a tool
execution on the backend. Allows JS "hands" to use Python "brain".
"""

import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth.dependencies import get_current_user_optional
from db.firestore import get_db
from agent.tools_executor import execute_tool

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tools", tags=["Tools"])

class ExecuteToolRequest(BaseModel):
    tool_name: str
    args: dict[str, Any]

class ExecuteToolResponse(BaseModel):
    success: bool
    result: dict[str, Any]

@router.post("/execute", response_model=ExecuteToolResponse)
async def execute_tool_endpoint(
    body: ExecuteToolRequest,
    user_id: str = Depends(get_current_user_optional),
):
    """Execute a single agent tool directly from the frontend."""
    try:
        db = get_db()
        result = await execute_tool(body.tool_name, body.args, user_id, db)
        return ExecuteToolResponse(
            success=result.get("success", True),
            result=result
        )
    except Exception as err:
        logger.error(f"[execute_tool_endpoint] {err}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(err))
