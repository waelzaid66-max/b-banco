import { useAuth, useSignIn, useSignUp, useSSO, useUser } from "@clerk/expo";
import { Feather, Ionicons, MaterialCommunityIcons } from "@/components/icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { router, type Href } from "expo-router";
import {
  getGetMeQueryKey,
  getGetMyListingsQueryKey,
  getGetMyMetricsQueryKey,
  getGetMySocialLinksQueryKey,
  setMySocialLinks,
  promoteUpload,
  updateMe,
  useGetMe,
  useGetMyListings,
  useGetMyMetrics,
  useGetMySocialLinks,
  type FeedItem,
  type SocialLink,
  type SocialLinkPlatform,
} from "@workspace/api-client-react";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type StyleProp,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useQueryClient } from "@tanstack/react-query";

import { AppText } from "@/components/AppText";
import { BancoLogo } from "@/components/BancoLogo";
import { CountryCodePicker } from "@/components/CountryCodePicker";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { PermissionRationaleModal } from "@/components/PermissionRationaleModal";
import { PromoteButton } from "@/components/PromoteButton";
import {
  countryByIso,
  isValidNationalNumber,
  parsePhone,
  toE164,
} from "@/constants/countryCodes";
import { useI18n } from "@/context/LanguageContext";
import { useSession } from "@/context/SessionContext";
import { useColors } from "@/hooks/useColors";
import { buildAvatarDataUri, uploadMediaAsset } from "@/lib/upload";

// Finalizes any pending OAuth redirect when the in-app browser returns.
WebBrowser.maybeCompleteAuthSession();

type Mode = "signin" | "signup";
type Step = "form" | "verify" | "reset";

const CONSENT_VERSION = "2026-06-11";

function socialIcon(
  platform: string
): React.ComponentProps<typeof Ionicons>["name"] {
  switch (platform.toLowerCase()) {
    case "facebook":
      return "logo-facebook";
    case "instagram":
      return "logo-instagram";
    case "twitter":
    case "x":
      return "logo-twitter";
    case "linkedin":
      return "logo-linkedin";
    case "youtube":
      return "logo-youtube";
    case "tiktok":
      return "logo-tiktok";
    case "whatsapp":
      return "logo-whatsapp";
    case "website":
    case "web":
      return "globe-outline";
    default:
      return "link-outline";
  }
}

const SOCIAL_PLATFORMS: SocialLinkPlatform[] = [
  "instagram",
  "linkedin",
  "website",
  "whatsapp",
];

// 2-column posts grid sizing (profileContent has 20px side pad).
const GRID_GAP = 12;
const tileSize = (Dimensions.get("window").width - 40 - GRID_GAP) / 2;
const tileImageHeight = Math.round(tileSize * 0.72);

export default function ProfileScreen() {
  const colors = useColors();
  const { t, lang, setLang, isRTL } = useI18n();
  const formatListedDate = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleDateString(
        lang === "ar" ? "ar-EG" : "en-US",
        { month: "short", day: "numeric", year: "numeric" }
      );
    } catch {
      return null;
    }
  };
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { cacheFeedItem, listingsVersion } = useSession();
  const { signIn, errors: signInErrors, fetchStatus: signInStatus } = useSignIn();
  const { signUp, errors: signUpErrors, fetchStatus: signUpStatus } = useSignUp();
  const { user, isLoaded } = useUser();
  const { signOut } = useAuth();
  const { startSSOFlow } = useSSO();

  const [mode, setMode] = useState<Mode>("signin");
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetSending, setResetSending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [showPhotoRationale, setShowPhotoRationale] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [signupPhoneIso, setSignupPhoneIso] = useState("EG");
  const [signupPhoneNumber, setSignupPhoneNumber] = useState("");
  const [showSignupPhoneCountryPicker, setShowSignupPhoneCountryPicker] =
    useState(false);
  const [accountType, setAccountType] = useState<"personal" | "business">(
    "personal"
  );
  const consentPendingRef = useRef(false);
  const pendingPhoneRef = useRef("");
  const pendingBusinessRef = useRef(false);
  const pendingFirstNameRef = useRef("");
  const pendingLastNameRef = useRef("");

  const [oauthLoading, setOauthLoading] = useState<null | "google" | "apple">(
    null
  );
  const [needsAccountType, setNeedsAccountType] = useState(false);
  const [savingAccountType, setSavingAccountType] = useState(false);
  const [pendingType, setPendingType] = useState<
    "individual" | "dealer" | "company"
  >("individual");
  // Set only after an in-session SSO auth, so the account-type prompt never
  // appears on a cold launch for an already-signed-in user.
  const authJustHappenedRef = useRef(false);

  // Real seller metrics + server-backed social links (Task #38 — REAL data only).
  const metricsQuery = useGetMyMetrics({
    query: { queryKey: getGetMyMetricsQueryKey(), enabled: !!user },
  });
  // Authoritative account state (internal account number lives here).
  const meQuery = useGetMe({
    query: { queryKey: getGetMeQueryKey(), enabled: !!user },
  });
  const socialQuery = useGetMySocialLinks({
    query: { queryKey: getGetMySocialLinksQueryKey(), enabled: !!user },
  });
  // The Instagram-style grid of the caller's OWN real listings (role-agnostic).
  const listingsQuery = useGetMyListings(undefined, {
    query: { queryKey: getGetMyListingsQueryKey(), enabled: !!user },
  });
  // Refetch the profile grid when the user publishes a listing so it appears
  // immediately — the profile tab stays mounted, so react-query won't refetch on
  // its own. refetch is stable, so this runs only on version change; the initial
  // mount (version 0) is skipped (the query already loads on mount).
  const refetchListings = listingsQuery.refetch;
  useEffect(() => {
    if (listingsVersion === 0) return;
    refetchListings();
  }, [listingsVersion, refetchListings]);
  const [showSocialEdit, setShowSocialEdit] = useState(false);
  const [savingSocial, setSavingSocial] = useState(false);
  const [socialDraft, setSocialDraft] = useState<Record<string, string>>({});
  // Profile identity redesign (Task #143) — presentational fields live in Clerk
  // unsafeMetadata (no new backend); cover reuses uploadMediaAsset.
  const [showMenu, setShowMenu] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [displayTitleDraft, setDisplayTitleDraft] = useState("");
  const [categoryLabelDraft, setCategoryLabelDraft] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [phoneIsoDraft, setPhoneIsoDraft] = useState("EG");
  const [phoneNumberDraft, setPhoneNumberDraft] = useState("");
  const [showPhoneCountryPicker, setShowPhoneCountryPicker] = useState(false);
  const queryClient = useQueryClient();

  const isSigningIn = signInStatus === "fetching";
  const isSigningUp = signUpStatus === "fetching";

  // Persist the user's explicit consent (version + timestamp) to Clerk once the
  // freshly created account becomes active. Guarded by a ref so it only records
  // for an account created in this session, never for returning sign-ins.
  useEffect(() => {
    if (!user || !consentPendingRef.current) return;
    consentPendingRef.current = false;
    const phoneToSave = pendingPhoneRef.current;
    const goBusiness = pendingBusinessRef.current;
    const firstNameToSave = pendingFirstNameRef.current;
    const lastNameToSave = pendingLastNameRef.current;
    pendingPhoneRef.current = "";
    pendingBusinessRef.current = false;
    pendingFirstNameRef.current = "";
    pendingLastNameRef.current = "";
    (async () => {
      try {
        await user.update({
          ...(firstNameToSave ? { firstName: firstNameToSave } : {}),
          ...(lastNameToSave ? { lastName: lastNameToSave } : {}),
          unsafeMetadata: {
            ...(user.unsafeMetadata ?? {}),
            termsAcceptedAt: new Date().toISOString(),
            termsVersion: CONSENT_VERSION,
            accountTypeChosen: true,
          },
        });
      } catch (e) {
        console.warn("[profile] consent metadata save failed", e);
      }
      // Persist the chosen account type (server-authoritative role mapping)
      // plus optional phone. Clerk token is already wired by the
      // AuthTokenBridge once the session is active.
      try {
        await updateMe({
          account_type: goBusiness ? "dealer" : "individual",
          ...(phoneToSave ? { phone: phoneToSave } : {}),
        });
      } catch (e) {
        console.warn("[profile] post-signup account_type save failed", e);
      }
      // Business signups continue straight into fast onboarding.
      if (goBusiness) {
        router.push("/business/onboarding");
      }
    })();
  }, [user]);

  // Warm up the in-app browser so the OAuth sheet opens instantly (no-op on web).
  useEffect(() => {
    if (Platform.OS === "web") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  // After an in-session SSO sign-in, prompt brand-new accounts (those without a
  // chosen account type) to pick Individual / Dealer / Company before entering.
  useEffect(() => {
    if (!user || !authJustHappenedRef.current) return;
    authJustHappenedRef.current = false;
    if (!user.unsafeMetadata?.accountTypeChosen) {
      setNeedsAccountType(true);
    }
  }, [user]);

  // Step 3 of the picker flow: only fires AFTER the user has acknowledged the
  // in-app rationale, so the OS prompt never appears without a disclosure.
  const launchPhotoPicker = async () => {
    setShowPhotoRationale(false);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          t("profile.photoPermissionTitle"),
          t("profile.photoPermissionBody"),
          [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("profile.photoPermissionSettings"),
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ],
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.6,
      });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      setUploadingPhoto(true);
      // Downscale + JPEG-encode to a bounded base64 data URI before handing it
      // to Clerk. Encoding the full-resolution photo (picker base64:true) can
      // OOM on large images; this keeps the payload small regardless of source.
      const file = await buildAvatarDataUri(asset);
      await user?.setProfileImage({ file });
      await user?.reload();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn("[profile] avatar upload failed", e);
      Alert.alert(
        t("profile.photoUploadFailedTitle"),
        t("profile.photoUploadFailedBody"),
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Cover photo — reuses the shared media upload (returns a hosted URL) and
  // stores only the URL string in Clerk unsafeMetadata. No new endpoint.
  const launchCoverPicker = async () => {
    setShowMenu(false);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          t("profile.photoPermissionTitle"),
          t("profile.photoPermissionBody"),
          [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("profile.photoPermissionSettings"),
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ],
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.6,
      });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      setUploadingCover(true);
      const uploaded = await uploadMediaAsset(asset);
      // Covers upload PRIVATE; promote to public ACL so the serve handler returns
      // them without auth (web + mobile <Image> send no bearer). Promote BEFORE
      // persisting the URL — a coverUrl that 403s is worse than no cover.
      await promoteUpload({ url: uploaded.url });
      await user?.update({
        unsafeMetadata: {
          ...(user.unsafeMetadata ?? {}),
          coverUrl: uploaded.url,
        },
      });
      await user?.reload();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn("[profile] cover upload failed", e);
      Alert.alert(
        t("profile.photoUploadFailedTitle"),
        t("profile.photoUploadFailedBody"),
      );
    } finally {
      setUploadingCover(false);
    }
  };

  const openEditProfile = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowMenu(false);
    const meta = (user?.unsafeMetadata ?? {}) as Record<string, unknown>;
    setDisplayTitleDraft(
      typeof meta.displayTitle === "string" ? meta.displayTitle : "",
    );
    setCategoryLabelDraft(
      typeof meta.categoryLabel === "string" ? meta.categoryLabel : "",
    );
    setBioDraft(typeof meta.bio === "string" ? meta.bio : "");
    const parsed = parsePhone(meQuery.data?.data?.phone);
    setPhoneIsoDraft(parsed.iso);
    setPhoneNumberDraft(parsed.number);
    setShowEditProfile(true);
  };

  const saveProfile = async () => {
    if (savingProfile) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const country = countryByIso(phoneIsoDraft);
    const national = phoneNumberDraft.trim();
    if (national && !isValidNationalNumber(national, country)) {
      Alert.alert(
        t("profile.editProfileError"),
        t("create.phoneFormatHint", { sample: country.sample }),
      );
      return;
    }
    setSavingProfile(true);
    try {
      await user?.update({
        unsafeMetadata: {
          ...(user.unsafeMetadata ?? {}),
          displayTitle: displayTitleDraft.trim(),
          categoryLabel: categoryLabelDraft.trim(),
          bio: bioDraft.trim(),
        },
      });
      // Phone lives on Banco /me (not Clerk metadata). Empty clears the field.
      await updateMe({
        phone: national ? toE164(national, country) : null,
      });
      await user?.reload();
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowEditProfile(false);
    } catch {
      Alert.alert(t("profile.editProfileError"));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSignIn = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { error } = await signIn.password({ emailAddress: email, password });
    if (error) return;
    if (signIn.status === "complete") {
      await signIn.finalize({ navigate: () => {} });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  // Email-based password recovery (Clerk reset_password_email_code). Phone
  // recovery is intentionally NOT offered — this Clerk tenant only supports
  // email, and we never surface a recovery channel we can't actually deliver.
  const handleForgotPassword = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setResetSending(true);
    const { error } = await signIn.create({ identifier: email });
    if (!error) {
      const { error: sendErr } = await signIn.resetPasswordEmailCode.sendCode();
      if (!sendErr) {
        setPassword("");
        setStep("reset");
      }
    }
    setResetSending(false);
  };

  const handleResetPassword = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { error: verifyErr } =
      await signIn.resetPasswordEmailCode.verifyCode({ code: resetCode });
    if (verifyErr) return;
    const { error: pwErr } = await signIn.resetPasswordEmailCode.submitPassword({
      password: newPassword,
      signOutOfOtherSessions: true,
    });
    if (pwErr) return;
    if (signIn.status === "complete") {
      await signIn.finalize({ navigate: () => {} });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleSignUp = async () => {
    // Safety net: the submit button is already disabled on these conditions.
    if (password !== confirmPassword) return;
    if (!firstName.trim() || !lastName.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    consentPendingRef.current = true;
    pendingPhoneRef.current = signupPhoneNumber.trim()
      ? toE164(signupPhoneNumber.trim(), countryByIso(signupPhoneIso))
      : "";
    pendingBusinessRef.current = accountType === "business";
    pendingFirstNameRef.current = firstName.trim();
    pendingLastNameRef.current = lastName.trim();
    const { error } = await signUp.password({ emailAddress: email, password });
    if (error) {
      consentPendingRef.current = false;
      pendingPhoneRef.current = "";
      pendingBusinessRef.current = false;
      pendingFirstNameRef.current = "";
      pendingLastNameRef.current = "";
      return;
    }
    await signUp.verifications.sendEmailCode();
    setStep("verify");
  };

  const handleVerify = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await signUp.verifications.verifyEmailCode({ code: verifyCode });
    if (signUp.status === "complete") {
      await signUp.finalize({ navigate: () => {} });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleOAuth = async (provider: "google" | "apple") => {
    if (oauthLoading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOauthLoading(provider);
    try {
      const { createdSessionId, setActive: ssoSetActive } = await startSSOFlow({
        strategy: provider === "google" ? "oauth_google" : "oauth_apple",
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId && ssoSetActive) {
        authJustHappenedRef.current = true;
        await ssoSetActive({ session: createdSessionId });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      Alert.alert(t("profile.oauthFailed"));
    } finally {
      setOauthLoading(null);
    }
  };

  const chooseAccountType = async (
    type: "individual" | "dealer" | "company"
  ) => {
    if (savingAccountType) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSavingAccountType(true);
    try {
      await updateMe({ account_type: type });
      try {
        await user?.update({
          unsafeMetadata: {
            ...(user.unsafeMetadata ?? {}),
            accountTypeChosen: true,
          },
        });
        await user?.reload();
      } catch (e) {
        console.warn("[profile] accountTypeChosen flag save failed", e);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNeedsAccountType(false);
      if (type === "dealer" || type === "company") {
        router.push("/business/onboarding");
      }
    } catch {
      Alert.alert(t("profile.accountTypeError"));
    } finally {
      setSavingAccountType(false);
    }
  };

  const openSocialEdit = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const current = socialQuery.data?.data ?? [];
    const draft: Record<string, string> = {};
    for (const p of SOCIAL_PLATFORMS) {
      draft[p] = current.find((l) => l.platform === p)?.value ?? "";
    }
    setSocialDraft(draft);
    setShowSocialEdit(true);
  };

  const saveSocial = async () => {
    if (savingSocial) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSavingSocial(true);
    try {
      const links: SocialLink[] = SOCIAL_PLATFORMS.flatMap((platform) => {
        const value = (socialDraft[platform] ?? "").trim();
        return value ? [{ platform, value }] : [];
      });
      await setMySocialLinks({ links });
      await socialQuery.refetch();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowSocialEdit(false);
    } catch {
      Alert.alert(t("profile.socialSaveError"));
    } finally {
      setSavingSocial(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setStep("form");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setShowConfirmPassword(false);
    setFirstName("");
    setLastName("");
    setVerifyCode("");
    setResetCode("");
    setNewPassword("");
    setShowPassword(false);
    setShowNewPassword(false);
    setAgreedToTerms(false);
    setSignupPhoneIso("EG");
    setSignupPhoneNumber("");
    setAccountType("personal");
    // Abandon any in-flight signup intent so a returning sign-in never
    // inherits a previous draft's consent, phone, name, or business routing.
    consentPendingRef.current = false;
    pendingPhoneRef.current = "";
    pendingBusinessRef.current = false;
    pendingFirstNameRef.current = "";
    pendingLastNameRef.current = "";
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.secondary,
      color: colors.foreground,
      borderColor: colors.border,
      borderRadius: colors.radius,
    },
  ];

  if (!isLoaded) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: colors.background, paddingTop: topPad },
        ]}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (user && needsAccountType) {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[
          styles.authContent,
          { paddingTop: topPad + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <BancoLogo height={40} style={styles.authLogoImg} />
        <AppText style={[styles.authTitle, { color: colors.foreground }]}>
          {t("profile.chooseAccountType")}
        </AppText>
        <AppText
          style={[styles.authSubtitle, { color: colors.mutedForeground }]}
        >
          {t("profile.chooseAccountTypeHint")}
        </AppText>
        {(
          [
            {
              type: "individual",
              icon: "account-outline",
              label: "accountIndividual",
              hint: "accountIndividualHint",
            },
            {
              type: "dealer",
              icon: "storefront-outline",
              label: "accountDealer",
              hint: "accountDealerHint",
            },
            {
              type: "company",
              icon: "office-building-outline",
              label: "accountCompany",
              hint: "accountCompanyHint",
            },
          ] as const
        ).map((opt) => {
          const active = pendingType === opt.type;
          return (
            <Pressable
              key={opt.type}
              onPress={() => {
                Haptics.selectionAsync();
                setPendingType(opt.type);
              }}
              style={[
                styles.onboardCard,
                {
                  backgroundColor: active ? colors.primary + "14" : colors.card,
                  borderColor: active ? colors.primary : colors.border,
                  borderRadius: colors.radius,
                },
                isRTL && styles.rowReverse,
              ]}
              testID={`onboard-${opt.type}`}
            >
              <View
                style={[
                  styles.onboardIcon,
                  {
                    backgroundColor: active
                      ? colors.primary + "1A"
                      : colors.secondary,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={opt.icon}
                  size={22}
                  color={active ? colors.primary : colors.mutedForeground}
                />
              </View>
              <View style={{ flex: 1 }}>
                <AppText
                  style={[
                    styles.onboardTitle,
                    {
                      color: colors.foreground,
                      textAlign: isRTL ? "right" : "left",
                    },
                  ]}
                >
                  {t(`profile.${opt.label}`)}
                </AppText>
                <AppText
                  style={[
                    styles.onboardHint,
                    {
                      color: colors.mutedForeground,
                      textAlign: isRTL ? "right" : "left",
                    },
                  ]}
                >
                  {t(`profile.${opt.hint}`)}
                </AppText>
              </View>
              <Ionicons
                name={active ? "radio-button-on" : "radio-button-off"}
                size={20}
                color={active ? colors.primary : colors.mutedForeground}
              />
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => chooseAccountType(pendingType)}
          disabled={savingAccountType}
          style={[
            styles.authBtn,
            {
              backgroundColor: savingAccountType
                ? colors.secondary
                : colors.primary,
              borderRadius: colors.radius,
              marginTop: 16,
            },
          ]}
          testID="onboard-continue"
        >
          {savingAccountType ? (
            <ActivityIndicator color={colors.primaryForeground} size="small" />
          ) : (
            <AppText
              style={[styles.authBtnText, { color: colors.primaryForeground }]}
            >
              {t("profile.onboardingContinue")}
            </AppText>
          )}
        </Pressable>
      </ScrollView>
    );
  }

  if (user) {
    const memberSince = (() => {
      if (!user.createdAt) return null;
      try {
        return new Date(user.createdAt).toLocaleDateString(
          lang === "ar" ? "ar-EG" : "en-US",
          { month: "long", year: "numeric" }
        );
      } catch {
        return String(new Date(user.createdAt).getFullYear());
      }
    })();

    const role = (user.publicMetadata?.role as string) || "";
    const isBusiness = ["dealer", "company", "enterprise"].includes(role);

    const metrics = metricsQuery.data?.data;
    const social = socialQuery.data?.data ?? [];
    // Presentational identity fields persisted in Clerk unsafeMetadata (Task #143).
    const meta = (user.unsafeMetadata ?? {}) as Record<string, unknown>;
    const coverUrl = typeof meta.coverUrl === "string" ? meta.coverUrl : "";
    const displayTitle =
      typeof meta.displayTitle === "string" ? meta.displayTitle : "";
    const categoryLabel =
      typeof meta.categoryLabel === "string" ? meta.categoryLabel : "";
    const bio = typeof meta.bio === "string" ? meta.bio : "";
    const displayName = user.firstName ?? t("profile.member");
    const userEmail = user.emailAddresses[0]?.emailAddress ?? "";
    // Verification reflects the account state from /me (UserState), not metrics.
    const isVerified = !!meQuery.data?.data?.is_verified;
    // No backend "pending" field exists — a business-role account that isn't yet
    // verified is, by definition, awaiting admin review.
    const isUnderReview = isBusiness && !isVerified;
    const responseRate =
      typeof metrics?.response_rate === "number" ? metrics.response_rate : null;

    // Profile-completion nudge (own profile only): the three signals that make a
    // seller trustworthy + reachable. Each missing item is a one-tap fix. The
    // whole block vanishes once complete — no nagging.
    const completionItems = [
      { key: "photo", done: !!user.hasImage, onPress: () => setShowPhotoRationale(true) },
      { key: "bio", done: !!bio, onPress: openEditProfile },
      { key: "phone", done: !!meQuery.data?.data?.phone?.trim(), onPress: openEditProfile },
    ];
    const completionMissing = completionItems.filter((i) => !i.done);
    const statNum = (n: number | undefined) =>
      typeof n === "number"
        ? n.toLocaleString(lang === "ar" ? "ar-EG" : "en-US")
        : "—";
    const stats = [
      { value: metrics?.total_listings, label: t("profile.statListings") },
      { value: metrics?.active_listings, label: t("profile.statActive") },
      { value: metrics?.years_active, label: t("profile.statYears") },
    ];
    const socialHref = (l: SocialLink) =>
      l.platform === "whatsapp"
        ? `https://wa.me/${l.value.replace(/[^\d]/g, "")}`
        : /^https?:\/\//i.test(l.value)
          ? l.value
          : `https://${l.value}`;
    const profileTabs: {
      icon: React.ComponentProps<typeof Ionicons>["name"];
      label: string;
      route: Href;
    }[] = [
      { icon: "clipboard-outline", label: "tabRequests", route: "/rfq" },
      { icon: "heart-outline", label: "tabSaved", route: "/(tabs)/saved" },
      {
        icon: "notifications-outline",
        label: "tabActivity",
        route: "/notifications",
      },
    ];
    if (isBusiness) {
      profileTabs.push({
        icon: "people-outline",
        label: "tabLeads",
        route: "/business/requests",
      });
    }
    const posts = listingsQuery.data?.data ?? [];
    // Host hub is a first-class journey — never hide behind bookable inventory.
    const showRentalHub = true;

    const menuItems: {
      key: string;
      icon: React.ComponentProps<typeof Feather>["name"];
      label: string;
      onPress: () => void;
      danger?: boolean;
    }[] = [
      {
        key: "edit",
        icon: "edit-2",
        label: t("profile.editProfile"),
        onPress: openEditProfile,
      },
      {
        key: "cover",
        icon: "image",
        label: t("profile.changeCover"),
        onPress: launchCoverPicker,
      },
      {
        key: "listings",
        icon: "grid",
        label: t("profile.menuMyListings"),
        onPress: () => {
          setShowMenu(false);
          router.push("/listings/mine");
        },
      },
      {
        key: "business",
        icon: "briefcase",
        label: t("profile.menuBusiness"),
        onPress: () => {
          setShowMenu(false);
          router.push("/business/supply-hub" as Href);
        },
      },
      {
        key: "industry",
        icon: "tool",
        label: t("profile.menuIndustry"),
        onPress: () => {
          setShowMenu(false);
          router.push("/industry" as Href);
        },
      },
      ...(showRentalHub
        ? [
            {
              key: "rental-hub",
              icon: "home" as const,
              label: t("profile.menuRentalHub"),
              onPress: () => {
                setShowMenu(false);
                router.push("/rentals/hub" as Href);
              },
            },
          ]
        : []),
      {
        key: "trips",
        icon: "calendar",
        label: t("profile.menuTrips"),
        onPress: () => {
          setShowMenu(false);
          router.push("/bookings");
        },
      },
      {
        key: "wallet",
        icon: "credit-card",
        label: t("profile.menuWallet"),
        onPress: () => {
          setShowMenu(false);
          router.push("/billing" as Href);
        },
      },
      {
        key: "plans",
        icon: "star",
        label: t("profile.menuPlans"),
        onPress: () => {
          setShowMenu(false);
          router.push("/plans");
        },
      },
      {
        key: "verify",
        icon: "shield",
        label: t("profile.menuVerify"),
        onPress: () => {
          setShowMenu(false);
          router.push("/business/verification");
        },
      },
      {
        key: "account",
        icon: "user",
        label: t("profile.menuAccountType"),
        onPress: () => {
          setShowMenu(false);
          setNeedsAccountType(true);
        },
      },
      {
        key: "settings",
        icon: "settings",
        label: t("profile.menuSettings"),
        onPress: () => {
          setShowMenu(false);
          router.push("/settings");
        },
      },
      {
        key: "help",
        icon: "help-circle",
        label: t("profile.menuHelp"),
        onPress: () => {
          setShowMenu(false);
          router.push("/settings");
        },
      },
      {
        key: "signout",
        icon: "log-out",
        label: t("profile.signOut"),
        onPress: () => {
          setShowMenu(false);
          signOut();
        },
        danger: true,
      },
    ];

    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[
          styles.profileContent,
          { paddingTop: topPad + 20 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Cover photo (full-bleed) with overlaid quick actions (Task #143) */}
        <View
          style={[
            styles.coverWrap,
            { height: 180 + topPad, marginTop: -(topPad + 20) },
          ]}
        >
          {coverUrl ? (
            <Image
              source={{ uri: coverUrl }}
              style={styles.coverImage}
              contentFit="cover"
              transition={150}
            />
          ) : (
            <View
              style={[
                styles.coverImage,
                { backgroundColor: colors.primary + "22" },
              ]}
            />
          )}
          <View
            style={[
              styles.coverActions,
              { top: topPad + 8 },
              isRTL && styles.rowReverse,
            ]}
          >
            <Pressable
              onPress={launchCoverPicker}
              hitSlop={8}
              style={styles.coverActionBtn}
              testID="cover-edit"
            >
              {uploadingCover ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Feather name="camera" size={18} color="#ffffff" />
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setShowMenu(true);
              }}
              hitSlop={8}
              style={styles.coverActionBtn}
              testID="profile-menu"
            >
              <Ionicons name="ellipsis-horizontal" size={20} color="#ffffff" />
            </Pressable>
          </View>
        </View>

        {/* Identity: overlapping avatar + name/title/category/bio + trust */}
        <View style={styles.identityWrap}>
          <View style={[styles.avatarRow, isRTL && styles.rowReverse]}>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowPhotoRationale(true);
              }}
              style={[
                styles.avatarLarge,
                {
                  backgroundColor: colors.primary,
                  borderColor: colors.background,
                },
              ]}
              testID="avatar-edit"
            >
              <View style={styles.avatarLargeInner}>
                {user.hasImage ? (
                  <Image
                    source={{ uri: user.imageUrl }}
                    style={styles.avatarLargeImage}
                    contentFit="cover"
                  />
                ) : (
                  <AppText
                    style={[
                      styles.avatarLargeText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    {(user.firstName ?? userEmail ?? "U")
                      .charAt(0)
                      .toUpperCase()}
                  </AppText>
                )}
              </View>
              <View
                style={[
                  styles.avatarBadge,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.background,
                  },
                ]}
              >
                {uploadingPhoto ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Feather name="camera" size={13} color={colors.foreground} />
                )}
              </View>
            </Pressable>

            <Pressable
              onPress={openEditProfile}
              style={[
                styles.editProfileBtn,
                { borderColor: colors.border, borderRadius: colors.radius },
              ]}
              testID="edit-profile"
            >
              <Feather name="edit-2" size={14} color={colors.foreground} />
              <AppText
                style={[styles.editProfileText, { color: colors.foreground }]}
              >
                {t("profile.editProfile")}
              </AppText>
            </Pressable>
          </View>

          <View style={[styles.igNameRow, isRTL && styles.rowReverse]}>
            <AppText style={[styles.userName, { color: colors.foreground }]}>
              {displayName}
            </AppText>
            {isVerified ? (
              <MaterialCommunityIcons
                name="check-decagram"
                size={16}
                color={colors.primary}
              />
            ) : null}
          </View>

          {displayTitle ? (
            <AppText
              style={[
                styles.displayTitle,
                {
                  color: colors.foreground,
                  textAlign: isRTL ? "right" : "left",
                },
              ]}
              numberOfLines={1}
            >
              {displayTitle}
            </AppText>
          ) : null}

          <View style={[styles.igMetaRow, isRTL && styles.rowReverse]}>
            <View
              style={[
                styles.rolePill,
                { backgroundColor: colors.secondary, borderRadius: 6 },
              ]}
            >
              <AppText style={[styles.roleText, { color: colors.primary }]}>
                {categoryLabel ||
                  ((user.publicMetadata?.role as string) || t("profile.member"))
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase())}
              </AppText>
            </View>
            {memberSince && (
              <AppText
                style={[styles.memberSince, { color: colors.mutedForeground }]}
              >
                {t("profile.activeSince", { date: memberSince })}
              </AppText>
            )}
          </View>

          <Pressable onPress={openEditProfile} testID="profile-bio">
            <AppText
              style={[
                bio ? styles.bioText : styles.bioEmpty,
                {
                  color: bio ? colors.foreground : colors.mutedForeground,
                  textAlign: isRTL ? "right" : "left",
                },
              ]}
              numberOfLines={3}
            >
              {bio || t("profile.bioEmpty")}
            </AppText>
          </Pressable>
          {/* numberOfLines above: 3 lines reads like Instagram without pushing
              the trust row off-screen; tap opens the editor either way. */}

          {meQuery.data?.data?.phone?.trim() ? (
            <Pressable onPress={openEditProfile} testID="profile-phone">
              <AppText
                style={[
                  styles.profilePhone,
                  {
                    color: colors.mutedForeground,
                    textAlign: isRTL ? "right" : "left",
                  },
                ]}
              >
                {(() => {
                  const parsed = parsePhone(meQuery.data?.data?.phone);
                  const country = countryByIso(parsed.iso);
                  return parsed.number
                    ? `+${country.dial} ${parsed.number}`
                    : meQuery.data?.data?.phone;
                })()}
              </AppText>
            </Pressable>
          ) : null}

          {meQuery.data?.data?.account_number && (
            <AppText
              style={[
                styles.accountNumber,
                {
                  color: colors.mutedForeground,
                  textAlign: isRTL ? "right" : "left",
                },
              ]}
            >
              {t("profile.accountNumber")}: {meQuery.data.data.account_number}
            </AppText>
          )}

          <View style={[styles.trustRow, isRTL && styles.rowReverse]}>
            <View
              style={[styles.trustChip, { backgroundColor: colors.secondary }]}
            >
              <MaterialCommunityIcons
                name={
                  isVerified
                    ? "check-decagram"
                    : isUnderReview
                      ? "clock-outline"
                      : "shield-check"
                }
                size={14}
                color={
                  isVerified
                    ? colors.primary
                    : isUnderReview
                      ? colors.foreground
                      : colors.mutedForeground
                }
              />
              <AppText
                style={[
                  styles.trustChipText,
                  {
                    color: isVerified
                      ? colors.primary
                      : isUnderReview
                        ? colors.foreground
                        : colors.mutedForeground,
                  },
                ]}
              >
                {isVerified
                  ? t("common.verified")
                  : isUnderReview
                    ? t("profile.underReview")
                    : t("profile.notVerified")}
              </AppText>
            </View>
            {responseRate != null ? (
              <View
                style={[styles.trustChip, { backgroundColor: colors.secondary }]}
              >
                <Feather
                  name="message-circle"
                  size={13}
                  color={colors.mutedForeground}
                />
                <AppText
                  style={[
                    styles.trustChipText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {t("profile.responseRate", {
                    rate: statNum(Math.round(responseRate)),
                  })}
                </AppText>
              </View>
            ) : null}
          </View>
        </View>

        {/* Complete-your-profile nudge — one-tap fixes; hidden once complete. */}
        {completionMissing.length > 0 ? (
          <View
            style={[
              styles.completeCard,
              { backgroundColor: colors.secondary, borderColor: colors.border },
            ]}
            testID="profile-completion"
          >
            <View style={[styles.completeHeader, isRTL && styles.rowReverse]}>
              <Feather name="user" size={15} color={colors.primary} />
              <AppText style={[styles.completeTitle, { color: colors.foreground }]}>
                {t("profile.completeTitle")}
              </AppText>
              <AppText style={[styles.completeCount, { color: colors.mutedForeground }]}>
                {completionItems.length - completionMissing.length}/{completionItems.length}
              </AppText>
            </View>
            <View style={[styles.completeChips, isRTL && styles.rowReverse]}>
              {completionMissing.map((m) => (
                <Pressable
                  key={m.key}
                  onPress={() => {
                    Haptics.selectionAsync();
                    m.onPress();
                  }}
                  style={[
                    styles.completeChip,
                    { backgroundColor: colors.background, borderColor: colors.border },
                    isRTL && styles.rowReverse,
                  ]}
                  testID={`complete-${m.key}`}
                >
                  <Feather name="plus" size={12} color={colors.primary} />
                  <AppText style={[styles.completeChipText, { color: colors.foreground }]}>
                    {t(`profile.complete_${m.key}`)}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* REAL metric tiles */}
        <View
          style={[
            styles.statsCard,
            { borderColor: colors.border },
            isRTL && styles.rowReverse,
          ]}
        >
          {stats.map((s, i) => (
            <View key={i} style={styles.statTile}>
              <AppText style={[styles.statNum, { color: colors.foreground }]}>
                {statNum(s.value)}
              </AppText>
              <AppText
                style={[styles.statLabel, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {s.label}
              </AppText>
            </View>
          ))}
        </View>

        {/* Server-backed social links + edit */}
        <View style={styles.socialSection}>
          <View
            style={[
              styles.socialHeader,
              { flexDirection: isRTL ? "row-reverse" : "row" },
            ]}
          >
            <AppText style={[styles.socialTitle, { color: colors.foreground }]}>
              {t("profile.socialLinks")}
            </AppText>
            {social.length === 0 ? (
              <AppText
                style={[styles.socialHint, { color: colors.mutedForeground }]}
              >
                {t("profile.addSocial")}
              </AppText>
            ) : null}
          </View>
        <View
          style={[
            styles.socialRow,
            { flexDirection: isRTL ? "row-reverse" : "row" },
          ]}
        >
          {social.map((l) => (
            <Pressable
              key={l.platform}
              onPress={() => Linking.openURL(socialHref(l)).catch(() => {})}
              style={[
                styles.socialBtn,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
              testID={`social-${l.platform}`}
            >
              <Ionicons
                name={socialIcon(l.platform)}
                size={18}
                color={colors.foreground}
              />
            </Pressable>
          ))}
          <Pressable
            onPress={openSocialEdit}
            style={[
              styles.socialBtn,
              {
                backgroundColor: colors.card,
                borderColor: colors.primary + "55",
                borderRadius: colors.radius,
              },
            ]}
            testID="social-edit"
          >
            <Feather name="edit-2" size={15} color={colors.primary} />
          </Pressable>
        </View>
        </View>

        {/* Instagram-style content tabs → REAL screens */}
        <View style={[styles.igTabs, isRTL && styles.rowReverse]}>
          {profileTabs.map((tab) => (
            <Pressable
              key={tab.label}
              onPress={() => {
                Haptics.selectionAsync();
                router.push(tab.route);
              }}
              style={styles.igTab}
              testID={`profile-${tab.label}`}
            >
              <View
                style={[
                  styles.igTabIcon,
                  {
                    backgroundColor: colors.secondary,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons name={tab.icon} size={20} color={colors.foreground} />
              </View>
              <AppText
                style={[styles.igTabLabel, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {t(`profile.${tab.label}`)}
              </AppText>
            </Pressable>
          ))}
        </View>

        {isBusiness ? (
          <View
            style={[
              styles.businessCard,
              {
                backgroundColor: colors.primary + "12",
                borderColor: colors.primary + "33",
                borderRadius: colors.radius,
              },
            ]}
          >
            <View style={[styles.businessHeader, isRTL && styles.rowReverse]}>
              <MaterialCommunityIcons
                name="storefront"
                size={22}
                color={colors.primary}
              />
              <View style={{ flex: 1 }}>
                <AppText
                  style={[
                    styles.businessTitle,
                    {
                      color: colors.foreground,
                      textAlign: isRTL ? "right" : "left",
                    },
                  ]}
                >
                  {t("profile.businessMode")}
                </AppText>
                <AppText
                  style={[
                    styles.businessHint,
                    {
                      color: colors.mutedForeground,
                      textAlign: isRTL ? "right" : "left",
                    },
                  ]}
                >
                  {t("profile.businessModeHint")}
                </AppText>
              </View>
            </View>
            <View style={[styles.businessActions, isRTL && styles.rowReverse]}>
              <Pressable
                onPress={() => router.push("/listings/create")}
                style={[
                  styles.businessBtn,
                  { backgroundColor: colors.primary, borderRadius: colors.radius },
                ]}
                testID="business-post-listing"
              >
                <Feather
                  name="plus"
                  size={16}
                  color={colors.primaryForeground}
                />
                <AppText
                  style={[
                    styles.businessBtnText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  {t("profile.postListing")}
                </AppText>
              </Pressable>
              <Pressable
                onPress={() => router.push("/listings/mine")}
                style={[
                  styles.businessBtnOutline,
                  { borderColor: colors.primary, borderRadius: colors.radius },
                ]}
                testID="business-my-listings"
              >
                <Feather name="grid" size={16} color={colors.primary} />
                <AppText
                  style={[styles.businessBtnText, { color: colors.primary }]}
                >
                  {t("profile.myListings")}
                </AppText>
              </Pressable>
            </View>
            <Pressable
              onPress={() => router.push("/business/requests")}
              style={[
                styles.businessRowBtn,
                { borderColor: colors.primary, borderRadius: colors.radius },
                isRTL && styles.rowReverse,
              ]}
              testID="business-customer-requests"
            >
              <Feather name="bell" size={16} color={colors.primary} />
              <AppText
                style={[styles.businessBtnText, { color: colors.primary }]}
              >
                {t("profile.customerRequests")}
              </AppText>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => router.push("/business/onboarding")}
            style={[
              styles.becomeCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.primary + "44",
                borderRadius: colors.radius,
              },
              isRTL && styles.rowReverse,
            ]}
            testID="become-business"
          >
            <View
              style={[
                styles.becomeIcon,
                { backgroundColor: colors.primary + "1A" },
              ]}
            >
              <MaterialCommunityIcons
                name="storefront-outline"
                size={22}
                color={colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <AppText
                style={[
                  styles.becomeTitle,
                  {
                    color: colors.foreground,
                    textAlign: isRTL ? "right" : "left",
                  },
                ]}
              >
                {t("profile.becomeBusiness")}
              </AppText>
              <AppText
                style={[
                  styles.becomeHint,
                  {
                    color: colors.mutedForeground,
                    textAlign: isRTL ? "right" : "left",
                  },
                ]}
              >
                {t("profile.becomeBusinessHint")}
              </AppText>
            </View>
            <Feather
              name={isRTL ? "chevron-left" : "chevron-right"}
              size={20}
              color={colors.mutedForeground}
            />
          </Pressable>
        )}

        {/* Instagram-style grid of the user's REAL own listings */}
        <View style={[styles.postsHeader, isRTL && styles.rowReverse]}>
          <Ionicons name="grid" size={16} color={colors.foreground} />
          <AppText style={[styles.postsTitle, { color: colors.foreground }]}>
            {t("profile.postsTitle")}
          </AppText>
        </View>
        <View
          style={[styles.postsDivider, { backgroundColor: colors.border }]}
        />

        {listingsQuery.isLoading ? (
          <View style={styles.postsState}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : listingsQuery.isError ? (
          <View style={styles.postsState}>
            <Feather
              name="wifi-off"
              size={28}
              color={colors.mutedForeground}
            />
            <AppText
              style={[styles.postsStateText, { color: colors.mutedForeground }]}
            >
              {t("profile.postsError")}
            </AppText>
            <Pressable
              onPress={() => listingsQuery.refetch()}
              style={[
                styles.postsRetryBtn,
                { borderColor: colors.primary, borderRadius: colors.radius },
              ]}
              testID="posts-retry"
            >
              <AppText style={[styles.postsRetryText, { color: colors.primary }]}>
                {t("common.retry")}
              </AppText>
            </Pressable>
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.postsState}>
            <View
              style={[
                styles.postsEmptyIcon,
                { backgroundColor: colors.secondary },
              ]}
            >
              <MaterialCommunityIcons
                name="image-multiple-outline"
                size={28}
                color={colors.mutedForeground}
              />
            </View>
            <AppText style={[styles.postsEmptyTitle, { color: colors.foreground }]}>
              {t("profile.postsEmptyTitle")}
            </AppText>
            <AppText
              style={[styles.postsStateText, { color: colors.mutedForeground }]}
            >
              {t("profile.postsEmptyHint")}
            </AppText>
            <Pressable
              onPress={() => router.push("/listings/create")}
              style={[
                styles.postsCreateBtn,
                { backgroundColor: colors.primary, borderRadius: colors.radius },
              ]}
              testID="posts-create"
            >
              <Feather name="plus" size={16} color={colors.primaryForeground} />
              <AppText
                style={[
                  styles.postsCreateText,
                  { color: colors.primaryForeground },
                ]}
              >
                {t("profile.postListing")}
              </AppText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.postsGrid}>
            {posts.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  Haptics.selectionAsync();
                  cacheFeedItem(item);
                  router.push(`/listing/${item.id}` as Href);
                }}
                style={[
                  styles.postCard,
                  {
                    width: tileSize,
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: 12,
                  },
                ]}
                testID={`post-${item.id}`}
              >
                <View style={styles.postImageWrap}>
                  <Image
                    source={{ uri: item.media_preview }}
                    style={styles.postImage}
                    contentFit="cover"
                    transition={150}
                  />
                  {item.has_video ? (
                    <View style={styles.postVideoBadge}>
                      <Ionicons name="play" size={11} color="#fff" />
                    </View>
                  ) : null}
                  {item.is_sponsored ? (
                    <View
                      style={[
                        styles.postFeatured,
                        { backgroundColor: colors.primary },
                      ]}
                    >
                      <Feather
                        name="star"
                        size={10}
                        color={colors.primaryForeground}
                      />
                      <AppText
                        style={[
                          styles.postFeaturedText,
                          { color: colors.primaryForeground },
                        ]}
                      >
                        {t("promote.promoted")}
                      </AppText>
                    </View>
                  ) : null}
                  {/* Promote overlay only on active (publicly visible) tiles that
                      are NOT already sponsored. FeedItem carries is_active so we
                      never charge the wallet for a draft/pending/archived listing,
                      and is_sponsored so a seller can't double-pay to boost a
                      listing that is already promoted (the "Promoted" badge shows
                      instead). */}
                  {item.is_active && !item.is_sponsored ? (
                    <View style={styles.postPromote}>
                      <PromoteButton
                        listingId={item.id}
                        variant="compact"
                        onPromoted={() => listingsQuery.refetch()}
                      />
                    </View>
                  ) : null}
                </View>
                <View style={styles.postBody}>
                  <AppText
                    style={[styles.postCardPrice, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
                    {item.price_display}
                  </AppText>
                  <AppText
                    style={[
                      styles.postCardTitle,
                      {
                        color: colors.mutedForeground,
                        textAlign: isRTL ? "right" : "left",
                      },
                    ]}
                    numberOfLines={2}
                  >
                    {item.title}
                  </AppText>
                  {formatListedDate(item.created_at) ? (
                    <AppText
                      style={[
                        styles.postCardListed,
                        {
                          color: colors.mutedForeground,
                          textAlign: isRTL ? "right" : "left",
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {t("mine.listedOn", {
                        date: formatListedDate(item.created_at) ?? "",
                      })}
                    </AppText>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <Modal
          visible={showSocialEdit}
          transparent
          animationType="fade"
          onRequestClose={() => !savingSocial && setShowSocialEdit(false)}
        >
          <View style={styles.modalBackdrop}>
            <View
              style={[
                styles.modalSheet,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <AppText style={[styles.modalTitle, { color: colors.foreground }]}>
                {t("profile.socialEditTitle")}
              </AppText>
              <AppText
                style={[styles.modalMessage, { color: colors.mutedForeground }]}
              >
                {t("profile.socialEditHint")}
              </AppText>
              {SOCIAL_PLATFORMS.map((p) => (
                <View
                  key={p}
                  style={[styles.socialField, isRTL && styles.rowReverse]}
                >
                  <Ionicons
                    name={socialIcon(p)}
                    size={18}
                    color={colors.mutedForeground}
                  />
                  <TextInput
                    value={socialDraft[p] ?? ""}
                    onChangeText={(v) =>
                      setSocialDraft((d) => ({ ...d, [p]: v }))
                    }
                    placeholder={t(`profile.socialPlaceholder_${p}`)}
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType={p === "whatsapp" ? "phone-pad" : "url"}
                    style={[
                      styles.socialInput,
                      {
                        color: colors.foreground,
                        borderColor: colors.border,
                        borderRadius: colors.radius,
                        textAlign: isRTL ? "right" : "left",
                      },
                    ]}
                    testID={`social-input-${p}`}
                  />
                </View>
              ))}
              <Pressable
                onPress={saveSocial}
                disabled={savingSocial}
                style={[
                  styles.modalPrimaryBtn,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: colors.radius,
                  },
                ]}
                testID="social-save"
              >
                {savingSocial ? (
                  <ActivityIndicator
                    color={colors.primaryForeground}
                    size="small"
                  />
                ) : (
                  <AppText
                    style={[
                      styles.modalPrimaryText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    {t("common.save")}
                  </AppText>
                )}
              </Pressable>
              <Pressable
                onPress={() => !savingSocial && setShowSocialEdit(false)}
                style={styles.modalCancelBtn}
              >
                <AppText
                  style={[
                    styles.modalCancelText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {t("common.cancel")}
                </AppText>
              </Pressable>
            </View>
          </View>
        </Modal>

        <PermissionRationaleModal
          visible={showPhotoRationale}
          onAcknowledge={launchPhotoPicker}
          onCancel={() => setShowPhotoRationale(false)}
          config={{
            icon: "image-outline",
            title: t("profile.photoAccessTitle"),
            message: t("profile.photoAccessMessage"),
            bullets: [
              t("profile.photoAccessBullet1"),
              t("profile.photoAccessBullet2"),
              t("profile.photoAccessBullet3"),
            ],
            confirmLabel: t("profile.photoAccessConfirm"),
          }}
        />

        {/* Edit profile — presentational fields saved to Clerk unsafeMetadata */}
        <Modal
          visible={showEditProfile}
          transparent
          animationType="fade"
          onRequestClose={() => !savingProfile && setShowEditProfile(false)}
        >
          <View style={styles.modalBackdrop}>
            <View
              style={[
                styles.modalSheet,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <AppText style={[styles.modalTitle, { color: colors.foreground }]}>
                {t("profile.editProfileTitle")}
              </AppText>
              <AppText
                style={[styles.modalMessage, { color: colors.mutedForeground }]}
              >
                {t("profile.editProfileHint")}
              </AppText>

              <View style={styles.editField}>
                <AppText
                  style={[
                    styles.editLabel,
                    {
                      color: colors.foreground,
                      textAlign: isRTL ? "right" : "left",
                    },
                  ]}
                >
                  {t("profile.displayTitleLabel")}
                </AppText>
                <TextInput
                  value={displayTitleDraft}
                  onChangeText={setDisplayTitleDraft}
                  placeholder={t("profile.displayTitlePlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
                  maxLength={60}
                  style={[
                    styles.editInput,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.secondary,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      textAlign: isRTL ? "right" : "left",
                    },
                  ]}
                  testID="edit-display-title"
                />
                <AppText
                  style={[
                    styles.editCounter,
                    {
                      color: colors.mutedForeground,
                      alignSelf: isRTL ? "flex-start" : "flex-end",
                    },
                  ]}
                >
                  {displayTitleDraft.length}/60
                </AppText>
              </View>

              <View style={styles.editField}>
                <AppText
                  style={[
                    styles.editLabel,
                    {
                      color: colors.foreground,
                      textAlign: isRTL ? "right" : "left",
                    },
                  ]}
                >
                  {t("profile.categoryLabelLabel")}
                </AppText>
                <TextInput
                  value={categoryLabelDraft}
                  onChangeText={setCategoryLabelDraft}
                  placeholder={t("profile.categoryLabelPlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
                  maxLength={40}
                  style={[
                    styles.editInput,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.secondary,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      textAlign: isRTL ? "right" : "left",
                    },
                  ]}
                  testID="edit-category-label"
                />
              </View>

              <View style={styles.editField}>
                <AppText
                  style={[
                    styles.editLabel,
                    {
                      color: colors.foreground,
                      textAlign: isRTL ? "right" : "left",
                    },
                  ]}
                >
                  {t("profile.bioLabel")}
                </AppText>
                <TextInput
                  value={bioDraft}
                  onChangeText={setBioDraft}
                  placeholder={t("profile.bioPlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
                  maxLength={160}
                  multiline
                  numberOfLines={3}
                  style={[
                    styles.editInput,
                    styles.editInputMultiline,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.secondary,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      textAlign: isRTL ? "right" : "left",
                    },
                  ]}
                  testID="edit-bio"
                />
                <AppText
                  style={[
                    styles.editCounter,
                    {
                      color: colors.mutedForeground,
                      alignSelf: isRTL ? "flex-start" : "flex-end",
                    },
                  ]}
                >
                  {bioDraft.length}/160
                </AppText>
              </View>

              <View style={styles.editField}>
                <AppText
                  style={[
                    styles.editLabel,
                    {
                      color: colors.foreground,
                      textAlign: isRTL ? "right" : "left",
                    },
                  ]}
                >
                  {t("profile.phoneLabel")}
                </AppText>
                <View
                  style={[
                    styles.editPhoneRow,
                    { flexDirection: isRTL ? "row-reverse" : "row" },
                  ]}
                >
                  <Pressable
                    onPress={() => {
                      Haptics.selectionAsync();
                      setShowPhoneCountryPicker(true);
                    }}
                    style={[
                      styles.editDialBtn,
                      {
                        borderColor: colors.border,
                        borderRadius: colors.radius,
                        backgroundColor: colors.secondary,
                        flexDirection: isRTL ? "row-reverse" : "row",
                      },
                    ]}
                    testID="edit-phone-country"
                  >
                    <AppText style={styles.editDialFlag}>
                      {countryByIso(phoneIsoDraft).flag}
                    </AppText>
                    <AppText
                      style={[styles.editDialCode, { color: colors.foreground }]}
                    >
                      +{countryByIso(phoneIsoDraft).dial}
                    </AppText>
                    <Feather
                      name="chevron-down"
                      size={16}
                      color={colors.mutedForeground}
                    />
                  </Pressable>
                  <TextInput
                    value={phoneNumberDraft}
                    onChangeText={setPhoneNumberDraft}
                    placeholder={countryByIso(phoneIsoDraft).sample}
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="phone-pad"
                    autoCorrect={false}
                    style={[
                      styles.editInput,
                      styles.editPhoneInput,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.secondary,
                        borderColor: colors.border,
                        borderRadius: colors.radius,
                        textAlign: isRTL ? "right" : "left",
                      },
                    ]}
                    testID="edit-phone-number"
                  />
                </View>
                <AppText
                  style={[
                    styles.editCounter,
                    {
                      color: colors.mutedForeground,
                      textAlign: isRTL ? "right" : "left",
                    },
                  ]}
                >
                  {t("create.phoneFormatHint", {
                    sample: countryByIso(phoneIsoDraft).sample,
                  })}
                </AppText>
              </View>

              <Pressable
                onPress={saveProfile}
                disabled={savingProfile}
                style={[
                  styles.modalPrimaryBtn,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: colors.radius,
                  },
                ]}
                testID="edit-profile-save"
              >
                {savingProfile ? (
                  <ActivityIndicator
                    color={colors.primaryForeground}
                    size="small"
                  />
                ) : (
                  <AppText
                    style={[
                      styles.modalPrimaryText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    {t("common.save")}
                  </AppText>
                )}
              </Pressable>
              <Pressable
                onPress={() => !savingProfile && setShowEditProfile(false)}
                style={styles.modalCancelBtn}
              >
                <AppText
                  style={[
                    styles.modalCancelText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {t("common.cancel")}
                </AppText>
              </Pressable>
            </View>
          </View>
        </Modal>

        <CountryCodePicker
          visible={showPhoneCountryPicker}
          selectedIso={phoneIsoDraft}
          onClose={() => setShowPhoneCountryPicker(false)}
          onSelect={(iso) => {
            setPhoneIsoDraft(iso);
            setShowPhoneCountryPicker(false);
          }}
        />
        <CountryCodePicker
          visible={showSignupPhoneCountryPicker}
          selectedIso={signupPhoneIso}
          onClose={() => setShowSignupPhoneCountryPicker(false)}
          onSelect={(iso) => {
            setSignupPhoneIso(iso);
            setShowSignupPhoneCountryPicker(false);
          }}
        />

        {/* Overflow menu → existing routes only */}
        <Modal
          visible={showMenu}
          transparent
          animationType="slide"
          onRequestClose={() => setShowMenu(false)}
        >
          <View style={styles.menuBackdrop}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={() => setShowMenu(false)}
              accessibilityRole="button"
            />
            <View
              style={[
                styles.menuSheet,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View
                style={[styles.menuHandle, { backgroundColor: colors.border }]}
              />
              <AppText style={[styles.menuTitle, { color: colors.foreground }]}>
                {t("profile.menuTitle")}
              </AppText>
              {userEmail ? (
                <AppText
                  style={[styles.menuEmail, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {userEmail}
                </AppText>
              ) : null}
              {menuItems.map((mi) => (
                <Pressable
                  key={mi.key}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setShowMenu(false);
                    mi.onPress();
                  }}
                  style={[styles.menuItem, isRTL && styles.rowReverse]}
                  testID={`menu-${mi.key}`}
                >
                  <Feather
                    name={mi.icon}
                    size={18}
                    color={mi.danger ? colors.destructive : colors.foreground}
                  />
                  <AppText
                    style={[
                      styles.menuItemText,
                      {
                        color: mi.danger
                          ? colors.destructive
                          : colors.foreground,
                        textAlign: isRTL ? "right" : "left",
                      },
                    ]}
                  >
                    {mi.label}
                  </AppText>
                  <Feather
                    name={isRTL ? "chevron-left" : "chevron-right"}
                    size={16}
                    color={colors.mutedForeground}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        </Modal>
      </ScrollView>
    );
  }

  if (mode === "signup" && step === "verify") {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[
          styles.authContent,
          { paddingTop: topPad + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <BancoLogo height={40} style={styles.authLogoImg} />
        <LanguageToggle
          lang={lang}
          setLang={setLang}
          colors={colors}
          style={styles.authLangToggle}
        />
        <AppText style={[styles.authTitle, { color: colors.foreground }]}>
          {t("profile.verifyTitle")}
        </AppText>
        <AppText style={[styles.authSubtitle, { color: colors.mutedForeground }]}>
          {t("profile.verifySent", { email })}
        </AppText>

        <View style={styles.field}>
          <TextInput
            value={verifyCode}
            onChangeText={setVerifyCode}
            placeholder={t("profile.codePlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            style={inputStyle}
            keyboardType="number-pad"
            testID="verify-code-input"
          />
          {signUpErrors?.fields?.code && (
            <AppText style={[styles.error, { color: colors.destructive }]}>
              {signUpErrors.fields.code.message}
            </AppText>
          )}
        </View>

        <Pressable
          onPress={handleVerify}
          disabled={!verifyCode || isSigningUp}
          style={[
            styles.authBtn,
            {
              backgroundColor:
                !verifyCode || isSigningUp ? colors.secondary : colors.primary,
              borderRadius: colors.radius,
            },
          ]}
          testID="verify-submit"
        >
          {isSigningUp ? (
            <ActivityIndicator color={colors.primaryForeground} size="small" />
          ) : (
            <AppText
              style={[styles.authBtnText, { color: colors.primaryForeground }]}
            >
              {t("profile.verify")}
            </AppText>
          )}
        </Pressable>

        <Pressable
          onPress={() => signUp.verifications.sendEmailCode()}
          style={styles.switchBtn}
        >
          <AppText style={[styles.switchText, { color: colors.mutedForeground }]}>
            {t("profile.didntReceive")}
            <AppText style={[styles.switchLink, { color: colors.primary }]}>
              {t("profile.resend")}
            </AppText>
          </AppText>
        </Pressable>

        <Pressable
          onPress={() => {
            setStep("form");
            setVerifyCode("");
            // Going back from verify abandons this signup attempt; drop the
            // pending intent so it can't fire on a later sign-in.
            consentPendingRef.current = false;
            pendingPhoneRef.current = "";
            pendingBusinessRef.current = false;
            pendingFirstNameRef.current = "";
            pendingLastNameRef.current = "";
          }}
          style={styles.switchBtn}
        >
          <AppText style={[styles.switchText, { color: colors.mutedForeground }]}>
            <AppText style={[styles.switchLink, { color: colors.primary }]}>
              {t("profile.goBack")}
            </AppText>
          </AppText>
        </Pressable>
      </ScrollView>
    );
  }

  if (mode === "signin" && step === "reset") {
    return (
      <KeyboardAwareScrollViewCompat
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[
          styles.authContent,
          { paddingTop: topPad + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <BancoLogo height={40} style={styles.authLogoImg} />
        <LanguageToggle
          lang={lang}
          setLang={setLang}
          colors={colors}
          style={styles.authLangToggle}
        />
        <AppText style={[styles.authTitle, { color: colors.foreground }]}>
          {t("profile.resetTitle")}
        </AppText>
        <AppText
          style={[styles.authSubtitle, { color: colors.mutedForeground }]}
        >
          {t("profile.resetSent", { email })}
        </AppText>

        <View style={styles.field}>
          <TextInput
            value={resetCode}
            onChangeText={setResetCode}
            placeholder={t("profile.codePlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            style={inputStyle}
            keyboardType="number-pad"
            testID="reset-code-input"
          />
          {signInErrors?.fields?.code && (
            <AppText style={[styles.error, { color: colors.destructive }]}>
              {signInErrors.fields.code.message}
            </AppText>
          )}
        </View>

        <View style={styles.field}>
          <View style={styles.passwordWrap}>
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder={t("profile.newPasswordPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              style={[
                inputStyle,
                { [isRTL ? "paddingLeft" : "paddingRight"]: 44 },
              ]}
              secureTextEntry={!showNewPassword}
              testID="reset-password-input"
            />
            <Pressable
              onPress={() => setShowNewPassword((v) => !v)}
              hitSlop={8}
              style={[styles.eyeBtn, { [isRTL ? "left" : "right"]: 14 }]}
              testID="reset-password-toggle"
            >
              <Feather
                name={showNewPassword ? "eye-off" : "eye"}
                size={18}
                color={colors.mutedForeground}
              />
            </Pressable>
          </View>
          {signInErrors?.fields?.password && (
            <AppText style={[styles.error, { color: colors.destructive }]}>
              {signInErrors.fields.password.message}
            </AppText>
          )}
        </View>

        <Pressable
          onPress={handleResetPassword}
          disabled={!resetCode || !newPassword || isSigningIn}
          style={[
            styles.authBtn,
            {
              backgroundColor:
                !resetCode || !newPassword || isSigningIn
                  ? colors.secondary
                  : colors.primary,
              borderRadius: colors.radius,
            },
          ]}
          testID="reset-submit"
        >
          {isSigningIn ? (
            <ActivityIndicator color={colors.primaryForeground} size="small" />
          ) : (
            <AppText
              style={[styles.authBtnText, { color: colors.primaryForeground }]}
            >
              {t("profile.resetSubmit")}
            </AppText>
          )}
        </Pressable>

        <Pressable
          onPress={() => signIn.resetPasswordEmailCode.sendCode()}
          style={styles.switchBtn}
        >
          <AppText
            style={[styles.switchText, { color: colors.mutedForeground }]}
          >
            {t("profile.didntReceive")}
            <AppText style={[styles.switchLink, { color: colors.primary }]}>
              {t("profile.resend")}
            </AppText>
          </AppText>
        </Pressable>

        <Pressable
          onPress={() => {
            setStep("form");
            setResetCode("");
            setNewPassword("");
          }}
          style={styles.switchBtn}
        >
          <AppText
            style={[styles.switchText, { color: colors.mutedForeground }]}
          >
            <AppText style={[styles.switchLink, { color: colors.primary }]}>
              {t("profile.goBack")}
            </AppText>
          </AppText>
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    );
  }

  const passwordMismatch = mode === "signup" && password !== confirmPassword;
  const submitDisabled =
    !email ||
    !password ||
    isSigningIn ||
    isSigningUp ||
    (mode === "signup" &&
      (!agreedToTerms ||
        !firstName.trim() ||
        !lastName.trim() ||
        !confirmPassword ||
        passwordMismatch));

  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.authContent,
        { paddingTop: topPad + 40 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <BancoLogo height={40} style={styles.authLogoImg} />
      <LanguageToggle
        lang={lang}
        setLang={setLang}
        colors={colors}
        style={styles.authLangToggle}
      />
      <AppText style={[styles.authTitle, { color: colors.foreground }]}>
        {mode === "signin" ? t("profile.welcomeBack") : t("profile.createAccount")}
      </AppText>
      <AppText style={[styles.authSubtitle, { color: colors.mutedForeground }]}>
        {mode === "signin" ? t("profile.signInToSave") : t("profile.joinBanco")}
      </AppText>

      {mode === "signup" && (
        <View style={styles.field}>
          <TextInput
            value={firstName}
            onChangeText={setFirstName}
            placeholder={t("profile.firstNamePlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            style={[inputStyle, { textAlign: isRTL ? "right" : "left" }]}
            autoCapitalize="words"
            autoCorrect={false}
            testID="first-name-input"
          />
        </View>
      )}

      {mode === "signup" && (
        <View style={styles.field}>
          <TextInput
            value={lastName}
            onChangeText={setLastName}
            placeholder={t("profile.lastNamePlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            style={[inputStyle, { textAlign: isRTL ? "right" : "left" }]}
            autoCapitalize="words"
            autoCorrect={false}
            testID="last-name-input"
          />
        </View>
      )}

      <View style={styles.field}>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder={t("profile.emailPlaceholder")}
          placeholderTextColor={colors.mutedForeground}
          style={inputStyle}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          testID="email-input"
        />
        {mode === "signin"
          ? signInErrors?.fields?.identifier && (
              <AppText style={[styles.error, { color: colors.destructive }]}>
                {signInErrors.fields.identifier.message}
              </AppText>
            )
          : signUpErrors?.fields?.emailAddress && (
              <AppText style={[styles.error, { color: colors.destructive }]}>
                {signUpErrors.fields.emailAddress.message}
              </AppText>
            )}
      </View>

      <View style={styles.field}>
        <View style={styles.passwordWrap}>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder={t("profile.passwordPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            style={[inputStyle, { [isRTL ? "paddingLeft" : "paddingRight"]: 44 }]}
            secureTextEntry={!showPassword}
            testID="password-input"
          />
          <Pressable
            onPress={() => setShowPassword((v) => !v)}
            hitSlop={8}
            style={[styles.eyeBtn, { [isRTL ? "left" : "right"]: 14 }]}
            testID="password-toggle"
          >
            <Feather
              name={showPassword ? "eye-off" : "eye"}
              size={18}
              color={colors.mutedForeground}
            />
          </Pressable>
        </View>
        {mode === "signin"
          ? signInErrors?.fields?.password && (
              <AppText style={[styles.error, { color: colors.destructive }]}>
                {signInErrors.fields.password.message}
              </AppText>
            )
          : signUpErrors?.fields?.password && (
              <AppText style={[styles.error, { color: colors.destructive }]}>
                {signUpErrors.fields.password.message}
              </AppText>
            )}
        {mode === "signin" && (
          <Pressable
            onPress={handleForgotPassword}
            disabled={resetSending}
            hitSlop={6}
            style={[
              styles.forgotBtn,
              { alignSelf: isRTL ? "flex-start" : "flex-end" },
            ]}
            testID="forgot-password"
          >
            <AppText style={[styles.forgotText, { color: colors.primary }]}>
              {resetSending ? t("profile.sending") : t("profile.forgotPassword")}
            </AppText>
          </Pressable>
        )}
      </View>

      {mode === "signup" && (
        <View style={styles.field}>
          <View style={styles.passwordWrap}>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder={t("profile.confirmPasswordPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              style={[inputStyle, { [isRTL ? "paddingLeft" : "paddingRight"]: 44 }]}
              secureTextEntry={!showConfirmPassword}
              testID="confirm-password-input"
            />
            <Pressable
              onPress={() => setShowConfirmPassword((v) => !v)}
              hitSlop={8}
              style={[styles.eyeBtn, { [isRTL ? "left" : "right"]: 14 }]}
              testID="confirm-password-toggle"
            >
              <Feather
                name={showConfirmPassword ? "eye-off" : "eye"}
                size={18}
                color={colors.mutedForeground}
              />
            </Pressable>
          </View>
          {passwordMismatch && confirmPassword.length > 0 && (
            <AppText style={[styles.error, { color: colors.destructive }]}>
              {t("profile.passwordsDoNotMatch")}
            </AppText>
          )}
        </View>
      )}

      {mode === "signup" && (
        <View style={styles.field}>
          <AppText
            style={[
              styles.accountTypeLabel,
              {
                color: colors.mutedForeground,
                textAlign: isRTL ? "right" : "left",
              },
            ]}
          >
            {t("profile.phoneLabel")}
          </AppText>
          <View
            style={[
              styles.editPhoneRow,
              { flexDirection: isRTL ? "row-reverse" : "row" },
            ]}
          >
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setShowSignupPhoneCountryPicker(true);
              }}
              style={[
                styles.editDialBtn,
                {
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  backgroundColor: colors.secondary,
                  flexDirection: isRTL ? "row-reverse" : "row",
                },
              ]}
              testID="signup-phone-country"
            >
              <AppText style={styles.editDialFlag}>
                {countryByIso(signupPhoneIso).flag}
              </AppText>
              <AppText
                style={[styles.editDialCode, { color: colors.foreground }]}
              >
                +{countryByIso(signupPhoneIso).dial}
              </AppText>
              <Feather
                name="chevron-down"
                size={16}
                color={colors.mutedForeground}
              />
            </Pressable>
            <TextInput
              value={signupPhoneNumber}
              onChangeText={setSignupPhoneNumber}
              placeholder={countryByIso(signupPhoneIso).sample}
              placeholderTextColor={colors.mutedForeground}
              keyboardType="phone-pad"
              autoCorrect={false}
              style={[
                styles.editInput,
                styles.editPhoneInput,
                {
                  color: colors.foreground,
                  backgroundColor: colors.secondary,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  textAlign: isRTL ? "right" : "left",
                },
              ]}
              testID="phone-input"
            />
          </View>
        </View>
      )}

      {mode === "signup" && (
        <View style={styles.field}>
          <AppText
            style={[
              styles.accountTypeLabel,
              {
                color: colors.mutedForeground,
                textAlign: isRTL ? "right" : "left",
              },
            ]}
          >
            {t("profile.accountType")}
          </AppText>
          <View
            style={[
              styles.accountTypeRow,
              { flexDirection: isRTL ? "row-reverse" : "row" },
            ]}
          >
            {(["personal", "business"] as const).map((type) => {
              const active = accountType === type;
              return (
                <Pressable
                  key={type}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setAccountType(type);
                  }}
                  style={[
                    styles.accountTypeOption,
                    {
                      backgroundColor: active
                        ? colors.primary + "14"
                        : colors.secondary,
                      borderColor: active ? colors.primary : colors.border,
                      borderRadius: colors.radius,
                    },
                  ]}
                  testID={`account-type-${type}`}
                >
                  <MaterialCommunityIcons
                    name={
                      type === "business"
                        ? "storefront-outline"
                        : "account-outline"
                    }
                    size={20}
                    color={active ? colors.primary : colors.mutedForeground}
                  />
                  <AppText
                    style={[
                      styles.accountTypeText,
                      { color: active ? colors.primary : colors.foreground },
                    ]}
                  >
                    {t(
                      type === "business"
                        ? "profile.business"
                        : "profile.personal"
                    )}
                  </AppText>
                  {type === "business" && (
                    <AppText
                      style={[
                        styles.accountTypeHint,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {t("profile.businessHint")}
                    </AppText>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {mode === "signup" && (
        <View style={[styles.consentRow, isRTL && styles.rowReverse]}>
          <Pressable
            onPress={() => setAgreedToTerms((v) => !v)}
            hitSlop={8}
            testID="consent-checkbox"
            style={styles.consentCheck}
          >
            <Ionicons
              name={agreedToTerms ? "checkbox" : "square-outline"}
              size={22}
              color={agreedToTerms ? colors.primary : colors.mutedForeground}
            />
          </Pressable>
          <AppText
            style={[
              styles.consentText,
              {
                color: colors.mutedForeground,
                textAlign: isRTL ? "right" : "left",
              },
            ]}
          >
            {t("profile.consentPrefix")}
            <AppText
              style={[styles.consentLink, { color: colors.primary }]}
              onPress={() => router.push("/legal/terms")}
            >
              {t("profile.terms")}
            </AppText>
            {t("profile.consentAnd")}
            <AppText
              style={[styles.consentLink, { color: colors.primary }]}
              onPress={() => router.push("/legal/privacy")}
            >
              {t("profile.privacy")}
            </AppText>
          </AppText>
        </View>
      )}

      <Pressable
        onPress={mode === "signin" ? handleSignIn : handleSignUp}
        disabled={submitDisabled}
        style={[
          styles.authBtn,
          {
            backgroundColor: submitDisabled ? colors.secondary : colors.primary,
            borderRadius: colors.radius,
          },
        ]}
        testID="auth-submit"
      >
        {isSigningIn || isSigningUp ? (
          <ActivityIndicator color={colors.primaryForeground} size="small" />
        ) : (
          <AppText
            style={[styles.authBtnText, { color: colors.primaryForeground }]}
          >
            {mode === "signin" ? t("profile.signIn") : t("profile.createAccount")}
          </AppText>
        )}
      </Pressable>

      <Pressable
        onPress={() => switchMode(mode === "signin" ? "signup" : "signin")}
        style={styles.switchBtn}
        testID="auth-switch-mode"
      >
        <AppText style={[styles.switchText, { color: colors.mutedForeground }]}>
          {mode === "signin"
            ? t("profile.dontHaveAccount")
            : t("profile.alreadyHaveAccount")}
          <AppText style={[styles.switchLink, { color: colors.primary }]}>
            {mode === "signin" ? t("profile.signUp") : t("profile.signIn")}
          </AppText>
        </AppText>
      </Pressable>

      {mode === "signup" && (
        <View nativeID="clerk-captcha" />
      )}

      <View style={styles.oauthDivider}>
        <View style={[styles.oauthLine, { backgroundColor: colors.border }]} />
        <AppText style={[styles.oauthOr, { color: colors.mutedForeground }]}>
          {t("profile.orDivider")}
        </AppText>
        <View style={[styles.oauthLine, { backgroundColor: colors.border }]} />
      </View>

      <Pressable
        onPress={() => handleOAuth("google")}
        disabled={!!oauthLoading}
        style={[
          styles.oauthBtn,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
          isRTL && styles.rowReverse,
        ]}
        testID="oauth-google"
      >
        {oauthLoading === "google" ? (
          <ActivityIndicator color={colors.foreground} size="small" />
        ) : (
          <>
            <Ionicons name="logo-google" size={18} color={colors.foreground} />
            <AppText style={[styles.oauthBtnText, { color: colors.foreground }]}>
              {t("profile.continueWithGoogle")}
            </AppText>
          </>
        )}
      </Pressable>

      {Platform.OS !== "android" && (
        <Pressable
          onPress={() => handleOAuth("apple")}
          disabled={!!oauthLoading}
          style={[
            styles.oauthBtn,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
            isRTL && styles.rowReverse,
          ]}
          testID="oauth-apple"
        >
          {oauthLoading === "apple" ? (
            <ActivityIndicator color={colors.foreground} size="small" />
          ) : (
            <>
              <Ionicons name="logo-apple" size={18} color={colors.foreground} />
              <AppText
                style={[styles.oauthBtnText, { color: colors.foreground }]}
              >
                {t("profile.continueWithApple")}
              </AppText>
            </>
          )}
        </Pressable>
      )}

      <View style={[styles.secureNotice, isRTL && styles.rowReverse]}>
        <Feather name="shield" size={13} color={colors.mutedForeground} />
        <AppText
          style={[styles.secureNoticeText, { color: colors.mutedForeground }]}
        >
          {t("profile.secureNotice")}
        </AppText>
      </View>

      <View style={[styles.secureNotice, isRTL && styles.rowReverse]}>
        <Feather name="user-check" size={13} color={colors.mutedForeground} />
        <AppText
          style={[styles.secureNoticeText, { color: colors.mutedForeground }]}
        >
          {t("profile.fraudNotice")}
        </AppText>
      </View>

      <AppText
        style={[
          styles.disclaimer,
          { color: colors.mutedForeground, textAlign: "center" },
        ]}
      >
        {t("profile.browseNoSignin")}
      </AppText>
    </KeyboardAwareScrollViewCompat>
  );
}

function LanguageToggle({
  lang,
  setLang,
  colors,
  style,
}: {
  lang: "en" | "ar";
  setLang: (l: "en" | "ar") => void;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.langToggle,
        { backgroundColor: colors.secondary, borderRadius: colors.radius },
        style,
      ]}
    >
      {(["en", "ar"] as const).map((key) => {
        const active = lang === key;
        return (
          <Pressable
            key={key}
            onPress={() => setLang(key)}
            style={[
              styles.langOption,
              active && {
                backgroundColor: colors.primary,
                borderRadius: colors.radius - 2,
              },
            ]}
            testID={`lang-${key}`}
          >
            <AppText
              style={[
                styles.langOptionText,
                {
                  color: active
                    ? colors.primaryForeground
                    : colors.mutedForeground,
                },
              ]}
            >
              {key === "en" ? "English" : "العربية"}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  profileContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
    gap: 16,
  },
  avatar: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarText: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  avatarBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  userName: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  userEmail: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  rolePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 4,
  },
  roleText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
  },
  businessCard: {
    borderWidth: 1,
    padding: 16,
    marginTop: 16,
    gap: 14,
  },
  businessHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  businessTitle: {
    fontSize: 15.5,
    fontFamily: "Inter_700Bold",
  },
  businessHint: {
    fontSize: 12.5,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  businessActions: {
    flexDirection: "row",
    gap: 10,
  },
  businessBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  businessBtnOutline: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderWidth: 1,
  },
  businessRowBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderWidth: 1,
  },
  businessBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  becomeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    padding: 14,
    marginTop: 16,
  },
  becomeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  becomeTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  becomeHint: {
    fontSize: 12.5,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  authContent: {
    paddingHorizontal: 28,
    paddingBottom: 60,
    alignItems: "stretch",
  },
  authLogoImg: {
    alignSelf: "center",
    marginBottom: 24,
  },
  authTitle: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginBottom: 8,
  },
  authSubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 20,
  },
  field: {
    gap: 4,
    marginBottom: 12,
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    borderWidth: 1,
  },
  error: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginLeft: 4,
  },
  passwordWrap: {
    position: "relative",
    justifyContent: "center",
  },
  eyeBtn: {
    position: "absolute",
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  forgotBtn: {
    paddingVertical: 4,
    marginTop: 2,
  },
  forgotText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  accountTypeLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  accountTypeRow: {
    gap: 10,
  },
  accountTypeOption: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderWidth: 1,
  },
  accountTypeText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  accountTypeHint: {
    fontSize: 10.5,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 4,
    marginBottom: 4,
  },
  consentCheck: {
    paddingTop: 1,
  },
  consentText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  consentLink: {
    fontFamily: "Inter_600SemiBold",
  },
  authBtn: {
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    minHeight: 50,
  },
  authBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  switchBtn: {
    marginTop: 16,
    alignItems: "center",
  },
  switchText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  switchLink: {
    fontFamily: "Inter_600SemiBold",
  },
  disclaimer: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalSheet: {
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
  },
  modalCancelBtn: {
    marginTop: 12,
    paddingVertical: 6,
  },
  modalCancelText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  memberSince: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 6,
  },
  accountNumber: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
    letterSpacing: 0.5,
  },
  profilePhone: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    marginTop: 8,
  },
  socialSection: {
    marginBottom: 16,
    gap: 8,
  },
  socialHeader: {
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  socialTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  socialHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
    textAlign: "right",
  },
  socialRow: {
    gap: 10,
  },
  socialBtn: {
    width: 42,
    height: 42,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  langToggle: {
    flexDirection: "row",
    padding: 4,
    gap: 4,
  },
  langOption: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  langOptionText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  authLangToggle: {
    alignSelf: "center",
    marginBottom: 24,
    minWidth: 200,
  },
  oauthDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 20,
    marginBottom: 16,
  },
  oauthLine: {
    flex: 1,
    height: 1,
  },
  oauthOr: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  oauthBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderWidth: 1,
    marginBottom: 10,
    minHeight: 50,
  },
  oauthBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  secureNotice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 8,
  },
  secureNoticeText: {
    fontSize: 11.5,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    flexShrink: 1,
  },
  onboardCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  onboardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  onboardTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  onboardHint: {
    fontSize: 12.5,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  igHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
    marginBottom: 16,
  },
  igStatsRow: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  statTile: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  statNum: {
    fontSize: 19,
    fontFamily: "Inter_700Bold",
  },
  statLabel: {
    fontSize: 11.5,
    fontFamily: "Inter_500Medium",
  },
  igIdentity: {
    gap: 4,
    marginBottom: 14,
  },
  igNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  igMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 2,
  },
  igTabs: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 6,
    marginBottom: 18,
  },
  igTab: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  igTabIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  igTabLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginBottom: 4,
  },
  settingsGear: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  postsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  postsTitle: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  postsDivider: {
    height: 1,
    marginTop: 8,
    marginBottom: 12,
  },
  postsState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 36,
    gap: 10,
  },
  postsStateText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    maxWidth: 260,
  },
  postsEmptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  postsEmptyTitle: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  postsRetryBtn: {
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 8,
    marginTop: 2,
  },
  postsRetryText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  postsCreateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 4,
  },
  postsCreateText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  postsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  postTile: {
    marginBottom: GRID_GAP,
    overflow: "hidden",
  },
  postImage: {
    width: "100%",
    height: "100%",
  },
  postVideoBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  postPriceWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingVertical: 5,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  postPrice: {
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  socialField: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  socialInput: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  modalPrimaryBtn: {
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    marginTop: 6,
  },
  modalPrimaryText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },

  // Cover
  coverWrap: {
    marginHorizontal: -20,
    overflow: "visible",
  },
  coverImage: {
    width: "100%",
    height: "100%",
  },
  coverActions: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    gap: 8,
  },
  coverActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },

  // Identity
  identityWrap: {
    paddingHorizontal: 0,
  },
  avatarRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  avatarLarge: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 4,
    marginTop: -52,
    zIndex: 2,
    elevation: 3,
  },
  avatarLargeInner: {
    flex: 1,
    borderRadius: 44,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLargeImage: {
    width: "100%",
    height: "100%",
  },
  avatarLargeText: {
    fontSize: 34,
    fontFamily: "Inter_700Bold",
  },
  editProfileBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    alignSelf: "flex-end",
  },
  editProfileText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  displayTitle: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  bioText: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  bioEmpty: {
    fontSize: 13,
    fontStyle: "italic",
    marginTop: 4,
  },
  trustRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    flexWrap: "wrap",
  },
  trustChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  trustChipText: {
    fontSize: 11.5,
    fontFamily: "Inter_500Medium",
  },

  // Stats card
  statsCard: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  completeCard: {
    marginTop: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  completeHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  completeTitle: { flex: 1, fontSize: 13.5, fontWeight: "700" },
  completeCount: { fontSize: 12, fontWeight: "700" },
  completeChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  completeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  completeChipText: { fontSize: 12.5, fontWeight: "600" },

  // Grid card
  postCard: {
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: GRID_GAP,
  },
  postImageWrap: {
    width: "100%",
    height: tileImageHeight,
    position: "relative",
  },
  postBody: {
    padding: 8,
  },
  postCardPrice: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  postCardTitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  postCardListed: {
    fontSize: 10.5,
    fontFamily: "Inter_400Regular",
    marginTop: 3,
    opacity: 0.85,
  },
  postFeatured: {
    position: "absolute",
    top: 6,
    left: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  postFeaturedText: {
    fontSize: 9.5,
    fontFamily: "Inter_700Bold",
  },
  postPromote: {
    position: "absolute",
    bottom: 6,
    right: 6,
  },

  // Edit-profile modal fields
  editField: {
    marginTop: 14,
  },
  editLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 6,
  },
  editInput: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  editInputMultiline: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  editCounter: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
  editPhoneRow: {
    alignItems: "center",
    gap: 8,
  },
  editDialBtn: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: "center",
    gap: 4,
  },
  editDialFlag: {
    fontSize: 16,
  },
  editDialCode: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  editPhoneInput: {
    flex: 1,
  },

  // Overflow menu
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  menuSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    borderWidth: 1,
  },
  menuHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 14,
  },
  menuTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  menuEmail: {
    fontSize: 13,
    marginTop: 2,
    marginBottom: 6,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 12,
  },
  menuItemText: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
});
