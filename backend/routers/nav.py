from fastapi import APIRouter, HTTPException
from schemas.navigation import NavRouteRequest, NavRouteResponse
from services.navigation import NavigationService

router = APIRouter(prefix="/api/nav", tags=["Navigation"])
nav_service = NavigationService()

@router.post("/route", response_model=NavRouteResponse)
async def get_route(request: NavRouteRequest):
    """
    Calculate the shortest path between two rooms or nodes.
    """
    try:
        print(f"DEBUG: Nav Request -> fromRoom='{request.fromRoom}', fromNode='{request.fromNode}', toRoom='{request.toRoom}'")
        result = nav_service.find_path(
            from_room_id=request.fromRoom,
            to_room_id=request.toRoom,
            accessible=request.accessible,
            from_node_id=request.fromNode
        )
        
        if not result:
            print(f"DEBUG: No path found for the given parameters.")
            raise HTTPException(status_code=404, detail="لم يتم العثور على مسار بين النقطتين")
            
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"DEBUG: Navigation Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
@router.get("/status")
async def get_status():
    """Check the status of the navigation engine."""
    return {
        "loaded": len(nav_service.map_data) > 0,
        "built": nav_service._built,
        "rooms_count": len(nav_service.map_data),
        "nodes_count": len(nav_service.nodes),
        "adjacency_entries": len(nav_service.adj)
    }

@router.post("/reload")
async def reload_navigation():
    """Manually reload navigation data."""
    nav_service.reload_data()
    return {"status": "reloaded", "rooms": len(nav_service.map_data)}
