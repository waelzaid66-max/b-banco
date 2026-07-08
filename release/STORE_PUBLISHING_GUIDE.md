# 🚀 دليل النشر على المتاجر — BANCO (من الصفر للتشغيل الكامل)

> آخر تحديث: 2026-07-05 · الحالة الكودية: كل البوابات خضراء @ `1f860f0`
> (السويت الكامل 265 ✓ · typecheck 7 أسطح ✓ · أيقونات SVG أندرويد 6/6 ✓)

---

## المرحلة 0 — الأدوات المفضلة لهذا الحجم (وليه)

| الدور | الأداة | ليه هي الأنسب |
|---|---|---|
| بناء ونشر الموبايل | **EAS (Expo Application Services)** | المشروع Expo أصلاً؛ بيبني iOS بدون ماك، بيوقّع تلقائياً، وبيرفع للمتاجر بأمر واحد (`eas submit`). المعيار الصناعي لمشاريع Expo الكبيرة. |
| استضافة الـAPI | **خادم مُدار (Railway / Render / Fly.io)** أو Replit Deployments الحالي | Express + Postgres جاهزين؛ المهم `PORT` و`DATABASE_URL` صح (راجع DEPLOY_VERIFICATION.md). |
| قاعدة البيانات | **Postgres مُدار (Neon / Supabase / Railway PG)** | نسخ احتياطي تلقائي + point-in-time recovery — إلزامي لسوق حقيقي. |
| مواقع الويب (admin/market/landing) | **Vercel أو Cloudflare Pages** | Vite static builds؛ نشر لحظي + CDN عالمي + رجوع فوري لأي إصدار. |
| المصادقة | **Clerk** (مُركّب بالفعل) | مفاتيح production instance منفصلة عن التطوير. |
| مراقبة الأعطال | **Sentry** (الكراش ريبورتنج مُركّب) | DSN إنتاجي في الـenv. |

## المرحلة 1 — الحسابات المطلوبة (مرة واحدة)

1. **Google Play Console** — 25$ مرة واحدة → console.play.google.com
2. **Apple Developer Program** — 99$/سنة → developer.apple.com
3. **حساب Expo/EAS** — مجاني للبداية → expo.dev
4. تجهيز **صفحة سياسة الخصوصية على رابط عام** (متوفرة داخل التطبيق `/legal/privacy` — انشر الويب أولاً أو استخدم صفحة اللاندنج).

## المرحلة 2 — البيئة الإنتاجية (قبل أي بناء)

ضع القيم الحقيقية (لا تُكتب في الكود أبداً — بيئة فقط):

```
# API (الخادم)
DATABASE_URL=postgresql://...   (الإنتاجي)
CLERK_SECRET_KEY=sk_live_...
PORT=(اللي المنصة بتحدده)
OPENAI_API_KEY=... (المساعد الذكي)
RESEND_API_KEY=... (الإيميلات)
# PAYMOB_* — معطّل حتى تفعيل صريح

# الموبايل (EAS env — production environment)
EXPO_PUBLIC_DOMAIN=api.yourdomain.com   ← دومين الـAPI الإنتاجي
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
EXPO_PUBLIC_ROUTER_ORIGIN=https://yourdomain.com   ← قبل بناء المتجر فقط

# اللاندنج (روابط الصفحة الرسمية)
VITE_MARKET_URL=https://market.yourdomain.com
VITE_ADMIN_URL=https://admin.yourdomain.com
VITE_APP_ANDROID_URL=(رابط Google Play بعد النشر)
VITE_APP_IOS_URL=(رابط App Store بعد النشر)
```

## المرحلة 3 — وسم الإصدار (نقطة الرجوع)

```bash
git tag v1.0.0 && git push boom v1.0.0
```
كل بناء للمتاجر يكون **من هذا الوسم حصرياً**.

## المرحلة 4 — بناء أندرويد ورفعه

```bash
cd artifacts/banco-mobile
npx eas login                          # مرة واحدة
npx eas build --platform android --profile production
# لما يخلص:
npx eas submit --platform android      # يرفع لـ Play Console مباشرة
```
في Play Console: املأ Store listing (الاسم BANCO OOM، الوصف AR/EN،
لقطات شاشة، الأيقونة موجودة) + Data safety + Content rating → Internal
testing أولاً → ثم Production.

## المرحلة 5 — بناء iOS ورفعه

```bash
npx eas build --platform ios --profile production   # لا يحتاج ماك
npx eas submit --platform ios                        # يرفع لـ App Store Connect
```
في App Store Connect: Store listing + Privacy labels → TestFlight أولاً → ثم
Submit for Review.

## المرحلة 6 — نشر الويب

1. الـAPI: انشر من `1f860f0` (راجع release/DEPLOY_VERIFICATION.md — بوابة
   الـDB/PORT معالجة).
2. admin-os / dealer-os / landing: `pnpm --filter <app> run build` → ارفع
   `dist/` على Vercel/Cloudflare مع env أعلاه.
3. حدّث روابط اللاندنج (`VITE_*`) بعد ما تعرف الدومينات النهائية.

## المرحلة 7 — تحقق ما بعد النشر (نفس بوابات الفحص)

- [ ] `GET /api/v1/feed` من الدومين الإنتاجي يرد 200 بقائمة (مش 500).
- [ ] تسجيل دخول حقيقي من التطبيق (Clerk live).
- [ ] نشر إعلان بصورة + ظهوره في الفيد والبحث.
- [ ] محادثة + إشعار + حجز يومي تجريبي.
- [ ] لوحة الأدمن بحساب staff.

## قواعد الأمان الدائمة

- **صفر أسرار في git** (مُطبَّق — dumps اتشالت، env فقط).
- إصدار جديد = **tag جديد** + نفس البوابات خضراء قبل الرفع.
- الرجوع = إعادة نشر الوسم السابق (المتاجر: phased rollout يوقف بضغطة).
