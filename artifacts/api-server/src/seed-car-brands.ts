/**
 * Production seed for the global car-brand reference (2026).
 *
 * ENRICHES the existing `brands` table in place — upsert by slug — so brands the
 * marketplace already learned or seeded are filled in with real metadata and
 * missing global brands are added, with ZERO duplication and no change to any
 * API or business logic. Search, filters, the create form and admin read the
 * same table, so they pick this up automatically.
 *
 *   pnpm --filter @workspace/api-server run seed:car-brands
 */
import { db } from "@workspace/db";
import { brands } from "@workspace/db/schema";
import { CAR_BRANDS } from "./reference/car-brands";

function keywordsFor(b: (typeof CAR_BRANDS)[number]): string[] {
  return Array.from(
    new Set(
      [...(b.keywords ?? []), b.en, b.ar, b.slug.replace(/-/g, " ")]
        .filter((s) => !!s && s.trim().length > 0)
        .map((s) => s.trim().toLowerCase()),
    ),
  );
}

async function main(): Promise<void> {
  console.log("[seed:car-brands] upserting global car brands…");
  let n = 0;
  for (const b of CAR_BRANDS) {
    const searchKeywords = keywordsFor(b);
    await db
      .insert(brands)
      .values({
        name: b.en,
        slug: b.slug,
        category: "car",
        nameAr: b.ar,
        country: b.country,
        parentCompany: b.parent ?? null,
        foundedYear: b.founded ?? null,
        isActive: true,
        isPremium: !!b.premium,
        isElectric: !!b.electric,
        isCommercial: !!b.commercial,
        popularity: b.popularity,
        searchKeywords,
      })
      .onConflictDoUpdate({
        target: brands.slug,
        set: {
          // Canonicalise to the official English name + enrich metadata. Slug is
          // the key, so this never creates a second row for the same brand.
          name: b.en,
          category: "car",
          nameAr: b.ar,
          country: b.country,
          parentCompany: b.parent ?? null,
          foundedYear: b.founded ?? null,
          isActive: true,
          isPremium: !!b.premium,
          isElectric: !!b.electric,
          isCommercial: !!b.commercial,
          popularity: b.popularity,
          searchKeywords,
          updatedAt: new Date(),
        },
      });
    n += 1;
  }
  console.log(`[seed:car-brands] upserted ${n} brands.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed:car-brands] FAILED", err);
    process.exit(1);
  });
