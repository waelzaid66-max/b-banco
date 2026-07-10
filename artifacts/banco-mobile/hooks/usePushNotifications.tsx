import { useAuth } from "@clerk/expo";
import {
  getListNotificationsQueryKey,
  registerPushToken,
  unregisterPushToken,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { useSound } from "@/context/SoundContext";
import {
  notificationRequiresAuth,
  routeForNotification,
} from "@/lib/notificationRouting";

/**
 * Remote push wiring (Task #102).
 *
 * - Registers this device's Expo push token with the backend once the user is
 *   signed in, and unregisters on sign-out (so a shared device stops receiving
 *   the previous user's pushes).
 * - Shows the banner in the foreground so an open-app user still sees a new
 *   message/reply land.
 * - Deep-links on tap using the SAME routing table as the in-app feed, for both
 *   warm taps and a cold start opened from a notification.
 *
 * Everything is best-effort and guarded: missing permission, a simulator, web,
 * or an absent EAS projectId all degrade silently to "no push" rather than
 * crashing — the in-app feed remains the source of truth.
 */

// Expo Go (SDK 53+) removed remote-push support; calling the remote notification
// APIs there throws synchronously and red-boxes the whole app on launch. Detect
// Expo Go and degrade to "no push" — standalone/dev builds are unaffected.
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Foreground presentation. SDK 53+ uses shouldShowBanner/shouldShowList.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function platformTag(): "ios" | "android" | "web" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

// On a cold start the router isn't mounted the instant the tap is delivered, so
// the first push() can throw. Retry a few times with a short backoff before
// giving up, so a notification tap reliably lands on the right screen instead of
// silently dropping the user on the home feed.
function navigateWhenReady(dest: Parameters<typeof router.push>[0], attempt = 0) {
  try {
    router.push(dest);
  } catch {
    if (attempt < 10) {
      setTimeout(() => navigateWhenReady(dest, attempt + 1), 250);
    }
  }
}

function handleResponse(
  response: Notifications.NotificationResponse | null,
  signedIn: boolean,
) {
  if (!response) return;
  const data = (response.notification.request.content.data ?? {}) as Record<
    string,
    unknown
  >;
  const type = typeof data.type === "string" ? data.type : undefined;
  const dest = routeForNotification(type, data);
  if (!dest) return;
  if (!signedIn && notificationRequiresAuth(dest)) {
    navigateWhenReady("/(tabs)/profile");
    return;
  }
  navigateWhenReady(dest);
}

async function obtainExpoPushToken(): Promise<string | null> {
  // Push tokens require a physical device; web/simulators can't get one.
  if (Platform.OS === "web") return null;
  if (isExpoGo) return null;
  if (!Device.isDevice) return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") return null;

  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId ?? Constants.easConfig?.projectId;

  const tokenResponse = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  return tokenResponse.data;
}

export function PushNotificationsBridge() {
  const { isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  // The local "Push notifications" setting gates device registration: turning it
  // off unregisters this device's token (server stops pushing here); turning it
  // back on re-registers. `ready` defers the first run until the stored pref has
  // loaded, so we never register-then-immediately-unregister on cold start.
  const { notificationsEnabled, ready } = useSound();
  const tokenRef = useRef<string | null>(null);

  // Register when signed in AND notifications are enabled; otherwise unregister.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    if (isSignedIn && notificationsEnabled) {
      obtainExpoPushToken()
        .then((token) => {
          if (cancelled || !token) return;
          tokenRef.current = token;
          return registerPushToken({ token, platform: platformTag() });
        })
        .catch((err) => {
          console.warn("[Push] registration skipped:", err);
        });
    } else if (tokenRef.current) {
      const token = tokenRef.current;
      tokenRef.current = null;
      unregisterPushToken({ token }).catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, notificationsEnabled, ready]);

  // Refresh in-app feed + home bell badge when a push lands while the app is open.
  useEffect(() => {
    if (isExpoGo) return;
    const sub = Notifications.addNotificationReceivedListener(() => {
      queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    });
    return () => sub.remove();
  }, [queryClient]);

  // Deep-link on tap: cold start (opened from a notification) + warm taps.
  useEffect(() => {
    if (isExpoGo) return;
    Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        handleResponse(r, isSignedIn === true);
        if (r) {
          queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
        }
      })
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      handleResponse(r, isSignedIn === true);
      queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    });
    return () => sub.remove();
  }, [isSignedIn, queryClient]);

  return null;
}
