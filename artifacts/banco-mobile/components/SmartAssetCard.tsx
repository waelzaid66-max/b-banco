import { Ionicons, MaterialCommunityIcons } from "@/components/icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { FeedItem, sendBehaviorSignal } from "@workspace/api-client-react";

import { BReactionButton } from "@/components/BReactionButton";
import { isVerifiedSignal } from "@/constants/feed";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/context/LanguageContext";
import { useSession } from "@/context/SessionContext";
import { shareListing } from "@/lib/share";

// The save glyph adapts to the section — a car for cars, a key for real estate,
// a factory mark for industrial (falls back to the heart) — so the action reads
// in the product's own language, and the filled + primary state still clearly
// means "saved".
type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
const SAVE_ICONS: Record<string, { on: IoniconName; off: IoniconName }> = {
  car: { on: "car", off: "car-outline" },
  real_estate: { on: "key", off: "key-outline" },
  industrial: { on: "business", off: "business-outline" },
};
function saveIconFor(
  category: string | null | undefined,
  saved: boolean | undefined,
): IoniconName {
  const pair = SAVE_ICONS[category ?? ""] ?? { on: "heart", off: "heart-outline" };
  return saved ? pair.on : pair.off;
}

interface SmartAssetCardProps {
  item: FeedItem;
  onPress?: (item: FeedItem) => void;
  onSave?: (item: FeedItem) => void;
  isSaved?: boolean;
  compact?: boolean;
}

function SmartAssetCardComponent({
  item,
  onPress,
  onSave,
  isSaved,
  compact,
}: SmartAssetCardProps) {
  const colors = useColors();
  const { t } = useI18n();
  const { cacheFeedItem, sessionId } = useSession();

  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const shadowOpacity = useSharedValue(0.18);
  const androidElevation = useSharedValue(4);

  const outerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    shadowOpacity: shadowOpacity.value,
    elevation: androidElevation.value,
    shadowRadius: 10,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
  }));

  const handlePressIn = () => {
    if (reduceMotion) return;
    scale.value = withTiming(0.96, { duration: 80 });
    shadowOpacity.value = withTiming(0.06, { duration: 80 });
    androidElevation.value = withTiming(1, { duration: 80 });
  };

  const handlePressOut = () => {
    if (reduceMotion) return;
    scale.value = withTiming(1.0, { duration: 120 });
    shadowOpacity.value = withTiming(0.18, { duration: 120 });
    androidElevation.value = withTiming(4, { duration: 120 });
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Seed the cache-first lookup with this exact list item before navigating,
    // so the detail screen paints from list data while the full record loads.
    cacheFeedItem(item);
    onPress?.(item);
  };

  const handleSave = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSave?.(item);
  };

  // B-reactions (long-press on the identity B): real personalization signals —
  // "interested" boosts this category's affinity in the adaptive feed, "angry"
  // lowers it. Fire-and-forget; a network hiccup never touches the UI.
  const sendReaction = (action: "interested" | "angry") => {
    void sendBehaviorSignal({
      session_id: sessionId,
      listing_id: item.id,
      action,
      category: item.category ?? undefined,
    }).catch(() => {});
  };

  const handleShare = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void shareListing({
      id: item.id,
      title: item.title,
      price: item.price_display,
    });
  };

  const imageHeight = compact ? 140 : 200;
  const isVerified = isVerifiedSignal(item.trust_signal);

  return (
    <Animated.View
      style={[styles.outerContainer, { borderRadius: colors.radius }, outerAnimatedStyle]}
    >
      <View
        style={[
          styles.innerContainer,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={handlePress}
          testID={`asset-card-${item.id}`}
        >
          <View style={[styles.imageWrapper, { height: imageHeight }]}>
            <Image
              source={{ uri: item.media_preview }}
              style={[
                styles.image,
                {
                  borderTopLeftRadius: colors.radius,
                  borderTopRightRadius: colors.radius,
                },
              ]}
              contentFit="cover"
              transition={200}
            />

            <View style={styles.topBadges}>
              {item.is_sponsored && (
                <View style={styles.sponsoredBadge}>
                  <Text style={styles.sponsoredText}>{t("common.featured")}</Text>
                </View>
              )}
              {item.urgency_signal ? (
                <View
                  style={[
                    styles.urgencyBadge,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  <Text style={styles.urgencyText}>{item.urgency_signal}</Text>
                </View>
              ) : null}
              {/* Bookable (furnished/daily rental) — icon-only so it needs no
                  translation and matches the 📅 map pin. */}
              {item.is_bookable ? (
                <View style={[styles.bookableBadge, { backgroundColor: colors.primary }]}>
                  <Ionicons name="calendar" size={12} color="#FFFFFF" />
                </View>
              ) : null}
            </View>

            {item.has_video && (
              <View style={styles.videoIndicator}>
                <Ionicons name="play-circle" size={20} color="#FFFFFF" />
              </View>
            )}

            <View style={styles.topRightActions}>
              <Pressable
                style={styles.actionBtn}
                onPress={handleShare}
                testID={`share-${item.id}`}
                hitSlop={8}
              >
                <Ionicons name="share-social-outline" size={20} color="#FFFFFF" />
              </Pressable>
              {onSave && (
                <View style={styles.actionBtn}>
                  <BReactionButton
                    saved={!!isSaved}
                    likeIcon={saveIconFor(item.category, true)}
                    onLike={handleSave}
                    onInterested={() => sendReaction("interested")}
                    onAngry={() => sendReaction("angry")}
                    height={30}
                    testID={`save-${item.id}`}
                  />
                </View>
              )}
            </View>
          </View>

          <View style={styles.content}>
            <Text
              style={[styles.price, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {item.price_display}
            </Text>

            {item.installment_badge ? (
              <View
                style={[
                  styles.installmentPill,
                  {
                    backgroundColor: colors.primary + "14",
                    borderColor: colors.primary + "33",
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name="calendar-month-outline"
                  size={13}
                  color={colors.primary}
                />
                <Text
                  style={[styles.installmentPillText, { color: colors.primary }]}
                  numberOfLines={1}
                >
                  {item.installment_badge}
                </Text>
              </View>
            ) : null}

            <Text
              style={[styles.title, { color: colors.foreground }]}
              numberOfLines={2}
            >
              {item.title}
            </Text>

            <View style={styles.metaRow}>
              <View style={styles.locationRow}>
                <Ionicons
                  name="location-outline"
                  size={11}
                  color={colors.mutedForeground}
                />
                <Text
                  style={[styles.location, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {item.location}
                </Text>
              </View>
              <View style={styles.trustRow}>
                {isVerified && (
                  <MaterialCommunityIcons
                    name="check-decagram"
                    size={13}
                    color={colors.primary}
                  />
                )}
                <Text
                  style={[
                    styles.trust,
                    {
                      color: isVerified
                        ? colors.primary
                        : colors.mutedForeground,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {item.trust_signal}
                </Text>
              </View>
            </View>

            {item.smart_badge ? (
              <View
                style={[
                  styles.smartBadge,
                  { backgroundColor: colors.muted, borderRadius: 6 },
                ]}
              >
                <Text style={[styles.smartText, { color: colors.accent }]}>
                  {item.smart_badge}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      </View>
    </Animated.View>
  );
}

export const SmartAssetCard = React.memo(
  SmartAssetCardComponent,
  (prev, next) =>
    prev.item.id === next.item.id &&
    prev.isSaved === next.isSaved &&
    prev.compact === next.compact &&
    prev.onPress === next.onPress &&
    prev.onSave === next.onSave
);

const styles = StyleSheet.create({
  outerContainer: {
    marginBottom: 12,
  },
  innerContainer: {
    borderWidth: 1,
    overflow: "hidden",
  },
  imageWrapper: {
    position: "relative",
    width: "100%",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  topBadges: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    gap: 6,
  },
  sponsoredBadge: {
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  sponsoredText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
  },
  urgencyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  bookableBadge: {
    width: 22,
    height: 22,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  urgencyText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  videoIndicator: {
    position: "absolute",
    bottom: 10,
    left: 10,
  },
  topRightActions: {
    position: "absolute",
    top: 10,
    right: 10,
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 20,
    padding: 6,
  },
  content: {
    padding: 12,
    gap: 4,
  },
  price: {
    fontSize: 21,
    fontFamily: "Inter_700Bold",
  },
  installmentPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
  },
  installmentPillText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  title: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    flex: 1,
  },
  location: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  trustRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  trust: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  smartBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
  },
  smartText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
});
