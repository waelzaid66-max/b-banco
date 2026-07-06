import { Feather } from "@/components/icons";
import {
  useGetMessages,
  sendMessage,
  reactToMessage,
  markConversationRead,
  updateListing,
  getListConversationsQueryKey,
  getGetMessagesQueryKey,
  getGetListingQueryKey,
  type Message,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  useWindowDimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { AppTextInput } from "@/components/AppTextInput";
import { EmojiPicker } from "@/components/EmojiPicker";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { uploadImageAsset } from "@/lib/upload";

// Allowlisted emojis for message reactions — MUST mirror the server's
// REACTION_EMOJIS (ConversationService) so toggles aren't rejected.
const REACTION_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "🔥"];

// Optimistic, client-only message that renders instantly while the send is in
// flight. It carries a delivery status so the bubble can show sending/failed and
// offer a tap-to-retry, then it is dropped once the server echo arrives.
type PendingStatus = "sending" | "failed";
type PendingMessage = {
  tempId: string;
  body: string;
  localUri?: string;
  asset?: ImagePicker.ImagePickerAsset;
  status: PendingStatus;
};
type Row =
  | { kind: "server"; msg: Message }
  | { kind: "pending"; msg: PendingMessage };

function timeLabel(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleTimeString(locale === "ar" ? "ar-EG" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function ThreadScreen() {
  const colors = useColors();
  const { t, isRTL, lang } = useI18n();
  const insets = useSafeAreaInsets();
  // Absolute bubble cap. A percentage maxWidth on a flex-row child inside a
  // FlatList doesn't resolve reliably on RN and collapses the bubble to the
  // longest word ("one word per line"); an absolute px cap fixes it.
  const { width: winW } = useWindowDimensions();
  const bubbleMaxWidth = Math.round(winW * 0.78);
  const params = useLocalSearchParams<{
    id: string;
    name?: string;
    listingId?: string;
    role?: string;
  }>();
  const conversationId = params.id;
  const qc = useQueryClient();

  // Mark-sold is a seller-only action and only when the inbox handed us the
  // listing id + viewer role (it does). Buyers and deep-links won't see it.
  const canMarkSold = params.role === "seller" && !!params.listingId;

  const [draft, setDraft] = useState("");
  // Messenger-style: the quick-emoji strip is collapsed behind a smiley toggle
  // in the composer, so the thread keeps its full height while typing.
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [soldDone, setSoldDone] = useState(false);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [previewAsset, setPreviewAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  // The message a long-press opened the reaction/reply sheet for; and the
  // message the composer is currently quoting in a reply.
  const [actionFor, setActionFor] = useState<Message | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const listRef = useRef<FlatList<Row>>(null);
  const lastReadCountRef = useRef(0);

  const query = useGetMessages(conversationId, {
    query: {
      queryKey: getGetMessagesQueryKey(conversationId),
      enabled: !!conversationId,
      refetchInterval: 3000,
      refetchOnWindowFocus: true,
    },
  });

  const messages: Message[] = query.data?.data ?? [];

  // Mark the thread read whenever new messages arrive (or on first load),
  // then refresh the inbox so the unread badge clears.
  const markRead = useCallback(async () => {
    if (!conversationId) return;
    try {
      await markConversationRead(conversationId);
      qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    } catch (err) {
      // Best-effort background sync — never block the chat UI on it. Surface in
      // dev so a persistently stuck unread badge is debuggable instead of silent.
      if (__DEV__) console.warn(t("chat.markReadFailed"), err);
    }
  }, [conversationId, qc, t]);

  // Rows = server history followed by any still-pending optimistic messages.
  const rows: Row[] = [
    ...messages.map((msg) => ({ kind: "server" as const, msg })),
    ...pending.map((msg) => ({ kind: "pending" as const, msg })),
  ];

  // Read receipt belongs only under the last of MY delivered messages.
  const lastMineReadAt = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].is_mine) return messages[i].read_at ?? null;
    }
    return undefined;
  })();
  const lastMineId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].is_mine) return messages[i].id;
    }
    return undefined;
  })();

  const scrollToEnd = useCallback((animated: boolean) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }, []);

  useEffect(() => {
    if (messages.length !== lastReadCountRef.current) {
      lastReadCountRef.current = messages.length;
      markRead();
      scrollToEnd(true);
    }
  }, [messages.length, markRead, scrollToEnd]);

  // Deliver one optimistic message: render it instantly, then call the API. On
  // success drop the placeholder (the server echo from refetch replaces it); on
  // failure flip it to "failed" so the bubble offers tap-to-retry.
  const deliver = useCallback(
    async (
      tempId: string,
      payload: {
        body?: string;
        media_url?: string;
        media_kind?: "image" | "video" | "audio";
        reply_to_id?: string;
        listing_ref_id?: string;
      }
    ) => {
      if (!conversationId) return;
      try {
        await sendMessage(conversationId, {
          body: payload.body ?? "",
          ...(payload.media_url ? { media_url: payload.media_url } : {}),
          ...(payload.media_kind ? { media_kind: payload.media_kind } : {}),
          ...(payload.reply_to_id ? { reply_to_id: payload.reply_to_id } : {}),
          ...(payload.listing_ref_id ? { listing_ref_id: payload.listing_ref_id } : {}),
        });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await query.refetch();
        qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        setPending((p) => p.filter((m) => m.tempId !== tempId));
      } catch {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setPending((p) =>
          p.map((m) => (m.tempId === tempId ? { ...m, status: "failed" } : m))
        );
      }
    },
    [conversationId, qc, query]
  );

  const handleSend = () => {
    const body = draft.trim();
    if (!body || !conversationId) return;
    setDraft("");
    const replyId = replyTo?.id;
    setReplyTo(null);
    const tempId = `t-${Date.now()}`;
    setPending((p) => [...p, { tempId, body, status: "sending" }]);
    scrollToEnd(true);
    void deliver(tempId, { body, ...(replyId ? { reply_to_id: replyId } : {}) });
  };

  // Toggle an emoji reaction on a message, then refetch so the chips update.
  const react = useCallback(
    async (messageId: string, emoji: string) => {
      if (!conversationId) return;
      setActionFor(null);
      try {
        Haptics.selectionAsync();
        await reactToMessage(conversationId, messageId, { emoji });
        await query.refetch();
      } catch {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    },
    [conversationId, query]
  );

  // Share the conversation's listing as a card inside the chat. Sent directly
  // (no optimistic bubble) — the card needs server-resolved title/thumb/price.
  const shareListing = useCallback(async () => {
    if (!conversationId || !params.listingId) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await sendMessage(conversationId, { body: "", listing_ref_id: params.listingId });
      await query.refetch();
      qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      scrollToEnd(true);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t("common.error"), t("chat.shareListingError"));
    }
  }, [conversationId, params.listingId, query, qc, scrollToEnd, t]);

  // Retry a failed optimistic message in place.
  const retry = useCallback(
    (m: PendingMessage) => {
      setPending((p) =>
        p.map((x) => (x.tempId === m.tempId ? { ...x, status: "sending" } : x))
      );
      if (m.asset) {
        const asset = m.asset;
        void (async () => {
          try {
            setUploading(true);
            const url = await uploadImageAsset(asset);
            await deliver(m.tempId, { media_url: url });
          } catch {
            setPending((p) =>
              p.map((x) =>
                x.tempId === m.tempId ? { ...x, status: "failed" } : x
              )
            );
          } finally {
            setUploading(false);
          }
        })();
      } else {
        void deliver(m.tempId, { body: m.body });
      }
    },
    [deliver]
  );

  // Step 1 of image send: pick from library and show a preview before sending —
  // the user confirms the exact photo (and can cancel) instead of it firing off
  // the moment it is picked.
  const handleAttachImage = async () => {
    if (uploading || !conversationId) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t("chat.photoPermTitle"), t("chat.photoPermBody"));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setPreviewAsset(result.assets[0]);
    } catch {
      Alert.alert(t("chat.uploadFailTitle"), t("chat.uploadFailBody"));
    }
  };

  // Step 2: confirm the previewed image — upload, then send optimistically with
  // an in-flight bubble showing the local image + spinner.
  const confirmSendImage = async () => {
    const asset = previewAsset;
    if (!asset || !conversationId) return;
    setPreviewAsset(null);
    const tempId = `t-${Date.now()}`;
    setPending((p) => [
      ...p,
      { tempId, body: "", localUri: asset.uri, asset, status: "sending" },
    ]);
    scrollToEnd(true);
    try {
      setUploading(true);
      const url = await uploadImageAsset(asset);
      await deliver(tempId, { media_url: url });
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPending((p) =>
        p.map((m) => (m.tempId === tempId ? { ...m, status: "failed" } : m))
      );
    } finally {
      setUploading(false);
    }
  };

  const handleMarkSold = () => {
    if (!params.listingId || soldDone) return;
    Alert.alert(t("chat.markSoldTitle"), t("chat.markSoldBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("chat.markSoldConfirm"),
        onPress: async () => {
          try {
            await updateListing(params.listingId as string, { status: "sold" });
            setSoldDone(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            qc.invalidateQueries({
              queryKey: getGetListingQueryKey(params.listingId as string),
            });
          } catch {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert(t("common.error"), t("chat.markSoldError"));
          }
        },
      },
    ]);
  };

  const renderRow = ({ item: row }: { item: Row }) => {
    const mine = row.kind === "pending" ? true : row.msg.is_mine;
    const mediaUrl =
      row.kind === "pending" ? row.msg.localUri : row.msg.media_url ?? undefined;
    const body = row.msg.body;
    const isPending = row.kind === "pending";
    const failed = isPending && row.msg.status === "failed";
    const inFlight = isPending && row.msg.status === "sending";
    const showReceipt =
      row.kind === "server" && mine && row.msg.id === lastMineId;

    // Social fields live only on delivered (server) messages.
    const server = row.kind === "server" ? row.msg : null;
    const replyPreview = server?.reply_to ?? null;
    const listingRef = server?.listing_ref ?? null;
    const reactions = server?.reactions ?? {};
    const myReactions = server?.my_reactions ?? [];

    const bubbleInner = (
      <View
        style={[
          styles.bubble,
          {
            maxWidth: bubbleMaxWidth,
            backgroundColor: mine ? colors.primary : colors.card,
            borderColor: failed ? colors.destructive : colors.border,
            borderWidth: mine && !failed ? 0 : StyleSheet.hairlineWidth,
            borderBottomRightRadius: mine ? 4 : 16,
            borderBottomLeftRadius: mine ? 16 : 4,
            opacity: inFlight ? 0.85 : 1,
          },
        ]}
      >
        {replyPreview ? (
          <View
            style={[
              styles.quote,
              {
                borderStartColor: mine ? colors.primaryForeground : colors.primary,
                backgroundColor: mine ? "rgba(255,255,255,0.14)" : colors.background,
              },
            ]}
          >
            <AppText
              numberOfLines={1}
              style={[
                styles.quoteText,
                { color: mine ? colors.primaryForeground : colors.mutedForeground },
              ]}
            >
              {replyPreview.body || t("chat.attachment")}
            </AppText>
          </View>
        ) : null}
        {listingRef ? (
          <Pressable
            onPress={() => router.push(`/listing/${listingRef.id}`)}
            style={[
              styles.listingCard,
              {
                backgroundColor: mine ? "rgba(255,255,255,0.14)" : colors.background,
                borderColor: mine ? "rgba(255,255,255,0.25)" : colors.border,
                flexDirection: isRTL ? "row-reverse" : "row",
              },
            ]}
            testID={`chat-listing-${listingRef.id}`}
          >
            {listingRef.thumb ? (
              <Image source={{ uri: listingRef.thumb }} style={styles.listingThumb} contentFit="cover" />
            ) : (
              <View style={[styles.listingThumb, styles.listingThumbPlaceholder, { backgroundColor: colors.secondary }]}>
                <Feather name="image" size={18} color={colors.mutedForeground} />
              </View>
            )}
            <View style={styles.listingInfo}>
              <AppText
                numberOfLines={2}
                style={[styles.listingTitle, { color: mine ? colors.primaryForeground : colors.foreground, textAlign: isRTL ? "right" : "left" }]}
              >
                {listingRef.title || t("chat.listing")}
              </AppText>
              {listingRef.price ? (
                <AppText
                  style={[styles.listingPrice, { color: mine ? colors.primaryForeground : colors.primary, textAlign: isRTL ? "right" : "left" }]}
                >
                  {listingRef.price}
                </AppText>
              ) : null}
            </View>
          </Pressable>
        ) : null}
        {mediaUrl ? (
          <Pressable
            onPress={() => !isPending && setViewerUri(mediaUrl)}
            disabled={isPending}
            accessibilityRole="imagebutton"
          >
            <Image
              source={{ uri: mediaUrl }}
              style={styles.bubbleImage}
              contentFit="cover"
              transition={150}
            />
            {inFlight ? (
              <View style={styles.imageUploadOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : null}
          </Pressable>
        ) : null}
        {body ? (
          <AppText
            style={[
              styles.bubbleText,
              {
                color: mine ? colors.primaryForeground : colors.foreground,
                marginTop: mediaUrl ? 6 : 0,
                textAlign: isRTL ? "right" : "left",
              },
            ]}
          >
            {body}
          </AppText>
        ) : null}
        <View
          style={[
            styles.metaRow,
            { flexDirection: isRTL ? "row-reverse" : "row" },
          ]}
        >
          <AppText
            style={[
              styles.bubbleTime,
              {
                color: mine ? colors.primaryForeground : colors.mutedForeground,
                opacity: 0.7,
              },
            ]}
          >
            {row.kind === "server"
              ? timeLabel(row.msg.created_at, lang)
              : inFlight
                ? t("chat.sending")
                : t("chat.failedTap")}
          </AppText>
          {inFlight ? (
            <ActivityIndicator
              size="small"
              color={colors.primaryForeground}
              style={styles.metaSpinner}
            />
          ) : null}
          {failed ? (
            <Feather name="alert-circle" size={12} color={colors.destructive} />
          ) : null}
        </View>
      </View>
    );

    return (
      <View>
        <View
          style={[
            styles.bubbleRow,
            { justifyContent: mine ? "flex-end" : "flex-start" },
          ]}
        >
          {failed ? (
            <Pressable onPress={() => retry(row.msg as PendingMessage)}>
              {bubbleInner}
            </Pressable>
          ) : server ? (
            <Pressable
              onLongPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setActionFor(server);
              }}
              delayLongPress={280}
              testID={`message-${server.id}`}
            >
              {bubbleInner}
            </Pressable>
          ) : (
            bubbleInner
          )}
        </View>
        {Object.keys(reactions).length ? (
          <View
            style={[
              styles.reactionRow,
              {
                justifyContent: mine ? "flex-end" : "flex-start",
                flexDirection: isRTL ? "row-reverse" : "row",
              },
            ]}
          >
            {Object.entries(reactions).map(([emoji, count]) => {
              const reacted = myReactions.includes(emoji);
              return (
                <Pressable
                  key={emoji}
                  onPress={() => server && react(server.id, emoji)}
                  style={[
                    styles.reactionChip,
                    {
                      backgroundColor: reacted ? colors.primary : colors.card,
                      borderColor: reacted ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <AppText style={styles.reactionEmoji}>{emoji}</AppText>
                  <AppText
                    style={[
                      styles.reactionCount,
                      { color: reacted ? colors.primaryForeground : colors.mutedForeground },
                    ]}
                  >
                    {count}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {showReceipt ? (
          <AppText
            style={[
              styles.receipt,
              {
                color: colors.mutedForeground,
                textAlign: isRTL ? "left" : "right",
              },
            ]}
          >
            {lastMineReadAt ? t("chat.read") : t("chat.delivered")}
          </AppText>
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: (Platform.OS === "web" ? 12 : insets.top) + 8,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
            flexDirection: isRTL ? "row-reverse" : "row",
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={12}
          testID="thread-back"
        >
          <Feather
            name={isRTL ? "arrow-right" : "arrow-left"}
            size={22}
            color={colors.foreground}
          />
        </Pressable>
        <AppText
          style={[styles.headerTitle, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {params.name || t("messages.title")}
        </AppText>
        {canMarkSold ? (
          <Pressable
            onPress={handleMarkSold}
            disabled={soldDone}
            style={[
              styles.soldBtn,
              {
                flexDirection: isRTL ? "row-reverse" : "row",
                backgroundColor: soldDone ? colors.secondary : colors.primary,
              },
            ]}
            testID="thread-mark-sold"
          >
            <Feather
              name={soldDone ? "check-circle" : "tag"}
              size={13}
              color={soldDone ? colors.mutedForeground : colors.primaryForeground}
            />
            <AppText
              style={[
                styles.soldBtnText,
                {
                  color: soldDone
                    ? colors.mutedForeground
                    : colors.primaryForeground,
                },
              ]}
            >
              {soldDone ? t("chat.soldDone") : t("chat.markSold")}
            </AppText>
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        {query.isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(row) =>
              row.kind === "server" ? row.msg.id : row.msg.tempId
            }
            renderItem={renderRow}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd({ animated: false })
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Feather
                  name="message-circle"
                  size={48}
                  color={colors.mutedForeground}
                />
                <AppText
                  style={[styles.emptyText, { color: colors.mutedForeground }]}
                >
                  {t("messages.threadEmpty")}
                </AppText>
              </View>
            }
          />
        )}

        {emojiOpen ? (
          <EmojiPicker onSelect={(e) => setDraft((d) => d + e)} />
        ) : null}

        {replyTo ? (
          <View
            style={[
              styles.replyBar,
              {
                backgroundColor: colors.card,
                borderTopColor: colors.border,
                borderStartColor: colors.primary,
                flexDirection: isRTL ? "row-reverse" : "row",
              },
            ]}
          >
            <View style={styles.replyBarInfo}>
              <AppText style={[styles.replyBarTitle, { color: colors.primary }]} numberOfLines={1}>
                {t("chat.replyingTo", { name: replyTo.is_mine ? t("chat.you") : params.name || t("messages.title") })}
              </AppText>
              <AppText style={[styles.replyBarBody, { color: colors.mutedForeground }]} numberOfLines={1}>
                {replyTo.body || t("chat.attachment")}
              </AppText>
            </View>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={10} testID="reply-cancel">
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : null}

        <View
          style={[
            styles.inputBar,
            {
              borderTopColor: colors.border,
              backgroundColor: colors.background,
              paddingBottom: insets.bottom + 8,
              flexDirection: isRTL ? "row-reverse" : "row",
            },
          ]}
        >
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setEmojiOpen((v) => !v);
            }}
            style={[
              styles.attachBtn,
              {
                backgroundColor: colors.card,
                borderColor: emojiOpen ? colors.primary : colors.border,
              },
            ]}
            testID="message-emoji-toggle"
          >
            <Feather
              name="smile"
              size={20}
              color={emojiOpen ? colors.primary : colors.mutedForeground}
            />
          </Pressable>
          {params.listingId ? (
            <Pressable
              onPress={shareListing}
              style={[styles.attachBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              testID="message-share-listing"
              accessibilityLabel={t("chat.shareListing")}
            >
              <Feather name="tag" size={19} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={handleAttachImage}
            disabled={uploading}
            style={[styles.attachBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            testID="message-attach"
          >
            {uploading ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Feather name="image" size={20} color={colors.mutedForeground} />
            )}
          </Pressable>
          <AppTextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t("messages.inputPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                color: colors.foreground,
                borderColor: colors.border,
                borderRadius: colors.radius,
                textAlign: isRTL ? "right" : "left",
              },
            ]}
            multiline
            testID="message-input"
          />
          <Pressable
            onPress={handleSend}
            disabled={!draft.trim()}
            style={[
              styles.sendBtn,
              {
                backgroundColor: !draft.trim()
                  ? colors.secondary
                  : colors.primary,
              },
            ]}
            testID="message-send"
          >
            <Feather
              name="send"
              size={18}
              color={
                !draft.trim() ? colors.mutedForeground : colors.primaryForeground
              }
              // The paper-plane points toward the send direction — mirror it in RTL
              // so it flies left in Arabic, matching WhatsApp/Messenger.
              style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Image preview-before-send: confirm the exact photo (or cancel) instead
          of firing it off the moment it's picked. */}
      <Modal
        visible={!!previewAsset}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewAsset(null)}
      >
        <View style={styles.previewBackdrop}>
          <View
            style={[
              styles.previewSheet,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <AppText style={[styles.previewTitle, { color: colors.foreground }]}>
              {t("chat.previewTitle")}
            </AppText>
            {previewAsset ? (
              <Image
                source={{ uri: previewAsset.uri }}
                style={styles.previewImage}
                contentFit="contain"
              />
            ) : null}
            <View
              style={[
                styles.previewActions,
                { flexDirection: isRTL ? "row-reverse" : "row" },
              ]}
            >
              <Pressable
                onPress={() => setPreviewAsset(null)}
                style={[
                  styles.previewBtn,
                  { backgroundColor: colors.secondary },
                ]}
                testID="preview-cancel"
              >
                <AppText
                  style={[styles.previewBtnText, { color: colors.foreground }]}
                >
                  {t("common.cancel")}
                </AppText>
              </Pressable>
              <Pressable
                onPress={confirmSendImage}
                style={[styles.previewBtn, { backgroundColor: colors.primary }]}
                testID="preview-send"
              >
                <Feather
                  name="send"
                  size={16}
                  color={colors.primaryForeground}
                  style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }}
                />
                <AppText
                  style={[
                    styles.previewBtnText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  {t("chat.previewSend")}
                </AppText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Full-screen image viewer — tap any sent image to open it large. */}
      <Modal
        visible={!!viewerUri}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerUri(null)}
      >
        <Pressable
          style={styles.viewerBackdrop}
          onPress={() => setViewerUri(null)}
        >
          {viewerUri ? (
            <Image
              source={{ uri: viewerUri }}
              style={styles.viewerImage}
              contentFit="contain"
            />
          ) : null}
          <Pressable
            onPress={() => setViewerUri(null)}
            style={[styles.viewerClose, { top: insets.top + 12 }]}
            hitSlop={12}
            accessibilityLabel={t("chat.viewerClose")}
            testID="viewer-close"
          >
            <Feather name="x" size={26} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Long-press action sheet: react with an emoji, or quote-reply. */}
      <Modal
        visible={!!actionFor}
        transparent
        animationType="fade"
        onRequestClose={() => setActionFor(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setActionFor(null)}>
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                paddingBottom: insets.bottom + 12,
              },
            ]}
          >
            <View style={[styles.sheetEmojis, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
              {REACTION_EMOJIS.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => actionFor && react(actionFor.id, e)}
                  style={styles.sheetEmojiBtn}
                  testID={`react-${e}`}
                >
                  <AppText style={styles.sheetEmoji}>{e}</AppText>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => {
                const m = actionFor;
                setActionFor(null);
                setReplyTo(m);
              }}
              style={[styles.sheetAction, { flexDirection: isRTL ? "row-reverse" : "row" }]}
              testID="action-reply"
            >
              <Feather
                name={isRTL ? "corner-up-right" : "corner-up-left"}
                size={18}
                color={colors.foreground}
              />
              <AppText style={[styles.sheetActionText, { color: colors.foreground }]}>
                {t("chat.reply")}
              </AppText>
            </Pressable>
            {/* Copy — only when there is text to copy (image-only messages skip it). */}
            {actionFor?.body?.trim() ? (
              <Pressable
                onPress={() => {
                  const text = actionFor.body ?? "";
                  setActionFor(null);
                  Haptics.selectionAsync();
                  void Clipboard.setStringAsync(text);
                }}
                style={[styles.sheetAction, { flexDirection: isRTL ? "row-reverse" : "row" }]}
                testID="action-copy"
              >
                <Feather name="copy" size={18} color={colors.foreground} />
                <AppText style={[styles.sheetActionText, { color: colors.foreground }]}>
                  {t("chat.copy")}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    alignItems: "center",
    gap: 8,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  soldBtn: {
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
  },
  soldBtnText: { fontSize: 12.5, fontFamily: "Inter_600SemiBold" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 14, paddingBottom: 18, flexGrow: 1 },
  bubbleRow: { flexDirection: "row", marginBottom: 8 },
  bubble: {
    // maxWidth is applied inline (absolute px from window width) — a percentage
    // here collapses the bubble to one-word-per-line inside the FlatList row.
    minWidth: 48,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 16,
  },
  bubbleText: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
  bubbleImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
  },
  bubbleTime: {
    fontSize: 10.5,
    fontFamily: "Inter_400Regular",
  },
  metaRow: {
    alignItems: "center",
    gap: 4,
    marginTop: 3,
    alignSelf: "flex-end",
  },
  metaSpinner: { transform: [{ scale: 0.7 }] },
  receipt: {
    fontSize: 10.5,
    fontFamily: "Inter_400Regular",
    marginTop: -4,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  imageUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 12,
  },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingTop: 80 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  inputBar: {
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  attachBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 42,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    // Android multiline grows from the top, not the vertical centre — keeps a
    // long message aligned to the first line as it expands.
    textAlignVertical: "top",
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  previewSheet: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 14,
  },
  previewTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  previewImage: {
    width: "100%",
    height: 300,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.1)",
  },
  previewActions: { gap: 10 },
  previewBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
  },
  previewBtnText: { fontSize: 14.5, fontFamily: "Inter_600SemiBold" },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerImage: { width: "100%", height: "80%" },
  viewerClose: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  // Quoted reply preview inside a bubble.
  quote: {
    borderStartWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 6,
  },
  quoteText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  // Shared-listing card inside a bubble.
  listingCard: {
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 8,
    marginBottom: 6,
    width: 220,
  },
  listingThumb: { width: 52, height: 52, borderRadius: 8 },
  listingThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  listingInfo: { flex: 1 },
  listingTitle: { fontSize: 13.5, fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  listingPrice: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  // Reaction chips under a bubble.
  reactionRow: { gap: 5, marginTop: -2, marginBottom: 8, paddingHorizontal: 2 },
  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  // Reply composer banner above the input bar.
  replyBar: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderStartWidth: 3,
  },
  replyBarInfo: { flex: 1 },
  replyBarTitle: { fontSize: 12.5, fontFamily: "Inter_600SemiBold" },
  replyBarBody: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },
  // Long-press action sheet.
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 14,
    paddingHorizontal: 16,
    gap: 6,
  },
  sheetEmojis: {
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: 6,
  },
  sheetEmojiBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  sheetEmoji: { fontSize: 30 },
  sheetAction: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  sheetActionText: { fontSize: 15, fontFamily: "Inter_500Medium" },
});
