# Wave 10 — تقرير شامل (2026-07-10)

**الفرع:** `main`  
**نسخة التطبيق:** `1.0.1` (iOS build 2 · Android versionCode 2)  
**الحالة:** كود محلي مكتمل + اختبارات آلية **PASS** · نشر Replit/EAS **مفتوح**

---

## 1) ملخص تنفيذي

| المحور | ما تم | الحالة |
|--------|--------|--------|
| **وسائط + نشر** | صورة مصغّرة آمنة (لا فيديو خام في البطاقات) · غلاف الملف · verify قبل promote | ✅ محلي |
| **استقرار الرئيسية** | `bootReady` (لغة + سوق + جلسة) · منع لمس أثناء التحميل · sessionId ثابت | ✅ محلي |
| **المساعد الذكي** | مسارات wallet/billing/rentals/supply · industrial→facilities في البحث · thumbnails | ✅ محلي |
| **الإشعارات** | deep-link موحّد · تحديث الشارة عند وصول push في المقدمة | ✅ محلي |
| **خرائط الأقسام** | clusters من API · bookable فقط real_estate · مركز حسب السوق | ✅ محلي (موجود مسبقاً + مُتحقَّق) |
| **تعديل وسائط الإعلان** | PATCH `media[]` · `ListingMediaEditor` · مسودة `promotedMedia` | ✅ محلي |
| **QA جهاز + Replit** | wave 8 live · upload E2E | ⏳ مفتوح |

**اختبارات آخر تشغيل:**

```bash
pnpm run ops:full-verify          # 17/17 + lib-hardening 57/57 + search-contract 37/37
pnpm --filter @workspace/api-server test -- src/lib/listingMediaPreview.test.ts  # 4/4
pnpm --filter @workspace/api-server test -- src/services/ListingService.update.test.ts
```

---

## 2) المشكلة الجذرية — الوسائط (Wave 10A)

### الأعراض
- إعلان يبدأ ب**فيديو** → `media[0]` أو thumbnail خاطئ → `<Image>` يحاول تحميل `.mp4` → البطاقة تختفي من الرئيسية/البحث/المحفوظات.

### الإصلاح (API)

| ملف | التغيير |
|-----|---------|
| `artifacts/api-server/src/lib/listingMediaPreview.ts` | `sortListingMedia` + `pickListingThumbnailUrl` (cover → أول صورة → poster فيديو) |
| `SearchService.enrichListings` | ترتيب وسائط + `thumbnail_url` عبر الم helper |
| `ListingService` (detail/SEO/update) | `orderBy(isThumbnail, sortOrder)` |
| `ListingLinkService` | نفس منطق الصورة المصغّرة |

### الإصلاح (Mobile)

| ملف | التغيير |
|-----|---------|
| `lib/listingMedia.ts` | `pickListingPreviewUrl()` |
| `context/SessionContext.tsx` | `media_preview` من helper وليس `media[0]` |
| `app/listing/[id].tsx` | نفس المنطق عند الحفظ |
| `lib/upload.ts` | `verifyUploadWithRetry()` مشترك |
| `app/(tabs)/profile.tsx` | غلاف: إذن + verify + promote + i18n |
| `app/listings/create.tsx` | استخدام verify المشترك + حفظ `promotedMedia` في المسودة |

### ما بقي مفتوحاً (Scope لاحق)
- **QA جهاز** لتعديل الوسائط بعد النشر
- **Replit redeploy** + live probe

---

## 2b) تعديل وسائط الإعلان + مسودة (Wave 10C)

### API
| ملف | التغيير |
|-----|---------|
| `validators/schemas.ts` | `ListingMediaInputSchema` + `UpdateListingSchema.media[]` |
| `ListingService.updateListing` | استبدال `listing_media` في transaction · promote للـ URLs الجديدة فقط |
| `lib/api-spec/openapi.yaml` | PATCH body `media` |
| `ListingService.update.test.ts` | اختبار استبدال الوسائط + cover |

### Mobile
| ملف | التغيير |
|-----|---------|
| `components/listings/ListingMediaEditor.tsx` | رفع/ترتيب/قص · hydrate من URLs موجودة |
| `app/listings/edit/[id].tsx` | يرسل `media` مع PATCH |
| `lib/listingDraft.ts` | `promotedMedia[]` — URLs بعيدة بعد verify |
| `app/listings/create.tsx` | restore + persist للمسودة |

---

## 3) استقرار الصفحة الرئيسية (Wave 10B)

### الأسباب
1. Rails/توصيات قبل جاهزية السوق → سوق خاطئ لحظياً  
2. استجابات شبكة قديمة تطغى على الأحدث  
3. أزرار تفاعلية أثناء skeleton  
4. `sessionId` جديد كل reload → تخصيص يُصفّر  

### الإصلاح

| آلية | ملف |
|------|-----|
| `readPreferredMarketCountrySync()` + mirror localStorage (web) | `lib/marketPreference.ts` |
| `bootReady = prefsReady && sessionReady` | `app/(tabs)/index.tsx` |
| `feedRequestGenRef` / `railsRequestGenRef` | `index.tsx` |
| `pointerEvents` على header + tabs + engine bar | `index.tsx` |
| قائمة الشعار تنتظر `clerkUserLoaded` | `index.tsx` |
| `loadOrCreateBehaviorSessionId` | `lib/behaviorSession.ts` + `SessionContext` |
| بحث: سوق أولي sync + hydrate native | `useSearchMiniApp.ts` + `search.tsx` |

---

## 4) المساعد الذكي — فحص عميق (Wave 10C)

### المشاكل التي وُجدت
1. **بحث صناعي:** الخادم يرسل `category: "industrial"` بينما واجهة البحث تستخدم `facilities`/`materials` → كان يُهمَل ويُعاد `all`.  
2. **اختصارات شاشات:** `wallet`/`billing`/`rentals`/`supply_hub`/`industry` غير مكتملة في أداة `open_app_screen` على الخادم.  
3. **صور البطاقات في actions:** fallback إضافي لـ `thumbnail_url`.

### الإصلاح

| طبقة | ملف | تفاصيل |
|------|-----|--------|
| API | `AiAssistantService.ts` | شاشات: billing, rentals, supply_hub, industry + labels AR/EN |
| Mobile | `app/assistant.tsx` | `assistantSearchCategory()` · `SCREEN_ROUTES` كامل |

### متطلبات التشغيل (Ops)
- `OPENAI_API_KEY` أو تكامل OpenAI المُدار على Replit  
- المستخدم **مسجّل دخول** (المسار `/api/v1/me/ai/assistant` محمي)  
- Rate limit على route الـ AI  

### QA يدوي للمساعد
- [ ] سؤال عربي: "عايز شقة للإيجار في القاهرة" → actions بحث + listings حقيقية  
- [ ] "فتح إعلاناتي" → navigate `my_listings`  
- [ ] "محادثاتي" → conversation actions من threads حقيقية فقط  
- [ ] بحث industrial → يفتح تبويب بحث **منشآت** وليس الكل  

---

## 5) الإشعارات (Wave 10D)

### البنية
- **In-app:** `app/notifications.tsx` + `useListNotifications`  
- **Push:** `hooks/usePushNotifications.tsx` + `lib/notificationRouting.ts` (مصدر واحد للـ deep-link)  
- **Home bell:** `index.tsx` · badge من unread · يُحدَّث كل 20s  

### الإصلاح الجديد
- عند وصول push **والتطبيق مفتوح** → `invalidateQueries(getListNotificationsQueryKey())`  
- عند **الضغط** على push → invalidate + نفس `routeForNotification`  

### جدول التوجيه (ملخص)

| type | الوجهة |
|------|--------|
| `message` | `/messages/[id]` |
| `booking` | `/bookings?role=host` |
| `payment_*` / `subscription_expiring` | `/billing` |
| `rfq` | `/rfq/[id]` |
| `lead` (بدون listing) | `/business/requests` |
| `verification` / `business` | `/business/supply-hub` |
| default + `listing_id` | `/listing/[id]` |

### QA يدوي
- [ ] رسالة جديدة → push + feed in-app + bell  
- [ ] حجز → host inbox  
- [ ] ضيف + listing public → يفتح التفاصيل · private → profile  
- [ ] إعداد "Push notifications" off → unregister token  

**ملاحظة:** Expo Go **لا يدعم** remote push (SDK 53+) — اختبار push على **EAS dev/preview build** فقط.

---

## 6) خرائط البحث — واقعية حسب القسم (Wave 10E)

### التصميم
- **Leaflet + OSM** داخل WebView/iframe — بدون Google API key  
- **طبقتان:** pins من الصفحة المحمّلة فوراً + clusters من `GET /search/map`  
- **نفس فلاتر القائمة** عبر `buildMapClusterParams(criteria, viewport)`  

### عزل الأقسام (لا خلط)

| القسم | سلوك الخريطة |
|-------|----------------|
| **Cars** | pins سعر · لا bookable · لا rent chips |
| **Real estate** | bookable 📅 من API `is_bookable` أو الصفحة · installment عبر criteria |
| **Facilities** | factory/warehouse/land · لا bookable |
| **Materials** | origin/material · لا bookable |

| ملف | دور |
|-----|-----|
| `components/search/mapHtml.ts` | HTML + `setClusters` + viewport bridge |
| `SearchResultsMap.tsx` / `.web.tsx` | debounce · cache · enrich price/bookable |
| `lib/searchParams` → `buildMapClusterParams` | نفس عقد API |

### QA يدوي للخرائط
- [ ] RE rent + furnished → pin bookable  
- [ ] Cars map → **لا** أيقونة تقويم  
- [ ] تغيير فلتر → خروج map mode (`criteriaKey`)  
- [ ] Discover explore map → evidence mappable للقسم  
- [ ] pan/zoom → clusters تتحدث بدون reload كامل  

### مؤجل (موثّق)
- خريطة داخل `LocationPicker`  
- near-me على web  
- hub maps منفصلة لكل قسم  

---

## 7) أهداف كل قسم — checklist صادق

### 🚗 Cars
| الهدف | كود | جهاز |
|-------|-----|------|
| engines new/used/import/bank/islamic | ✅ | ⏳ |
| brand/year/fuel/transmission معزولة | ✅ | ⏳ |
| installment gated | ✅ | ⏳ |
| Discover import CTA | ✅ | ⏳ |
| map بدون bookable | ✅ | ⏳ |

### 🏠 Real estate
| الهدف | كود | جهاز |
|-------|-----|------|
| sale/rent engines + rental_term مع rent فقط | ✅ | ⏳ |
| bookable map + booking flow | ✅ | ⏳ |
| listing_mode sale/buy (wave 9) | ✅ | ⏳ |

### 🏭 Facilities
| الهدف | kod | جهاز |
|-------|-----|------|
| factory/warehouse/land | ✅ | ⏳ |
| industry filter · لا car/RE leaks | ✅ | ⏳ |

### 📦 Materials
| الهدف | كود | جهاز |
|-------|-----|------|
| line/raw/machine + material chips | ✅ | ⏳ |
| origin · لا facilities industry leak | ✅ | ⏳ |

### 👤 Profile / Media
| الهدف | كود | جهاز |
|-------|-----|------|
| avatar + cover upload + verify | ✅ | ⏳ |
| social links · help→assistant | ✅ | ⏳ |
| overflow: saved + notifications | ✅ | ⏳ |

### 💬 Messages / Assistant
| الهدف | كود | جهاز |
|-------|-----|------|
| guest gate · RTL send | ✅ | ⏳ |
| assistant grounded + actions | ✅ | ⏳ |

### 🔔 Notifications / Billing
| الهدف | كود | جهاز |
|-------|-----|------|
| routing parity push/in-app | ✅ | ⏳ |
| billing hub + CSV/PDF | ✅ | ⏳ |

---

## 8) ملفات م changed (مرجع Git)

### API (جديد/معدّل)
- `src/lib/listingMediaPreview.ts` (+ test)
- `src/services/SearchService.ts`
- `src/services/ListingService.ts`
- `src/services/ListingLinkService.ts`
- `src/services/AiAssistantService.ts`

### Mobile (جديد/معدّل)
- `lib/listingMedia.ts`, `lib/upload.ts`, `lib/marketPreference.ts`, `lib/behaviorSession.ts`
- `context/SessionContext.tsx`
- `app/(tabs)/index.tsx`, `profile.tsx`, `search.tsx`
- `app/listing/[id].tsx`, `app/listings/create.tsx`, `app/listings/edit/[id].tsx`
- `components/listings/ListingMediaEditor.tsx`
- `lib/listingDraft.ts`
- `app/assistant.tsx`
- `hooks/useSearchMiniApp.ts`, `hooks/usePushNotifications.tsx`
- `constants/i18n.ts`
- `tests/lib-hardening.test.mjs`
- `app.json` → v1.0.1

---

## 9) خطواتك التالية (بالترتيب)

1. **Commit على main** (Wave 10C) — `git log -1`  
2. **Redeploy Replit** من `origin/main` → `node audit/mobile/scripts/post-redeploy-verify.mjs`  
3. **EAS preview** + `audit/mobile/DEVICE-QA-SECTION-COMPANIES.md`  
4. **`CLERK_BEARER_TOKEN`** → staging upload smoke إن متاح  
5. **لا تحذف** مسارات import/supply/rent/business لأغراض "تنظيف"  

---

## 10) روابط تقارير ذات صلة

| مستند | الغرض |
|-------|--------|
| `MOBILE-STABILIZE-PROGRESS.md` | سجل waves 0–10 |
| `HONEST-INVENTORY-2026-07-10.md` | حقيقة live vs local |
| `SECTION-ISOLATION-STRICT-2026-07-10.md` | عزل الأقسام |
| `DEVICE-QA-SECTION-COMPANIES.md` | QA جهاز |
| `NEXT-OPS-REPLIT-REDEPLOY.md` | نشر Replit |

---

*آخر تحديث: 2026-07-10 · Wave 10 · commit ي-follow هذا الملف*
