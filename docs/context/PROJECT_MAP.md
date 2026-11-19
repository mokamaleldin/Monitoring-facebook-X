# خريطة المشروع (PROJECT_MAP)

> آخر مطابقة مع الكود: 2026-11-19 — فرع `feat/kashida-v1-platform`.

## 1) البنية في نظرة

```
app/
  layout.tsx            html lang=ar dir=rtl + metadata (noindex)
  page.tsx              صفحة المدخل الرئيسي / ← <Newsroom/>
  admin/page.tsx        لوحة إدارة كشيدة المستقلة /admin ← <AdminPanel/> (تُصدّر إلى out/admin/)
  globals.css           هوية كشيدة العربية RTL + جداول متجاوبة (@container) + تحقق نماذج (:user-invalid)
components/
  SignIn.tsx            نموذج الدخول المشترك + Brand + ConfigMissingGate
  Newsroom.tsx          بوابة /: تفصل المحرر (مساحة جهته فقط) عن platform_admin (تحويل تلقائي إلى /admin/)
  Workspace.tsx         مساحة المحرر: rail + header (اسم جهته فقط) + orgMeta + تمرير loadFeedPage
  Feed.tsx              تيار الأخبار: فلاتر FB/X ونوع/مصدر/بحث + ترقيم cursor من الخادم + تمرير لا نهائي + Article
  Sources.tsx           إدارة المصادر (دفعة روابط، إيقاف/استئناف، طلبات معلقة)
  AdminPanel.tsx        لوحة أدمن كشيدة (/admin): الجهات والمحررون، إدارة جهة محددة، استكمال العضويات المعلقة، الجمع والسجل
lib/
  model.ts              كل الأنواع المشتركة (Post, OrgMeta, FeedPage, AdminOverview, CollectionRun...) + parseSource/foldArabic/cairoTime
  snapshot.ts           محوّل نقي لعينة facebook-snapshot.json (لا يستورد الملف مباشرة؛ آمن للتصدير العام)
  backend.ts            عميل Supabase (افتراضي NEXT_PUBLIC_DATA_MODE=supabase) + RPCs + admin-api & collect-facebook
  demo.ts               محاكاة الوضع التجريبي الصريح (NEXT_PUBLIC_DATA_MODE=demo) + feedDemo/orgMetaDemo
  fixtures.ts           بيانات العرض التمثيلية لوضع demo فقط
server/
  socialapis.ts         عميل SocialAPIs المحدود (x-api-token, limit=3, after_time YYYY-MM-DD, no redirect/retry) + normalizer
  collector.ts          محرك دورة الجمع الواحدة المحدودة (runKey idempotent، حد 5 طلبات/5 Credits، تسجيل /usage منفصل)
  pg-collector-store.ts منفّذ CollectorStore على PostgreSQL/PGlite
  admin-service.ts      منطق مسارات /admin-api و/collect-facebook + تحقق platform_admin + استكمال العضوية الجزئي
  supabase-admin-backend.ts ربط AdminBackend مع Supabase المستضاف عبر service_role RPCs
  node-server.ts        خادم Node خفيف اختياري (npm run start:api) بديل عن Edge Functions عند الحاجة
supabase/
  migrations/
    202611190001_newsroom.sql   المخطط الأساسي + RLS + RPCs الأولى
    202611190002_platform_v1.sql ترقية v1: أعمدة العينة، runtime_config (المرجع الزمني)، collection_runs، newsroom_feed، دوال الأدمن وservice_role
  functions/
    admin-api/index.ts          Supabase Edge Function لإدارة الجهات والمحررين والمصادر
    collect-facebook/index.ts   Supabase Edge Function لدورة جمع Facebook الواحدة المحدودة
scripts/
  env-loader.mjs        قراءة .env.local محليًا دون طباعة الأسرار
  local-supabase.mjs    خادم Supabase محلي متوافق على PGlite (Auth JWT + PostgREST RPC/RLS + Functions) للتطوير والاختبار
  bootstrap-auth.mjs    تهيئة متكررة آمنة للجهات والمصادر والـ3 حسابات عبر auth.admin.createUser
  import-snapshot.mjs   استيراد متكرر آمن لـfacebook-snapshot.json مع خيار --set-reference-date
  collect-facebook.mjs  تشغيل يدوي لدورة Facebook واحدة محدودة من سطر الأوامر
  serve-out.mjs         خادم محلي ثابت لمعاينة مجلد البناء out/
  fixture-sql.mjs       مولد SQL لأمثلة العرض القديمة
tests/
  workspace.test.mjs              اختبارات lib/model وdemo (4)
  database.test.mjs               اختبارات SQL الأساسية على PGlite (6)
  snapshot-and-isolation.test.mjs اختبارات العينة (16/12/8)، الإيقاف، الترقيم، 50 جهة، X اصطناعي، التزامن (3)
  auth-and-admin.test.mjs         اختبارات JWT الحقيقية، عزل الجهات، إغلاق التسجيل، إنشاء محرر، استكمال فشل العضوية (2)
  collector.test.mjs              اختبارات موصل SocialAPIs والـidempotency والتوقف عند 429/network drop (3)
```

## 2) «عايز أعمل X؟ روح فين»

| المهمة | الملفات |
|---|---|
| تعديل صفحة الدخول أو رسالة نقص الإعداد | `components/SignIn.tsx` + `lib/backend.ts` |
| تعديل لوحة أدمن كشيدة `/admin` | `components/AdminPanel.tsx` + `server/admin-service.ts` + `supabase/functions/admin-api/index.ts` |
| تعديل الترقيم أو الفلاتر على الخادم | `supabase/migrations/202611190002_platform_v1.sql` (`newsroom_feed`) + `components/Feed.tsx` |
| تعديل كارت الخبر أو الوسائط/التفاعل | `components/Feed.tsx` (`Article`) + `lib/model.ts` |
| تعديل استيراد عينة البوت | `lib/snapshot.ts` + `scripts/import-snapshot.mjs` |
| تعديل دورة جمع Facebook أو السقف | `server/socialapis.ts` + `server/collector.ts` + `supabase/functions/collect-facebook/index.ts` |
| تهيئة حسابات الاختبار | `scripts/bootstrap-auth.mjs` (المتغيرات في `.env.example`) |
| تشغيل البيئة المحلية بدون Docker | `scripts/local-supabase.mjs` + `scripts/serve-out.mjs` |
