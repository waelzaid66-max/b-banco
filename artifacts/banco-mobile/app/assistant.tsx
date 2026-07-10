import { Feather } from "@/components/icons";
import { useAuth } from "@clerk/expo";
import {
  askBancoAssistant,
  type AiAssistantMessage,
  type AiAssistantAction,
} from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { router, type Href } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { BancoLogo } from "@/components/BancoLogo";
import { useI18n } from "@/context/LanguageContext";
import { searchCriteriaToNavParams } from "@/lib/searchNavParams";
import { DEFAULT_CRITERIA, type SearchCriteria } from "@/lib/searchParams";
import { useColors } from "@/hooks/useColors";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  actions?: AiAssistantAction[];
};

let idCounter = 0;
const nextId = () => `m${Date.now()}_${idCounter++}`;

// Maps an assistant "navigate" action's screen key to an in-app route.
const SCREEN_ROUTES: Record<string, Href> = {
  home: "/(tabs)",
  search: "/(tabs)/search",
  saved: "/(tabs)/saved",
  messages: "/(tabs)/messages",
  my_listings: "/listings/mine",
  create_listing: "/listings/create",
  wallet: "/wallet" as Href,
  billing: "/billing" as Href,
  profile: "/(tabs)/profile",
  notifications: "/notifications",
  supply_hub: "/business/supply-hub",
  industry: "/industry",
  rentals: "/rentals/hub" as Href,
  assistant: "/assistant",
};

function assistantSearchCategory(
  raw: string | null | undefined,
): SearchCriteria["category"] {
  if (
    raw === "car" ||
    raw === "real_estate" ||
    raw === "facilities" ||
    raw === "materials" ||
    raw === "all"
  ) {
    return raw;
  }
  // Server search tool still emits legacy `industrial`; mobile search UI uses facilities.
  if (raw === "industrial") return "facilities";
  return DEFAULT_CRITERIA.category;
}

export default function AssistantScreen() {
  const colors = useColors();
  const { t, isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();
  const topPad = Platform.OS === "web" ? 12 : insets.top;
  const rowDir = isRTL ? "row-reverse" : "row";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || sending) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      const userMsg: ChatMessage = { id: nextId(), role: "user", content: message };
      const history: AiAssistantMessage[] = messages
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setSending(true);
      scrollToEnd();

      try {
        const resp = await askBancoAssistant({ message, history });
        const answer = resp.data?.answer?.trim();
        const actions = resp.data?.actions ?? [];
        const errMsg = resp.error?.message?.trim();
        setMessages((prev) => [
          ...prev,
          answer
            ? { id: nextId(), role: "assistant", content: answer, actions }
            : {
                id: nextId(),
                role: "assistant",
                content: errMsg || t("assistant.errorBubble"),
                error: true,
              },
        ]);
      } catch (e) {
        const detail =
          e instanceof Error && e.message.trim()
            ? e.message.trim()
            : t("assistant.errorBubble");
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", content: detail, error: true },
        ]);
      } finally {
        setSending(false);
        scrollToEnd();
      }
    },
    [messages, sending, scrollToEnd, t],
  );

  const suggestions = [
    t("assistant.suggest1"),
    t("assistant.suggest2"),
    t("assistant.suggest3"),
    t("assistant.suggest4"),
  ];

  const runAction = useCallback((a: AiAssistantAction) => {
    Haptics.selectionAsync().catch(() => {});
    if (a.kind === "listing" && a.listing_id) {
      router.push(`/listing/${a.listing_id}`);
      return;
    }
    if (a.kind === "conversation" && a.conversation_id) {
      router.push(`/messages/${a.conversation_id}`);
      return;
    }
    if (a.kind === "search") {
      const params = searchCriteriaToNavParams({
        ...DEFAULT_CRITERIA,
        q: a.query ?? "",
        category: assistantSearchCategory(a.category),
        maxPrice: a.max_price != null ? String(a.max_price) : "",
        paymentType: a.has_installment ? "installment" : "any",
      });
      router.push({ pathname: "/(tabs)/search", params });
      return;
    }
    if (a.kind === "navigate" && a.screen) {
      const route = SCREEN_ROUTES[a.screen];
      if (route) router.push(route);
    }
  }, []);

  const renderActions = (msg: ChatMessage) => {
    if (!msg.actions || msg.actions.length === 0) return null;
    return (
      <View style={[styles.actions, { alignItems: isRTL ? "flex-end" : "flex-start" }]}>
        <AppText style={[styles.actionsLabel, { color: colors.mutedForeground }]}>
          {t("assistant.suggestionsLabel")}
        </AppText>
        {msg.actions.map((a, i) => {
          if (a.kind === "listing") {
            return (
              <Pressable
                key={`${msg.id}-a${i}`}
                onPress={() => runAction(a)}
                style={[
                  styles.listingCard,
                  { borderColor: colors.border, backgroundColor: colors.secondary, flexDirection: rowDir },
                ]}
                testID={`assistant-action-listing-${a.listing_id}`}
              >
                {a.thumbnail_url ? (
                  <Image source={{ uri: a.thumbnail_url }} style={styles.listingThumb} />
                ) : (
                  <View style={[styles.listingThumb, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}>
                    <Feather name="image" size={18} color={colors.mutedForeground} />
                  </View>
                )}
                <View style={styles.listingInfo}>
                  <AppText
                    numberOfLines={1}
                    style={[styles.listingTitle, { color: colors.foreground, textAlign: isRTL ? "right" : "left" }]}
                  >
                    {a.label}
                  </AppText>
                  <AppText
                    numberOfLines={1}
                    style={[styles.listingMeta, { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" }]}
                  >
                    {[a.price_display, a.location].filter(Boolean).join(" · ")}
                  </AppText>
                </View>
                <Feather
                  name={isRTL ? "chevron-left" : "chevron-right"}
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
            );
          }
          const icon =
            a.kind === "search" ? "search" : a.kind === "conversation" ? "message-circle" : "arrow-right-circle";
          return (
            <Pressable
              key={`${msg.id}-a${i}`}
              onPress={() => runAction(a)}
              style={[
                styles.actionChip,
                { borderColor: colors.border, backgroundColor: colors.secondary, flexDirection: rowDir },
              ]}
              testID={`assistant-action-${a.kind}-${i}`}
            >
              <Feather name={icon} size={15} color={colors.primary} />
              <AppText style={[styles.actionChipText, { color: colors.foreground }]} numberOfLines={1}>
                {a.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    );
  };

  const Header = (
    <View
      style={[
        styles.header,
        {
          paddingTop: topPad + 8,
          borderBottomColor: colors.border,
          backgroundColor: colors.background,
          flexDirection: rowDir,
        },
      ]}
    >
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
        hitSlop={12}
        style={styles.backBtn}
        testID="assistant-back"
      >
        <Feather
          name={isRTL ? "chevron-right" : "chevron-left"}
          size={26}
          color={colors.foreground}
        />
      </Pressable>
      <View style={[styles.headerCenter, { alignItems: isRTL ? "flex-end" : "flex-start" }]}>
        <View style={[styles.headerTitleRow, { flexDirection: rowDir }]}>
          <AppText style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {t("assistant.title")}
          </AppText>
          <View style={[styles.aiTag, { backgroundColor: colors.primary }]}>
            <AppText style={[styles.aiTagText, { color: colors.primaryForeground }]}>
              {t("assistant.tag")}
            </AppText>
          </View>
        </View>
        <AppText
          style={[styles.subtitle, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          {t("assistant.disclaimer")}
        </AppText>
      </View>
      <View style={styles.backBtn} />
    </View>
  );

  if (!isSignedIn) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {Header}
        <View style={styles.empty}>
          <Feather name="lock" size={56} color={colors.mutedForeground} />
          <AppText style={[styles.emptyTitle, { color: colors.foreground }]}>
            {t("assistant.signInTitle")}
          </AppText>
          <AppText style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {t("assistant.signInHint")}
          </AppText>
          <Pressable
            onPress={() => router.replace("/(tabs)/profile")}
            style={[
              styles.signInBtn,
              { backgroundColor: colors.primary, borderRadius: colors.radius },
            ]}
            testID="assistant-signin"
          >
            <AppText style={[styles.signInText, { color: colors.primaryForeground }]}>
              {t("assistant.signInCta")}
            </AppText>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {Header}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollToEnd}
        >
          {messages.length === 0 ? (
            <View style={styles.intro}>
              <View style={[styles.introIcon, { backgroundColor: colors.secondary }]}>
                <Feather name="message-square" size={26} color={colors.primary} />
              </View>
              <AppText style={[styles.introTitle, { color: colors.foreground }]}>
                {t("assistant.emptyTitle")}
              </AppText>
              <AppText style={[styles.introHint, { color: colors.mutedForeground }]}>
                {t("assistant.emptyHint")}
              </AppText>
              <View style={styles.chips}>
                {suggestions.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => send(s)}
                    style={[
                      styles.chip,
                      { borderColor: colors.border, backgroundColor: colors.secondary },
                    ]}
                    testID={`assistant-suggest-${s.slice(0, 8)}`}
                  >
                    <AppText style={[styles.chipText, { color: colors.foreground }]}>{s}</AppText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            messages.map((m) => {
              const isUser = m.role === "user";
              return (
                <View key={m.id}>
                  <View
                    style={[
                      styles.bubbleRow,
                      { justifyContent: isUser ? "flex-end" : "flex-start" },
                    ]}
                  >
                    <View
                      style={[
                        styles.bubble,
                        isUser
                          ? { backgroundColor: colors.primary, borderTopRightRadius: 4 }
                          : {
                              backgroundColor: colors.secondary,
                              borderTopLeftRadius: 4,
                              borderWidth: m.error ? 1 : 0,
                              borderColor: m.error ? colors.primary : "transparent",
                            },
                      ]}
                    >
                      <AppText
                        style={[
                          styles.bubbleText,
                          {
                            color: isUser ? colors.primaryForeground : colors.foreground,
                            textAlign: isRTL ? "right" : "left",
                          },
                        ]}
                      >
                        {m.content}
                      </AppText>
                    </View>
                  </View>
                  {renderActions(m)}
                </View>
              );
            })
          )}
          {sending ? (
            <View style={[styles.bubbleRow, { justifyContent: "flex-start" }]}>
              <View
                style={[
                  styles.bubble,
                  { backgroundColor: colors.secondary, borderTopLeftRadius: 4 },
                ]}
              >
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.inputBar,
            {
              flexDirection: rowDir,
              borderTopColor: colors.border,
              backgroundColor: colors.background,
              paddingBottom: insets.bottom + 10,
            },
          ]}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={t("assistant.inputPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              {
                backgroundColor: colors.secondary,
                color: colors.foreground,
                borderColor: colors.border,
                textAlign: isRTL ? "right" : "left",
              },
            ]}
            multiline
            onSubmitEditing={() => send(input)}
            editable={!sending}
            testID="assistant-input"
          />
          <Pressable
            onPress={() => send(input)}
            disabled={sending || input.trim().length === 0}
            style={[
              styles.sendBtn,
              {
                backgroundColor:
                  sending || input.trim().length === 0 ? colors.secondary : colors.primary,
              },
            ]}
            testID="assistant-send"
          >
            <Feather
              name="send"
              size={20}
              color={
                sending || input.trim().length === 0
                  ? colors.mutedForeground
                  : colors.primaryForeground
              }
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { flex: 1, gap: 2 },
  headerTitleRow: { alignItems: "center", gap: 8 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  aiTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  aiTagText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  subtitle: { fontSize: 11.5, fontFamily: "Inter_400Regular" },
  messages: { padding: 16, gap: 10, flexGrow: 1 },
  intro: { alignItems: "center", paddingTop: 32, gap: 10 },
  introIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  introTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  introHint: {
    fontSize: 13.5,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  chips: { gap: 10, alignSelf: "stretch", marginTop: 12 },
  chip: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  chipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  actions: { marginTop: 8, gap: 8, alignSelf: "stretch" },
  actionsLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  actionChip: {
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    maxWidth: "92%",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  actionChipText: { fontSize: 13.5, fontFamily: "Inter_500Medium", flexShrink: 1 },
  listingCard: {
    alignItems: "center",
    gap: 10,
    alignSelf: "stretch",
    borderWidth: 1,
    borderRadius: 14,
    padding: 8,
  },
  listingThumb: { width: 46, height: 46, borderRadius: 9 },
  listingInfo: { flex: 1, gap: 2 },
  listingTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  listingMeta: { fontSize: 12.5, fontFamily: "Inter_400Regular" },
  bubbleRow: { flexDirection: "row" },
  bubble: {
    maxWidth: "84%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleText: { fontSize: 14.5, fontFamily: "Inter_400Regular", lineHeight: 21 },
  inputBar: {
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 14.5,
    fontFamily: "Inter_400Regular",
    maxHeight: 120,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  signInBtn: { paddingHorizontal: 24, paddingVertical: 13, marginTop: 8 },
  signInText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
