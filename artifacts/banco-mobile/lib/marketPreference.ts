/**
 * Shared preferred market ISO (EG, SA, …) for search + publish.
 * Search filters inventory by this; create stamps specs.market_country.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_MARKET_COUNTRY } from "@/constants/listingCreateTaxonomy";

const STORAGE_KEY = "banco:preferred_market_country:v1";

const ISO2 = /^[A-Za-z]{2}$/;

export function normalizeMarketCountry(code: string | null | undefined): string {
  const iso = (code ?? "").trim().toUpperCase();
  return ISO2.test(iso) ? iso : DEFAULT_MARKET_COUNTRY;
}

/** Web can read persisted market synchronously; native still hydrates via AsyncStorage. */
function readStoredMarketSync(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeMarketCountry(raw);
  } catch {
    return null;
  }
}

/** First-paint market on web; default on native until AsyncStorage resolves. */
export function readPreferredMarketCountrySync(): string {
  return readStoredMarketSync() ?? DEFAULT_MARKET_COUNTRY;
}

export async function loadPreferredMarketCountry(): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return normalizeMarketCountry(raw);
  } catch {
    return DEFAULT_MARKET_COUNTRY;
  }
}

export async function savePreferredMarketCountry(code: string): Promise<string> {
  const iso = normalizeMarketCountry(code);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, iso);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, iso);
    }
  } catch {
    // Preference is best-effort; search/create still use the in-memory value.
  }
  return iso;
}
