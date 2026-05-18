"""
================================================================
UQU Academic Assistant — Common Pydantic Schemas
================================================================
"""

from pydantic import BaseModel


class SuccessResponse(BaseModel):
    """Standard success response."""
    success: bool = True


class ErrorResponse(BaseModel):
    """Standard error response."""
    error: str
