import { useUser } from "@clerk/expo";
import {
  Feather,
  Ionicons,
  MaterialCommunityIcons,
} from "@/components/icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router, useLocalSearchParams, type Href } from "expo-router";
import {
  getListing,
  getSimilarListings,
  sendBehaviorSignal,
  contactLead,
  createReport,
  createConversation,
  FeedItem,
  PaymentOption,
  Offer,
  useGetCompany,
  getGetCompanyQueryKey,
  useGetMe,
  getGetMeQueryKey,
  updateListing,
  ContactLeadBodyActionType,
  type CreateReportBodyReason,
} from "@workspace/api-client-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { BReactionButton } from "@/components/BReactionButton";
import { DealRatingChip } from "@/components/DealRatingChip";
import { BookingCard } from "@/components/BookingCard";
import { LinkedListings } from "@/components/LinkedListings";
import { ListingComments } from "@/components/ListingComments";
import { MediaGallery } from "@/components/MediaGallery";
import { PromoteButton } from "@/components/PromoteButton";
import { SellerRatingBar, SellerReviews } from "@/components/SellerReviews";
import { SellerSocialLinks } from "@/components/SellerSocialLinks";
import { SkeletonCard } from "@/components/SkeletonCard";
import { SmartAssetCard } from "@/components/SmartAssetCard";
import { formatSpecs } from "@/constants/listingSpecs";
import { useI18n } from "@/context/LanguageContext";
import { useSession } from "@/context/SessionContext";
import { useSound } from "@/context/SoundContext";
import { useAuthGate } from "@/hooks/useAuthGate";
import { useColors } from "@/hooks/useColors";
import { pickListingPreviewUrl } from "@/lib/listingMedia";

const { width: SCREEN_W } = Dimensions.get("window");
const REPORT_REASON_KEYS = [
  "fraud",
  "wrongInfo",
  "sold",
  "offensive",
  "duplicate",
  "other",
] as const;

const REPORT_REASON_MAP: Record<
  (typeof REPORT_REASON_KEYS)[number],
  CreateReportBodyReason
> = {
  fraud: "scam",
  wrongInfo: "wrong_data",
  sold: "other",
  offensive: "other",
  duplicate: "duplicate",
  other: "other",
};


export default function ListingDetailScreen() {
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, isRTL } = useI18n();
  const { sessionId, isSaved, toggleSave, recordView, getCachedItem } =
    useSession();
  const { playSound } = useSound();
  const { user, isSignedIn, isLoaded } = useUser();
  const { requireAuth } = useAuthGate();

  const [listing, setListing] = useState<
    Awaited<ReturnType<typeof getListing>>["data"] | null
  >(null);
  const [similar, setSimilar] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportState, setReportState] = useState<
    "idle" | "submitting" | "done" | "error"
  >("idle");
  const [offerRequested, setOfferRequested] = useState(false);
  const [rfqOpen, setRfqOpen] = useState(false);
  const [rfqState, setRfqState] = useState<
    "idle" | "submitting" | "done" | "error"
  >(
    "idle"
  );
  const [rfqContact, setRfqContact] = useState<"whatsapp" | "call">("whatsapp");
  const [rfqPref, setRfqPref] = useState<"any" | "islamic" | "bank">("any");
  const [rfqMonthly, setRfqMonthly] = useState<string | null>(null);
  const [rfqNote, setRfqNote] = useState("");
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyState, setApplyState] = useState<
    "idle" | "submitting" | "done" | "error"
  >("idle");
  const [selectedPlan, setSelectedPlan] = useState(0);
  const [openingChat, setOpeningChat] = useState(false);
  const [potentialFlash, setPotentialFlash] = useState(false);
  const [marking, setMarking] = useState(false);
  const hasSignaled = useRef(false);

  // Deep-link focus (from the real-estate map pin or a booking notification):
  // `?focus=booking` lands the guest directly on the BookingCard. Best-effort and
  // fully guarded — if the card isn't present (not a furnished/daily rental) or
  // the platform can't measure (web), it simply no-ops and never affects the page.
  const scrollRef = useRef<ScrollView>(null);
  const bookingWrapRef = useRef<View>(null);
  const didFocusBooking = useRef(false);
  useEffect(() => {
    if (focus !== "booking" || !listing || didFocusBooking.current) return;
    const timer = setTimeout(() => {
      const scroll = scrollRef.current;
      const wrap = bookingWrapRef.current;
      if (!scroll || !wrap) return;
      const node = (
        scroll as unknown as { getInnerViewNode?: () => number }
      ).getInnerViewNode?.();
      if (node == null || typeof wrap.measureLayout !== "function") return;
      didFocusBooking.current = true;
      wrap.measureLayout(
        node,
        (_x: number, y: number) =>
          scroll.scrollTo({ y: Math.max(0, y - 16), animated: true }),
        () => {},
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [focus, listing]);

  // Cache-first: if this listing was just seen in a feed/saved rail we already
  // hold a lightweight FeedItem for it. We paint its image, price and title
  // immediately so the screen feels instant, while the full record loads.
  const cached = useMemo(
    () => (id ? getCachedItem(id) : null),
    [id, getCachedItem]
  );

  const rowDir = isRTL ? "row-reverse" : "row";
  const textAlign = isRTL ? "right" : "left";

  // Best-effort buyer identity from the signed-in Clerk user; only included
  // when present so guests can still submit anonymously.
  const buyerIdentity: { buyer_name?: string; buyer_phone?: string } = {};
  const buyerName = (user?.fullName ?? user?.firstName ?? "").trim();
  if (buyerName) buyerIdentity.buyer_name = buyerName;
  const buyerPhone = (user?.primaryPhoneNumber?.phoneNumber ?? "").trim();
  if (buyerPhone) buyerIdentity.buyer_phone = buyerPhone;

  // Public seller trust stats. Enabled only once the listing (and its seller id)
  // is loaded; renders gracefully when the seller has no company profile.
  const sellerId = listing?.seller?.id ?? "";
  const { data: companyRes } = useGetCompany(sellerId, {
    query: { enabled: !!sellerId, queryKey: getGetCompanyQueryKey(sellerId) },
  });
  const company = companyRes?.data ?? null;

  // Identify the viewer so the owner sees a "mark sold" control instead of the
  // buyer offer CTA. me.id and seller.id are both backend user ids.
  const meQuery = useGetMe({
    query: { enabled: !!isSignedIn, queryKey: getGetMeQueryKey() },
  });
  const meId = meQuery.data?.data?.id ?? null;

  const loadListing = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(false);
    try {
      const [detailRes, simRes] = await Promise.all([
        getListing(id),
        getSimilarListings(id).catch(() => ({ data: [] })),
      ]);
      setListing(detailRes.data ?? null);
      setSimilar(simRes.data ?? []);
      if (detailRes.data) recordView(detailRes.data);

      if (!hasSignaled.current) {
        hasSignaled.current = true;
        sendBehaviorSignal({
          session_id: sessionId,
          listing_id: id,
          action: "view",
        }).catch(() => {});
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [id, sessionId, recordView]);

  useEffect(() => {
    // Wait for Clerk to resolve; listing detail is public (optionalAuth API).
    // Re-fetch when sign-in flips so contact_token is minted for buyers.
    if (!isLoaded) return;
    loadListing();
  }, [loadListing, isLoaded, isSignedIn]);

  // Per-service arrival cue: a category-specific sound the first time a listing
  // resolves (vehicle = engine, property = key/latch, otherwise a light tap).
  // Guarded by a ref so toggling the sound setting can't replay it.
  const soundPlayedRef = useRef(false);
  useEffect(() => {
    if (!listing || soundPlayedRef.current) return;
    soundPlayedRef.current = true;
    const cat = listing.category;
    playSound(cat === "car" ? "engine" : cat === "real_estate" ? "key" : "tap");
  }, [listing, playSound]);

  const openWhatsApp = useCallback(async (phone: string, text?: string) => {
    const cleaned = phone.replace(/\D/g, "");
    const encoded = text ? encodeURIComponent(text) : "";
    const appUrl = `whatsapp://send?phone=${cleaned}${
      encoded ? `&text=${encoded}` : ""
    }`;
    const webUrl = `https://wa.me/${cleaned}${encoded ? `?text=${encoded}` : ""}`;
    await Linking.openURL(appUrl).catch(() =>
      Linking.openURL(webUrl).catch(() => {})
    );
  }, []);

  const openRfq = () => {
    if (!requireAuth()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRfqState("idle");
    setRfqContact(listing?.whatsapp_enabled ? "whatsapp" : "call");
    setRfqPref("any");
    setRfqMonthly(null);
    setRfqNote("");
    setRfqOpen(true);
  };

  const closeRfq = () => {
    if (rfqState === "submitting") return;
    setRfqOpen(false);
  };

  // Owner-only: reuse the existing updateListing(status) contract. This screen
  // owns `listing` in local state (not react-query), so patch it directly.
  const handleMarkSold = () => {
    if (!listing || marking) return;
    Alert.alert(t("chat.markSoldTitle"), t("chat.markSoldBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("chat.markSoldConfirm"),
        onPress: async () => {
          setMarking(true);
          try {
            await updateListing(listing.id, { status: "sold" });
            setListing((prev) => (prev ? { ...prev, status: "sold" } : prev));
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert(t("common.error"), t("chat.markSoldError"));
          } finally {
            setMarking(false);
          }
        },
      },
    ]);
  };

  const submitRfq = async () => {
    if (rfqState === "submitting") return;
    setRfqState("submitting");

    const prefLabel =
      rfqPref === "islamic"
        ? t("listing.rfq.islamicPlan")
        : rfqPref === "bank"
          ? t("listing.rfq.bankPlan")
          : t("listing.rfq.anyPlan");
    const lines = [
      t("listing.offerPrefill", { title: listing?.title ?? "" }),
      `${t("listing.rfq.financingLabel")}: ${prefLabel}`,
      `${t("listing.rfq.monthlyValue")}: ${
        rfqMonthly ?? t("listing.rfq.anyMonthly")
      }`,
    ];
    if (rfqNote.trim()) lines.push(rfqNote.trim());
    const message = lines.join("\n");

    // contactLead records the finance_request lead AND reveals the seller phone
    // in its response. The public listing detail never includes the phone —
    // reveal is gated behind a single-use contact_token minted server-side for
    // authenticated non-owner viewers. Without a token the request can neither be
    // recorded nor routed (e.g. owner/guest viewing), so surface that honestly
    // instead of a false "sent".
    const contactToken = listing?.contact_token;
    if (!contactToken) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setRfqState("error");
      return;
    }

    try {
      const res = await contactLead({
        listing_id: id,
        action_type: "finance_request",
        contact_token: contactToken,
        ...buyerIdentity,
      });
      const sellerPhone = res.data?.phone ?? undefined;
      // The external handoff (dialer / WhatsApp) is best-effort and self-catching
      // — a missing app must NOT flip a successfully recorded request to a failure.
      if (sellerPhone) {
        if (rfqContact === "call") {
          await Linking.openURL(`tel:${sellerPhone}`).catch(() => {});
        } else {
          await openWhatsApp(sellerPhone, message);
        }
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOfferRequested(true);
      setRfqState("done");
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setRfqState("error");
    }
  };

  const openApply = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setApplyState("idle");
    setSelectedPlan(0);
    setApplyOpen(true);
  };

  const closeApply = () => {
    if (applyState === "submitting") return;
    setApplyOpen(false);
  };

  const submitApply = async () => {
    if (applyState === "submitting" || !id) return;
    setApplyState("submitting");
    try {
      // contactLead records the finance_request lead (phone is not needed for in-app apply).
      const contactToken = listing?.contact_token;
      if (contactToken) {
        await contactLead({
          listing_id: id,
          action_type: "finance_request",
          contact_token: contactToken,
          ...buyerIdentity,
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setApplyState("done");
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setApplyState("error");
    }
  };

  const handleCTA = async (action: ContactLeadBodyActionType) => {
    if (!requireAuth()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!id) return;

    try {
      // contactLead records the contact event AND returns the revealed seller
      // phone — the public listing detail never carries it (reveal-token gated).
      const contactToken = listing?.contact_token;
      if (!contactToken) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(t("listing.contactFailTitle"), t("listing.contactFailBody"));
        return;
      }
      const res = await contactLead({
        listing_id: id,
        action_type: action,
        contact_token: contactToken,
        ...buyerIdentity,
      });
      const phone = res.data?.phone ?? undefined;
      if (!phone) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(t("listing.contactFailTitle"), t("listing.contactFailBody"));
        return;
      }

      if (action === "whatsapp") {
        await openWhatsApp(phone);
      } else if (action === "chat") {
        await openWhatsApp(phone, t("listing.chatPrefill", { title: listing?.title ?? "" }));
      } else if (action === "call") {
        await Linking.openURL(`tel:${phone}`).catch(() => {});
      }
    } catch {
      // Recording the lead or opening the external app failed — tell the buyer
      // honestly instead of leaving the tap looking like it did nothing.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(t("listing.contactFailTitle"), t("listing.contactFailBody"));
    }
  };

  const openInAppChat = async () => {
    if (!id || openingChat) return;
    if (!requireAuth()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setOpeningChat(true);

    // Record the chat lead fire-and-forget. The phone returned is not needed for
    // in-app chat (conversation creation handles the actual handoff below).
    const contactToken = listing?.contact_token;
    if (contactToken) {
      void contactLead({
        listing_id: id,
        action_type: "chat",
        contact_token: contactToken,
        ...buyerIdentity,
      }).catch(() => {});
    }

    try {
      const res = await createConversation({ listing_id: id });
      const conversationId = res.data?.id;
      if (!conversationId) throw new Error("missing conversation");
      router.push({
        pathname: "/messages/[id]",
        params: {
          id: conversationId,
          name: res.data?.counterparty_name ?? listing?.seller?.name ?? "",
        },
      });
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(t("listing.contactFailTitle"), t("listing.contactFailBody"));
    } finally {
      setOpeningChat(false);
    }
  };

  const closeReport = () => {
    setReportOpen(false);
    setReportState("idle");
  };

  const submitReport = async (
    reasonKey: (typeof REPORT_REASON_KEYS)[number]
  ) => {
    if (reportState === "submitting") return;
    setReportState("submitting");
    try {
      await createReport({
        listing_id: id ?? "",
        reason: REPORT_REASON_MAP[reasonKey] ?? "other",
        details: t(`report.reasons.${reasonKey}`),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setReportState("done");
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setReportState("error");
    }
  };

  const bottomBarHeight = 80 + (Platform.OS === "web" ? 34 : insets.bottom);

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {cached?.media_preview ? (
          <Image
            source={{ uri: cached.media_preview }}
            style={styles.skeletonGallery}
            contentFit="cover"
            transition={120}
          />
        ) : (
          <View
            style={[
              styles.skeletonGallery,
              { backgroundColor: colors.secondary },
            ]}
          />
        )}
        <View style={{ paddingHorizontal: 20, paddingTop: 20, gap: 12 }}>
          {cached ? (
            <>
              {!!cached.price_display && (
                <AppText
                  style={[styles.cachedPrice, { color: colors.foreground }]}
                >
                  {cached.price_display}
                </AppText>
              )}
              {!!cached.title && (
                <AppText
                  numberOfLines={2}
                  style={[styles.cachedTitle, { color: colors.foreground }]}
                >
                  {cached.title}
                </AppText>
              )}
              {!!cached.location && (
                <AppText
                  style={[
                    styles.cachedLocation,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {cached.location}
                </AppText>
              )}
              <SkeletonCard />
            </>
          ) : (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          )}
        </View>
      </View>
    );
  }

  if (error || !listing) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={48} color={colors.mutedForeground} />
        <AppText style={[styles.errorText, { color: colors.foreground }]}>
          {t("listing.notAvailable")}
        </AppText>
        <Pressable
          onPress={() => router.back()}
          style={[
            styles.retryBtn,
            { backgroundColor: colors.primary, borderRadius: colors.radius },
          ]}
        >
          <AppText style={[styles.retryText, { color: colors.primaryForeground }]}>
            {t("common.back")}
          </AppText>
        </Pressable>
      </View>
    );
  }

  const specsEntries = formatSpecs(
    listing.specs as Record<string, unknown> | undefined,
    isRTL
  );

  const openInMaps = () => {
    // Prefer precise coordinates when the BFF provides them; otherwise fall back
    // to a text search on the city/area. No in-app map, no Maps API key.
    const coords = listing.coordinates;
    const place = (listing.location ?? "").trim();
    if (!coords && !place) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const q = coords ? `${coords.lat},${coords.lng}` : encodeURIComponent(place);
    const webUrl = `https://www.google.com/maps/search/?api=1&query=${q}`;
    const nativeUrl = Platform.select({
      ios: `maps://?q=${q}`,
      android: `geo:0,0?q=${q}`,
      default: webUrl,
    });
    Linking.openURL(nativeUrl ?? webUrl).catch(() =>
      Linking.openURL(webUrl).catch(() => {})
    );
  };

  // Hospitality hand-off: hotel listings get a direct Google (Travel/Hotels)
  // booking search prefilled with the property name + area — the rent section's
  // door to bookable stays without building a booking engine.
  const isHotel =
    (listing.specs as Record<string, unknown> | undefined)?.property_type ===
    "hotel";
  const openGoogleBooking = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const q = encodeURIComponent(
      `${listing.title} ${(listing.location ?? "").trim()}`.trim(),
    );
    Linking.openURL(`https://www.google.com/travel/search?q=${q}`).catch(
      () => {},
    );
  };

  const SELLER_ROLE_KEYS = ["individual", "dealer", "company"];
  const sellerRoleRaw = listing.seller?.role?.toLowerCase() ?? "";
  const sellerRoleLabel = SELLER_ROLE_KEYS.includes(sellerRoleRaw)
    ? t(`listing.roles.${sellerRoleRaw}`)
    : listing.seller?.role ?? "";

  const financingOptions = (listing.payment?.options ?? []).filter(
    (o) => o.mode && o.mode !== "cash"
  );
  const islamicOptions = financingOptions.filter((o) => o.is_islamic_compliant);
  const conventionalOptions = financingOptions.filter(
    (o) => !o.is_islamic_compliant
  );
  // Pre-formatted, rate-free offers from the BFF — the canonical source for the
  // Compare Plans view, strictly separated by financing_type (never interleaved).
  const offers = listing.offers ?? [];
  const islamicOffers = offers.filter((o) => o.financing_type === "islamic");
  const conventionalOffers = offers.filter(
    (o) => o.financing_type === "conventional"
  );
  const hasOffers = offers.length > 0;
  const showPlans =
    !!listing.payment?.has_installment &&
    (hasOffers || financingOptions.length > 0);

  // Above-fold lead installment: the amount and the payment-type label must come
  // from the SAME canonical offer (best_offer) so the label always describes the
  // amount shown. Fall back to the lowest monthly (no label) when no promoted
  // offer exists. Pre-formatted BFF strings only — never any client-side math.
  const aboveFoldMonthly =
    listing.best_offer?.monthly_display ??
    (listing.payment?.has_installment
      ? listing.payment?.lowest_monthly ?? null
      : null);
  const aboveFoldBadge = listing.best_offer?.provider_badge ?? null;
  const isOwner = !!meId && meId === listing.seller?.id;
  const isSold = listing.status === "sold";

  // Role separation, made visible: only furnished/daily real-estate is bookable
  // (the hotel mode). Long-term rent and sale keep the plain contact-owner flow.
  // Owners and sold listings never show the guest booking widget.
  const isBookable =
    listing.category === "real_estate" &&
    (listing.specs as Record<string, unknown> | undefined)?.rental_term ===
      "furnished_daily" &&
    !isOwner &&
    !isSold;

  // Distinct real monthly amounts from the listing's plans — the buyer picks a
  // target budget; we never fabricate figures.
  const monthlyOptions = Array.from(
    new Set(
      financingOptions
        .map((o) => o.monthly_payment)
        .filter((m): m is string => !!m)
    )
  );

  const modeLabel = (mode?: string) => {
    if (mode === "seller_installment") return t("listing.sellerInstallment");
    if (mode === "bank_finance") return t("listing.bankFinance");
    if (mode === "cash") return t("listing.cash");
    return mode ?? "—";
  };

  // Single clear label per offer: Islamic compliance wins, then the funding
  // source (bank vs. seller). Falls back to the generic mode label.
  const planLabel = (opt: PaymentOption) => {
    if (opt.is_islamic_compliant === true) return t("listing.planLabel.islamic");
    if (opt.mode === "bank_finance") return t("listing.planLabel.bank");
    if (opt.mode === "seller_installment") return t("listing.planLabel.seller");
    return modeLabel(opt.mode);
  };

  const planIcon = (
    opt: PaymentOption
  ): keyof typeof MaterialCommunityIcons.glyphMap => {
    if (opt.is_islamic_compliant === true) return "star-crescent";
    if (opt.mode === "bank_finance") return "bank-outline";
    return "account-cash-outline";
  };

  const saved = isSaved(id ?? "");
  const topOffset = (Platform.OS === "web" ? 67 : insets.top) + 8;
  const hasSeller = !!listing?.seller?.id;
  // WhatsApp contact is opt-in per listing: only surface the WhatsApp CTA and
  // RFQ contact chip when the seller enabled it at creation time.
  const whatsappEnabled = !!listing?.whatsapp_enabled;
  const selectedOption =
    financingOptions[selectedPlan] ?? financingOptions[0];

  const renderPlanCard = (opt: PaymentOption, i: number) => {
    const isBest =
      !!opt.monthly_payment &&
      opt.monthly_payment === listing.payment?.lowest_monthly;
    return (
      <View
        key={`${opt.mode}-${i}`}
        style={[
          styles.optionCard,
          {
            backgroundColor: isBest ? colors.primary + "0D" : colors.card,
            borderColor: isBest ? colors.primary : colors.border,
            borderRadius: 10,
          },
        ]}
      >
        <View style={[styles.optionHead, { flexDirection: rowDir }]}>
          <View style={[styles.planLabelRow, { flexDirection: rowDir }]}>
            <MaterialCommunityIcons
              name={planIcon(opt)}
              size={15}
              color={colors.accent}
            />
            <AppText
              style={[
                styles.optionMode,
                { color: colors.foreground, textAlign },
              ]}
            >
              {planLabel(opt)}
            </AppText>
          </View>
          {isBest ? (
            <View
              style={[styles.bestBadge, { backgroundColor: colors.primary }]}
            >
              <MaterialCommunityIcons
                name="star"
                size={11}
                color={colors.primaryForeground}
              />
              <AppText
                style={[
                  styles.bestBadgeText,
                  { color: colors.primaryForeground },
                ]}
              >
                {t("listing.bestOffer")}
              </AppText>
            </View>
          ) : null}
        </View>
        {opt.down_payment ? (
          <PlanRow
            label={t("listing.downPayment")}
            value={opt.down_payment}
            rowDir={rowDir}
            colors={colors}
          />
        ) : null}
        {opt.monthly_payment ? (
          <PlanRow
            label={t("listing.monthlyPayment")}
            value={opt.monthly_payment}
            suffix={t("common.perMonth")}
            rowDir={rowDir}
            colors={colors}
            highlight
          />
        ) : null}
        {opt.duration_months ? (
          <PlanRow
            label={t("listing.duration")}
            value={`${opt.duration_months} ${t("listing.months")}`}
            rowDir={rowDir}
            colors={colors}
          />
        ) : null}
      </View>
    );
  };

  // Renders a single pre-formatted BFF offer. No rate/APR is ever shown — the
  // Offer contract intentionally carries none, including for Islamic plans.
  const renderOfferCard = (offer: Offer) => (
    <View
      key={offer.id}
      style={[
        styles.optionCard,
        {
          backgroundColor: offer.is_best ? colors.primary + "0D" : colors.card,
          borderColor: offer.is_best ? colors.primary : colors.border,
          borderRadius: 10,
        },
      ]}
    >
      <View style={[styles.optionHead, { flexDirection: rowDir }]}>
        <View style={[styles.planLabelRow, { flexDirection: rowDir }]}>
          <MaterialCommunityIcons
            name={
              offer.financing_type === "islamic"
                ? "star-crescent"
                : "bank-outline"
            }
            size={15}
            color={colors.accent}
          />
          <AppText
            style={[styles.optionMode, { color: colors.foreground, textAlign }]}
          >
            {offer.provider_badge}
          </AppText>
        </View>
        {offer.is_best ? (
          <View style={[styles.bestBadge, { backgroundColor: colors.primary }]}>
            <MaterialCommunityIcons
              name="star"
              size={11}
              color={colors.primaryForeground}
            />
            <AppText
              style={[styles.bestBadgeText, { color: colors.primaryForeground }]}
            >
              {t("listing.bestOffer")}
            </AppText>
          </View>
        ) : null}
      </View>
      {offer.down_payment_display ? (
        <PlanRow
          label={t("listing.downPayment")}
          value={offer.down_payment_display}
          rowDir={rowDir}
          colors={colors}
        />
      ) : null}
      <PlanRow
        label={t("listing.monthlyPayment")}
        value={offer.monthly_display}
        suffix={t("common.perMonth")}
        rowDir={rowDir}
        colors={colors}
        highlight
      />
      <PlanRow
        label={t("listing.duration")}
        value={`${offer.duration_months} ${t("listing.months")}`}
        rowDir={rowDir}
        colors={colors}
      />
      <PlanRow
        label={t("listing.totalPayable")}
        value={offer.total_payable_display}
        rowDir={rowDir}
        colors={colors}
      />
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomBarHeight + 20 }}
      >
        <View style={styles.galleryWrapper}>
          <MediaGallery media={listing.media ?? []} height={320} />
        </View>

        <View style={styles.body}>
          <View style={[styles.priceSection, { flexDirection: rowDir }]}>
            <AppText style={[styles.price, { color: colors.foreground, textAlign }]}>
              {listing.price_display}
            </AppText>
            {isSold ? (
              <View
                style={[styles.soldBadge, { backgroundColor: colors.primary }]}
                testID="sold-badge"
              >
                <Feather
                  name="check-circle"
                  size={13}
                  color={colors.primaryForeground}
                />
                <AppText
                  style={[
                    styles.soldBadgeText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  {t("chat.soldDone")}
                </AppText>
              </View>
            ) : null}
          </View>

          {/* Deal rating vs the listing's real market segment. Self-hides until
              the segment has enough real samples (never a fabricated verdict). */}
          {!isSold ? <DealRatingChip listingId={id} /> : null}

          {aboveFoldMonthly ? (
            <View style={[styles.monthlyRow, { flexDirection: rowDir }]}>
              <MaterialCommunityIcons
                name="calendar-month-outline"
                size={15}
                color={colors.primary}
              />
              <AppText style={[styles.monthlyRowText, { color: colors.primary }]}>
                {t("listing.startsFrom")} {aboveFoldMonthly}
                <AppText
                  style={[styles.monthlyRowPer, { color: colors.mutedForeground }]}
                >
                  {t("common.perMonth")}
                </AppText>
              </AppText>
              {aboveFoldBadge ? (
                <View
                  style={[
                    styles.paymentBadge,
                    {
                      backgroundColor: colors.secondary,
                      borderRadius: 8,
                      marginTop: 0,
                    },
                  ]}
                >
                  <AppText
                    style={[styles.paymentBadgeText, { color: colors.accent }]}
                  >
                    {aboveFoldBadge}
                  </AppText>
                </View>
              ) : null}
            </View>
          ) : null}

          <AppText style={[styles.title, { color: colors.foreground, textAlign }]}>
            {listing.title}
          </AppText>

          <View style={[styles.locationRow, { flexDirection: rowDir }]}>
            <Ionicons
              name="location-outline"
              size={14}
              color={colors.mutedForeground}
            />
            <AppText
              style={[styles.location, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {listing.location}
            </AppText>
            {listing.location || listing.coordinates ? (
              <Pressable
                onPress={openInMaps}
                style={[
                  styles.mapsBtn,
                  {
                    flexDirection: rowDir,
                    borderColor: colors.border,
                    backgroundColor: colors.secondary,
                  },
                ]}
                testID="open-in-maps"
              >
                <Ionicons name="map-outline" size={13} color={colors.accent} />
                <AppText style={[styles.mapsBtnText, { color: colors.accent }]}>
                  {t("listing.openInMaps")}
                </AppText>
              </Pressable>
            ) : null}
            {isHotel ? (
              <Pressable
                onPress={openGoogleBooking}
                style={[
                  styles.mapsBtn,
                  {
                    flexDirection: rowDir,
                    borderColor: colors.border,
                    backgroundColor: colors.secondary,
                  },
                ]}
                testID="book-on-google"
              >
                <Ionicons name="bed-outline" size={13} color={colors.accent} />
                <AppText style={[styles.mapsBtnText, { color: colors.accent }]}>
                  {t("listing.bookOnGoogle")}
                </AppText>
              </Pressable>
            ) : null}
          </View>

          {isBookable ? (
            <View ref={bookingWrapRef} collapsable={false}>
              <BookingCard listingId={listing.id} pricePerNight={listing.price_cash} />
            </View>
          ) : null}

          {listing.seller?.id ? (
            <SellerRatingBar sellerId={listing.seller.id} />
          ) : null}

          {isOwner ? (
            isSold ? null : (
              <View style={{ gap: 10 }}>
                <Pressable
                  onPress={() => router.push(`/listings/edit/${listing.id}` as Href)}
                  style={[
                    styles.offerBtn,
                    {
                      flexDirection: rowDir,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      backgroundColor: colors.card,
                    },
                  ]}
                  testID="owner-edit-listing"
                >
                  <Feather name="edit-2" size={18} color={colors.foreground} />
                  <AppText
                    style={[styles.offerBtnText, { color: colors.foreground }]}
                  >
                    {t("mine.edit")}
                  </AppText>
                </Pressable>
                <Pressable
                  onPress={handleMarkSold}
                  disabled={marking}
                  style={[
                    styles.offerBtn,
                    {
                      flexDirection: rowDir,
                      borderColor: colors.primary,
                      borderRadius: colors.radius,
                      backgroundColor: colors.primary,
                    },
                  ]}
                  testID="owner-mark-sold"
                >
                  {marking ? (
                    <ActivityIndicator
                      color={colors.primaryForeground}
                      size="small"
                    />
                  ) : (
                    <Feather
                      name="tag"
                      size={18}
                      color={colors.primaryForeground}
                    />
                  )}
                  <AppText
                    style={[
                      styles.offerBtnText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    {t("chat.markSold")}
                  </AppText>
                </Pressable>
                {listing.status === "active" ? (
                  <PromoteButton listingId={listing.id} variant="full" />
                ) : null}
              </View>
            )
          ) : (
            <Pressable
              onPress={openRfq}
              disabled={offerRequested}
              style={[
                styles.offerBtn,
                {
                  flexDirection: rowDir,
                  borderColor: colors.primary,
                  borderRadius: colors.radius,
                  backgroundColor: offerRequested
                    ? colors.primary + "15"
                    : "transparent",
                },
              ]}
              testID="request-offer"
            >
              <MaterialCommunityIcons
                name={
                  offerRequested ? "check-circle-outline" : "tag-text-outline"
                }
                size={18}
                color={colors.primary}
              />
              <AppText style={[styles.offerBtnText, { color: colors.primary }]}>
                {offerRequested
                  ? t("listing.offerSent")
                  : t("listing.requestOffer")}
              </AppText>
            </Pressable>
          )}

          {listing.description ? (
            <View style={[styles.section, { borderTopColor: colors.border }]}>
              <AppText
                style={[styles.sectionTitle, { color: colors.foreground, textAlign }]}
              >
                {t("listing.description")}
              </AppText>
              <AppText
                style={[styles.description, { color: colors.mutedForeground, textAlign }]}
              >
                {listing.description}
              </AppText>
            </View>
          ) : null}

          {specsEntries.length > 0 && (
            <View style={[styles.section, { borderTopColor: colors.border }]}>
              <AppText
                style={[styles.sectionTitle, { color: colors.foreground, textAlign }]}
              >
                {t("listing.specs")}
              </AppText>
              <View style={styles.specsGrid}>
                {specsEntries.map((spec, i) => (
                  <View
                    key={`${spec.label}-${i}`}
                    style={[
                      styles.specItem,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderRadius: 8,
                      },
                    ]}
                  >
                    <AppText
                      style={[styles.specKey, { color: colors.mutedForeground, textAlign }]}
                    >
                      {spec.label}
                    </AppText>
                    <AppText
                      style={[styles.specValue, { color: colors.foreground, textAlign }]}
                      numberOfLines={2}
                    >
                      {spec.value}
                    </AppText>
                  </View>
                ))}
              </View>
            </View>
          )}

          {listing.logistics &&
          (listing.logistics.delivery_time_days != null ||
            listing.logistics.origin_type != null ||
            listing.logistics.country_of_origin != null ||
            listing.logistics.shipping_method != null) ? (
            <View style={[styles.section, { borderTopColor: colors.border }]}>
              <AppText
                style={[styles.sectionTitle, { color: colors.foreground, textAlign }]}
              >
                {t("business.logistics.title")}
              </AppText>
              <View style={styles.specsGrid}>
                {listing.logistics.delivery_time_days != null ? (
                  <View
                    style={[
                      styles.specItem,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderRadius: 8,
                      },
                    ]}
                  >
                    <AppText
                      style={[styles.specKey, { color: colors.mutedForeground, textAlign }]}
                    >
                      {t("business.logistics.deliveryTime")}
                    </AppText>
                    <AppText
                      style={[styles.specValue, { color: colors.foreground, textAlign }]}
                      numberOfLines={2}
                    >
                      {listing.logistics.delivery_time_days}{" "}
                      {t("business.logistics.daysUnit")}
                    </AppText>
                  </View>
                ) : null}
                {listing.logistics.origin_type != null ? (
                  <View
                    style={[
                      styles.specItem,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderRadius: 8,
                      },
                    ]}
                  >
                    <AppText
                      style={[styles.specKey, { color: colors.mutedForeground, textAlign }]}
                    >
                      {t("business.logistics.origin")}
                    </AppText>
                    <AppText
                      style={[styles.specValue, { color: colors.foreground, textAlign }]}
                      numberOfLines={2}
                    >
                      {t(`business.logistics.originType.${listing.logistics.origin_type}`)}
                    </AppText>
                  </View>
                ) : null}
                {listing.logistics.country_of_origin != null ? (
                  <View
                    style={[
                      styles.specItem,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderRadius: 8,
                      },
                    ]}
                  >
                    <AppText
                      style={[styles.specKey, { color: colors.mutedForeground, textAlign }]}
                    >
                      {t("business.logistics.country")}
                    </AppText>
                    <AppText
                      style={[styles.specValue, { color: colors.foreground, textAlign }]}
                      numberOfLines={2}
                    >
                      {listing.logistics.country_of_origin}
                    </AppText>
                  </View>
                ) : null}
                {listing.logistics.shipping_method != null ? (
                  <View
                    style={[
                      styles.specItem,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderRadius: 8,
                      },
                    ]}
                  >
                    <AppText
                      style={[styles.specKey, { color: colors.mutedForeground, textAlign }]}
                    >
                      {t("business.logistics.shipping")}
                    </AppText>
                    <AppText
                      style={[styles.specValue, { color: colors.foreground, textAlign }]}
                      numberOfLines={2}
                    >
                      {t(
                        `business.logistics.shippingMethod.${listing.logistics.shipping_method}`,
                      )}
                    </AppText>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          {showPlans && (
            <View style={[styles.section, { borderTopColor: colors.border }]}>
              <AppText
                style={[styles.sectionTitle, { color: colors.foreground, textAlign }]}
              >
                {t("listing.comparePlans")}
              </AppText>

              {hasOffers ? (
                <>
                  {conventionalOffers.length > 0 ? (
                    <View style={styles.planGroup}>
                      <AppText
                        style={[
                          styles.planGroupTitle,
                          { color: colors.mutedForeground, textAlign },
                        ]}
                      >
                        {t("listing.conventionalPlans")}
                      </AppText>
                      {conventionalOffers.map((o) => renderOfferCard(o))}
                    </View>
                  ) : null}
                  {islamicOffers.length > 0 ? (
                    <View style={styles.planGroup}>
                      <AppText
                        style={[
                          styles.planGroupTitle,
                          { color: colors.mutedForeground, textAlign },
                        ]}
                      >
                        {t("listing.islamicPlans")}
                      </AppText>
                      {islamicOffers.map((o) => renderOfferCard(o))}
                    </View>
                  ) : null}
                </>
              ) : (
                financingOptions.map((opt, i) => renderPlanCard(opt, i))
              )}

              <Pressable
                onPress={openApply}
                style={[
                  styles.applyBtn,
                  {
                    flexDirection: rowDir,
                    backgroundColor: colors.primary,
                    borderRadius: colors.radius,
                  },
                ]}
                testID="apply-installment"
              >
                <MaterialCommunityIcons
                  name="file-document-edit-outline"
                  size={19}
                  color={colors.primaryForeground}
                />
                <AppText
                  style={[styles.applyBtnText, { color: colors.primaryForeground }]}
                >
                  {t("listing.applyInstallment")}
                </AppText>
              </Pressable>

              <View
                style={[
                  styles.disclaimerBox,
                  { backgroundColor: colors.secondary, borderRadius: 8 },
                ]}
              >
                <Feather
                  name="info"
                  size={14}
                  color={colors.mutedForeground}
                  style={{ marginTop: 1 }}
                />
                <AppText
                  style={[styles.disclaimerText, { color: colors.mutedForeground, textAlign }]}
                >
                  {t("listing.disclaimer")}
                </AppText>
              </View>
            </View>
          )}

          <LinkedListings
            items={listing.linked_listings}
            onPress={(linkedId) => router.push(`/listing/${linkedId}`)}
          />

          {listing.seller && (
            <View style={[styles.section, { borderTopColor: colors.border }]}>
              <AppText
                style={[styles.sectionTitle, { color: colors.foreground, textAlign }]}
              >
                {t("listing.seller")}
              </AppText>
              <View
                style={[
                  styles.sellerCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    flexDirection: rowDir,
                  },
                ]}
              >
                <View
                  style={[
                    styles.sellerAvatar,
                    { backgroundColor: colors.secondary, borderRadius: 24 },
                  ]}
                >
                  <AppText
                    style={[styles.sellerInitial, { color: colors.foreground }]}
                  >
                    {listing.seller.name.charAt(0).toUpperCase()}
                  </AppText>
                </View>
                <View style={styles.sellerInfo}>
                  <View style={[styles.sellerNameRow, { flexDirection: rowDir }]}>
                    <AppText
                      style={[styles.sellerName, { color: colors.foreground }]}
                    >
                      {listing.seller.name}
                    </AppText>
                    {listing.seller.is_verified && (
                      <MaterialCommunityIcons
                        name="check-decagram"
                        size={16}
                        color={colors.primary}
                      />
                    )}
                  </View>
                  <View style={[styles.sellerMetaRow, { flexDirection: rowDir }]}>
                    {sellerRoleLabel ? (
                      <AppText
                        style={[
                          styles.sellerRole,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {sellerRoleLabel}
                      </AppText>
                    ) : null}
                    {listing.seller.is_verified ? (
                      <View
                        style={[
                          styles.verifiedPill,
                          {
                            backgroundColor: colors.primary + "14",
                            borderColor: colors.primary + "33",
                          },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name="shield-check"
                          size={11}
                          color={colors.primary}
                        />
                        <AppText
                          style={[
                            styles.verifiedPillText,
                            { color: colors.primary },
                          ]}
                        >
                          {t("listing.verifiedSeller")}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  {company?.stats ? (
                    <View style={[styles.trustRow, { flexDirection: rowDir }]}>
                      <View style={styles.trustStat}>
                        <AppText
                          style={[styles.trustValue, { color: colors.foreground }]}
                        >
                          {company.stats.active_listings}
                        </AppText>
                        <AppText
                          style={[
                            styles.trustLabel,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {t("listing.trust.activeListings")}
                        </AppText>
                      </View>
                      {company.stats.response_rate != null ? (
                        <View style={styles.trustStat}>
                          <AppText
                            style={[
                              styles.trustValue,
                              { color: colors.foreground },
                            ]}
                          >
                            {company.stats.response_rate}%
                          </AppText>
                          <AppText
                            style={[
                              styles.trustLabel,
                              { color: colors.mutedForeground },
                            ]}
                          >
                            {t("listing.trust.responseRate")}
                          </AppText>
                        </View>
                      ) : null}
                      {company.stats.years_active > 0 ? (
                        <View style={styles.trustStat}>
                          <AppText
                            style={[
                              styles.trustValue,
                              { color: colors.foreground },
                            ]}
                          >
                            {company.stats.years_active}
                          </AppText>
                          <AppText
                            style={[
                              styles.trustLabel,
                              { color: colors.mutedForeground },
                            ]}
                          >
                            {t("listing.trust.yearsActive")}
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  {listing.seller.social_links?.length ? (
                    <SellerSocialLinks links={listing.seller.social_links} />
                  ) : null}
                </View>
              </View>
            </View>
          )}

          {listing?.seller?.id ? (
            <SellerReviews sellerId={listing.seller.id} />
          ) : null}

          

          {id ? (
            <ListingComments listingId={id} viewerId={meId} isOwner={isOwner} />
          ) : null}

          {similar.length > 0 && (
            <View style={[styles.section, { borderTopColor: colors.border }]}>
              <AppText
                style={[styles.sectionTitle, { color: colors.foreground, textAlign }]}
              >
                {t("listing.similar")}
              </AppText>
              <FlatList
                data={isRTL ? [...similar].reverse() : similar}
                keyExtractor={(i) => i.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                renderItem={({ item }) => (
                  <View style={{ width: SCREEN_W * 0.7, marginHorizontal: 6 }}>
                    <SmartAssetCard
                      item={item}
                      onPress={(i) => {
                        router.replace(`/listing/${i.id}`);
                      }}
                      compact
                    />
                  </View>
                )}
                contentContainerStyle={[
                  { paddingHorizontal: 10 },
                  isRTL && { flexDirection: "row-reverse" },
                ]}
                scrollEnabled
              />
            </View>
          )}

          <Pressable
            style={[styles.reportBtn, { flexDirection: rowDir }]}
            onPress={() => {
              setReportState("idle");
              setReportOpen(true);
            }}
            testID="report-listing"
          >
            <Feather name="flag" size={15} color={colors.mutedForeground} />
            <AppText style={[styles.reportText, { color: colors.mutedForeground }]}>
              {t("listing.report")}
            </AppText>
          </Pressable>
        </View>
      </ScrollView>

      <Pressable
        style={[
          styles.floatBtn,
          isRTL ? { right: 16 } : { left: 16 },
          { top: topOffset },
        ]}
        onPress={() => router.back()}
        testID="listing-back"
      >
        <Feather
          name={isRTL ? "arrow-right" : "arrow-left"}
          size={22}
          color="#FFFFFF"
        />
      </Pressable>

      <View
        style={[
          styles.floatBtn,
          isRTL ? { left: 16 } : { right: 16 },
          { top: topOffset },
        ]}
        testID="listing-save"
      >
        <BReactionButton
          saved={saved}
          potentialActive={potentialFlash}
          saveIcon={
            listing.category === "car"
              ? "car"
              : listing.category === "real_estate"
                ? "key"
                : listing.category === "industrial"
                  ? "business"
                  : "bookmark"
          }
          onPotential={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setPotentialFlash(true);
            void sendBehaviorSignal({
              session_id: sessionId,
              listing_id: listing.id,
              action: "interested",
              category: listing.category ?? undefined,
            }).catch(() => {});
            setTimeout(() => setPotentialFlash(false), 1200);
          }}
          onSave={() => {
            const feedItem: FeedItem = {
              id: listing.id,
              media_preview: pickListingPreviewUrl(listing.media),
              price_display: listing.price_display,
              title: listing.title,
              location: listing.location,
              trust_signal: listing.seller?.name ?? "",
              has_video: listing.media?.some((m) => m.type === "video") ?? false,
              is_sponsored: false,
            };
            toggleSave(feedItem);
          }}
          onAngry={() => {
            void sendBehaviorSignal({
              session_id: sessionId,
              listing_id: listing.id,
              action: "angry",
              category: listing.category ?? undefined,
            }).catch(() => {});
          }}
          height={26}
        />
      </View>

      <View
        style={[
          styles.ctaBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: Platform.OS === "web" ? 34 : insets.bottom,
            height: bottomBarHeight,
          },
        ]}
      >
        {isOwner && !isSold ? (
          <CTAButton
            icon="create-outline"
            label={t("mine.edit")}
            testLabel="owner-edit"
            onPress={() =>
              router.push(`/listings/edit/${listing.id}` as Href)
            }
            style={{ backgroundColor: colors.primary, flex: 1 }}
            textColor={colors.primaryForeground}
            radius={colors.radius}
          />
        ) : hasSeller && !isOwner ? (
          <>
            <CTAButton
              icon="call-outline"
              label={t("listing.call")}
              testLabel="call"
              onPress={() => handleCTA("call")}
              style={{ backgroundColor: colors.secondary }}
              textColor={colors.foreground}
              radius={colors.radius}
            />
            {whatsappEnabled && (
              <CTAButton
                icon="logo-whatsapp"
                label={t("listing.whatsapp")}
                testLabel="whatsapp"
                onPress={() => handleCTA("whatsapp")}
                style={{ backgroundColor: "#25D366" }}
                textColor="#FFFFFF"
                radius={colors.radius}
              />
            )}
            <CTAButton
              icon="chatbubble-outline"
              label={t("listing.chat")}
              testLabel="chat"
              onPress={openInAppChat}
              style={{ backgroundColor: colors.primary }}
              textColor={colors.primaryForeground}
              radius={colors.radius}
            />
          </>
        ) : (
          <View style={styles.contactUnavailable}>
            <Feather
              name="phone-off"
              size={16}
              color={colors.mutedForeground}
            />
            <AppText
              style={[styles.contactUnavailableText, { color: colors.mutedForeground }]}
            >
              {t("listing.contactUnavailable")}
            </AppText>
          </View>
        )}
      </View>

      <Modal
        visible={reportOpen}
        transparent
        animationType="fade"
        onRequestClose={closeReport}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => {
              if (reportState !== "submitting") closeReport();
            }}
            accessibilityRole="button"
          />
          <View
            style={[
              styles.reportSheet,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                paddingBottom: (Platform.OS === "web" ? 24 : insets.bottom) + 16,
              },
            ]}
          >
            {reportState === "submitting" ? (
              <View style={styles.reportResult}>
                <ActivityIndicator color={colors.primary} />
                <AppText
                  style={[
                    styles.reportSubtitle,
                    { color: colors.mutedForeground, textAlign: "center" },
                  ]}
                >
                  {t("report.submitting")}
                </AppText>
              </View>
            ) : reportState === "done" ? (
              <View style={styles.reportResult}>
                <View
                  style={[
                    styles.reportResultIcon,
                    { backgroundColor: colors.primary + "18" },
                  ]}
                >
                  <Feather name="check" size={30} color={colors.primary} />
                </View>
                <AppText
                  style={[
                    styles.reportTitle,
                    { color: colors.foreground, textAlign: "center" },
                  ]}
                >
                  {t("report.successTitle")}
                </AppText>
                <AppText
                  style={[
                    styles.reportSubtitle,
                    { color: colors.mutedForeground, textAlign: "center" },
                  ]}
                >
                  {t("report.successBody")}
                </AppText>
                <Pressable
                  style={[
                    styles.reportCancel,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: colors.radius,
                    },
                  ]}
                  onPress={closeReport}
                  testID="report-done"
                >
                  <AppText
                    style={[
                      styles.reportCancelText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    {t("report.done")}
                  </AppText>
                </Pressable>
              </View>
            ) : reportState === "error" ? (
              <View style={styles.reportResult}>
                <View
                  style={[
                    styles.reportResultIcon,
                    { backgroundColor: colors.destructive + "18" },
                  ]}
                >
                  <Feather
                    name="alert-triangle"
                    size={28}
                    color={colors.destructive}
                  />
                </View>
                <AppText
                  style={[
                    styles.reportTitle,
                    { color: colors.foreground, textAlign: "center" },
                  ]}
                >
                  {t("report.errorTitle")}
                </AppText>
                <AppText
                  style={[
                    styles.reportSubtitle,
                    { color: colors.mutedForeground, textAlign: "center" },
                  ]}
                >
                  {t("report.errorBody")}
                </AppText>
                <Pressable
                  style={[
                    styles.reportCancel,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: colors.radius,
                    },
                  ]}
                  onPress={() => setReportState("idle")}
                  testID="report-retry"
                >
                  <AppText
                    style={[
                      styles.reportCancelText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    {t("report.retry")}
                  </AppText>
                </Pressable>
              </View>
            ) : (
              <>
                <AppText
                  style={[
                    styles.reportTitle,
                    { color: colors.foreground, textAlign },
                  ]}
                >
                  {t("report.title")}
                </AppText>
                <AppText
                  style={[
                    styles.reportSubtitle,
                    { color: colors.mutedForeground, textAlign },
                  ]}
                >
                  {t("report.subtitle")}
                </AppText>
                {REPORT_REASON_KEYS.map((reasonKey) => (
                  <Pressable
                    key={reasonKey}
                    style={[
                      styles.reasonRow,
                      { borderTopColor: colors.border, flexDirection: rowDir },
                    ]}
                    onPress={() => submitReport(reasonKey)}
                    testID={`report-reason-${reasonKey}`}
                  >
                    <AppText
                      style={[styles.reasonText, { color: colors.foreground }]}
                    >
                      {t(`report.reasons.${reasonKey}`)}
                    </AppText>
                    <Feather
                      name={isRTL ? "chevron-left" : "chevron-right"}
                      size={18}
                      color={colors.mutedForeground}
                    />
                  </Pressable>
                ))}
                <Pressable
                  style={[
                    styles.reportCancel,
                    {
                      backgroundColor: colors.secondary,
                      borderRadius: colors.radius,
                    },
                  ]}
                  onPress={closeReport}
                >
                  <AppText
                    style={[
                      styles.reportCancelText,
                      { color: colors.foreground },
                    ]}
                  >
                    {t("common.cancel")}
                  </AppText>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={rfqOpen}
        transparent
        animationType="slide"
        onRequestClose={closeRfq}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <View style={styles.modalOverlay}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={closeRfq}
              accessibilityRole="button"
            />
            <View
              style={[
                styles.reportSheet,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  paddingBottom:
                    (Platform.OS === "web" ? 24 : insets.bottom) + 16,
                },
              ]}
            >
              {rfqState === "submitting" ? (
                <View style={styles.reportResult}>
                  <ActivityIndicator color={colors.primary} />
                  <AppText
                    style={[
                      styles.reportSubtitle,
                      { color: colors.mutedForeground, textAlign: "center" },
                    ]}
                  >
                    {t("listing.rfq.sending")}
                  </AppText>
                </View>
              ) : rfqState === "done" ? (
                <View style={styles.reportResult}>
                  <View
                    style={[
                      styles.reportResultIcon,
                      { backgroundColor: colors.primary + "18" },
                    ]}
                  >
                    <Feather name="check" size={30} color={colors.primary} />
                  </View>
                  <AppText
                    style={[
                      styles.reportTitle,
                      { color: colors.foreground, textAlign: "center" },
                    ]}
                  >
                    {t("listing.rfq.successTitle")}
                  </AppText>
                  <AppText
                    style={[
                      styles.reportSubtitle,
                      { color: colors.mutedForeground, textAlign: "center" },
                    ]}
                  >
                    {t("listing.rfq.successBody")}
                  </AppText>
                  <Pressable
                    style={[
                      styles.reportCancel,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: colors.radius,
                      },
                    ]}
                    onPress={() => setRfqOpen(false)}
                    testID="rfq-done"
                  >
                    <AppText
                      style={[
                        styles.reportCancelText,
                        { color: colors.primaryForeground },
                      ]}
                    >
                      {t("listing.rfq.done")}
                    </AppText>
                  </Pressable>
                </View>
              ) : rfqState === "error" ? (
                <View style={styles.reportResult}>
                  <View
                    style={[
                      styles.reportResultIcon,
                      { backgroundColor: colors.destructive + "18" },
                    ]}
                  >
                    <Feather
                      name="alert-triangle"
                      size={28}
                      color={colors.destructive}
                    />
                  </View>
                  <AppText
                    style={[
                      styles.reportTitle,
                      { color: colors.foreground, textAlign: "center" },
                    ]}
                  >
                    {t("listing.rfq.errorTitle")}
                  </AppText>
                  <AppText
                    style={[
                      styles.reportSubtitle,
                      { color: colors.mutedForeground, textAlign: "center" },
                    ]}
                  >
                    {t("listing.rfq.errorBody")}
                  </AppText>
                  <Pressable
                    style={[
                      styles.reportCancel,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: colors.radius,
                      },
                    ]}
                    onPress={() => setRfqState("idle")}
                    testID="rfq-retry"
                  >
                    <AppText
                      style={[
                        styles.reportCancelText,
                        { color: colors.primaryForeground },
                      ]}
                    >
                      {t("listing.rfq.retry")}
                    </AppText>
                  </Pressable>
                </View>
              ) : (
                <>
                  <AppText
                    style={[
                      styles.reportTitle,
                      { color: colors.foreground, textAlign },
                    ]}
                  >
                    {t("listing.rfq.title")}
                  </AppText>
                  <AppText
                    style={[
                      styles.reportSubtitle,
                      { color: colors.mutedForeground, textAlign },
                    ]}
                  >
                    {t("listing.rfq.subtitle")}
                  </AppText>

                  <View
                    style={[
                      styles.rfqSummary,
                      { backgroundColor: colors.secondary, flexDirection: rowDir },
                    ]}
                  >
                    <AppText
                      style={[
                        styles.rfqSummaryTitle,
                        { color: colors.foreground, textAlign },
                      ]}
                      numberOfLines={1}
                    >
                      {listing.title}
                    </AppText>
                    <AppText
                      style={[styles.rfqSummaryPrice, { color: colors.primary }]}
                    >
                      {listing.payment?.lowest_monthly
                        ? `${listing.payment.lowest_monthly}${t("common.perMonth")}`
                        : listing.price_display}
                    </AppText>
                  </View>

                  {financingOptions.length > 0 ? (
                    <View style={styles.rfqGroup}>
                      <AppText
                        style={[
                          styles.rfqLabel,
                          { color: colors.foreground, textAlign },
                        ]}
                      >
                        {t("listing.rfq.financingLabel")}
                      </AppText>
                      <View style={[styles.rfqChips, { flexDirection: rowDir }]}>
                        <RfqChip
                          label={t("listing.rfq.anyPlan")}
                          active={rfqPref === "any"}
                          onPress={() => setRfqPref("any")}
                          colors={colors}
                        />
                        {islamicOptions.length > 0 ? (
                          <RfqChip
                            label={t("listing.rfq.islamicPlan")}
                            active={rfqPref === "islamic"}
                            onPress={() => setRfqPref("islamic")}
                            colors={colors}
                          />
                        ) : null}
                        {conventionalOptions.length > 0 ? (
                          <RfqChip
                            label={t("listing.rfq.bankPlan")}
                            active={rfqPref === "bank"}
                            onPress={() => setRfqPref("bank")}
                            colors={colors}
                          />
                        ) : null}
                      </View>
                    </View>
                  ) : null}

                  {monthlyOptions.length > 0 ? (
                    <View style={styles.rfqGroup}>
                      <AppText
                        style={[
                          styles.rfqLabel,
                          { color: colors.foreground, textAlign },
                        ]}
                      >
                        {t("listing.rfq.monthlyLabel")}
                      </AppText>
                      <View style={[styles.rfqChips, { flexDirection: rowDir }]}>
                        <RfqChip
                          label={t("listing.rfq.anyMonthly")}
                          active={rfqMonthly === null}
                          onPress={() => setRfqMonthly(null)}
                          colors={colors}
                        />
                        {monthlyOptions.map((m) => (
                          <RfqChip
                            key={m}
                            label={`${m}${t("common.perMonth")}`}
                            active={rfqMonthly === m}
                            onPress={() => setRfqMonthly(m)}
                            colors={colors}
                          />
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {hasSeller ? (
                    <View style={styles.rfqGroup}>
                      <AppText
                        style={[
                          styles.rfqLabel,
                          { color: colors.foreground, textAlign },
                        ]}
                      >
                        {t("listing.rfq.contactLabel")}
                      </AppText>
                      <View style={[styles.rfqChips, { flexDirection: rowDir }]}>
                        {whatsappEnabled && (
                          <RfqChip
                            label={t("listing.rfq.whatsapp")}
                            active={rfqContact === "whatsapp"}
                            onPress={() => setRfqContact("whatsapp")}
                            colors={colors}
                            icon="logo-whatsapp"
                          />
                        )}
                        <RfqChip
                          label={t("listing.rfq.call")}
                          active={rfqContact === "call"}
                          onPress={() => setRfqContact("call")}
                          colors={colors}
                          icon="call-outline"
                        />
                      </View>
                    </View>
                  ) : null}

                  <View style={styles.rfqGroup}>
                    <AppText
                      style={[
                        styles.rfqLabel,
                        { color: colors.foreground, textAlign },
                      ]}
                    >
                      {t("listing.rfq.noteLabel")}
                    </AppText>
                    <TextInput
                      value={rfqNote}
                      onChangeText={setRfqNote}
                      placeholder={t("listing.rfq.notePlaceholder")}
                      placeholderTextColor={colors.mutedForeground}
                      multiline
                      style={[
                        styles.rfqInput,
                        {
                          backgroundColor: colors.secondary,
                          color: colors.foreground,
                          borderColor: colors.border,
                          textAlign,
                        },
                      ]}
                    />
                  </View>

                  <Pressable
                    style={[
                      styles.rfqSubmit,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: colors.radius,
                        flexDirection: rowDir,
                      },
                    ]}
                    onPress={submitRfq}
                    testID="rfq-submit"
                  >
                    <MaterialCommunityIcons
                      name="send"
                      size={18}
                      color={colors.primaryForeground}
                    />
                    <AppText
                      style={[
                        styles.rfqSubmitText,
                        { color: colors.primaryForeground },
                      ]}
                    >
                      {t("listing.rfq.send")}
                    </AppText>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.reportCancel,
                      {
                        backgroundColor: colors.secondary,
                        borderRadius: colors.radius,
                      },
                    ]}
                    onPress={closeRfq}
                  >
                    <AppText
                      style={[
                        styles.reportCancelText,
                        { color: colors.foreground },
                      ]}
                    >
                      {t("common.cancel")}
                    </AppText>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={applyOpen}
        transparent
        animationType="slide"
        onRequestClose={closeApply}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={closeApply}
            accessibilityRole="button"
          />
          <View
            style={[
              styles.reportSheet,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                paddingBottom: (Platform.OS === "web" ? 24 : insets.bottom) + 16,
              },
            ]}
          >
            {applyState === "submitting" ? (
              <View style={styles.reportResult}>
                <ActivityIndicator color={colors.primary} />
                <AppText
                  style={[
                    styles.reportSubtitle,
                    { color: colors.mutedForeground, textAlign: "center" },
                  ]}
                >
                  {t("listing.apply.submitting")}
                </AppText>
              </View>
            ) : applyState === "done" ? (
              <View style={styles.reportResult}>
                <View
                  style={[
                    styles.reportResultIcon,
                    { backgroundColor: colors.primary + "18" },
                  ]}
                >
                  <Feather name="check" size={30} color={colors.primary} />
                </View>
                <AppText
                  style={[
                    styles.reportTitle,
                    { color: colors.foreground, textAlign: "center" },
                  ]}
                >
                  {t("listing.apply.successTitle")}
                </AppText>
                <AppText
                  style={[
                    styles.reportSubtitle,
                    { color: colors.mutedForeground, textAlign: "center" },
                  ]}
                >
                  {t("listing.apply.successBody")}
                </AppText>
                <Pressable
                  style={[
                    styles.reportCancel,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: colors.radius,
                    },
                  ]}
                  onPress={() => setApplyOpen(false)}
                  testID="apply-done"
                >
                  <AppText
                    style={[
                      styles.reportCancelText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    {t("listing.apply.done")}
                  </AppText>
                </Pressable>
              </View>
            ) : applyState === "error" ? (
              <View style={styles.reportResult}>
                <View
                  style={[
                    styles.reportResultIcon,
                    { backgroundColor: colors.destructive + "18" },
                  ]}
                >
                  <Feather
                    name="alert-triangle"
                    size={28}
                    color={colors.destructive}
                  />
                </View>
                <AppText
                  style={[
                    styles.reportTitle,
                    { color: colors.foreground, textAlign: "center" },
                  ]}
                >
                  {t("listing.apply.errorTitle")}
                </AppText>
                <AppText
                  style={[
                    styles.reportSubtitle,
                    { color: colors.mutedForeground, textAlign: "center" },
                  ]}
                >
                  {t("listing.apply.errorBody")}
                </AppText>
                <Pressable
                  style={[
                    styles.reportCancel,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: colors.radius,
                    },
                  ]}
                  onPress={() => setApplyState("idle")}
                  testID="apply-retry"
                >
                  <AppText
                    style={[
                      styles.reportCancelText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    {t("listing.apply.retry")}
                  </AppText>
                </Pressable>
              </View>
            ) : (
              <>
                <AppText
                  style={[
                    styles.reportTitle,
                    { color: colors.foreground, textAlign },
                  ]}
                >
                  {t("listing.apply.title")}
                </AppText>
                <AppText
                  style={[
                    styles.reportSubtitle,
                    { color: colors.mutedForeground, textAlign },
                  ]}
                >
                  {t("listing.apply.subtitle")}
                </AppText>

                <AppText
                  style={[
                    styles.rfqLabel,
                    { color: colors.foreground, textAlign, marginTop: 14 },
                  ]}
                >
                  {t("listing.apply.choosePlan")}
                </AppText>
                <View style={{ gap: 8, marginTop: 8 }}>
                  {financingOptions.map((opt, i) => {
                    const selected = selectedPlan === i;
                    return (
                      <Pressable
                        key={`apply-${opt.mode}-${i}`}
                        onPress={() => setSelectedPlan(i)}
                        style={[
                          styles.applyPlanRow,
                          {
                            flexDirection: rowDir,
                            borderColor: selected
                              ? colors.primary
                              : colors.border,
                            backgroundColor: selected
                              ? colors.primary + "0D"
                              : colors.card,
                          },
                        ]}
                        testID={`apply-plan-${i}`}
                      >
                        <View
                          style={[
                            styles.applyRadio,
                            {
                              borderColor: selected
                                ? colors.primary
                                : colors.border,
                            },
                          ]}
                        >
                          {selected ? (
                            <View
                              style={[
                                styles.applyRadioDot,
                                { backgroundColor: colors.primary },
                              ]}
                            />
                          ) : null}
                        </View>
                        <View style={styles.applyPlanInfo}>
                          <View
                            style={[
                              styles.planLabelRow,
                              { flexDirection: rowDir },
                            ]}
                          >
                            <MaterialCommunityIcons
                              name={planIcon(opt)}
                              size={14}
                              color={colors.accent}
                            />
                            <AppText
                              style={[
                                styles.applyPlanLabel,
                                { color: colors.foreground, textAlign },
                              ]}
                            >
                              {planLabel(opt)}
                            </AppText>
                          </View>
                          {opt.monthly_payment ? (
                            <AppText
                              style={[
                                styles.applyPlanMonthly,
                                { color: colors.mutedForeground, textAlign },
                              ]}
                            >
                              {opt.monthly_payment}
                              {t("common.perMonth")}
                              {opt.duration_months
                                ? ` · ${opt.duration_months} ${t("listing.months")}`
                                : ""}
                            </AppText>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>

                {selectedOption ? (
                  <View
                    style={[
                      styles.applyDetailBox,
                      { backgroundColor: colors.secondary },
                    ]}
                  >
                    <AppText
                      style={[
                        styles.rfqLabel,
                        { color: colors.foreground, textAlign },
                      ]}
                    >
                      {t("listing.apply.selectedPlan")}
                    </AppText>
                    {selectedOption.down_payment ? (
                      <PlanRow
                        label={t("listing.downPayment")}
                        value={selectedOption.down_payment}
                        rowDir={rowDir}
                        colors={colors}
                      />
                    ) : null}
                    {selectedOption.monthly_payment ? (
                      <PlanRow
                        label={t("listing.monthlyPayment")}
                        value={selectedOption.monthly_payment}
                        suffix={t("common.perMonth")}
                        rowDir={rowDir}
                        colors={colors}
                        highlight
                      />
                    ) : null}
                    {selectedOption.duration_months ? (
                      <PlanRow
                        label={t("listing.duration")}
                        value={`${selectedOption.duration_months} ${t("listing.months")}`}
                        rowDir={rowDir}
                        colors={colors}
                      />
                    ) : null}
                  </View>
                ) : null}

                <View
                  style={[
                    styles.disclaimerBox,
                    {
                      backgroundColor: colors.secondary,
                      borderRadius: 8,
                      marginTop: 12,
                    },
                  ]}
                >
                  <Feather
                    name="info"
                    size={14}
                    color={colors.mutedForeground}
                    style={{ marginTop: 1 }}
                  />
                  <AppText
                    style={[
                      styles.disclaimerText,
                      { color: colors.mutedForeground, textAlign },
                    ]}
                  >
                    {t("listing.disclaimer")}
                  </AppText>
                </View>

                <Pressable
                  style={[
                    styles.rfqSubmit,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: colors.radius,
                      flexDirection: rowDir,
                    },
                  ]}
                  onPress={submitApply}
                  testID="apply-submit"
                >
                  <MaterialCommunityIcons
                    name="file-document-edit-outline"
                    size={18}
                    color={colors.primaryForeground}
                  />
                  <AppText
                    style={[
                      styles.rfqSubmitText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    {t("listing.apply.submit")}
                  </AppText>
                </Pressable>

                <Pressable
                  style={[
                    styles.reportCancel,
                    {
                      backgroundColor: colors.secondary,
                      borderRadius: colors.radius,
                    },
                  ]}
                  onPress={closeApply}
                >
                  <AppText
                    style={[
                      styles.reportCancelText,
                      { color: colors.foreground },
                    ]}
                  >
                    {t("common.cancel")}
                  </AppText>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function RfqChip({
  label,
  active,
  onPress,
  colors,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.rfqChip,
        {
          backgroundColor: active ? colors.primary : colors.secondary,
          borderColor: active ? colors.primary : colors.border,
        },
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={14}
          color={active ? colors.primaryForeground : colors.foreground}
        />
      ) : null}
      <AppText
        style={[
          styles.rfqChipText,
          { color: active ? colors.primaryForeground : colors.foreground },
        ]}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function PlanRow({
  label,
  value,
  suffix,
  rowDir,
  colors,
  highlight,
}: {
  label: string;
  value: string;
  suffix?: string;
  rowDir: "row" | "row-reverse";
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.planRow, { flexDirection: rowDir }]}>
      <AppText style={[styles.planRowLabel, { color: colors.mutedForeground }]}>
        {label}
      </AppText>
      <AppText
        style={[
          styles.planRowValue,
          { color: highlight ? colors.primary : colors.foreground },
        ]}
      >
        {value}
        {suffix ? (
          <AppText style={[styles.planRowSuffix, { color: colors.mutedForeground }]}>
            {suffix}
          </AppText>
        ) : null}
      </AppText>
    </View>
  );
}

function CTAButton({
  icon,
  label,
  testLabel,
  onPress,
  style,
  textColor,
  radius,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  testLabel: string;
  onPress: () => void;
  style?: object;
  textColor: string;
  radius: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.ctaBtn, { borderRadius: radius }, style]}
      testID={`cta-${testLabel}`}
    >
      <Ionicons name={icon} size={20} color={textColor} />
      <AppText style={[styles.ctaBtnText, { color: textColor }]}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  skeletonGallery: {
    width: "100%",
    height: 320,
  },
  cachedPrice: {
    fontSize: 24,
    fontWeight: "800",
  },
  cachedTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  cachedLocation: {
    fontSize: 14,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  errorText: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  galleryWrapper: {
    position: "relative",
  },
  floatBtn: {
    position: "absolute",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 20,
    padding: 8,
    zIndex: 10,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  priceSection: {
    alignItems: "flex-start",
    gap: 10,
    flexWrap: "wrap",
  },
  price: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    flex: 1,
  },
  soldBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 18,
    alignSelf: "center",
  },
  soldBadgeText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  paymentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
  },
  paymentBadgeText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  title: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 26,
    marginTop: 6,
  },
  locationRow: {
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  location: {
    flexShrink: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  mapsBtn: {
    marginStart: "auto",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  mapsBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  offerBtn: {
    marginTop: 16,
    borderWidth: 1.5,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  offerBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  section: {
    marginTop: 24,
    paddingTop: 24,
    borderTopWidth: 1,
    gap: 14,
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  description: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  specsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  specItem: {
    width: "48%",
    padding: 12,
    borderWidth: 1,
    gap: 4,
  },
  specKey: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
  },
  specValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  installmentHighlight: {
    padding: 16,
    borderWidth: 1,
    alignItems: "center",
  },
  installmentFrom: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  installmentAmount: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  installmentPer: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  monthlyRow: {
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  monthlyRowText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  monthlyRowPer: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  trustRow: {
    flexWrap: "wrap",
    gap: 18,
    marginTop: 10,
  },
  trustStat: {
    alignItems: "flex-start",
  },
  trustValue: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  trustLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  planGroup: {
    gap: 10,
  },
  planGroupHead: {
    alignItems: "center",
    gap: 6,
  },
  planGroupTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  optionCard: {
    padding: 14,
    borderWidth: 1,
    gap: 8,
  },
  optionHead: {
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  optionMode: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  bestBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  bestBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  planRow: {
    justifyContent: "space-between",
    alignItems: "center",
  },
  planRowLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  planRowValue: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  planRowSuffix: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  disclaimerBox: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    alignItems: "flex-start",
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  sellerCard: {
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderWidth: 1,
  },
  sellerAvatar: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  sellerInitial: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  sellerInfo: {
    flex: 1,
    gap: 3,
  },
  sellerNameRow: {
    alignItems: "center",
    gap: 6,
  },
  sellerName: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  sellerRole: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textTransform: "capitalize",
  },
  reportBtn: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 28,
    paddingVertical: 12,
  },
  reportText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  ctaBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 10,
  },
  ctaBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
  },
  ctaBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  contactUnavailable: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  contactUnavailableText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  reportSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  reportTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  reportSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    marginBottom: 8,
  },
  reasonRow: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    borderTopWidth: 1,
  },
  reasonText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  reportCancel: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: "center",
  },
  reportCancelText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  reportResult: {
    alignItems: "center",
    paddingVertical: 16,
    gap: 8,
  },
  reportResultIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  flex: { flex: 1 },
  sellerMetaRow: {
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    flexWrap: "wrap",
  },
  verifiedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  verifiedPillText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  rfqSummary: {
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  rfqSummaryTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  rfqSummaryPrice: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  rfqGroup: {
    marginTop: 16,
    gap: 8,
  },
  rfqLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  rfqChips: {
    flexWrap: "wrap",
    gap: 8,
  },
  rfqChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  rfqChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  rfqInput: {
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlignVertical: "top",
  },
  rfqSubmit: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    marginTop: 20,
  },
  rfqSubmitText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  planLabelRow: {
    alignItems: "center",
    gap: 6,
  },
  applyBtn: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    marginTop: 6,
  },
  applyBtnText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  contactRow: {
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderWidth: 1,
    gap: 12,
  },
  contactNumberWrap: {
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  contactNumber: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  contactActions: {
    alignItems: "center",
    gap: 8,
  },
  contactIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  applyPlanRow: {
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  applyRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  applyRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  applyPlanInfo: {
    flex: 1,
    gap: 4,
  },
  applyPlanLabel: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  applyPlanMonthly: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  applyDetailBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
});
