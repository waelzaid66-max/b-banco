# جرد أزرار البروفايل — كل الأدوار والحالات

**التاريخ:** 2026-07-10  
**الملف:** `artifacts/banco-mobile/app/(tabs)/profile.tsx`  
**مرجع سحابي:** `audit/production-readiness/PHASE-16-17-CLOUD.md` + `ARCHITECTURE-DEEP-UNDERSTANDING-AR.md`

---

## السبب الجذري لـ «كل الأزرار لا تعمل»

| العطل | التأثير | الإصلاح |
|-------|---------|---------|
| قائمة `⋯` (overflow) كانت `Pressable` يلف الـ sheet + `onStartShouldSetResponder={() => true}` | **يمنع اللمس** من الوصول لصفوف القائمة على Android/iOS | backdrop منفصل (`absoluteFill`) + sheet شقيق — **مُصلَح** |
| نفس النمط في `PromoteButton` (شبكة إعلانات البروفايل) | زر «ترويج» لا يستجيب | **مُصلَح** |
| مسارات `settings` / `business/verification` غير مسجّلة صراحة في `_layout` | احتمال فشل تنقّل على بعض البنيات | **مُصلَح** — `Stack.Screen` أُضيفت |

---

## حالات الشاشة

| الحالة | ماذا ترى | الأزرار المتوقعة |
|--------|----------|-----------------|
| **Guest** | نموذج تسجيل/دخول | OAuth، إيميل، تبديل لغة، نسيت كلمة المرور |
| **Clerk يحمّل** | Spinner | — |
| **needsAccountType** | اختيار فردي/تاجر/شركة | 3 بطاقات + متابعة (يحجب البروفايل الكامل مؤقتاً) |
| **مسجّل — individual** | بروفايل كامل | كل ما بالأسفل ما عدا بطاقة «وضع الأعمال» |
| **مسجّل — dealer/company/enterprise** | + بطاقة أعمال | أزرار نشر، طلبات عملاء، تبويب Leads |

---

## سطح البروفايل (مسجّل)

### أزرار الغلاف (Cover)

| testID | الإجراء | المسار/النتيجة |
|--------|---------|----------------|
| `cover-edit` | تغيير الغلاف | ImagePicker → رفع → Clerk metadata |
| `profile-menu` | قائمة `⋯` | Modal overflow (انظر القائمة) |

### الهوية

| testID | الإجراء | المسار |
|--------|---------|--------|
| `avatar-edit` | صورة شخصية | PermissionRationale → ImagePicker → Clerk |
| `profile-edit` (نص) | تعديل | Modal تعديل البروفايل |
| `profile-bio` | تعديل السيرة | نفس Modal |
| `profile-phone` | تعديل الهاتف | نفس Modal + `updateMe({ phone })` |

### إكمال الملف (إن وُجد نواقص)

| testID | الإجراء |
|--------|---------|
| `complete-photo` | صورة |
| `complete-bio` | سيرة |
| `complete-phone` | هاتف |

### روابط اجتماعية

| testID | الإجراء |
|--------|---------|
| `social-{platform}` | فتح الرابط |
| `social-edit` | Modal روابط → `setMySocialLinks` |

### تبويبات سريعة (IG-style)

| label | المسار | individual | business |
|-------|--------|------------|----------|
| tabRequests | `/rfq` | ✅ | ✅ |
| tabSaved | `/(tabs)/saved` | ✅ | ✅ |
| tabActivity | `/notifications` | ✅ | ✅ |
| tabLeads | `/business/requests` | ❌ | ✅ |

### بطاقة الأعمال (dealer/company/enterprise فقط)

| testID | المسار |
|--------|--------|
| `business-post-listing` | `/listings/create` |
| `business-my-listings` | `/listings/mine` |
| `business-customer-requests` | `/business/requests` |
| (onboarding CTA إن وُجد) | `/business/onboarding` |

### شبكة إعلاناتي

| الإجراء | المسار |
|---------|--------|
| بطاقة إعلان | `/listing/{id}` |
| ترويج | PromoteButton sheet |
| إنشاء أول إعلان | `/listings/create` |

---

## قائمة Overflow (`⋯`) — كل الأدوار

| key | testID | المسار | ملاحظة |
|-----|--------|--------|--------|
| edit | menu-edit | Modal تعديل | |
| cover | menu-cover | غلاف | |
| listings | menu-listings | `/listings/mine` | |
| business | menu-business | `/business/supply-hub` | كل الأدوار |
| industry | menu-industry | `/industry` | |
| rental-hub | menu-rental-hub | `/rentals/hub` | **دائماً ظاهر** (موجة 5) |
| trips | menu-trips | `/bookings` | |
| wallet | menu-wallet | `/billing` | المحفظة داخل billing |
| plans | menu-plans | `/plans` | |
| verify | menu-verify | `/business/verification` | |
| account | menu-account | شاشة اختيار نوع الحساب | |
| settings | menu-settings | `/settings` | |
| help | menu-help | `/settings` | نفس الإعدادات حالياً |
| signout | menu-signout | `signOut()` | |

---

## ما لا يزال خارج البروفايل (بالتصميم)

| الميزة | أين تُدار |
|--------|-----------|
| أرقام متعددة + واتساب للإعلان | `listings/create` → `specs.contact_phones` |
| هاتف الحساب الواحد | البروفايل → تعديل → `users.phone` |
| واتساب كرابط عام | روابط اجتماعية |

---

## تحقق على الجهاز (بعد البناء)

1. سجّل دخول → افتح البروفايل → `⋯` → اضغط **كل** صف في القائمة — يجب التنقّل أو فتح modal.
2. كرر كـ **individual** و **dealer**.
3. اضغط تبويبات Requests / Saved / Activity (+ Leads للتاجر).
4. من شبكة الإعلانات: افتح إعلاناً + جرّب «ترويج».

**لا تُعلَن PASS من مراجعة كود فقط.**
