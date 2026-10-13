"""Long-term memory: remember / forget facts about the student."""

from agent.tools.context import ToolContext


async def _remember_fact(ctx: ToolContext, args: dict) -> dict:
    """Long-term memory"""
    user_id = ctx.user_id
    db = ctx.db
    from services.memory import remember
    return remember(db, user_id, str(args.get("text") or ""))


async def _forget_fact(ctx: ToolContext, args: dict) -> dict:
    user_id = ctx.user_id
    db = ctx.db
    from services.memory import forget
    return forget(db, user_id, text=str(args.get("text") or "") or None)


HANDLERS = {
    "remember_fact": _remember_fact,
    "forget_fact": _forget_fact,
}
