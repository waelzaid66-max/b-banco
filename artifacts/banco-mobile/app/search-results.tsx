import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useColors } from "@/hooks/useColors";

/**
 * Legacy route — forwards to the Search tab so one surface owns criteria, map,
 * facets, and pagination. Keeps old deep links and bookmarks working.
 */
export default function SearchResultsScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<Record<string, string | string[]>>();

  useEffect(() => {
    const flat: Record<string, string> = { ts: String(Date.now()) };
    for (const [key, value] of Object.entries(params)) {
      if (value == null || key === "ts") continue;
      flat[key] = Array.isArray(value) ? value[0] : String(value);
    }
    router.replace({ pathname: "/(tabs)/search", params: flat });
  }, [params]);

  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
