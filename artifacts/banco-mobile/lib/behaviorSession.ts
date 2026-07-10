/**
 * Stable behavior-session id for feed ranking / analytics. Persisted across
 * reloads so home/search do not reset personalization on every JS restart.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "banco:behavior_session_id:v1";

function generateSessionId(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 11)}`;
}

function isValidSessionId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length >= 8;
}

/** Web can read synchronously; native hydrates via AsyncStorage. */
export function readBehaviorSessionIdSync(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isValidSessionId(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function loadOrCreateBehaviorSessionId(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (isValidSessionId(stored)) return stored;

    const synced = readBehaviorSessionIdSync();
    if (synced) {
      await AsyncStorage.setItem(STORAGE_KEY, synced);
      return synced;
    }

    const fresh = generateSessionId();
    await AsyncStorage.setItem(STORAGE_KEY, fresh);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, fresh);
    }
    return fresh;
  } catch {
    return readBehaviorSessionIdSync() ?? generateSessionId();
  }
}
