/**
 * Lightweight, dependency-free client crash logging.
 *
 * Surfaces React render crashes (via the root ErrorBoundary's onError) AND
 * uncaught global JS errors (via React Native's ErrorUtils) with a clear
 * "[crash]" tag, so they appear in Expo / EAS / device logs instead of
 * vanishing. It is a SINGLE seam: an off-device reporter (Sentry React Native,
 * or a POST to the API's error ingest) can be added inside `logClientCrash`
 * later without touching any caller. No new dependency, no native config.
 */

export type CrashContext = Record<string, unknown>;

export function logClientCrash(error: unknown, context: CrashContext = {}): void {
  const e = error instanceof Error ? error : new Error(String(error));
  // The one place a crash is recorded. Kept best-effort — logging a crash must
  // never itself throw.
  try {
    console.error("[crash]", e.message, { stack: e.stack, ...context });
  } catch {
    // ignore
  }
  // Future off-device hook (Sentry RN / POST /v1/client-errors) goes here.
}

type RNErrorUtils = {
  getGlobalHandler?: () => ((e: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (e: unknown, isFatal?: boolean) => void) => void;
};

let installed = false;

/**
 * Install a global handler for uncaught JS errors (call once at the app root).
 * Preserves the platform's existing handler (red-box in dev / default crash),
 * so behavior is unchanged — we only ADD logging.
 */
export function installGlobalCrashHandler(): void {
  if (installed) return;
  installed = true;
  const errorUtils = (globalThis as { ErrorUtils?: RNErrorUtils }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;
  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((err, isFatal) => {
    logClientCrash(err, { kind: "globalJsError", isFatal: !!isFatal });
    previous?.(err, isFatal);
  });
}
