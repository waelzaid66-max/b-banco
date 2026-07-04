/**
 * Global car-brand reference data (2026) — real manufacturer facts.
 *
 * This ENRICHES the existing `brands` table (category = "car"); it does not
 * create a parallel list. The seed upserts by slug, so a brand the marketplace
 * already learned/seeded (Toyota, BMW, …) is enriched in place — never
 * duplicated — and missing global brands are added. Because search, filters, the
 * create form and admin all already read `brands`, they pick this up with no
 * API or business-logic change.
 *
 * Scope of THIS phase: brands only. Models / generations / trims / years come
 * later via the existing models / car_variants tables (hierarchy already present).
 *
 * Fields left out on purpose: `logo` — we do not fabricate asset URLs; logoUrl
 * stays null until real logo files are uploaded (the column is ready).
 * `popularity` is an editorial 0–100 sort weight (MENA-market informed), not a
 * measured statistic.
 */

export interface CarBrandSeed {
  slug: string;
  en: string;
  ar: string;
  country: string;
  parent?: string;
  founded?: number;
  premium?: boolean;
  electric?: boolean; // EV-only marque
  commercial?: boolean; // primarily commercial/trucks/vans
  popularity: number; // 0–100 relative sort weight
  keywords?: string[];
}

// prettier-ignore
export const CAR_BRANDS: CarBrandSeed[] = [
  // ── Japanese ─────────────────────────────────────────────
  { slug: "toyota", en: "Toyota", ar: "تويوتا", country: "Japan", parent: "Toyota Motor Corporation", founded: 1937, popularity: 98, keywords: ["toyota", "تويوتا"] },
  { slug: "lexus", en: "Lexus", ar: "لكزس", country: "Japan", parent: "Toyota Motor Corporation", founded: 1989, premium: true, popularity: 84, keywords: ["lexus", "لكزس", "لكسس"] },
  { slug: "honda", en: "Honda", ar: "هوندا", country: "Japan", parent: "Honda Motor", founded: 1948, popularity: 90, keywords: ["honda", "هوندا"] },
  { slug: "acura", en: "Acura", ar: "أكيورا", country: "Japan", parent: "Honda Motor", founded: 1986, premium: true, popularity: 55, keywords: ["acura", "اكيورا"] },
  { slug: "nissan", en: "Nissan", ar: "نيسان", country: "Japan", parent: "Nissan Motor", founded: 1933, popularity: 91, keywords: ["nissan", "نيسان"] },
  { slug: "infiniti", en: "Infiniti", ar: "إنفينيتي", country: "Japan", parent: "Nissan Motor", founded: 1989, premium: true, popularity: 62, keywords: ["infiniti", "انفينيتي"] },
  { slug: "mazda", en: "Mazda", ar: "مازда", country: "Japan", parent: "Mazda Motor", founded: 1920, popularity: 80, keywords: ["mazda", "مازدا"] },
  { slug: "mitsubishi", en: "Mitsubishi", ar: "ميتسوبيشي", country: "Japan", parent: "Mitsubishi Motors", founded: 1970, popularity: 83, keywords: ["mitsubishi", "ميتسوبيشي"] },
  { slug: "subaru", en: "Subaru", ar: "سوبارو", country: "Japan", parent: "Subaru Corporation", founded: 1953, popularity: 66, keywords: ["subaru", "سوبارو"] },
  { slug: "suzuki", en: "Suzuki", ar: "سوزوكي", country: "Japan", parent: "Suzuki Motor", founded: 1909, popularity: 82, keywords: ["suzuki", "سوزوكي"] },
  { slug: "daihatsu", en: "Daihatsu", ar: "دايهاتسو", country: "Japan", parent: "Toyota Motor Corporation", founded: 1907, popularity: 52, keywords: ["daihatsu", "دايهاتسو"] },
  { slug: "isuzu", en: "Isuzu", ar: "إيسوزو", country: "Japan", parent: "Isuzu Motors", founded: 1916, commercial: true, popularity: 70, keywords: ["isuzu", "ايسوزو"] },
  { slug: "hino", en: "Hino", ar: "هينو", country: "Japan", parent: "Toyota Motor Corporation", founded: 1942, commercial: true, popularity: 48, keywords: ["hino", "هينو"] },

  // ── Korean ───────────────────────────────────────────────
  { slug: "hyundai", en: "Hyundai", ar: "هيونداي", country: "South Korea", parent: "Hyundai Motor Group", founded: 1967, popularity: 96, keywords: ["hyundai", "هيونداي", "هيونداى"] },
  { slug: "kia", en: "Kia", ar: "كيا", country: "South Korea", parent: "Hyundai Motor Group", founded: 1944, popularity: 95, keywords: ["kia", "كيا"] },
  { slug: "genesis", en: "Genesis", ar: "جينيسيس", country: "South Korea", parent: "Hyundai Motor Group", founded: 2015, premium: true, popularity: 58, keywords: ["genesis", "جينيسيس"] },
  { slug: "ssangyong", en: "SsangYong (KGM)", ar: "سانج يونج", country: "South Korea", parent: "KG Mobility", founded: 1954, popularity: 45, keywords: ["ssangyong", "kgm", "سانج يونج"] },

  // ── German ───────────────────────────────────────────────
  { slug: "mercedes-benz", en: "Mercedes-Benz", ar: "مرسيدس بنز", country: "Germany", parent: "Mercedes-Benz Group", founded: 1926, premium: true, popularity: 92, keywords: ["mercedes", "mercedes-benz", "مرسيدس", "بنز"] },
  { slug: "maybach", en: "Mercedes-Maybach", ar: "مايباخ", country: "Germany", parent: "Mercedes-Benz Group", founded: 1909, premium: true, popularity: 40, keywords: ["maybach", "مايباخ"] },
  { slug: "bmw", en: "BMW", ar: "بي إم دبليو", country: "Germany", parent: "BMW Group", founded: 1916, premium: true, popularity: 91, keywords: ["bmw", "بي ام دبليو", "بمو"] },
  { slug: "mini", en: "MINI", ar: "ميني", country: "United Kingdom", parent: "BMW Group", founded: 1959, premium: true, popularity: 60, keywords: ["mini", "ميني"] },
  { slug: "audi", en: "Audi", ar: "أودي", country: "Germany", parent: "Volkswagen Group", founded: 1909, premium: true, popularity: 88, keywords: ["audi", "اودي", "أودي"] },
  { slug: "volkswagen", en: "Volkswagen", ar: "فولكس فاجن", country: "Germany", parent: "Volkswagen Group", founded: 1937, popularity: 84, keywords: ["volkswagen", "vw", "فولكس فاجن", "فولكسفاجن"] },
  { slug: "porsche", en: "Porsche", ar: "بورش", country: "Germany", parent: "Volkswagen Group", founded: 1931, premium: true, popularity: 76, keywords: ["porsche", "بورش", "بورشه"] },
  { slug: "opel", en: "Opel", ar: "أوبل", country: "Germany", parent: "Stellantis", founded: 1862, popularity: 64, keywords: ["opel", "اوبل"] },
  { slug: "smart", en: "Smart", ar: "سمارت", country: "Germany", parent: "Mercedes-Benz Group / Geely", founded: 1994, electric: true, popularity: 42, keywords: ["smart", "سمارت"] },

  // ── British ──────────────────────────────────────────────
  { slug: "land-rover", en: "Land Rover", ar: "لاند روفر", country: "United Kingdom", parent: "Tata Motors (JLR)", founded: 1948, premium: true, popularity: 79, keywords: ["land rover", "range rover", "لاند روفر", "رينج روفر"] },
  { slug: "jaguar", en: "Jaguar", ar: "جاجوار", country: "United Kingdom", parent: "Tata Motors (JLR)", founded: 1935, premium: true, popularity: 62, keywords: ["jaguar", "جاجوار", "جاكوار"] },
  { slug: "bentley", en: "Bentley", ar: "بنتلي", country: "United Kingdom", parent: "Volkswagen Group", founded: 1919, premium: true, popularity: 50, keywords: ["bentley", "بنتلي"] },
  { slug: "rolls-royce", en: "Rolls-Royce", ar: "رولز رويس", country: "United Kingdom", parent: "BMW Group", founded: 1904, premium: true, popularity: 52, keywords: ["rolls royce", "rolls-royce", "رولز رويس"] },
  { slug: "aston-martin", en: "Aston Martin", ar: "أستون مارتن", country: "United Kingdom", parent: "Aston Martin Lagonda", founded: 1913, premium: true, popularity: 48, keywords: ["aston martin", "استون مارتن"] },
  { slug: "mclaren", en: "McLaren", ar: "ماكلارين", country: "United Kingdom", parent: "McLaren Group", founded: 1985, premium: true, popularity: 44, keywords: ["mclaren", "ماكلارين"] },
  { slug: "lotus", en: "Lotus", ar: "لوتس", country: "United Kingdom", parent: "Geely", founded: 1948, premium: true, popularity: 40, keywords: ["lotus", "لوتس"] },
  { slug: "mg", en: "MG", ar: "إم جي", country: "United Kingdom", parent: "SAIC Motor", founded: 1924, popularity: 86, keywords: ["mg", "ام جي", "إم جي"] },
  { slug: "ineos", en: "Ineos", ar: "إينيوس", country: "United Kingdom", parent: "Ineos Automotive", founded: 2017, popularity: 30, keywords: ["ineos", "grenadier", "اينيوس"] },

  // ── Italian ──────────────────────────────────────────────
  { slug: "ferrari", en: "Ferrari", ar: "فيراري", country: "Italy", parent: "Ferrari N.V.", founded: 1939, premium: true, popularity: 60, keywords: ["ferrari", "فيراري"] },
  { slug: "lamborghini", en: "Lamborghini", ar: "لامبورجيني", country: "Italy", parent: "Volkswagen Group (Audi)", founded: 1963, premium: true, popularity: 58, keywords: ["lamborghini", "لامبورجيني", "لمبرجيني"] },
  { slug: "maserati", en: "Maserati", ar: "مازيراتي", country: "Italy", parent: "Stellantis", founded: 1914, premium: true, popularity: 50, keywords: ["maserati", "مازيراتي"] },
  { slug: "alfa-romeo", en: "Alfa Romeo", ar: "ألفا روميو", country: "Italy", parent: "Stellantis", founded: 1910, premium: true, popularity: 52, keywords: ["alfa romeo", "الفا روميو"] },
  { slug: "fiat", en: "Fiat", ar: "فيات", country: "Italy", parent: "Stellantis", founded: 1899, popularity: 68, keywords: ["fiat", "فيات"] },
  { slug: "lancia", en: "Lancia", ar: "لانشيا", country: "Italy", parent: "Stellantis", founded: 1906, popularity: 32, keywords: ["lancia", "لانشيا"] },
  { slug: "abarth", en: "Abarth", ar: "أبارث", country: "Italy", parent: "Stellantis", founded: 1949, popularity: 34, keywords: ["abarth", "ابارث"] },
  { slug: "pagani", en: "Pagani", ar: "باجاني", country: "Italy", parent: "Pagani Automobili", founded: 1992, premium: true, popularity: 28, keywords: ["pagani", "باجاني"] },

  // ── French ───────────────────────────────────────────────
  { slug: "renault", en: "Renault", ar: "رينو", country: "France", parent: "Renault Group", founded: 1899, popularity: 78, keywords: ["renault", "رينو", "رينلت"] },
  { slug: "peugeot", en: "Peugeot", ar: "بيجو", country: "France", parent: "Stellantis", founded: 1810, popularity: 80, keywords: ["peugeot", "بيجو"] },
  { slug: "citroen", en: "Citroën", ar: "ستروين", country: "France", parent: "Stellantis", founded: 1919, popularity: 66, keywords: ["citroen", "citroën", "ستروين", "سيتروين"] },
  { slug: "ds", en: "DS Automobiles", ar: "دي إس", country: "France", parent: "Stellantis", founded: 2014, premium: true, popularity: 40, keywords: ["ds", "دي اس"] },
  { slug: "alpine", en: "Alpine", ar: "ألبين", country: "France", parent: "Renault Group", founded: 1955, premium: true, popularity: 34, keywords: ["alpine", "البين"] },
  { slug: "bugatti", en: "Bugatti", ar: "بوجاتي", country: "France", parent: "Bugatti Rimac", founded: 1909, premium: true, popularity: 40, keywords: ["bugatti", "بوجاتي"] },
  { slug: "dacia", en: "Dacia", ar: "داسيا", country: "Romania", parent: "Renault Group", founded: 1966, popularity: 62, keywords: ["dacia", "داسيا"] },

  // ── American ─────────────────────────────────────────────
  { slug: "ford", en: "Ford", ar: "فورد", country: "United States", parent: "Ford Motor Company", founded: 1903, popularity: 85, keywords: ["ford", "فورد"] },
  { slug: "lincoln", en: "Lincoln", ar: "لينكون", country: "United States", parent: "Ford Motor Company", founded: 1917, premium: true, popularity: 50, keywords: ["lincoln", "لينكون"] },
  { slug: "chevrolet", en: "Chevrolet", ar: "شيفروليه", country: "United States", parent: "General Motors", founded: 1911, popularity: 84, keywords: ["chevrolet", "chevy", "شيفروليه", "شيفورليه"] },
  { slug: "gmc", en: "GMC", ar: "جي إم سي", country: "United States", parent: "General Motors", founded: 1911, popularity: 60, keywords: ["gmc", "جي ام سي"] },
  { slug: "cadillac", en: "Cadillac", ar: "كاديلاك", country: "United States", parent: "General Motors", founded: 1902, premium: true, popularity: 58, keywords: ["cadillac", "كاديلاك"] },
  { slug: "buick", en: "Buick", ar: "بويك", country: "United States", parent: "General Motors", founded: 1903, popularity: 44, keywords: ["buick", "بويك"] },
  { slug: "chrysler", en: "Chrysler", ar: "كرايسلر", country: "United States", parent: "Stellantis", founded: 1925, popularity: 52, keywords: ["chrysler", "كرايسلر"] },
  { slug: "dodge", en: "Dodge", ar: "دودج", country: "United States", parent: "Stellantis", founded: 1900, popularity: 62, keywords: ["dodge", "دودج"] },
  { slug: "jeep", en: "Jeep", ar: "جيب", country: "United States", parent: "Stellantis", founded: 1943, popularity: 82, keywords: ["jeep", "جيب"] },
  { slug: "ram", en: "RAM", ar: "رام", country: "United States", parent: "Stellantis", founded: 2010, commercial: true, popularity: 56, keywords: ["ram", "رام"] },
  { slug: "tesla", en: "Tesla", ar: "تسلا", country: "United States", parent: "Tesla, Inc.", founded: 2003, premium: true, electric: true, popularity: 78, keywords: ["tesla", "تسلا"] },
  { slug: "rivian", en: "Rivian", ar: "ريفيان", country: "United States", parent: "Rivian Automotive", founded: 2009, electric: true, popularity: 40, keywords: ["rivian", "ريفيان"] },
  { slug: "lucid", en: "Lucid", ar: "لوسيد", country: "United States", parent: "Lucid Group", founded: 2007, premium: true, electric: true, popularity: 42, keywords: ["lucid", "لوسيد"] },
  { slug: "fisker", en: "Fisker", ar: "فيسكر", country: "United States", parent: "Fisker Inc.", founded: 2016, electric: true, popularity: 26, keywords: ["fisker", "فيسكر"] },
  { slug: "hummer", en: "Hummer", ar: "همر", country: "United States", parent: "General Motors", founded: 1992, electric: true, popularity: 48, keywords: ["hummer", "همر"] },

  // ── Swedish ──────────────────────────────────────────────
  { slug: "volvo", en: "Volvo", ar: "فولفو", country: "Sweden", parent: "Geely", founded: 1927, premium: true, popularity: 70, keywords: ["volvo", "فولفو"] },
  { slug: "polestar", en: "Polestar", ar: "بولستار", country: "Sweden", parent: "Geely / Volvo", founded: 2017, premium: true, electric: true, popularity: 44, keywords: ["polestar", "بولستار"] },
  { slug: "koenigsegg", en: "Koenigsegg", ar: "كوينيجزيج", country: "Sweden", parent: "Koenigsegg", founded: 1994, premium: true, popularity: 26, keywords: ["koenigsegg", "كوينجزيج"] },

  // ── Czech / Spanish ──────────────────────────────────────
  { slug: "skoda", en: "Škoda", ar: "شكودا", country: "Czech Republic", parent: "Volkswagen Group", founded: 1895, popularity: 74, keywords: ["skoda", "škoda", "شكودا", "سكودا"] },
  { slug: "seat", en: "SEAT", ar: "سيات", country: "Spain", parent: "Volkswagen Group", founded: 1950, popularity: 58, keywords: ["seat", "سيات"] },
  { slug: "cupra", en: "Cupra", ar: "كوبرا", country: "Spain", parent: "Volkswagen Group", founded: 2018, premium: true, popularity: 46, keywords: ["cupra", "كوبرا"] },

  // ── Indian / Malaysian / Russian ─────────────────────────
  { slug: "tata", en: "Tata", ar: "تاتا", country: "India", parent: "Tata Motors", founded: 1945, popularity: 54, keywords: ["tata", "تاتا"] },
  { slug: "mahindra", en: "Mahindra", ar: "ماهيندرا", country: "India", parent: "Mahindra & Mahindra", founded: 1945, popularity: 50, keywords: ["mahindra", "ماهيندرا"] },
  { slug: "proton", en: "Proton", ar: "بروتون", country: "Malaysia", parent: "Geely / DRB-HICOM", founded: 1983, popularity: 42, keywords: ["proton", "بروتون"] },
  { slug: "perodua", en: "Perodua", ar: "بيرودوا", country: "Malaysia", parent: "Perodua", founded: 1993, popularity: 34, keywords: ["perodua", "بيرودوا"] },
  { slug: "lada", en: "Lada", ar: "لادا", country: "Russia", parent: "AvtoVAZ", founded: 1966, popularity: 40, keywords: ["lada", "لادا"] },

  // ── Chinese ──────────────────────────────────────────────
  { slug: "byd", en: "BYD", ar: "بي واي دي", country: "China", parent: "BYD Auto", founded: 1995, electric: true, popularity: 88, keywords: ["byd", "بي واي دي"] },
  { slug: "denza", en: "Denza", ar: "دينزا", country: "China", parent: "BYD Auto", founded: 2010, premium: true, electric: true, popularity: 40, keywords: ["denza", "دينزا"] },
  { slug: "geely", en: "Geely", ar: "جيلي", country: "China", parent: "Geely Holding", founded: 1986, popularity: 80, keywords: ["geely", "جيلي"] },
  { slug: "zeekr", en: "Zeekr", ar: "زيكر", country: "China", parent: "Geely Holding", founded: 2021, premium: true, electric: true, popularity: 56, keywords: ["zeekr", "زيكر"] },
  { slug: "lynk-co", en: "Lynk & Co", ar: "لينك آند كو", country: "China", parent: "Geely Holding", founded: 2016, popularity: 44, keywords: ["lynk", "lynk & co", "لينك"] },
  { slug: "chery", en: "Chery", ar: "شيري", country: "China", parent: "Chery Automobile", founded: 1997, popularity: 82, keywords: ["chery", "شيري"] },
  { slug: "omoda", en: "Omoda", ar: "أومودا", country: "China", parent: "Chery Automobile", founded: 2022, popularity: 58, keywords: ["omoda", "اومودا"] },
  { slug: "jaecoo", en: "Jaecoo", ar: "جايكو", country: "China", parent: "Chery Automobile", founded: 2023, popularity: 52, keywords: ["jaecoo", "جايكو"] },
  { slug: "exeed", en: "Exeed", ar: "إكسيد", country: "China", parent: "Chery Automobile", founded: 2017, premium: true, popularity: 46, keywords: ["exeed", "اكسيد"] },
  { slug: "gwm", en: "Great Wall Motors", ar: "جريت وول", country: "China", parent: "Great Wall Motors", founded: 1984, popularity: 70, keywords: ["great wall", "gwm", "جريت وول"] },
  { slug: "haval", en: "Haval", ar: "هافال", country: "China", parent: "Great Wall Motors", founded: 2013, popularity: 74, keywords: ["haval", "هافال"] },
  { slug: "tank", en: "Tank", ar: "تانك", country: "China", parent: "Great Wall Motors", founded: 2021, popularity: 50, keywords: ["tank", "تانك"] },
  { slug: "ora", en: "Ora", ar: "أورا", country: "China", parent: "Great Wall Motors", founded: 2018, electric: true, popularity: 44, keywords: ["ora", "اورا"] },
  { slug: "changan", en: "Changan", ar: "شانجان", country: "China", parent: "Changan Automobile", founded: 1862, popularity: 68, keywords: ["changan", "شانجان", "شانجن"] },
  { slug: "deepal", en: "Deepal", ar: "ديبال", country: "China", parent: "Changan Automobile", founded: 2022, electric: true, popularity: 40, keywords: ["deepal", "ديبال"] },
  { slug: "gac", en: "GAC", ar: "جي إيه سي", country: "China", parent: "GAC Group", founded: 1997, popularity: 58, keywords: ["gac", "trumpchi", "جي ايه سي"] },
  { slug: "saic-maxus", en: "Maxus", ar: "ماكسوس", country: "China", parent: "SAIC Motor", founded: 2011, commercial: true, popularity: 46, keywords: ["maxus", "ماكسوس"] },
  { slug: "wuling", en: "Wuling", ar: "وولينج", country: "China", parent: "SAIC-GM-Wuling", founded: 2002, popularity: 40, keywords: ["wuling", "وولينج"] },
  { slug: "baic", en: "BAIC", ar: "بايك", country: "China", parent: "BAIC Group", founded: 1958, popularity: 48, keywords: ["baic", "بايك"] },
  { slug: "faw", en: "FAW", ar: "فاو", country: "China", parent: "FAW Group", founded: 1953, popularity: 42, keywords: ["faw", "فاو"] },
  { slug: "hongqi", en: "Hongqi", ar: "هونشي", country: "China", parent: "FAW Group", founded: 1958, premium: true, popularity: 40, keywords: ["hongqi", "هونشي"] },
  { slug: "dongfeng", en: "Dongfeng", ar: "دونجفينج", country: "China", parent: "Dongfeng Motor", founded: 1969, popularity: 46, keywords: ["dongfeng", "دونجفينج"] },
  { slug: "voyah", en: "Voyah", ar: "فوياه", country: "China", parent: "Dongfeng Motor", founded: 2020, premium: true, electric: true, popularity: 34, keywords: ["voyah", "فوياه"] },
  { slug: "jac", en: "JAC", ar: "جاك", country: "China", parent: "JAC Motors", founded: 1964, popularity: 44, keywords: ["jac", "جاك"] },
  { slug: "jetour", en: "Jetour", ar: "جيتور", country: "China", parent: "Chery Automobile", founded: 2018, popularity: 56, keywords: ["jetour", "جيتور"] },
  { slug: "bestune", en: "Bestune", ar: "بيستون", country: "China", parent: "FAW Group", founded: 2006, popularity: 34, keywords: ["bestune", "بيستون"] },
  { slug: "nio", en: "NIO", ar: "نيو", country: "China", parent: "NIO Inc.", founded: 2014, premium: true, electric: true, popularity: 50, keywords: ["nio", "نيو"] },
  { slug: "xpeng", en: "XPeng", ar: "إكس بينج", country: "China", parent: "XPeng Motors", founded: 2014, electric: true, popularity: 48, keywords: ["xpeng", "اكس بينج"] },
  { slug: "li-auto", en: "Li Auto", ar: "لي أوتو", country: "China", parent: "Li Auto Inc.", founded: 2015, electric: true, popularity: 46, keywords: ["li auto", "lixiang", "لي اوتو"] },
  { slug: "leapmotor", en: "Leapmotor", ar: "ليب موتور", country: "China", parent: "Leapmotor / Stellantis", founded: 2015, electric: true, popularity: 40, keywords: ["leapmotor", "ليب موتور"] },
  { slug: "aito", en: "AITO", ar: "أيتو", country: "China", parent: "Seres / Huawei", founded: 2021, electric: true, popularity: 40, keywords: ["aito", "seres", "ايتو"] },
  { slug: "avatr", en: "Avatr", ar: "أفاتر", country: "China", parent: "Changan / CATL / Huawei", founded: 2018, premium: true, electric: true, popularity: 32, keywords: ["avatr", "افاتر"] },
  { slug: "skywell", en: "Skywell", ar: "سكاي ويل", country: "China", parent: "Skywell", founded: 2019, electric: true, popularity: 30, keywords: ["skywell", "سكاي ويل"] },
  { slug: "foton", en: "Foton", ar: "فوتون", country: "China", parent: "BAIC Group", founded: 1996, commercial: true, popularity: 44, keywords: ["foton", "فوتون"] },

  // ── Vietnamese ───────────────────────────────────────────
  { slug: "vinfast", en: "VinFast", ar: "فينفاست", country: "Vietnam", parent: "Vingroup", founded: 2017, electric: true, popularity: 40, keywords: ["vinfast", "فينفاست"] },
];
