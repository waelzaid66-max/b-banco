import type { ExpoConfig } from "expo/config";

import appJson from "./app.json";

const expo = appJson.expo as ExpoConfig;

/**
 * Deep-link / universal-link origin for expo-router static rendering.
 *
 * - Dev / Replit: defaults to https://replit.com/ (matches current tunnel host).
 * - Production EAS: set EXPO_PUBLIC_ROUTER_ORIGIN=https://your-production-domain
 *   in the EAS production environment before `eas build --profile production`.
 *
 * Do NOT hardcode the production domain here — it would break local Expo Go dev.
 */
const routerOrigin =
  process.env.EXPO_PUBLIC_ROUTER_ORIGIN?.trim() ||
  process.env.EXPO_ROUTER_ORIGIN?.trim() ||
  "https://replit.com/";

function withRouterOrigin(plugins: ExpoConfig["plugins"]): ExpoConfig["plugins"] {
  return (plugins ?? []).map((plugin) => {
    if (Array.isArray(plugin) && plugin[0] === "expo-router") {
      const opts =
        typeof plugin[1] === "object" && plugin[1] !== null ? plugin[1] : {};
      return ["expo-router", { ...opts, origin: routerOrigin }];
    }
    return plugin;
  });
}

export default (): ExpoConfig => ({
  ...expo,
  plugins: withRouterOrigin(expo.plugins),
});
