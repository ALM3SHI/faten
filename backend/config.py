"""
================================================================
UQU Academic Assistant — Application Configuration
================================================================
Loads settings from .env using pydantic-settings.
"""

from pathlib import Path
from pydantic_settings import BaseSettings
from functools import lru_cache

_ENV_PATH = Path(__file__).resolve().parent / ".env"


class Settings(BaseSettings):
    """Application settings loaded from environment variables / .env file."""

    # ── OpenAI API ──
    OPENAI_API_KEY: str
    OPENAI_MODEL: str = "gpt-4o"

    # ── Gemini API (for plan-generator + schedule-ai migrated from frontend) ──
    GEMINI_API_KEY: str = ""
    # gemini-1.5-flash has the broadest free-tier availability and supports
    # every feature we need (multimodal PDF, responseMimeType=JSON,
    # systemInstruction, maxOutputTokens). gemini-2.0-flash returns
    # RESOURCE_EXHAUSTED with limit:0 on most non-paid keys.
    GEMINI_MODEL: str = "gemini-1.5-flash"

    # ── Llama (OpenAI-compatible) — used by the AI Study Plan generator ──
    # Any provider exposing the OpenAI Chat Completions API works:
    #   • OpenRouter   → https://openrouter.ai/api/v1     model: meta-llama/llama-3.3-70b-instruct
    #   • Groq         → https://api.groq.com/openai/v1   model: llama-3.3-70b-versatile
    #   • Ollama local → http://localhost:11434/v1        model: llama3.3 (api key can be any string)
    # Defaults below target OpenRouter — override in .env to switch providers.
    LLAMA_API_KEY: str = ""
    LLAMA_BASE_URL: str = "https://openrouter.ai/api/v1"
    LLAMA_MODEL: str = "meta-llama/llama-3.3-70b-instruct"

    # ── Speech-to-Text (Groq Whisper) ──
    # Powers POST /api/stt/transcribe used by the chat microphone button.
    # If unset, the endpoint responds 503 and the frontend gracefully
    # falls back to the browser's built-in Web Speech API.
    # Get a free key at https://console.groq.com/keys
    GROQ_API_KEY: str = ""
    GROQ_STT_MODEL: str = "whisper-large-v3"  # best Arabic accuracy on Groq

    # ── Firebase ──
    FIREBASE_CREDENTIALS_PATH: str = "serviceAccountKey.json"

    # ── Server ──
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    model_config = {"env_file": str(_ENV_PATH), "env_file_encoding": "utf-8", "extra": "ignore"}


@lru_cache()
def get_settings() -> Settings:
    """Cached settings singleton — loaded once at startup."""
    return Settings()
