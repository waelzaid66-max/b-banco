import { useAuth } from "@clerk/expo";
import { MaterialCommunityIcons } from "@/components/icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSellerReviewsQueryKey,
  useCreateSellerReview,
  useGetSellerReviews,
  type SellerReview,
} from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { AppTextInput as TextInput } from "@/components/AppTextInput";

import { AppText } from "@/components/AppText";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";

const STAR_COLOR = "#F5A623";

function StarRow({
  rating,
  size,
  color,
}: {
  rating: number;
  size: number;
  color: string;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <MaterialCommunityIcons
          key={i}
          name={i <= Math.round(rating) ? "star" : "star-outline"}
          size={size}
          color={color}
        />
      ))}
    </View>
  );
}

/**
 * Compact rating summary bar for the top of the listing detail — reuses the
 * same seller-reviews query (react-query dedupes by key), so it stays in sync
 * with the full reviews section below. Renders nothing until a rating exists.
 */
export function SellerRatingBar({ sellerId }: { sellerId: string }) {
  const colors = useColors();
  const { t, isRTL } = useI18n();
  const rowDir = isRTL ? "row-reverse" : "row";

  const query = useGetSellerReviews(sellerId, {
    query: { enabled: !!sellerId, queryKey: getGetSellerReviewsQueryKey(sellerId) },
  });
  const summary = query.data?.data?.summary;
  if (!summary || summary.count < 1 || summary.average == null) return null;

  return (
    <View
      style={[
        styles.ratingBar,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          flexDirection: rowDir,
        },
      ]}
      testID="seller-rating-bar"
    >
      <AppText style={[styles.ratingBarAvg, { color: colors.foreground }]}>
        {summary.average.toFixed(1)}
      </AppText>
      <StarRow rating={summary.average} size={14} color={STAR_COLOR} />
      <AppText style={[styles.ratingBarCount, { color: colors.mutedForeground }]}>
        {t("listing.reviews.count", { count: summary.count })}
      </AppText>
    </View>
  );
}

export function SellerReviews({ sellerId }: { sellerId: string }) {
  const colors = useColors();
  const { t, isRTL } = useI18n();
  const { isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const rowDir = isRTL ? "row-reverse" : "row";
  const textAlign = isRTL ? "right" : "left";

  const query = useGetSellerReviews(sellerId, {
    query: { enabled: !!sellerId, queryKey: getGetSellerReviewsQueryKey(sellerId) },
  });
  const data = query.data?.data;
  const items: SellerReview[] = data?.items ?? [];
  const summary = data?.summary;
  const canReview = data?.can_review ?? false;
  const myRating = data?.my_rating ?? null;

  const { mutate: submitReview, isPending } = useCreateSellerReview();

  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startEditing = () => {
    setRating(myRating ?? 0);
    setBody("");
    setError(null);
    setOpen(true);
  };

  const handleSubmit = () => {
    if (rating < 1) {
      setError(t("listing.reviews.ratingRequired"));
      return;
    }
    setError(null);
    submitReview(
      { id: sellerId, data: { rating, body: body.trim() || null } },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => {}
          );
          setOpen(false);
          setBody("");
          queryClient.invalidateQueries({
            queryKey: getGetSellerReviewsQueryKey(sellerId),
          });
        },
        onError: () => setError(t("listing.reviews.error")),
      }
    );
  };

  if (query.isLoading) {
    return (
      <View style={[styles.section, { borderTopColor: colors.border }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (query.isError) return null;

  return (
    <View style={[styles.section, { borderTopColor: colors.border }]}>
      <AppText style={[styles.sectionTitle, { color: colors.foreground, textAlign }]}>
        {t("listing.reviews.title")}
      </AppText>

      <View style={[styles.aggRow, { flexDirection: rowDir }]}>
        {summary && summary.count > 0 && summary.average != null ? (
          <>
            <AppText style={[styles.aggAvg, { color: colors.foreground }]}>
              {summary.average.toFixed(1)}
            </AppText>
            <View style={{ gap: 4, alignItems: isRTL ? "flex-end" : "flex-start" }}>
              <StarRow rating={summary.average} size={15} color={STAR_COLOR} />
              <AppText
                style={[styles.aggCount, { color: colors.mutedForeground, textAlign }]}
              >
                {t("listing.reviews.count", { count: summary.count })}
              </AppText>
            </View>
          </>
        ) : (
          <AppText style={[styles.empty, { color: colors.mutedForeground, textAlign }]}>
            {t("listing.reviews.empty")}
          </AppText>
        )}
      </View>

      {isSignedIn && canReview && !open ? (
        <Pressable
          onPress={startEditing}
          style={[
            styles.writeBtn,
            {
              borderColor: colors.border,
              borderRadius: colors.radius,
              flexDirection: rowDir,
            },
          ]}
          testID="review-write"
        >
          <MaterialCommunityIcons
            name="star-plus-outline"
            size={16}
            color={colors.primary}
          />
          <AppText style={[styles.writeText, { color: colors.primary }]}>
            {myRating != null ? t("listing.reviews.edit") : t("listing.reviews.write")}
          </AppText>
        </Pressable>
      ) : null}

      {isSignedIn && !canReview && myRating == null ? (
        <AppText style={[styles.hint, { color: colors.mutedForeground, textAlign }]}>
          {t("listing.reviews.notEligible")}
        </AppText>
      ) : null}

      {!isSignedIn ? (
        <Pressable onPress={() => router.push("/(tabs)/profile")} testID="review-signin">
          <AppText style={[styles.hint, { color: colors.primary, textAlign }]}>
            {t("listing.reviews.signIn")}
          </AppText>
        </Pressable>
      ) : null}

      {open ? (
        <View
          style={[
            styles.composer,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          <AppText
            style={[styles.composerLabel, { color: colors.foreground, textAlign }]}
          >
            {t("listing.reviews.yourRating")}
          </AppText>
          <View style={[styles.starPicker, { flexDirection: rowDir }]}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Pressable
                key={i}
                onPress={() => setRating(i)}
                hitSlop={6}
                testID={`review-star-${i}`}
              >
                <MaterialCommunityIcons
                  name={i <= rating ? "star" : "star-outline"}
                  size={30}
                  color={STAR_COLOR}
                />
              </Pressable>
            ))}
          </View>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={t("listing.reviews.placeholder")}
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[
              styles.input,
              { color: colors.foreground, borderColor: colors.border, textAlign },
            ]}
            testID="review-body"
          />
          {error ? (
            <AppText style={[styles.errorText, { color: colors.primary, textAlign }]}>
              {error}
            </AppText>
          ) : null}
          <View style={[styles.composerActions, { flexDirection: rowDir }]}>
            <Pressable
              onPress={() => setOpen(false)}
              style={styles.cancelBtn}
              testID="review-cancel"
            >
              <AppText style={[styles.cancelText, { color: colors.mutedForeground }]}>
                {t("common.cancel")}
              </AppText>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={isPending}
              style={[
                styles.submitBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius,
                  opacity: isPending ? 0.6 : 1,
                },
              ]}
              testID="review-submit"
            >
              <AppText style={[styles.submitText, { color: colors.primaryForeground }]}>
                {isPending
                  ? t("listing.reviews.submitting")
                  : t("listing.reviews.submit")}
              </AppText>
            </Pressable>
          </View>
        </View>
      ) : null}

      {items.length > 0 ? (
        <View style={{ gap: 14, marginTop: 14 }}>
          {items.map((r) => (
            <View key={r.id} style={{ gap: 5 }}>
              <View style={[styles.reviewHead, { flexDirection: rowDir }]}>
                <AppText
                  style={[styles.reviewAuthor, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {r.author_name}
                </AppText>
                <StarRow rating={r.rating} size={13} color={STAR_COLOR} />
              </View>
              {r.body ? (
                <AppText
                  style={[
                    styles.reviewBody,
                    { color: colors.mutedForeground, textAlign },
                  ]}
                >
                  {r.body}
                </AppText>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 24, paddingTop: 24, borderTopWidth: 1, gap: 14 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  aggRow: { alignItems: "center", gap: 12 },
  aggAvg: { fontSize: 34, fontFamily: "Inter_700Bold" },
  aggCount: { fontSize: 13, fontFamily: "Inter_400Regular" },
  ratingBar: {
    alignSelf: "flex-start",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 4,
  },
  ratingBarAvg: { fontSize: 15, fontFamily: "Inter_700Bold" },
  ratingBarCount: { fontSize: 12.5, fontFamily: "Inter_500Medium" },
  empty: { fontSize: 14, fontFamily: "Inter_400Regular" },
  writeBtn: {
    alignSelf: "flex-start",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  writeText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  hint: { fontSize: 13.5, fontFamily: "Inter_500Medium" },
  composer: { borderWidth: 1, padding: 14, gap: 12 },
  composerLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  starPicker: { gap: 6 },
  input: {
    minHeight: 70,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14.5,
    fontFamily: "Inter_400Regular",
    textAlignVertical: "top",
  },
  errorText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  composerActions: { alignItems: "center", justifyContent: "flex-end", gap: 8 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  cancelText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  submitBtn: { paddingHorizontal: 20, paddingVertical: 10 },
  submitText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  reviewHead: { alignItems: "center", gap: 8, justifyContent: "space-between" },
  reviewAuthor: { fontSize: 14.5, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  reviewBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
