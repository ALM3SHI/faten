from typing import List, Dict, Any, Optional
from pydantic import BaseModel

class NavRouteRequest(BaseModel):
    fromRoom: str = ""
    fromNode: str = ""
    toRoom: str = ""
    accessible: bool = False

class NavStep(BaseModel):
    text: str
    icon: str

class NavRouteResponse(BaseModel):
    nodeIds: List[str]
    distanceMeters: int
    estimatedTime: str
    steps: List[NavStep]
    points: List[Dict[str, Any]]
