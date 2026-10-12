"""
================================================================
UQU Academic Assistant — Firestore Database Client
================================================================
Initializes Firebase Admin SDK and provides the Firestore client.
"""

import os
import firebase_admin
from firebase_admin import credentials, firestore
from config import get_settings

_app = None
_db = None

# Resolve paths relative to this file's directory (backend/)
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def init_firestore():
    """Initialize Firebase Admin SDK and return Firestore client.
    Call once at application startup."""
    global _app, _db

    if _app is not None:
        return _db

    settings = get_settings()

    # 1) Credentials pasted into an environment variable (cloud hosting).
    if settings.FIREBASE_CREDENTIALS_JSON.strip():
        import json
        cred = credentials.Certificate(json.loads(settings.FIREBASE_CREDENTIALS_JSON))
        _app = firebase_admin.initialize_app(cred)
        _db = firestore.client()
        return _db

    # 2) Credentials file on disk: backend/ + serviceAccountKey.json
    cred_path = settings.FIREBASE_CREDENTIALS_PATH
    if not os.path.isabs(cred_path):
        cred_path = os.path.join(_BASE_DIR, cred_path)

    if not os.path.isfile(cred_path):
        raise RuntimeError(
            f"Firebase service account file not found: {cred_path}\n"
            "Download it from Firebase Console > Project Settings > Service Accounts > "
            "Generate New Private Key, and save it as backend/serviceAccountKey.json "
            "(or set FIREBASE_CREDENTIALS_PATH / FIREBASE_CREDENTIALS_JSON in backend/.env)."
        )

    cred = credentials.Certificate(cred_path)
    _app = firebase_admin.initialize_app(cred)
    _db = firestore.client()
    return _db


def get_db() -> firestore.firestore.Client:
    """FastAPI dependency — returns the Firestore client."""
    if _db is None:
        return init_firestore()
    return _db
