import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { translations, type Lang } from "@/constants/i18n";

type Weight = "regular" | "medium" | "semibold" | "bold";

const FONTS: Record<Lang, Record<Weight, string>> = {
  en: {
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    semibold: "Inter_600SemiBold",
    bold: "Inter_700Bold",
  },
  ar: {
    regular: "Cairo_400Regular",
    medium: "Cairo_500Medium",
    semibold: "Cairo_600SemiBold",
    bold: "Cairo_700Bold",
  },
};

const STORAGE_KEY = "banco.lang";

/** Web can read persisted lang synchronously; native still hydrates via AsyncStorage. */
function readStoredLangSync(): Lang | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "ar" || stored === "en") return stored;
  } catch {
    // ignore — private mode / blocked storage
  }
  return null;
}

// Module-level snapshot of the active language so components rendered OUTSIDE
// LanguageProvider (e.g. the ErrorBoundary fallback) can still localize their
// text without the context. Kept in sync by the provider effect below.
let currentLang: Lang = "en";

export function getCurrentLang(): Lang {
  return currentLang;
}

type LanguageContextValue = {
  lang: Lang;
  isRTL: boolean;
  ready: boolean;
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  font: (weight?: Weight) => string;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined,
);

function resolve(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj,
    );
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readStoredLangSync() ?? "en");
  const [ready, setReady] = useState(() => readStoredLangSync() !== null);

  useEffect(() => {
    if (ready) return;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === "ar" || stored === "en") setLangState(stored);
      } catch {
        // ignore — fall back to default language
      }
      setReady(true);
    })();
  }, [ready]);

  useEffect(() => {
    currentLang = lang;
  }, [lang]);

  const value = useMemo<LanguageContextValue>(() => {
    const isRTL = lang === "ar";

    const setLang = (l: Lang) => {
      setLangState(l);
      AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {});
    };

    const t = (key: string, vars?: Record<string, string | number>) => {
      let str = resolve(translations[lang], key);
      if (typeof str !== "string") str = resolve(translations.en, key);
      if (typeof str !== "string") return key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = (str as string).replace(
            new RegExp(`\\{${k}\\}`, "g"),
            String(v),
          );
        }
      }
      return str as string;
    };

    const font = (weight: Weight = "regular") => FONTS[lang][weight];

    return {
      lang,
      isRTL,
      ready,
      setLang,
      toggle: () => setLang(lang === "ar" ? "en" : "ar"),
      t,
      font,
    };
  }, [lang, ready]);

  // Avoid one-frame LTR→RTL flip (wrong font + mirrored layout) before hydration.
  if (!ready) return null;

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useI18n must be used within LanguageProvider");
  }
  return ctx;
}
