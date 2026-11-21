# سجل التغييرات (CHANGELOG)

> أحدث إدخال فوق. سطر أو اتنين لكل تغيير: التاريخ — إيه اتعمل — الملفات — نتيجة الاختبارات.

## 2026-11-21 (Egypt Hashtags & Trends Engine + Fixed Sidebar + Simplified Pull)
- **محرك الهاشتاجات والترندات لمصر (`lib/trends-engine.ts`, `server/trends-service.ts`, `supabase/functions/trends-api/index.ts`, `components/Trends.tsx`):**
  - قسم جديد «الهاشتاجات والترندات · مصر» أسفل «تيار الأخبار» في مساحة المحرر (معزول لكل جهة عبر RLS).
  - خوارزمية تحليل عربية قوية لمنشورات فيسبوك الخاصة بالجهة (فلترة السبام والترحيب التلقائي والمسابقات وهاشتاجات الناشرين الذاتية، استخراج الهاشتاجات الصريحة، تجميع TF-IDF وعبارات إخبارية، إبراز الشأن المصري، تقاطع مع ترندات X وGoogle، حد أقصى 15 موضوعًا حقيقيًا دون تأليف، وزر «عرض في التيار»).
  - جلب حي لترندات مصر من X (عبر `X_BEARER_TOKEN` الرسمي أو قائمة مصر في `GetDayTrends` بعد فحص `robots.txt`) وعمليات بحث Google مصر (`trends.google.com/trending/rss?geo=EG`) مع كاش 15 دقيقة وزر تحديث فوري، بدون صرف SocialAPIs Credits.
- **تثبيت الشريط الجانبي الأزرق لكشيدة:** `position: sticky; height: 100dvh` في `app/globals.css` لتثبيت اللوجو والقائمة و«كشيدة للرصد الإعلامي» أسفل الشاشة أثناء التمرير.
- **تبسيط تبويب «سحب الأخبار» في `/admin`:** واجهة خفيفة بزر واحد «اسحب الآن (مرة واحدة)» ونتيجة آخر سحبة وتبديل التوقيت.

## 2026-11-20 (Login Network Error Clarity + Single-Command Local Dev)
- التمييز في [SignIn.tsx](../../components/SignIn.tsx) بين خطأ كلمة السر وتعذّر الاتصال بخادم الدخول المحلي (`AuthRetryableFetchError` / `status === 0`).
- إضافة سكربت [dev-local.mjs](../../scripts/dev-local.mjs) (`npm run dev:local`) لتشغيل `local-supabase` و`next dev` معًا بأمر واحد.

## 2026-11-20 (Card UX + Group Renaming + Source Icons/Links)
- **تحسين شكل كارت البوست وأسماء وروابط المصادر:**
  - إضافة أيقونات مميزة حسب نوع المصدر ([Icons.tsx](../../components/Icons.tsx): صفحة فيسبوك / جروب عام / حساب X) وروابط مباشرة قابلة للضغط باسم ورابط كل مصدر على الكارت وفي القائمة الجانبية و«المصادر».
  - ترحيل [202611200003_rename_source.sql](../../supabase/migrations/202611200003_rename_source.sql) (`newsroom_admin_rename_source`) + زر «تعديل الاسم» في `/admin` لتمكين الأدمن من تسمية الجروبات بأسمائها الحقيقية فورًا دون اختلاق أسماء.
  - إضافة `referrerPolicy="no-referrer"` لروابط الصور الحية، والتحقق محليًا من توقيع انتهاء `oe=` في عينة 6 نوفمبر (انتهت صلاحيتها من فيسبوك يوم 10–11 نوفمبر).
  - تحسين تصميم الكارت (شارات ملونة لنوع المحتوى، كبسولات تفاعل، زر «فتح المنشور الأصلي» أوضح).

## 2026-11-19 (UX + Brand Refresh)
- **تحسينات واجهة القراءة والإدارة وهوية كشيدة:**
  - إضافة «اقرأ المزيد / عرض أقل» للبوستات الطويلة في [Feed.tsx](../../components/Feed.tsx).
  - محاولة عرض كل روابط الصور/الفيديو المتاحة بالمنشور، وعند انتهاء صلاحيتها يُعرض كارت رابط مباشر («اضغط هنا لمشاهدة الفيديو / الصورة») بدل رسالة «معاينة الوسائط غير متاحة».
  - إعادة صياغة وتبسيط تبويب «الجمع والاستهلاك» في [AdminPanel.tsx](../../components/AdminPanel.tsx) بعربي مباشر بدون مصطلحات إنجليزية مربكة، وإخفاء رمز منع التكرار تحت «إعداد متقدم».
  - اعتماد اللوجو الأبيض الشفاف الجديد (`public/brand/kashida-logo-white.png`) وألوان كشيدة الكحلي العميق والأزرق السماوي في [globals.css](../../app/globals.css).

## 2026-11-19 (v1 Platform)
- **تنفيذ النسخة الأولى كاملة على فرع `feat/kashida-v1-platform`:**
  - ترحيل قاعدة البيانات `supabase/migrations/202611190002_platform_v1.sql` (أعمدة العينة والتحليلات، `runtime_config` للتاريخ المرجعي، `collection_runs/items`، ترقيم `newsroom_feed` والبحث العربي على الخادم، دوال الأدمن و`service_role`).
  - مدخل واحد ومساحتان منفصلتان: ضبط `NEXT_PUBLIC_DATA_MODE=supabase` افتراضيًا، صفحة دخول معزّزة، لوحة أدمن مستقلة `/admin` (إنشاء جهات ومحررين عبر `auth.admin.createUser` مع استكمال آمن لفشل العضوية، اختيار صريح للجهة، إدارة مصادرها وحدودها، سجل الجمع والاستهلاك).
  - موصل SocialAPIs المحدود من جانب الخادم (`server/socialapis.ts`, `server/collector.ts`, `supabase/functions/*`, `scripts/collect-facebook.mjs`) بحد 5 طلبات / 5 Credits / limit=3 وidempotency كامل، دون صرف رصيد لغياب `SOCIALAPIS_API_KEY`.
  - أدوات التهيئة والاستيراد والخادم المحلي المتوافق على PGlite (`scripts/bootstrap-auth.mjs`, `scripts/import-snapshot.mjs`, `scripts/local-supabase.mjs`, `scripts/serve-out.mjs`).
  - اختبارات آلية 18/18 (`tests/*.test.mjs`) + `typecheck` + `build` (`out/` خالٍ من الأسرار والعينة) + اختبار متصفح تفاعلي كامل بـ4 حسابات (أدمن، محرر جديد، `user1@gmail.com`، `user2@gmail.com`).

## 2026-11-19
- **إنشاء المرجع الدائم للمشروع.** أُضيف `AGENTS.md` (يتحمّل تلقائيًا كل جلسة) و`docs/context/` (STATUS, PROJECT_MAP, DATA_CONTRACTS, CHANGELOG).
  نُسخ `START-HERE.md` والعينة إلى `docs/context/handoff/`؛ العينة مضافة لـ`.gitignore`. مفيش تعديل على كود التطبيق. `npm test` 10/10.
