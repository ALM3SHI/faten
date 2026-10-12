# نشر فطن مجانًا

| الجزء | المكان | التكلفة |
|---|---|---|
| الواجهة (Next.js كموقع ثابت) | Firebase Hosting — `https://fatan-2648a.web.app` | مجاني (خطة Spark) |
| الخادم (FastAPI) | Render — خطة Free | مجاني، بدون بطاقة |
| قاعدة البيانات وتسجيل الدخول | Firebase (نفس المشروع) | مجاني |
| الذكاء الاصطناعي | Gemini | مجاني ضمن حدود يومية |
| الإشعارات اليومية 8 صباحًا | GitHub Actions | مجاني |

> **حدود الخطة المجانية:** خادم Render ينام بعد 15 دقيقة بدون استخدام، وأول طلب بعدها يتأخر حوالي دقيقة.
> عند زيادة المستخدمين انقل الخادم إلى Google Cloud Run (منطقة الدمام `me-central2`) بدون تغيير الكود.

---

## 1) ارفع آخر التعديلات إلى GitHub
Render ينشر الخادم مباشرة من المستودع، فلازم تكون التعديلات مرفوعة:
```
git add -A
git commit -m "Prepare free deployment"
git push
```
المستودع باسم Saleh، فلازم تكون عندك صلاحية عليه، أو يربطه هو بحسابه في Render.

## 2) الخادم على Render
1. سجّل في [render.com](https://render.com) بحساب GitHub.
2. **New → Blueprint** واختر المستودع. Render يقرأ `render.yaml` تلقائيًا.
3. سيطلب القيم السرية:
   - `GEMINI_API_KEY`: نفس المفتاح الموجود في `backend/.env`.
   - `FIREBASE_CREDENTIALS_JSON`: افتح `backend/serviceAccountKey.json` والصق **محتواه كاملًا**.
   - `ALLOWED_ORIGINS`: `https://fatan-2648a.web.app,https://fatan-2648a.firebaseapp.com`
4. انتظر حتى ينتهي النشر، ثم افتح `https://<اسم-الخدمة>.onrender.com/health`. يجب أن يظهر `"status":"healthy"`.
5. من تبويب **Environment** انسخ قيمة `CRON_SECRET`، فستحتاجها في الخطوة 4.

## 3) الواجهة وقواعد الأمان على Firebase
1. أنشئ الملف `frontend\.env.production.local` وفيه سطر واحد:
   ```
   NEXT_PUBLIC_AGENT_BASE_URL=https://<اسم-الخدمة>.onrender.com
   ```
2. أول مرة فقط، سجّل الدخول لـ Firebase:
   ```
   npx firebase-tools login
   ```
3. شغّل **`DEPLOY_FRONTEND.bat`**. يبني الموقع وينشره، وينشر معه `firestore.rules`.
4. الموقع يعمل على `https://fatan-2648a.web.app`.

لتحديث الموقع لاحقًا شغّل `DEPLOY_FRONTEND.bat` مرة أخرى. والخادم يتحدث تلقائيًا مع كل `git push`.

## 4) الإشعارات اليومية (GitHub Actions)
في المستودع على GitHub: **Settings → Secrets and variables → Actions → New repository secret**
- `BACKEND_URL` = `https://<اسم-الخدمة>.onrender.com`
- `CRON_SECRET` = القيمة التي نسختها من Render

للتجربة: تبويب **Actions → Daily notifications → Run workflow**.

---

## مشاكل شائعة
| المشكلة | الحل |
|---|---|
| `Failed to fetch` في الموقع المنشور | تأكد أن `NEXT_PUBLIC_AGENT_BASE_URL` صحيح، ثم أعد تشغيل `DEPLOY_FRONTEND.bat`. وأول طلب بعد نوم الخادم يأخذ دقيقة. |
| خطأ CORS في المتصفح | تأكد أن `ALLOWED_ORIGINS` على Render فيه رابط الموقع بالضبط، بدون `/` في آخره. |
| تسجيل الدخول بـ Google لا يعمل على نطاق جديد | Firebase Console ← Authentication ← Settings ← Authorized domains، وأضف النطاق. |
| "وصلت للحد اليومي" | الحد `DAILY_AI_CREDITS` (الافتراضي 60). غيّره من Render ← Environment. |
