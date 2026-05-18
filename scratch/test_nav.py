import httpx
import json

url = "http://localhost:8001/api/nav/route"
payload = {
    "fromRoom": "",
    "fromNode": "n_220",
    "toRoom": "Room_20",
    "accessible": False
}

try:
    response = httpx.post(url, json=payload)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.text}")
except Exception as e:
    print(f"Error: {e}")
