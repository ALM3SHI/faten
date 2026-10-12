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

    # ── AI provider for the chat agent & other LLM features ──
    # "gemini" (default, free tier) or "openai". See services/llm.py.
    AI_PROVIDER: str = "gemini"

    # ── OpenAI API (only used when AI_PROVIDER=openai) ──
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"
    OPENAI_FAST_MODEL: str = "gpt-4o-mini"

    # ── Gemini API (for plan-generator + schedule-ai migrated from frontend) ──
    GEMINI_API_KEY: str = ""
    # gemini-1.5-flash and gemini-2.0-flash have been shut down by Google.
    # gemini-3.6-flash is Google's listed replacement and supports every
    # feature we use (multimodal PDF, responseMimeType=JSON, maxOutputTokens).
    # Override in .env if your key has access to a different model.
    GEMINI_MODEL: str = "gemini-3.6-flash"
    # Cheaper/faster model for intent classification & simple answers.
    GEMINI_FAST_MODEL: str = "gemini-3.5-flash-lite"
    # Gemini 3 always reasons; "low" keeps chat replies fast.
    GEMINI_REASONING_EFFORT: str = "low"

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
    # On hosts where you cannot upload a file (Render, Cloud Run, …) paste the
    # whole service-account JSON into this variable instead. Takes priority.
    FIREBASE_CREDENTIALS_JSON: str = ""

    # ── Scheduled jobs ──
    # Run the 8 AM notifications inside this process. Turn OFF on hosts that
    # sleep when idle and trigger POST /api/cron/daily-notifications instead.
    ENABLE_INTERNAL_SCHEDULER: bool = True
    # Shared secret for the external trigger (empty = endpoint disabled).
    CRON_SECRET: str = ""
    # Pause between users so the job stays under the AI provider's per-minute limit.
    CRON_USER_DELAY_SECONDS: float = 4.0

    # ── Daily AI budget per user (see services/quota.py) ──
    # One chat message costs 1 credit; plan generation / schedule vision 5.
    # Set to 0 to disable the limit (e.g. while developing locally).
    DAILY_AI_CREDITS: int = 60

    # ── CORS ──
    # Comma-separated list of allowed frontend origins, e.g.
    #   ALLOWED_ORIGINS=http://localhost:3000,https://your-app.web.app
    # "*" allows any origin (fine for local development).
    ALLOWED_ORIGINS: str = "*"

    # ── Server ──
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    model_config = {"env_file": str(_ENV_PATH), "env_file_encoding": "utf-8", "extra": "ignore"}

    # ── Resolved values for the active provider ──
    @property
    def ai_provider(self) -> str:
        return "openai" if self.AI_PROVIDER.strip().lower() == "openai" else "gemini"

    @property
    def llm_api_key(self) -> str:
        return self.OPENAI_API_KEY if self.ai_provider == "openai" else self.GEMINI_API_KEY

    @property
    def llm_model(self) -> str:
        return self.OPENAI_MODEL if self.ai_provider == "openai" else self.GEMINI_MODEL

    @property
    def llm_fast_model(self) -> str:
        return self.OPENAI_FAST_MODEL if self.ai_provider == "openai" else self.GEMINI_FAST_MODEL


@lru_cache()
def get_settings() -> Settings:
    """Cached settings singleton — loaded once at startup."""
    return Settings()
