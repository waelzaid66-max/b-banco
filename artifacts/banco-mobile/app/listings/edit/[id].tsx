import { Feather, Ionicons } from "@/components/icons";
import { AppTextInput as TextInput } from "@/components/AppTextInput";
import {
  getGetListingQueryKey,
  getListing,
  useUpdateListing,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { CountryCodePicker } from "@/components/CountryCodePicker";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { LocationPicker } from "@/components/LocationPicker";
import {
  countryByIso,
  isValidNationalNumber,
  parsePhone,
  toE164,
} from "@/constants/countryCodes";
import { useI18n } from "@/context/LanguageContext";
import { useSession } from "@/context/SessionContext";
import { useColors } from "@/hooks/useColors";
import {
  ListingMediaEditor,
  type ListingMediaEditorHandle,
} from "@/components/listings/ListingMediaEditor";

type PhoneEntry = { country: string; number: string };

const MAX_PHONES = 5;

function digitsToNumber(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function phonesFromSpecs(specs: Record<string, unknown>): PhoneEntry[] {
  const raw = specs.contact_phones;
  if (!Array.isArray(raw) || raw.length === 0) {
    return [{ country: "EG", number: "" }];
  }
  const entries = raw
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((e164) => {
      const parsed = parsePhone(e164);
      return { country: parsed.iso, number: parsed.number };
    });
  return entries.length > 0 ? entries : [{ country: "EG", number: "" }];
}

export default function EditListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const { t, isRTL } = useI18n();
  const { bumpListings } = useSession();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const rowDir = isRTL ? "row-reverse" : "row";
  const textAlign = isRTL ? "right" : "left";

  const listingQ = useQuery({
    queryKey: getGetListingQueryKey(id ?? ""),
    queryFn: () => getListing(id ?? ""),
    enabled: !!id,
  });

  const listing = listingQ.data?.data;
  const specs = (listing?.specs ?? {}) as Record<string, unknown>;
  const isFurnishedDaily = specs.rental_term === "furnished_daily";
  const isRequest = listing?.is_request === true;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [locationValue, setLocationValue] = useState<string | null>(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [phones, setPhones] = useState<PhoneEntry[]>([{ country: "EG", number: "" }]);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [phonePickerIdx, setPhonePickerIdx] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const mediaRef = useRef<ListingMediaEditorHandle>(null);

  useEffect(() => {
    if (!listing || hydrated) return;
    setTitle(listing.title ?? "");
    setDescription(listing.description ?? "");
    setLocation(listing.location ?? "");
    setLocationValue(listing.location ?? null);
    if (typeof listing.price_cash === "number") {
      setPrice(String(Math.round(listing.price_cash)));
    }
    setPhones(phonesFromSpecs(specs));
    setWhatsappEnabled(
      specs.whatsapp_enabled === true || listing.whatsapp_enabled === true,
    );
    setHydrated(true);
  }, [listing, hydrated]);

  const { mutate, isPending } = useUpdateListing({
    mutation: {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        bumpListings();
        Alert.alert(t("editListing.savedTitle"), t("editListing.savedBody"), [
          { text: t("common.done"), onPress: () => router.back() },
        ]);
      },
      onError: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(t("common.error"), t("editListing.error"));
      },
    },
  });

  const setPhoneNumberAt = (index: number, number: string) => {
    setPhones((prev) =>
      prev.map((p, i) => (i === index ? { ...p, number } : p)),
    );
  };

  const setPhoneCountryAt = (index: number, iso: string) => {
    setPhones((prev) =>
      prev.map((p, i) => (i === index ? { ...p, country: iso } : p)),
    );
  };

  const addPhone = () => {
    setPhones((prev) =>
      prev.length >= MAX_PHONES
        ? prev
        : [...prev, { country: prev[prev.length - 1]?.country ?? "EG", number: "" }],
    );
  };

  const removePhoneAt = (index: number) => {
    setPhones((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    );
  };

  const onSave = () => {
    if (!id || !title.trim()) return;
    const base_price_cash = digitsToNumber(price);
    if (!isRequest && base_price_cash <= 0) {
      Alert.alert(t("common.error"), t("editListing.priceRequired"));
      return;
    }

    const filledPhones = phones.filter((p) => p.number.trim() !== "");
    if (filledPhones.length === 0) {
      Alert.alert(t("common.error"), t("create.errPhone"));
      return;
    }
    const phonesValid = filledPhones.every((p) =>
      isValidNationalNumber(p.number, countryByIso(p.country)),
    );
    if (!phonesValid) {
      Alert.alert(t("common.error"), t("create.errPhoneInvalid"));
      return;
    }

    const cleanPhones = filledPhones.map((p) =>
      toE164(p.number, countryByIso(p.country)),
    );

    const media = mediaRef.current?.buildMediaPayload();
    if (mediaRef.current?.hasPendingUploads()) {
      Alert.alert(t("common.error"), t("create.errMediaNotReady"));
      return;
    }
    if (media === null) {
      Alert.alert(t("common.error"), t("create.errMinPhotos", { count: 2 }));
      return;
    }

    mutate({
      id,
      data: {
        title: title.trim(),
        description: description.trim() || undefined,
        location: locationValue ?? location.trim(),
        ...(isRequest ? {} : { base_price_cash }),
        media,
        specs: {
          contact_phones: cleanPhones,
          whatsapp_enabled: whatsappEnabled,
        },
      },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
            flexDirection: rowDir,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12}>
          <Feather name="x" size={22} color={colors.foreground} />
        </Pressable>
        <AppText style={[styles.headerTitle, { color: colors.foreground }]}>
          {t("editListing.title")}
        </AppText>
        <Pressable
          onPress={onSave}
          disabled={isPending || listingQ.isLoading}
          style={styles.iconBtn}
          hitSlop={12}
          testID="edit-listing-save"
        >
          {isPending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <AppText style={{ color: colors.primary, fontWeight: "700" }}>
              {t("editListing.save")}
            </AppText>
          )}
        </Pressable>
      </View>

      {listingQ.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : listingQ.isError || !listing ? (
        <View style={styles.centered}>
          <AppText style={{ color: colors.mutedForeground }}>
            {t("listing.notAvailable")}
          </AppText>
        </View>
      ) : (
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
        >
          {isFurnishedDaily ? (
            <View style={[styles.badge, { backgroundColor: colors.primary + "14", flexDirection: rowDir }]}>
              <Feather name="calendar" size={14} color={colors.primary} />
              <AppText style={{ color: colors.primary, fontSize: 12, fontWeight: "600" }}>
                {t("rentals.hub.unitBadge")}
              </AppText>
            </View>
          ) : null}

          <AppText style={[styles.locked, { color: colors.mutedForeground, textAlign }]}>
            {t("editListing.lockedType")}
          </AppText>

          <ListingMediaEditor
            ref={mediaRef}
            initialMedia={listing.media ?? []}
            isRequest={isRequest}
            testIdPrefix="edit-listing"
          />

          <Field label={t("create.titleField")} colors={colors} isRTL={isRTL}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, textAlign }]}
              placeholder={t("create.titlePlaceholder")}
              placeholderTextColor={colors.mutedForeground}
            />
          </Field>

          <Field label={t("create.descriptionField")} colors={colors} isRTL={isRTL}>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              style={[
                styles.input,
                styles.textArea,
                { color: colors.foreground, borderColor: colors.border, textAlign },
              ]}
              placeholder={t("create.descriptionPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
            />
          </Field>

          <Field label={t("create.locationField")} colors={colors} isRTL={isRTL}>
            <Pressable
              onPress={() => setLocationPickerOpen(true)}
              style={[styles.input, styles.pressField, { borderColor: colors.border, flexDirection: rowDir }]}
            >
              <AppText style={{ color: location ? colors.foreground : colors.mutedForeground, flex: 1, textAlign }}>
                {location || t("create.locationPlaceholder")}
              </AppText>
              <Feather name="map-pin" size={16} color={colors.mutedForeground} />
            </Pressable>
          </Field>

          <Field
            label={isFurnishedDaily ? t("editListing.priceNightHint") : t("editListing.priceHint")}
            colors={colors}
            isRTL={isRTL}
          >
            <TextInput
              value={price}
              onChangeText={setPrice}
              keyboardType="numeric"
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, textAlign }]}
              placeholder={isRequest ? t("editListing.requestNoPrice") : "0"}
              placeholderTextColor={colors.mutedForeground}
              editable={!isRequest}
            />
          </Field>
          {isRequest ? (
            <AppText style={[styles.locked, { color: colors.mutedForeground, textAlign }]}>
              {t("editListing.requestPriceLocked")}
            </AppText>
          ) : null}

          <Field label={t("create.contactLabel")} colors={colors} isRTL={isRTL}>
            <AppText style={[styles.locked, { color: colors.mutedForeground, textAlign, marginBottom: 4 }]}>
              {t("create.contactHint")}
            </AppText>
            {phones.map((phone, i) => {
              const country = countryByIso(phone.country);
              return (
                <View key={`edit-phone-${i}`} style={styles.phoneGroup}>
                  <View style={[styles.phoneRow, { flexDirection: rowDir }]}>
                    <Pressable
                      onPress={() => {
                        Haptics.selectionAsync();
                        setPhonePickerIdx(i);
                      }}
                      style={[
                        styles.dialBtn,
                        {
                          borderColor: colors.border,
                          borderRadius: colors.radius,
                          backgroundColor: colors.card,
                          flexDirection: rowDir,
                        },
                      ]}
                      testID={`edit-phone-country-${i}`}
                    >
                      <AppText style={styles.dialFlag}>{country.flag}</AppText>
                      <AppText style={[styles.dialCode, { color: colors.foreground }]}>
                        +{country.dial}
                      </AppText>
                      <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
                    </Pressable>
                    <TextInput
                      value={phone.number}
                      onChangeText={(v) => setPhoneNumberAt(i, v)}
                      placeholder={country.sample}
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="phone-pad"
                      autoCorrect={false}
                      style={[styles.input, styles.phoneInput, { color: colors.foreground, borderColor: colors.border, textAlign }]}
                      testID={`edit-phone-${i}`}
                    />
                    {phones.length > 1 ? (
                      <Pressable
                        onPress={() => {
                          Haptics.selectionAsync();
                          removePhoneAt(i);
                        }}
                        style={[styles.phoneRemove, { borderColor: colors.border, borderRadius: colors.radius }]}
                        hitSlop={6}
                        testID={`edit-remove-phone-${i}`}
                      >
                        <Feather name="trash-2" size={18} color={colors.destructive} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
            {phones.length < MAX_PHONES ? (
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  addPhone();
                }}
                style={[
                  styles.addRowBtn,
                  {
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    flexDirection: rowDir,
                  },
                ]}
                testID="edit-add-phone"
              >
                <Feather name="plus" size={18} color={colors.primary} />
                <AppText style={{ color: colors.primary, fontWeight: "600" }}>
                  {t("create.addPhone")}
                </AppText>
              </Pressable>
            ) : null}
          </Field>

          <View
            style={[
              styles.whatsappRow,
              {
                flexDirection: rowDir,
                borderColor: colors.border,
                borderRadius: colors.radius,
                backgroundColor: colors.card,
              },
            ]}
          >
            <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
            <View style={styles.whatsappTextWrap}>
              <AppText style={{ color: colors.foreground, fontWeight: "600", textAlign }}>
                {t("create.whatsappTitle")}
              </AppText>
              <AppText style={{ color: colors.mutedForeground, fontSize: 12, textAlign }}>
                {t("create.whatsappHint")}
              </AppText>
            </View>
            <Switch
              value={whatsappEnabled}
              onValueChange={setWhatsappEnabled}
              trackColor={{ false: colors.border, true: colors.primary + "88" }}
              thumbColor={whatsappEnabled ? colors.primary : colors.mutedForeground}
              testID="edit-whatsapp-toggle"
            />
          </View>
        </KeyboardAwareScrollViewCompat>
      )}

      <LocationPicker
        visible={locationPickerOpen}
        selectedValue={locationValue ?? undefined}
        onClose={() => setLocationPickerOpen(false)}
        onSelect={(_value, label) => {
          setLocation(label);
          setLocationValue(label);
          setLocationPickerOpen(false);
        }}
        onClear={() => {
          setLocation("");
          setLocationValue(null);
        }}
      />

      <CountryCodePicker
        visible={phonePickerIdx !== null}
        selectedIso={
          phonePickerIdx !== null ? phones[phonePickerIdx]?.country : undefined
        }
        onClose={() => setPhonePickerIdx(null)}
        onSelect={(iso) => {
          if (phonePickerIdx !== null) setPhoneCountryAt(phonePickerIdx, iso);
          setPhonePickerIdx(null);
        }}
      />
    </View>
  );
}

function Field({
  label,
  children,
  colors,
  isRTL,
}: {
  label: string;
  children: ReactNode;
  colors: ReturnType<typeof useColors>;
  isRTL: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <AppText style={{ color: colors.foreground, fontWeight: "600", textAlign: isRTL ? "right" : "left" }}>
        {label}
      </AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  iconBtn: { minWidth: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  badge: {
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  locked: { fontSize: 12, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 15,
  },
  textArea: { minHeight: 100, textAlignVertical: "top" },
  pressField: { alignItems: "center" },
  phoneGroup: { gap: 4, marginBottom: 8 },
  phoneRow: { alignItems: "center", gap: 8 },
  dialBtn: {
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
  },
  dialFlag: { fontSize: 18 },
  dialCode: { fontSize: 14, fontWeight: "600" },
  phoneInput: { flex: 1, marginBottom: 0 },
  phoneRemove: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  addRowBtn: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    marginTop: 4,
  },
  whatsappRow: {
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: 1,
  },
  whatsappTextWrap: { flex: 1, gap: 2 },
});
