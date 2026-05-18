import math
import json
import os
import heapq
import re
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path

METERS_PER_UNIT = 1.2
WALK_SPEED_MPS = 1.2

class NavigationService:
    def __init__(self):
        self.nodes = {}  # nodeId -> { x, y, roomId?, type }
        self.adj = {}    # nodeId -> [{ to, weight, accessible }]
        self.map_data = []
        self.nav_graph = {"nodes": {}, "edges": []}
        self._built = False
        self.reload_data()

    def reload_data(self):
        """Force a reload of data from JSON and rebuild the graph."""
        self._load_data()
        self._built = False
        if self.map_data:
            self.build_graph()

    def _load_data(self):
        """
        Load navigation data from the standard JSON file.
        This is the guaranteed way to ensure data integrity.
        """
        try:
            # Determine path to assets/map-data.json
            current_dir = os.path.dirname(os.path.abspath(__file__))
            backend_dir = os.path.dirname(current_dir)
            root_dir = os.path.dirname(backend_dir)
            json_path = os.path.join(root_dir, "assets", "map-data.json")
            
            if not os.path.exists(json_path):
                print(f"DEBUG: Navigation JSON not found at {json_path}")
                # Fallback: try to load from JS if JSON is missing (legacy support)
                return

            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                self.map_data = data.get("mapData", [])
                self.nav_graph = data.get("navGraph", {"nodes": {}, "edges": []})
            
            if self.map_data:
                print(f"DEBUG: [OK] Navigation data loaded from JSON ({len(self.map_data)} rooms)")
            
        except Exception as e:
            print(f"DEBUG: [ERROR] JSON Loading Error: {e}")
            self.map_data = []
            self.nav_graph = {"nodes": {}, "edges": []}

    def build_graph(self):
        if not self.map_data:
            self._load_data()
            if not self.map_data:
                return

        self.nodes = {}
        self.adj = {}

        # 1. Create door nodes from MAP_DATA
        for room in self.map_data:
            doors = room.get("doors", [])
            for door in doors:
                node_id = f"{room['id']}__{door['id']}"
                self.nodes[node_id] = {
                    "x": door["x"],
                    "y": door["y"],
                    "roomId": room["id"],
                    "type": "stairs" if room.get("type") == "stairs" else "door"
                }

        # 2. Merge manually-defined waypoint nodes
        for node_id, node_data in self.nav_graph.get("nodes", {}).items():
            self.nodes[node_id] = node_data.copy()

        # 3. Build adjacency list from edges
        for node_id in self.nodes:
            self.adj[node_id] = []

        for edge in self.nav_graph.get("edges", []):
            u = edge["from"]
            v = edge["to"]
            if u not in self.nodes or v not in self.nodes:
                continue

            node_a = self.nodes[u]
            node_b = self.nodes[v]

            weight = edge.get("weight")
            if weight is None:
                weight = math.hypot(node_a["x"] - node_b["x"], node_a["y"] - node_b["y"])

            accessible = edge.get("accessible", True)

            self.adj[u].append({"to": v, "weight": weight, "accessible": accessible})
            if not edge.get("oneWay", False):
                self.adj[v].append({"to": u, "weight": weight, "accessible": accessible})

        # 4. Auto-snap doors
        self._auto_snap_doors()
        self._built = True
        print(f"DEBUG: Graph built. Nodes: {len(self.nodes)}, Adjacency list entries: {len(self.adj)}")

    def _project_point_on_segment(self, px, py, ax, ay, bx, by):
        dx = bx - ax
        dy = by - ay
        len_sq = dx * dx + dy * dy
        if len_sq == 0:
            return {"x": ax, "y": ay, "dist": math.hypot(px - ax, py - ay), "t": 0}
        t = ((px - ax) * dx + (py - ay) * dy) / len_sq
        t = max(0, min(1, t))
        cx = ax + t * dx
        cy = ay + t * dy
        return {"x": cx, "y": cy, "dist": math.hypot(px - cx, py - cy), "t": t}

    def _snap_door_to_edge(self, door_x, door_y):
        best_dist = float('inf')
        best_point = None
        best_node_a = None
        best_node_b = None
        visited = set()

        for node_id, neighbors in self.adj.items():
            node_a = self.nodes[node_id]
            if node_a.get("type") in ["door", "stairs"]:
                continue

            for neighbor in neighbors:
                v = neighbor["to"]
                node_b = self.nodes[v]
                if node_b.get("type") in ["door", "stairs"]:
                    continue

                edge_key = tuple(sorted((node_id, v)))
                if edge_key in visited:
                    continue
                visited.add(edge_key)

                proj = self._project_point_on_segment(door_x, door_y, node_a["x"], node_a["y"], node_b["x"], node_b["y"])
                if proj["dist"] < best_dist:
                    best_dist = proj["dist"]
                    best_point = {"x": proj["x"], "y": proj["y"]}
                    best_node_a = node_id
                    best_node_b = v

        return {"point": best_point, "dist": best_dist, "edgeNodeA": best_node_a, "edgeNodeB": best_node_b}

    def _split_edge(self, node_a, node_b, snap_id):
        s_node = self.nodes[snap_id]
        a_node = self.nodes[node_a]
        b_node = self.nodes[node_b]

        w_as = math.hypot(s_node["x"] - a_node["x"], s_node["y"] - a_node["y"])
        w_sb = math.hypot(b_node["x"] - s_node["x"], b_node["y"] - s_node["y"])

        self.adj[node_a] = [e for e in self.adj[node_a] if e["to"] != node_b]
        self.adj[node_b] = [e for e in self.adj[node_b] if e["to"] != node_a]

        self.adj[node_a].append({"to": snap_id, "weight": w_as, "accessible": True})
        self.adj[snap_id].append({"to": node_a, "weight": w_as, "accessible": True})
        self.adj[snap_id].append({"to": node_b, "weight": w_sb, "accessible": True})
        self.adj[node_b].append({"to": snap_id, "weight": w_sb, "accessible": True})

    def _auto_snap_doors(self):
        manually_connected = set()
        for edge in self.nav_graph.get("edges", []):
            if "__" in edge["from"]: manually_connected.add(edge["from"])
            if "__" in edge["to"]: manually_connected.add(edge["to"])

        for door_node_id, door_node in list(self.nodes.items()):
            if door_node.get("type") not in ["door", "stairs"]:
                continue
            if door_node_id in manually_connected:
                continue

            snap = self._snap_door_to_edge(door_node["x"], door_node["y"])
            
            # If no edge is close, fallback to snapping to the nearest NODE directly
            if not snap["point"] or snap["dist"] > 15:
                best_node = None
                best_d = float('inf')
                for nid, n in self.nodes.items():
                    if n.get("type") in ["door", "stairs"]: continue
                    d = math.hypot(door_node["x"] - n["x"], door_node["y"] - n["y"])
                    if d < best_d:
                        best_d = d
                        best_node = nid
                
                if best_node and best_d < 30: # more lenient fallback
                    w = best_d
                    self.adj[door_node_id].append({"to": best_node, "weight": w, "accessible": True})
                    self.adj[best_node].append({"to": door_node_id, "weight": w, "accessible": True})
                    continue
                else:
                    continue

            snap_id = f"{door_node_id}_snap"
            self.nodes[snap_id] = {
                "x": snap["point"]["x"],
                "y": snap["point"]["y"],
                "type": "snap",
                "corridorId": self.nodes[snap["edgeNodeA"]].get("corridorId")
            }

            door_to_snap = math.hypot(door_node["x"] - snap["point"]["x"], door_node["y"] - snap["point"]["y"])
            if door_node_id not in self.adj: self.adj[door_node_id] = []
            if snap_id not in self.adj: self.adj[snap_id] = []
            
            self.adj[door_node_id].append({"to": snap_id, "weight": door_to_snap, "accessible": True})
            self.adj[snap_id].append({"to": door_node_id, "weight": door_to_snap, "accessible": True})

            self._split_edge(snap["edgeNodeA"], snap["edgeNodeB"], snap_id)

    def get_node_for_room(self, room_id):
        if not room_id:
            return None
        
        # Ensure room_id is a string
        room_id = str(room_id).strip()
        if not room_id:
            return None
            
        # Case-insensitive lookup
        room_id_lower = room_id.lower()
        
        # Debug info
        print(f"DEBUG: Looking for room '{room_id}' (lower: '{room_id_lower}')")
        if self.map_data:
            print(f"DEBUG: Available rooms: {[r['id'] for r in self.map_data[:5]]}")
        
        room = next((r for r in self.map_data if str(r["id"]).lower() == room_id_lower), None)
        
        if not room:
            print(f"DEBUG: Room not found: {room_id}")
            return None
        if not room.get("doors"):
            print(f"DEBUG: Room {room_id} has no doors")
            return None
        
        node_id = f"{room['id']}__{room['doors'][0]['id']}"
        print(f"DEBUG: Room {room_id} -> node {node_id}")
        return node_id

    def find_path(self, from_room_id: str = "", to_room_id: str = "", accessible: bool = False, from_node_id: str = ""):
        if not self._built:
            self.build_graph()

        # Sanitize "null" strings from frontend
        if from_node_id == "null": from_node_id = ""
        if from_room_id == "null": from_room_id = ""
        if to_room_id == "null": to_room_id = ""

        if from_node_id and from_node_id.strip():
            start_node = from_node_id
        else:
            start_node = self.get_node_for_room(from_room_id) if from_room_id.strip() else None
            
        end_node = self.get_node_for_room(to_room_id)

        if not start_node or not end_node or start_node not in self.nodes or end_node not in self.nodes:
            print(f"DEBUG: Pathfinding failed early. start_node={start_node}, end_node={end_node}")
            if start_node and start_node not in self.nodes: print(f"DEBUG: start_node {start_node} not in nodes")
            if end_node and end_node not in self.nodes: print(f"DEBUG: end_node {end_node} not in nodes")
            return None

        if start_node == end_node:
            return self._build_result([start_node])

        goal = self.nodes[end_node]

        def h(node_id):
            n = self.nodes[node_id]
            return math.hypot(n["x"] - goal["x"], n["y"] - goal["y"])

        open_set = []
        heapq.heappush(open_set, (h(start_node), start_node))
        g_score = {start_node: 0}
        came_from = {}
        closed_set = set()

        while open_set:
            f, current = heapq.heappop(open_set)

            if current == end_node:
                return self._reconstruct_path(came_from, end_node)

            if current in closed_set:
                continue
            closed_set.add(current)

            for edge in self.adj.get(current, []):
                neighbor = edge["to"]
                if neighbor in closed_set:
                    continue
                if accessible and not edge["accessible"]:
                    continue

                tentative_g = g_score[current] + edge["weight"]
                if tentative_g < g_score.get(neighbor, float('inf')):
                    g_score[neighbor] = tentative_g
                    came_from[neighbor] = current
                    heapq.heappush(open_set, (tentative_g + h(neighbor), neighbor))

        return None

    def _reconstruct_path(self, came_from, end_node):
        path = [end_node]
        current = end_node
        while current in came_from:
            current = came_from[current]
            path.insert(0, current)
        return self._build_result(path)

    def _string_pull(self, node_ids):
        if len(node_ids) <= 2:
            return node_ids

        result = [node_ids[0]]
        anchor = 0

        while anchor < len(node_ids) - 1:
            farthest_direct = anchor + 1
            for probe in range(anchor + 2, len(node_ids)):
                if self._can_skip_between(node_ids, anchor, probe):
                    farthest_direct = probe
                else:
                    break
            result.append(node_ids[farthest_direct])
            anchor = farthest_direct

        return result

    def _can_skip_between(self, node_ids, from_idx, to_idx):
        n_a = self.nodes[node_ids[from_idx]]
        n_b = self.nodes[node_ids[to_idx]]
        
        dx = n_b["x"] - n_a["x"]
        dy = n_b["y"] - n_a["y"]
        length = math.hypot(dx, dy)
        if length == 0: return True

        for i in range(from_idx + 1, to_idx):
            n_c = self.nodes[node_ids[i]]
            cross = abs((n_c["x"] - n_a["x"]) * dy - (n_c["y"] - n_a["y"]) * dx) / length
            if cross > 1.0: return False

        corridor_a = n_a.get("corridorId")
        corridor_b = n_b.get("corridorId")
        if corridor_a and corridor_b and corridor_a == corridor_b:
            return True

        for i in range(from_idx + 1, to_idx):
            n_c = self.nodes[node_ids[i]]
            if not n_c.get("corridorId"):
                return False
        return True

    def _build_result(self, node_ids):
        pulled_ids = self._string_pull(node_ids)
        points = [{"x": self.nodes[id_]["x"], "y": self.nodes[id_]["y"], "id": id_} for id_ in pulled_ids]

        distance = 0
        for i in range(1, len(points)):
            distance += math.hypot(points[i]["x"] - points[i-1]["x"], points[i]["y"] - points[i-1]["y"])

        distance_meters = distance * METERS_PER_UNIT
        time_seconds = distance_meters / WALK_SPEED_MPS

        return {
            "nodeIds": pulled_ids,
            "points": points,
            "distanceMeters": round(distance_meters),
            "estimatedTime": self._format_time(time_seconds),
            "steps": self._generate_steps(pulled_ids)
        }

    def _generate_steps(self, node_ids):
        if len(node_ids) < 2:
            return []

        steps = []
        # Step 1: Leave room
        start_node = self.nodes[node_ids[0]]
        if start_node.get("roomId"):
            room = next((r for r in self.map_data if r["id"] == start_node["roomId"]), None)
            label = room["label"] if room else start_node["roomId"]
            steps.append({"text": f"اخرج من {label}", "icon": "🚪"})

        # Mid steps
        last_angle = None
        for i in range(1, len(node_ids) - 1):
            prev = self.nodes[node_ids[i-1]]
            curr = self.nodes[node_ids[i]]
            nxt = self.nodes[node_ids[i+1]]

            angle1 = math.atan2(curr["y"] - prev["y"], curr["x"] - prev["x"])
            angle2 = math.atan2(nxt["y"] - curr["y"], nxt["x"] - curr["x"])
            turn = ((angle2 - angle1) * 180 / math.pi + 540) % 360 - 180

            if abs(turn) > 35:
                if turn > 0:
                    steps.append({"text": "انعطف يساراً في الممر", "icon": "↩️"})
                else:
                    steps.append({"text": "انعطف يميناً في الممر", "icon": "↪️"})
            elif last_angle is None or abs(turn) <= 35:
                curr_node = self.nodes[node_ids[i]]
                if curr_node.get("type") == "waypoint" and i == len(node_ids) // 2:
                    steps.append({"text": "أكمل السير في الممر", "icon": "🚶"})
            
            last_angle = angle2

        if len(steps) == 1:
            steps.append({"text": "امشِ في الممر", "icon": "🚶"})

        # Last step
        end_node = self.nodes[node_ids[-1]]
        if end_node.get("roomId"):
            room = next((r for r in self.map_data if r["id"] == end_node["roomId"]), None)
            label = room["label"] if room else end_node["roomId"]
            steps.append({"text": f"ادخل {label}", "icon": "📍"})

        return steps

    def _format_time(self, seconds):
        if seconds < 60: return "أقل من دقيقة"
        mins = round(seconds / 60)
        if mins == 1: return "دقيقة واحدة"
        if mins == 2: return "دقيقتان"
        if mins <= 10: return f"{mins} دقائق"
        return f"{mins} دقيقة"
