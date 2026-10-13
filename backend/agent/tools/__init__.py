"""Agent tool implementations, one module per group.

    regulations — calendar, courses, reviews, regulations search, news
    schedule    — exams, study plans and tasks, client actions, attendance
    gpa         — transcript analysis, GPA pathway/history, grade updates
    student     — profile, preferences, courses, notifications, navigation
    memory      — long-term memory

Each module exposes HANDLERS: {tool_name: async handler(ctx, args)}. The
single entry point is agent.tools_executor.execute_tool.
"""
