# دليل إعداد نظام الذكاء الاصطناعي (UQU Academic Agent)

## المتطلبات
- Node.js 18+
- Firebase CLI: `npm install -g firebase-tools`
- حساب Firebase (مجاني)
- مفتاح OpenAI API

---

## الخطوة 1 — إنشاء مشروع Firebase

1. اذهب إلى https://console.firebase.google.com
2. انقر "Add project" وأعطه اسماً (مثل `uqu-academic`)
3. من **Authentication** → Enable **Email/Password**
4. من **Firestore Database** → Create database → Start in **production mode**
5. من **Project Settings** → General → Your apps → Add web app
6. انسخ قيم الـ `firebaseConfig`

---

## الخطوة 2 — إعداد `assets/firebase-config.js`

افتح الملف واستبدل القيم:

```js
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",        // من Project Settings
  authDomain:        "uqu-academic.firebaseapp.com",
  projectId:         "uqu-academic",
  storageBucket:     "uqu-academic.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc"
};

const AGENT_BASE_URL = "https://us-central1-uqu-academic.cloudfunctions.net";
```

---

## الخطوة 3 — إعداد `.firebaserc`

أنشئ الملف في جذر المشروع:

```json
{
  "projects": {
    "default": "uqu-academic"
  }
}
```

---

## الخطوة 4 — نشر Cloud Functions (الباك-إند)

```bash
cd "uqu_upgrade"

# تسجيل الدخول
firebase login

# تثبيت dependencies
cd functions
npm install
cd ..

# ضبط مفتاح OpenAI (استخدام Secret Manager — الأكثر أماناً)
firebase functions:secrets:set OPENAI_API_KEY
# أدخل مفتاحك عند الطلب: sk-...

# نشر
firebase deploy --only functions
```

بعد النشر ستظهر روابط مثل:
```
chat: https://us-central1-uqu-academic.cloudfunctions.net/chat
```

انسخ الجزء `https://us-central1-uqu-academic.cloudfunctions.net` وضعه في `AGENT_BASE_URL`.

---

## الخطوة 5 — نشر Firestore Rules

```bash
firebase deploy --only firestore:rules
```

---

## الخطوة 6 — تجربة محلية (اختياري)

```bash
# تشغيل المحاكي المحلي
firebase emulators:start --only functions,firestore

# الروابط:
# Functions: http://127.0.0.1:5001/uqu-academic/us-central1/chat
# Firestore: http://127.0.0.1:8080
# Emulator UI: http://127.0.0.1:4000
```

في هذه الحالة `AGENT_BASE_URL` = `http://127.0.0.1:5001/uqu-academic/us-central1`

---

## هيكل قاعدة البيانات (Firestore)

```
users/
  {uid}/
    profile: { name, major, university, level, currentGpa, courses[] }
    study_preferences: { best_time, study_hours, method }
    analysis: { weaknesses[], strengths[], recommendations[] }
    transcripts/
      {id}: { courses[], cgpa, totalHours, createdAt }
    exams/
      {id}: { subject, date, exam_type, done, createdAt }
    study_plans/
      {id}: { title, tasks[], active, createdAt }
    notifications/
      {id}: { title, message, type, read, createdAt }
    chat_history/
      {convId}/
        messages/
          {msgId}: { role, content, timestamp }
```

---

## أدوات الذكاء الاصطناعي المتاحة

| الأداة | الوظيفة |
|--------|---------|
| `add_upcoming_exam` | إضافة اختبار للوحة التحكم |
| `create_study_plan` | إنشاء خطة دراسية |
| `send_notification` | إرسال إشعار/تحفيز |
| `get_student_data` | قراءة بيانات الطالب |
| `analyze_transcript` | تحليل السجل الأكاديمي |
| `update_profile` | تحديث الملف الشخصي |
| `get_upcoming_exams` | عرض الاختبارات القادمة |
| `add_course` | إضافة مادة |
| `complete_task` | إنجاز مهمة |

---

## مثال على تفاعل النظام

**الطالب يكتب في الشات:**
> "عندي اختبار فيزياء بكره الساعة 10 ومو عارف كيف أذاكر"

**ما يحدث تلقائياً:**
1. AI يفهم: اختبار فيزياء، تاريخ = غداً
2. يستدعي `add_upcoming_exam` → يُضاف للوحة التحكم فوراً
3. يستدعي `create_study_plan` → خطة مراجعة ليلية مقسمة بالساعات
4. يرد على الطالب: *"تم تسجيل اختبار الفيزياء وجهزت لك خطة مراجعة في صفحة الخطط 📋"*
5. بطاقات الإجراءات تظهر تحت الرسالة ✅
