# UQU Academic Assistant — FastAPI Backend v2.0

> المساعد الأكاديمي الذكي لجامعة أم القرى — Python/FastAPI + NVIDIA NIM + Firebase

## 🏗 Architecture

```
backend/
├── main.py              # FastAPI app, CORS, lifespan, scheduler
├── config.py            # Settings from .env (pydantic-settings)
├── requirements.txt     # Python dependencies
├── serviceAccountKey.json  # Firebase credentials (NOT committed)
│
├── agent/               # AI Agent Core
│   ├── loop.py          # Iterative tool-calling loop (max 6 iterations)
│   ├── prompts.py       # Hyper-contextual system prompt builder (9 blocks)
│   ├── tools_schema.py  # 12 tool definitions for function calling
│   └── tools_executor.py # Tool execution logic + Firestore writes
│
├── auth/                # Security
│   └── dependencies.py  # Firebase ID token verification (FastAPI Depends)
│
├── db/                  # Database
│   └── firestore.py     # Firebase Admin SDK initialization
│
├── routers/             # API Endpoints
│   ├── chat.py          # POST /chat, /api/chat — AI Agent
│   ├── profile.py       # POST /syncProfile, /api/sync-profile
│   ├── transcript.py    # POST /syncTranscript, /api/sync-transcript
│   ├── student.py       # GET  /student-context, /api/student-context
│   └── notifications.py # POST /mark-notification-read, /api/mark-notification-read
│
├── schemas/             # Pydantic Models
│   ├── chat.py          # ChatRequest, ChatResponse, ActionLog
│   ├── profile.py       # ProfilePayload, LearningInfo (studySpeed, stressLevel)
│   ├── transcript.py    # CourseRecord, SemesterRecord, TranscriptPayload
│   └── common.py        # SuccessResponse, ErrorResponse
│
└── tasks/               # Background Jobs
    └── cron.py          # Daily motivational notifications (8 AM Riyadh)
```

## 🔧 12 Agent Tools

| # | Tool | Description |
|---|------|-------------|
| 1 | `add_upcoming_exam` | Register an exam/quiz to the dashboard |
| 2 | `create_study_plan` | Create a study plan with tasks |
| 3 | `send_notification` | Send motivational/reminder notifications |
| 4 | `get_student_data` | Read student profile, transcript, exams, plan |
| 5 | `analyze_transcript` | GPA analysis with strengths & weaknesses |
| 6 | `update_profile` | Update profile fields (name, major, GPA targets) |
| 7 | `get_upcoming_exams` | Fetch upcoming exams list |
| 8 | `add_course` | Add a course to the current semester |
| 9 | `complete_task` | Mark a study plan task as done |
| 10 | `modify_study_session` | ⭐ Restructure study plan sessions |
| 11 | `predict_gpa_pathway` | ⭐ Calculate grades needed for target GPA |
| 12 | `update_learning_preferences` | ⭐ Update learning style & stress level |

## 🚀 Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Configure environment
cp .env.example .env
# Edit .env with your NVIDIA_API_KEY

# 3. Place Firebase credentials
# Copy serviceAccountKey.json from Firebase Console

# 4. Run the server
py -m uvicorn main:app --reload --port 8000

# 5. Open Swagger UI
# http://localhost:8000/docs
```

## 📝 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NVIDIA_API_KEY` | NVIDIA NIM API key | (required) |
| `NVIDIA_MODEL` | AI model identifier | `moonshotai/kimi-k2.5` |
| `FIREBASE_CREDENTIALS_PATH` | Path to serviceAccountKey.json | `serviceAccountKey.json` |
| `HOST` | Server host | `0.0.0.0` |
| `PORT` | Server port | `8000` |

## 🔐 Authentication

All endpoints (except `/health`) require a Firebase ID token:
```
Authorization: Bearer <firebase_id_token>
```

The token is obtained via `firebase.auth().currentUser.getIdToken()` on the frontend.

## 📊 GPA Scale

Uses the **official UQU 4.00 scale**:

| Grade | Points | Grade | Points |
|-------|--------|-------|--------|
| A+ | 4.00 | C+ | 2.50 |
| A  | 3.75 | C  | 2.00 |
| B+ | 3.50 | D+ | 1.50 |
| B  | 3.00 | D  | 1.00 |
|    |      | F  | 0.00 |

## 🔄 Dual Route Support

All endpoints support both legacy (frontend-compatible) and new API routes:
- `/chat` ↔ `/api/chat`
- `/syncProfile` ↔ `/api/sync-profile`
- `/syncTranscript` ↔ `/api/sync-transcript`
- `/student-context` ↔ `/api/student-context`
- `/mark-notification-read` ↔ `/api/mark-notification-read`
