# 🧭 خطوات إصلاح Navigation Engine

## الحالة الحالية
الـ Frontend يحاول الاتصال بـ Backend لكن يحصل على **404**.
السبب: **Backend لم يتم إعادة تشغيله بعد التحديثات**

---

## ✅ الحل (خطوة بخطوة)

### الخطوة 1️⃣: إيقاف الـ Backend القديم
إذا كان هناك terminal مفتوح يشغل الـ backend:
- اضغط **Ctrl+C** لإيقافه

### الخطوة 2️⃣: فتح terminal جديد
```powershell
cd "c:\Users\M4SHi\Desktop\uqu_upgrade (5)\uqu_upgrade"
```

### الخطوة 3️⃣: تفعيل البيئة الافتراضية
```powershell
.\.venv\Scripts\Activate.ps1
```

### الخطوة 4️⃣: اختبار البيانات (اختياري لكن موصى به)
```bash
cd backend
python full_test.py
```

يجب أن ترى شيء مثل:
```
✓ Data loaded successfully
✓ Graph built successfully
✓ Pathfinding working (2/2 tests passed)
```

### الخطوة 5️⃣: تشغيل الـ Backend مع الكود الجديد
```bash
uvicorn main:app --reload --port 8000
```

يجب أن ترى رسائل مثل:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete
```

---

## 🧪 الآن اختبر من الـ Frontend

1. افتح تطبيق الويب
2. افتح **Browser Console** (F12 أو Ctrl+Shift+K)
3. حاول اختيار مسار على الخريطة
4. يجب أن ترى رسالة نجاح مثل:
```
🧭 NavEngine: Sending request to http://localhost:8000/api/nav/route
   Payload: {fromRoom: '', fromNode: 'n_113', toRoom: 'Room_3', accessible: false}
   Response status: 200
   ✓ Path found! Points: 25 Distance: 18 m
```

---

## 🚨 إذا لم ينجح؟

### تحقق من:

1. **Backend يعمل؟**
   - افتح http://localhost:8000/docs
   - يجب أن ترى Swagger UI

2. **البيانات محملة؟**
   ```bash
   cd backend
   python full_test.py
   ```

3. **أنت في المجلد الصحيح؟**
   ```bash
   cd backend
   pwd  # يجب أن ينتهي بـ .../backend
   ```

4. **الاستيرادات صحيحة؟**
   ```bash
   python -c "from services.navigation import NavigationService; print('OK')"
   ```

---

## 📝 الملفات المحدثة:
- ✅ `backend/services/navigation.py` - تحسينات كبيرة
- ✅ `assets/nav-engine.js` - تحسينات logging
- ✅ `backend/full_test.py` - ملف اختبار شامل
- ✅ `backend/debug_nav.py` - ملف اختبار بسيط
- ✅ `backend/test_nav.py` - اختبار HTTP

