# عقود البيانات (DATA_CONTRACTS)

> المرجع لكل شكل بيانات: أنواع الواجهة، جداول قاعدة البيانات، الدوال (RPCs)، وسجل الجمع.
> آخر مطابقة: 2026-11-19 (بعد ترحيل `202611190002_platform_v1.sql`).

## 1) أنواع الواجهة (`lib/model.ts`)
- `Post`: `id, platform, text, media ("text"|"photo"|"video"), mediaUrl, mediaItems?: MediaItem[], originalUrl, publishedAt, seenAt, sources, engagement?: {reactions,comments,shares,views}|null, sharedPost?, timeOrigin?, timeSemanticsVerified?`
- `OrgMeta`: `{ id, name, feedDays, canAdd, sources, pending, referenceAt, referenceLabel }`
- `FeedPage`: `{ posts: Post[], totalCount, hasMore, nextCursor: { seenAt, id } | null, referenceAt, referenceLabel }`
- `AdminOverview`: `{ referenceAt, referenceLabel, uniqueSources, uniqueActiveFacebookSources, totalPosts, organizations: AdminOrg[], runs: CollectionRun[], orphanUsers?, collectorConfigured? }`

## 2) جداول قاعدة البيانات (schema `newsroom` — خاصة)

| جدول | الإضافات في `0002` / ملاحظات |
|---|---|
| `organizations` | `max_sources` غير مُتاح قراءته لـ`authenticated` (للأدمن فقط) |
| `members` | `user_id` PK، `role in ('editor','platform_admin')` |
| `sources` | + `legacy_id text unique` لربط معرّفات البوت القديمة (`youm7`, `mazid`, `rassd`, `group-783`, `group-230`) |
| `posts` | + `raw_media_type`, `media_items jsonb`, `engagement jsonb`, `shared_post`, `time_origin`, `time_semantics_verified`, `updated_at` |
| `appearances` | + `last_seen_at`; عند إعادة الاستيراد أو التحديث `seen_at = LEAST(existing, new)` للحفاظ على أول وقت رصد |
| `runtime_config` | صف وحيد (`id=1`): `feed_reference_at`, `reference_label`. `NULL` = التوقيت الحي `now()`. مقفول عن المحررين |
| `collection_runs` | `run_key unique`, `status`, `request_cap`, `credit_cap`, `requests_made`, `usage_checks`, `credits_charged`, `credits_uncertain`, `credits_remaining`, `usage_before/after`, `account_usage_delta`, `inserted_count`, `updated_count`, `stop_reason`. RLS: للأدمن فقط |
| `collection_run_items` | PK `(run_id, source_id)` لمنع تكرار طلب المصدر داخل نفس الدورة، يحفظ `status` (`attempted/ok/error/uncertain/skipped`)، `http_status`، `empty_response`، `old_posts_count`، `missing_time_count`. RLS: للأدمن فقط |

## 3) الـRPCs في `public`

### للمستخدمين المصادق عليهم (`authenticated`)
- `newsroom_workspaces()` — مساحات المستخدم فقط.
- `newsroom_org_meta(p_org)` — مصادر الجهة وطلباتها وحالة الإضافة ومرجع العرض (بدون `max_sources`).
- `newsroom_feed(p_org, p_platform, p_media, p_source, p_query, p_cursor_seen, p_cursor_id, p_limit)` — `security invoker`؛ يطبّق الصلاحيات والنافذة والفلاتر والبحث العربي (`newsroom.fold_arabic`) **قبل** الترقيم المستقر `(seen DESC, id ASC)`.
- `newsroom_snapshot(p_org)` — مُحافظ عليه للتوافق مع الاختبارات السابقة.
- `newsroom_follow(p_org, p_locator)`, `newsroom_pause(p_org, p_source)`, `newsroom_cancel_request(p_org, p_locator)`.
- دوال الأدمن (`newsroom.is_admin()` إلزامي): `newsroom_admin_overview()`, `newsroom_admin_create_org(...)`, `newsroom_admin_update_org(...)`, `newsroom_admin_set_reference(...)`, `newsroom_admin_resolve_request(...)`.

### لـ`service_role` فقط (ممنوعة عن `public, anon, authenticated` برمز 42501)
- `newsroom_service_is_admin`, `newsroom_service_org_exists`, `newsroom_service_get_membership`, `newsroom_service_assign_member`, `newsroom_service_orphan_users`
- `newsroom_service_upsert_org`, `newsroom_service_upsert_source`, `newsroom_service_subscribe`, `newsroom_service_upsert_post`, `newsroom_service_set_reference`
- `newsroom_service_get_run`, `newsroom_service_claim_run`, `newsroom_service_list_active_fb_sources`, `newsroom_service_claim_run_item`, `newsroom_service_update_run_item`, `newsroom_service_finish_run`

## 4) توزيع العينة (5 مصادر Facebook ← 6 متابعات ← 16 منشورًا)
- **مزيد** (`10000000-0000-4000-9000-000000000001`): اليوم السابع (4) + مزيد (4) + الجروب `783030320118289` (4) = **12 منشورًا** (6 صور، 6 فيديوهات؛ بينها المنشور بلا نص `1710087194079259`).
- **رصد** (`10000000-0000-4000-9000-000000000002`): اليوم السابع (4) + شبكة رصد (1) + الجروب `230664764330181` (3) = **8 منشورات**.
- **المشترك**: اليوم السابع (4 منشورات). إيقافه عند مزيد يخفضها 12 ← 8 بينما رصد تبقى 8.
- **مرجع العرض**: `2026-11-06T23:59:59+00:00` للعرض المحلي للعينة دون تعديل أوقات المنشورات؛ و`NULL` للتيار الحي.
