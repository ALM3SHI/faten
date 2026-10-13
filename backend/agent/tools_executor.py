"""
================================================================
UQU AGENT — Tools Executor
================================================================
Single entry point for agent tool calls. The tools themselves live in
agent/tools/, one module per group (regulations, schedule, gpa, student,
memory); this module only routes a call to its handler.
All GPA values operate on the official UQU 4.00 scale.
"""

from datetime import datetime, timezone

from agent.tools import gpa, memory, regulations, schedule, student
from agent.tools.context import ToolContext

TOOL_HANDLERS = {
    **regulations.HANDLERS,
    **schedule.HANDLERS,
    **gpa.HANDLERS,
    **student.HANDLERS,
    **memory.HANDLERS,
}


async def execute_tool(
    tool_name: str,
    args: dict,
    user_id: str,
    db
) -> dict:
    """Execute a tool call (writing to Firestore where the tool does).

    Args:
        tool_name: Name of the tool to execute
        args: Parsed arguments from the AI model
        user_id: Firebase user ID
        db: Firestore client

    Returns:
        Result dict sent back to the AI model
    """
    ctx = ToolContext(
        tool_name=tool_name,
        user_id=user_id,
        db=db,
        user_ref=db.collection("users").document(user_id),
        now_iso=datetime.now(timezone.utc).isoformat(),
    )
    handler = TOOL_HANDLERS.get(tool_name)
    if handler is None:
        return {"success": False, "message": f"أداة غير معروفة: {tool_name}"}
    return await handler(ctx, args)
