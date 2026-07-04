import { useAuth } from "@clerk/expo";
import { MaterialCommunityIcons } from "@/components/icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetListingCommentsQueryKey,
  useCreateListingComment,
  useDeleteListingComment,
  useGetListingComments,
  type Comment,
} from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from "react-native";
import { AppTextInput as TextInput } from "@/components/AppTextInput";

import { AppText } from "@/components/AppText";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";

type Colors = ReturnType<typeof useColors>;

function CommentBubble({
  comment,
  colors,
  rowDir,
  textAlign,
  sellerLabel,
  canDelete,
  onDelete,
  deleteLabel,
}: {
  comment: Comment;
  colors: Colors;
  rowDir: "row" | "row-reverse";
  textAlign: "left" | "right";
  sellerLabel: string;
  canDelete: boolean;
  onDelete: () => void;
  deleteLabel: string;
}) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: rowDir, alignItems: "center", gap: 6 }}>
        <AppText style={[styles.author, { color: colors.foreground }]} numberOfLines={1}>
          {comment.author_name}
        </AppText>
        {comment.is_seller ? (
          <View
            style={[
              styles.sellerPill,
              {
                backgroundColor: colors.primary + "14",
                borderColor: colors.primary + "33",
              },
            ]}
          >
            <MaterialCommunityIcons name="shield-check" size={10} color={colors.primary} />
            <AppText style={[styles.sellerPillText, { color: colors.primary }]}>
              {sellerLabel}
            </AppText>
          </View>
        ) : null}
        {canDelete ? (
          <Pressable
            onPress={onDelete}
            hitSlop={8}
            style={[styles.deleteBtn, isRTLDir(rowDir) ? { marginRight: "auto" } : { marginLeft: "auto" }]}
            accessibilityLabel={deleteLabel}
            testID={`comment-delete-${comment.id}`}
          >
            <MaterialCommunityIcons
              name="trash-can-outline"
              size={15}
              color={colors.mutedForeground}
            />
          </Pressable>
        ) : null}
      </View>
      <AppText style={[styles.body, { color: colors.mutedForeground, textAlign }]}>
        {comment.body}
      </AppText>
    </View>
  );
}

function isRTLDir(rowDir: "row" | "row-reverse") {
  return rowDir === "row-reverse";
}

export function ListingComments({
  listingId,
  viewerId,
  isOwner = false,
}: {
  listingId: string;
  viewerId?: string | null;
  isOwner?: boolean;
}) {
  const colors = useColors();
  const { t, isRTL } = useI18n();
  const { isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const rowDir = isRTL ? "row-reverse" : "row";
  const textAlign = isRTL ? "right" : "left";

  const query = useGetListingComments(listingId, {
    query: { enabled: !!listingId, queryKey: getGetListingCommentsQueryKey(listingId) },
  });
  const all: Comment[] = query.data?.data ?? [];

  const { topLevel, repliesByParent } = useMemo(() => {
    const top: Comment[] = [];
    const map: Record<string, Comment[]> = {};
    for (const c of all) {
      if (c.parent_id) {
        (map[c.parent_id] ??= []).push(c);
      } else {
        top.push(c);
      }
    }
    return { topLevel: top, repliesByParent: map };
  }, [all]);

  const { mutate: postComment, isPending } = useCreateListingComment();
  const { mutate: removeComment } = useDeleteListingComment();

  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getGetListingCommentsQueryKey(listingId),
    });

  // A comment is deletable by its own author or by the listing owner.
  const canDeleteComment = (c: Comment) =>
    isOwner || (!!viewerId && c.author_id === viewerId);

  const confirmDelete = (c: Comment) => {
    Alert.alert(
      t("listing.comments.deleteTitle"),
      t("listing.comments.deleteBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("listing.comments.deleteConfirm"),
          style: "destructive",
          onPress: () =>
            removeComment(
              { id: listingId, commentId: c.id },
              {
                onSuccess: () => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                    () => {}
                  );
                  invalidate();
                },
                onError: () => setError(t("listing.comments.error")),
              }
            ),
        },
      ]
    );
  };

  const submit = (raw: string, parentId: string | null, clear: () => void) => {
    const body = raw.trim();
    if (!body) return;
    setError(null);
    postComment(
      { id: listingId, data: { body, parent_id: parentId } },
      {
        onSuccess: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          clear();
          setReplyTo(null);
          invalidate();
        },
        onError: (e) => {
          const code = (e as { code?: string })?.code;
          setError(
            code === "RATE_LIMITED"
              ? t("listing.comments.rateLimited")
              : t("listing.comments.error")
          );
        },
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

  const sellerLabel = t("listing.comments.sellerBadge");

  return (
    <View style={[styles.section, { borderTopColor: colors.border }]}>
      <AppText style={[styles.sectionTitle, { color: colors.foreground, textAlign }]}>
        {t("listing.comments.title")}
      </AppText>

      {isSignedIn ? (
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
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("listing.comments.placeholder")}
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[styles.input, { color: colors.foreground, textAlign }]}
            testID="comment-input"
          />
          <View style={[styles.composerActions, { flexDirection: rowDir }]}>
            <Pressable
              onPress={() => submit(text, null, () => setText(""))}
              disabled={isPending || !text.trim()}
              style={[
                styles.submitBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius,
                  opacity: isPending || !text.trim() ? 0.5 : 1,
                },
              ]}
              testID="comment-submit"
            >
              <AppText style={[styles.submitText, { color: colors.primaryForeground }]}>
                {isPending && !replyTo
                  ? t("listing.comments.sending")
                  : t("listing.comments.send")}
              </AppText>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => router.push("/(tabs)/profile")}
          testID="comment-signin"
        >
          <AppText style={[styles.hint, { color: colors.primary, textAlign }]}>
            {t("listing.comments.signIn")}
          </AppText>
        </Pressable>
      )}

      {error ? (
        <AppText style={[styles.errorText, { color: colors.primary, textAlign }]}>
          {error}
        </AppText>
      ) : null}

      {topLevel.length === 0 ? (
        <AppText style={[styles.empty, { color: colors.mutedForeground, textAlign }]}>
          {t("listing.comments.empty")}
        </AppText>
      ) : (
        <View style={{ gap: 18 }}>
          {topLevel.map((c) => {
            const replies = repliesByParent[c.id] ?? [];
            return (
              <View key={c.id} style={{ gap: 10 }}>
                <CommentBubble
                  comment={c}
                  colors={colors}
                  rowDir={rowDir}
                  textAlign={textAlign}
                  sellerLabel={sellerLabel}
                  canDelete={canDeleteComment(c)}
                  onDelete={() => confirmDelete(c)}
                  deleteLabel={t("listing.comments.delete")}
                />
                {replies.length > 0 ? (
                  <View
                    style={[
                      styles.replies,
                      isRTL
                        ? {
                            borderRightColor: colors.border,
                            borderRightWidth: 2,
                            paddingRight: 12,
                          }
                        : {
                            borderLeftColor: colors.border,
                            borderLeftWidth: 2,
                            paddingLeft: 12,
                          },
                    ]}
                  >
                    {replies.map((r) => (
                      <CommentBubble
                        key={r.id}
                        comment={r}
                        colors={colors}
                        rowDir={rowDir}
                        textAlign={textAlign}
                        sellerLabel={sellerLabel}
                        canDelete={canDeleteComment(r)}
                        onDelete={() => confirmDelete(r)}
                        deleteLabel={t("listing.comments.delete")}
                      />
                    ))}
                  </View>
                ) : null}
                {isSignedIn ? (
                  replyTo === c.id ? (
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
                      <TextInput
                        value={replyText}
                        onChangeText={setReplyText}
                        placeholder={t("listing.comments.replyPlaceholder")}
                        placeholderTextColor={colors.mutedForeground}
                        multiline
                        style={[styles.input, { color: colors.foreground, textAlign }]}
                        testID={`comment-reply-input-${c.id}`}
                        autoFocus
                      />
                      <View style={[styles.composerActions, { flexDirection: rowDir }]}>
                        <Pressable
                          onPress={() => {
                            setReplyTo(null);
                            setReplyText("");
                          }}
                          style={styles.cancelBtn}
                          testID={`comment-reply-cancel-${c.id}`}
                        >
                          <AppText
                            style={[styles.cancelText, { color: colors.mutedForeground }]}
                          >
                            {t("common.cancel")}
                          </AppText>
                        </Pressable>
                        <Pressable
                          onPress={() => submit(replyText, c.id, () => setReplyText(""))}
                          disabled={isPending || !replyText.trim()}
                          style={[
                            styles.submitBtn,
                            {
                              backgroundColor: colors.primary,
                              borderRadius: colors.radius,
                              opacity: isPending || !replyText.trim() ? 0.5 : 1,
                            },
                          ]}
                          testID={`comment-reply-submit-${c.id}`}
                        >
                          <AppText
                            style={[styles.submitText, { color: colors.primaryForeground }]}
                          >
                            {t("listing.comments.send")}
                          </AppText>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => {
                        setReplyTo(c.id);
                        setReplyText("");
                      }}
                      hitSlop={6}
                      testID={`comment-reply-${c.id}`}
                    >
                      <AppText style={[styles.replyLink, { color: colors.primary, textAlign }]}>
                        {t("listing.comments.reply")}
                      </AppText>
                    </Pressable>
                  )
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 24, paddingTop: 24, borderTopWidth: 1, gap: 14 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  composer: { borderWidth: 1, padding: 12, gap: 10 },
  input: {
    minHeight: 56,
    fontSize: 14.5,
    fontFamily: "Inter_400Regular",
    textAlignVertical: "top",
  },
  composerActions: { alignItems: "center", justifyContent: "flex-end", gap: 8 },
  submitBtn: { paddingHorizontal: 20, paddingVertical: 9 },
  submitText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 9 },
  cancelText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  hint: { fontSize: 13.5, fontFamily: "Inter_500Medium" },
  errorText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  empty: { fontSize: 14, fontFamily: "Inter_400Regular" },
  replies: { marginLeft: 4, gap: 12 },
  replyLink: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  author: { fontSize: 14.5, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  sellerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sellerPillText: { fontSize: 10.5, fontFamily: "Inter_700Bold" },
  deleteBtn: { padding: 2 },
});
