import { useUser } from "@clerk/expo";
import { Feather, Ionicons } from "@/components/icons";
import {
  createListing,
  verifyUpload,
  useGetMe,
  getGetMeQueryKey,
  useGetMySubscription,
  getGetMySubscriptionQueryKey,
  type CreateListingBody,
  type CreateListingBodyMediaItem,
  type CreateListingBodyPaymentOptionsItem,
} from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { useSession } from "@/context/SessionContext";
import {
  isVideoAsset,
  isUploadAbortError,
  buildResolvedMedia,
  uploadResolvedMedia,
} from "@/lib/upload";
import {
  MAX_MEDIA,
  MAX_PHOTOS,
  MAX_VIDEO_MB,
  MAX_VIDEO_SECONDS,
  MAX_VIDEOS,
  MIN_PHOTOS,
  capMedia,
  moveMediaItem,
  partitionPickedAssets,
} from "@/lib/listingMedia";
import { CarPicker } from "@/components/CarPicker";
import { CountryCodePicker } from "@/components/CountryCodePicker";
import {
  ImageCropModal,
  type CropModalResult,
} from "@/components/ImageCropModal";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { LocationPicker } from "@/components/LocationPicker";
import { PermissionRationaleModal } from "@/components/PermissionRationaleModal";
import { SmartAssetCard } from "@/components/SmartAssetCard";
import { type CarBrand, brandLabel, CAR_BRANDS } from "@/constants/cars";
import {
  INDUSTRIAL_TYPES,
  SPEC_FIELDS_BY_UI,
  UI_CATEGORIES,
  apiCategoryForUi,
  requiredSpecKeysFor,
  type UiListingCategory,
} from "@/constants/listingCreateTaxonomy";
import { buildPreviewFeedItem } from "@/constants/listingPreview";
import {
  DEFAULT_COUNTRY,
  countryByIso,
  isValidNationalNumber,
  parsePhone,
  toE164,
} from "@/constants/countryCodes";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  LISTING_DRAFT_KEY,
  parseListingDraft,
  serializeListingDraft,
  listingDraftHasContent,
  type ListingDraftInput,
} from "@/lib/listingDraft";

type InstallmentMode = "seller_installment" | "bank_finance";

type PlanDraft = {
  mode: InstallmentMode;
  downPayment: string;
  monthlyPayment: string;
  durationMonths: string;
  isIslamic: boolean;
};

type PhoneEntry = {
  country: string;
  number: string;
};

type UploadStatus = "uploading" | "verifying" | "uploaded" | "failed";

type UploadEntry = {
  status: UploadStatus;
  progress: number;
  url?: string;
  type?: "image" | "video";
  error?: string;
};

type CropResult = {
  uri: string;
  width: number;
  height: number;
  contentType: string;
};

const emptyPlan = (): PlanDraft => ({
  mode: "seller_installment",
  downPayment: "",
  monthlyPayment: "",
  durationMonths: "",
  isIslamic: false,
});

// Guided wizard steps. Raw Materials is a 4th seller-facing category that maps
// to category=industrial + industrial_type="raw_material" at submit/preview.
const STEP_KEYS = ["category", "details", "media", "price", "preview"] as const;
const TOTAL_STEPS = STEP_KEYS.length;

const MAX_PHONES = 5;

// Media limits, caps and the pure video-validation/reorder helpers now live in
// lib/listingMedia.ts so the policy is shared and testable in isolation.

function digitsToNumber(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export default function CreateListingScreen() {
  const colors = useColors();
  const { t, isRTL } = useI18n();
  const { bumpListings } = useSession();
  const insets = useSafeAreaInsets();
  const { isSignedIn, isLoaded } = useUser();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const meQuery = useGetMe({
    query: { enabled: !!isSignedIn, queryKey: getGetMeQueryKey() },
  });
  const accountPhone = meQuery.data?.data?.phone ?? null;
  const isVerified = meQuery.data?.data?.is_verified ?? false;
  const userRole = meQuery.data?.data?.role ?? null;

  // Free-listing transparency. listing_quota === null means unlimited (no
  // banner). Backed by the existing subscription endpoint — the only client
  // arithmetic is remaining = quota − used.
  const subQuery = useGetMySubscription({
    query: { enabled: !!isSignedIn, queryKey: getGetMySubscriptionQueryKey() },
  });
  const usage = subQuery.data?.data?.usage;
  const freeRemaining =
    usage && usage.listing_quota != null
      ? Math.max(0, usage.listing_quota - usage.listings_this_month)
      : null;

  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<UiListingCategory | null>(null);
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [specs, setSpecs] = useState<Record<string, string>>({});
  // Free-form seller specs (philosophy: unlimited, save-everything). Stored as
  // top-level scalar specs at submit so they're displayed + searchable.
  const [customSpecs, setCustomSpecs] = useState<{ name: string; value: string }[]>([]);
  const [carBrand, setCarBrand] = useState<CarBrand | null>(null);
  const [carModel, setCarModel] = useState<string | null>(null);
  const [carPickerOpen, setCarPickerOpen] = useState(false);
  const [industrialType, setIndustrialType] = useState<string | null>(null);
  const [carOrigin, setCarOrigin] = useState<"local" | "imported" | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [locationValue, setLocationValue] = useState<string | null>(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  // Optional precise GPS pin for the listing (#4). null until the seller taps
  // "use my location"; sent as latitude/longitude so near-me uses the exact
  // point instead of the area centroid. Never blocks publishing.
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [cashPrice, setCashPrice] = useState("");
  // Buyer "request/wanted" mode. When on, this is a request to BUY (is_request):
  // price becomes optional, payment plans are hidden, and a description is
  // required. Mirrors the server contract (base_price_cash optional + the
  // bilingual "طلب سعر / Price requested" line).
  const [isRequest, setIsRequest] = useState(false);

  const [phones, setPhones] = useState<PhoneEntry[]>([
    { country: DEFAULT_COUNTRY.iso, number: "" },
  ]);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [phonePickerIdx, setPhonePickerIdx] = useState<number | null>(null);
  const [showOptionalSpecs, setShowOptionalSpecs] = useState(false);
  const [plans, setPlans] = useState<PlanDraft[]>([]);

  const [showPhotoRationale, setShowPhotoRationale] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null | undefined>(undefined);
  const [done, setDone] = useState(false);
  // Per-asset upload tracking, keyed by the stable picked-asset uri. uploadState
  // drives the tile overlays + the publish gate; cropResults holds the cropped
  // bytes to upload (T4); controllers lets remove/reset abort in-flight PUTs.
  // cropResultsRef mirrors cropResults so startUpload reads the latest crop
  // synchronously (state updates are async).
  const [uploadState, setUploadState] = useState<Record<string, UploadEntry>>({});
  const [cropResults, setCropResults] = useState<Record<string, CropResult>>({});
  const controllers = useRef<Record<string, AbortController>>({});
  const cropResultsRef = useRef<Record<string, CropResult>>({});
  // Crop flow. Newly picked images queue up for the in-app cropper one at a time;
  // editAsset re-opens the cropper for an already-added tile ("Edit crop"). The
  // cropper always reads the ORIGINAL picked asset so re-cropping never compounds
  // quality loss. editAsset takes priority over the queue.
  const [cropQueue, setCropQueue] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [editAsset, setEditAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const cropAsset = editAsset ?? cropQueue[0] ?? null;

  const writeDir: "rtl" | "ltr" = isRTL ? "rtl" : "ltr";
  const rowDir: "row" | "row-reverse" = isRTL ? "row-reverse" : "row";
  const textAlign: "right" | "left" = isRTL ? "right" : "left";

  const specFields = useMemo(
    () => (category ? SPEC_FIELDS_BY_UI[category] : []),
    [category],
  );
  // Which keys are required depends on the chosen sub-type — e.g. land/shop have
  // no rooms/finishing, raw materials need no industry — so recompute as the spec
  // values change. Mirrors the server floor (validateAttributes) exactly.
  const requiredSpecKeys = useMemo(
    () => (category ? requiredSpecKeysFor(category, specs) : []),
    [category, specs],
  );
  const requiredSpecFields = useMemo(
    () => specFields.filter((f) => requiredSpecKeys.includes(f.key)),
    [specFields, requiredSpecKeys],
  );
  const optionalSpecFields = useMemo(
    () => specFields.filter((f) => !requiredSpecKeys.includes(f.key)),
    [specFields, requiredSpecKeys],
  );

  const setSpec = (key: string, value: string) =>
    setSpecs((prev) => ({ ...prev, [key]: value }));

  // Capture the seller's current GPS location for the listing pin (#4). Optional
  // + best-effort: a denied permission or any failure leaves the pin unset and
  // never blocks publishing. Sent as latitude/longitude in the create body.
  const captureLocation = async () => {
    setPinBusy(true);
    try {
      const Location = await import("expo-location");
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      // location is optional — never surface as a blocking error
    } finally {
      setPinBusy(false);
    }
  };

  // Seed the first contact-phone row from the account/business phone, but only
  // while the row is still untouched (don't clobber what the seller typed).
  const phoneSeeded = useRef(false);
  useEffect(() => {
    if (phoneSeeded.current) return;
    const seed = accountPhone?.trim();
    if (!seed) return;
    const parsed = parsePhone(seed);
    setPhones((prev) => {
      if (prev.length === 1 && prev[0].number.trim() === "") {
        phoneSeeded.current = true;
        return [{ country: parsed.iso, number: parsed.number }];
      }
      return prev;
    });
  }, [accountPhone]);

  // ── Auto-save draft (#2): persist the typed fields so an interrupted listing
  // can be resumed. Photos are NOT persisted (device-session URIs). A corrupt or
  // stale blob is rejected by parseListingDraft, so it can never break the form. ──
  const draftReady = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = parseListingDraft(await AsyncStorage.getItem(LISTING_DRAFT_KEY));
        if (cancelled || !d) return;
        setStep(d.step);
        if (d.category) setCategory(d.category as UiListingCategory);
        setTitle(d.title);
        setDescription(d.description);
        setLocation(d.location);
        setLocationValue(d.locationValue);
        setCashPrice(d.cashPrice);
        setIsRequest(d.isRequest);
        setWhatsappEnabled(d.whatsappEnabled);
        setSpecs(d.specs);
        setCustomSpecs(d.customSpecs);
        setCarBrand(
          d.carBrandValue ? CAR_BRANDS.find((b) => b.value === d.carBrandValue) ?? null : null,
        );
        setCarModel(d.carModel);
        setIndustrialType(d.industrialType);
        setCarOrigin(d.carOrigin);
        // Only override the phone row for a real entered number (else leave the
        // account-phone seeding above to do its job on an untouched row).
        if (d.phones.some((p) => p.number.trim())) setPhones(d.phones);
        setPlans(
          d.plans.filter(
            (p) => p.mode === "seller_installment" || p.mode === "bank_finance",
          ) as PlanDraft[],
        );
      } catch {
        // a broken draft must never block creating a listing
      } finally {
        if (!cancelled) draftReady.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced persist of the resumable fields — after the restore pass, and never
  // on the success screen or mid-submit. Photos/upload state are intentionally out.
  useEffect(() => {
    if (!draftReady.current || done || submitting) return;
    const input: ListingDraftInput = {
      step,
      category,
      title,
      description,
      location,
      locationValue,
      cashPrice,
      isRequest,
      whatsappEnabled,
      specs,
      customSpecs,
      carBrandValue: carBrand?.value ?? null,
      carModel,
      industrialType,
      carOrigin,
      phones,
      plans,
    };
    if (!listingDraftHasContent(input)) return;
    const handle = setTimeout(() => {
      AsyncStorage.setItem(LISTING_DRAFT_KEY, serializeListingDraft(input)).catch(() => {});
    }, 600);
    return () => clearTimeout(handle);
  }, [
    step,
    category,
    title,
    description,
    location,
    locationValue,
    cashPrice,
    isRequest,
    whatsappEnabled,
    specs,
    customSpecs,
    carBrand,
    carModel,
    industrialType,
    carOrigin,
    phones,
    plans,
    done,
    submitting,
  ]);

  const setPhoneNumberAt = (index: number, value: string) =>
    setPhones((prev) =>
      prev.map((p, i) => (i === index ? { ...p, number: value } : p)),
    );

  const setPhoneCountryAt = (index: number, iso: string) =>
    setPhones((prev) =>
      prev.map((p, i) => (i === index ? { ...p, country: iso } : p)),
    );

  const addPhone = () =>
    setPhones((prev) =>
      prev.length >= MAX_PHONES
        ? prev
        : [...prev, { country: DEFAULT_COUNTRY.iso, number: "" }],
    );

  const removePhoneAt = (index: number) =>
    setPhones((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    );

  const addPlan = () => {
    Haptics.selectionAsync();
    setPlans((prev) => [...prev, emptyPlan()]);
  };

  const removePlan = (index: number) =>
    setPlans((prev) => prev.filter((_, i) => i !== index));

  const updatePlan = (index: number, patch: Partial<PlanDraft>) =>
    setPlans((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    );

  // Verify the stored object is readable before marking a tile done. The verify
  // endpoint returns 503 while storage metadata is still settling (read-after-
  // write lag); treat that as transient and retry a few times. Any other error
  // is permanent and propagates to mark the upload failed.
  const verifyWithRetry = async (url: string, signal: AbortSignal) => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      if (signal.aborted) return;
      try {
        await verifyUpload({ url });
        return;
      } catch (e) {
        const status = (e as { status?: number } | null)?.status;
        if (status === 503 && attempt < 4) {
          await new Promise((r) => setTimeout(r, 700 * attempt));
          continue;
        }
        throw e;
      }
    }
  };

  // Per-asset upload state machine: uploading(progress) -> verifying -> uploaded
  // | failed. Media uploads the moment it's added so publishing is instant, the
  // seller sees per-tile progress, and a single flaky asset can be retried in
  // place without re-picking the set. Aborts any prior in-flight PUT for the uri.
  const startUpload = (asset: ImagePicker.ImagePickerAsset) => {
    const uri = asset.uri;
    controllers.current[uri]?.abort();
    const controller = new AbortController();
    controllers.current[uri] = controller;
    setUploadState((s) => ({ ...s, [uri]: { status: "uploading", progress: 0 } }));

    void (async () => {
      try {
        const crop = cropResultsRef.current[uri];
        const resolved = await buildResolvedMedia(
          asset,
          crop ? { uri: crop.uri, contentType: crop.contentType } : undefined,
        );
        if (controller.signal.aborted) return;
        const uploaded = await uploadResolvedMedia(resolved, {
          signal: controller.signal,
          onProgress: (f) =>
            setUploadState((s) => {
              const cur = s[uri];
              if (!cur || cur.status !== "uploading") return s;
              return { ...s, [uri]: { ...cur, progress: f } };
            }),
        });
        if (controller.signal.aborted) return;
        setUploadState((s) => ({
          ...s,
          [uri]: {
            status: "verifying",
            progress: 1,
            url: uploaded.url,
            type: uploaded.type,
          },
        }));
        await verifyWithRetry(uploaded.url, controller.signal);
        if (controller.signal.aborted) return;
        setUploadState((s) => ({
          ...s,
          [uri]: {
            status: "uploaded",
            progress: 1,
            url: uploaded.url,
            type: uploaded.type,
          },
        }));
      } catch (e) {
        if (isUploadAbortError(e) || controller.signal.aborted) return;
        setUploadState((s) => ({
          ...s,
          [uri]: { status: "failed", progress: 0, error: t("create.errUpload") },
        }));
      } finally {
        if (controllers.current[uri] === controller) {
          delete controllers.current[uri];
        }
      }
    })();
  };

  // Newly added picks: videos upload as-is immediately; images go through the
  // in-app cropper first (queued sequentially) and only start uploading once the
  // seller confirms a crop. An image missing source dimensions can't be mapped to
  // a crop rectangle, so it skips the cropper and uploads normalized.
  const handleAddedAssets = (added: ImagePicker.ImagePickerAsset[]) => {
    const toCrop: ImagePicker.ImagePickerAsset[] = [];
    added.forEach((a) => {
      const cropable =
        !isVideoAsset(a) && (a.width ?? 0) > 0 && (a.height ?? 0) > 0;
      if (cropable) toCrop.push(a);
      else startUpload(a);
    });
    if (toCrop.length) setCropQueue((q) => [...q, ...toCrop]);
  };

  // Seller confirmed the crop: record the rendered bytes (sync ref + state so
  // startUpload reads the latest crop) and kick off the upload. Then advance —
  // an edit re-crop closes the modal; a fresh pick pops the queue to the next.
  const handleCropConfirm = (result: CropModalResult) => {
    const asset = cropAsset;
    if (!asset) return;
    const uri = asset.uri;
    const cr: CropResult = {
      uri: result.uri,
      width: result.width,
      height: result.height,
      contentType: result.contentType,
    };
    cropResultsRef.current[uri] = cr;
    setCropResults((prev) => ({ ...prev, [uri]: cr }));
    startUpload(asset);
    if (editAsset) setEditAsset(null);
    else setCropQueue((q) => q.slice(1));
  };

  // Cancel: an edit re-crop just closes (keeps the existing crop + upload). A
  // fresh pick is dropped entirely — the tile was already added to photos, so
  // removePhoto cleans up every per-asset state. removePhoto also filters this
  // asset (the current queue head) out of cropQueue, which advances the queue on
  // its own — do NOT slice again here or the next queued image gets skipped.
  const handleCropCancel = () => {
    const asset = cropAsset;
    if (!asset) return;
    if (editAsset) {
      setEditAsset(null);
      return;
    }
    removePhoto(asset.uri);
  };

  const launchPicker = async () => {
    setShowPhotoRationale(false);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const remaining = MAX_MEDIA - photos.length;
      if (remaining <= 0) return;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, remaining),
        quality: 0.7,
      });
      if (result.canceled) return;
      // Validation policy (oversize/over-length videos) lives in lib/listingMedia
      // — the server can't enforce it on a presigned PUT. Images always pass;
      // only their count is capped by capMedia.
      const { accepted, rejectedLong, rejectedBig } = partitionPickedAssets(
        result.assets,
      );
      const next = capMedia([...photos, ...accepted]);
      const added = next.filter(
        (p) => !photos.some((prev) => prev.uri === p.uri),
      );
      setPhotos(next);
      handleAddedAssets(added);
      setError(
        rejectedLong
          ? t("create.errVideoTooLong", { seconds: MAX_VIDEO_SECONDS })
          : rejectedBig
            ? t("create.errVideoTooLarge", { mb: MAX_VIDEO_MB })
            : null,
      );
    } catch {
      Alert.alert(t("common.error"), t("create.errUpload"));
    }
  };

  // Optional listing video. Single-select with the OS-native editor so a clip
  // longer than the cap gets TRIMMED in-app — allowsEditing presents the system
  // trimmer capped to videoMaxDuration — instead of being rejected. allowsEditing
  // can't combine with multi-select, so video gets its own affordance separate
  // from the multi-image picker. partitionPickedAssets still guards the result
  // for the rare case the platform returns an over-cap clip.
  const launchVideoTrimPicker = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const videoCount = photos.filter(isVideoAsset).length;
      if (videoCount >= MAX_VIDEOS || photos.length >= MAX_MEDIA) return;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsEditing: true,
        quality: 0.7,
        videoMaxDuration: MAX_VIDEO_SECONDS,
      });
      if (result.canceled) return;
      const { accepted, rejectedLong, rejectedBig } = partitionPickedAssets(
        result.assets,
      );
      const next = capMedia([...photos, ...accepted]);
      const added = next.filter(
        (p) => !photos.some((prev) => prev.uri === p.uri),
      );
      setPhotos(next);
      handleAddedAssets(added);
      setError(
        rejectedLong
          ? t("create.errVideoTooLong", { seconds: MAX_VIDEO_SECONDS })
          : rejectedBig
            ? t("create.errVideoTooLarge", { mb: MAX_VIDEO_MB })
            : null,
      );
    } catch {
      Alert.alert(t("common.error"), t("create.errUpload"));
    }
  };

  // Camera capture for listing photos. The OS permission prompt (carrying the
  // listing-scoped cameraPermission string) is the rationale; a permanent denial
  // routes to Settings. A captured photo flows through the SAME crop → upload
  // pipeline as library picks, so it counts toward the photo min/max.
  const requestCameraPermission = async (): Promise<boolean> => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.granted) return true;
    if (Platform.OS !== "web" && !perm.canAskAgain) {
      Alert.alert(t("create.cameraDeniedTitle"), t("create.cameraDeniedBody"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("create.openSettings"),
          onPress: () => Linking.openSettings().catch(() => {}),
        },
      ]);
    } else {
      setError(t("create.cameraPermission"));
    }
    return false;
  };

  const captureFromCamera = async () => {
    try {
      if (photos.length >= MAX_MEDIA) return;
      if (!(await requestCameraPermission())) return;
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.7,
      });
      if (result.canceled) return;
      const next = capMedia([...photos, ...result.assets]);
      const added = next.filter(
        (p) => !photos.some((prev) => prev.uri === p.uri),
      );
      setPhotos(next);
      handleAddedAssets(added);
      setError(null);
    } catch {
      Alert.alert(t("common.error"), t("create.errUpload"));
    }
  };

  // Native offers camera-or-library via an action sheet; RN-Web's Alert can't
  // render a multi-button sheet, so web goes straight to the library-rationale
  // flow (web has no in-app camera capture here).
  const openPhotoSource = () => {
    if (photos.length >= MAX_MEDIA) return;
    if (Platform.OS === "web") {
      setShowPhotoRationale(true);
      return;
    }
    Alert.alert(t("create.photoSource"), undefined, [
      { text: t("create.takePhoto"), onPress: () => void captureFromCamera() },
      {
        text: t("create.chooseFromLibrary"),
        onPress: () => setShowPhotoRationale(true),
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  // Removing a tile aborts any in-flight upload for it and drops every per-asset
  // state keyed by its uri (caption, upload status, crop result).
  const removePhoto = (uri: string) => {
    controllers.current[uri]?.abort();
    delete controllers.current[uri];
    delete cropResultsRef.current[uri];
    setPhotos((prev) => prev.filter((p) => p.uri !== uri));
    setCaptions((prev) => {
      const next = { ...prev };
      delete next[uri];
      return next;
    });
    setUploadState((prev) => {
      const next = { ...prev };
      delete next[uri];
      return next;
    });
    setCropResults((prev) => {
      const next = { ...prev };
      delete next[uri];
      return next;
    });
    // Drop the asset from the pending crop queue and close the editor if it was
    // re-cropping this exact tile, so the cropper can never reopen on a removed
    // image (which would waste an upload on deleted media).
    setCropQueue((q) => q.filter((a) => a.uri !== uri));
    setEditAsset((cur) => (cur?.uri === uri ? null : cur));
  };

  // Reorder media one slot at a time (-1 = toward the cover, +1 = toward the
  // end). The card cover is always the first image, so moving a photo to the
  // front re-selects the cover; captions are keyed by uri and survive the move.
  const moveMedia = (index: number, dir: -1 | 1) => {
    Haptics.selectionAsync();
    setPhotos((prev) => moveMediaItem(prev, index, dir));
  };

  // Lowest seller-entered installment monthly — echoed (never computed) into the
  // live preview badge. Mirrors PaymentService picking the cheapest plan.
  const installmentSummary = useMemo(() => {
    const valid = plans
      .map((p) => ({
        monthly: digitsToNumber(p.monthlyPayment),
        duration: digitsToNumber(p.durationMonths),
      }))
      .filter((p) => p.monthly > 0 && p.duration > 0);
    return {
      hasInstallment: valid.length > 0,
      lowestMonthly: valid.length
        ? Math.min(...valid.map((p) => p.monthly))
        : null,
    };
  }, [plans]);

  const previewItem = useMemo(() => {
    if (!category) return null;
    return buildPreviewFeedItem({
      uiCategory: category,
      title: title.trim() || t("create.titlePlaceholder"),
      location: location.trim() || t("create.locationField"),
      coverUri: photos.find((p) => !isVideoAsset(p))?.uri ?? null,
      hasVideo: photos.some(isVideoAsset),
      cashPrice: digitsToNumber(cashPrice),
      lowestMonthly: installmentSummary.lowestMonthly,
      hasInstallment: installmentSummary.hasInstallment,
      industrialType:
        category === "raw_materials" ? "raw_material" : industrialType,
      isVerified,
      role: userRole,
      isRequest,
    });
  }, [
    category,
    title,
    location,
    photos,
    cashPrice,
    installmentSummary,
    industrialType,
    isVerified,
    userRole,
    isRequest,
    t,
  ]);

  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (!category) return t("create.errCategory");
      return null;
    }
    if (s === 1) {
      if (!title.trim()) return t("create.errTitle");
      // A buyer request has no price, so the description is the only place to
      // explain what's wanted — the server contract requires it too.
      if (isRequest && !description.trim()) return t("create.errDescriptionRequired");
      if (!location.trim()) return t("create.errLocation");
      const filledPhones = phones.filter((p) => p.number.trim() !== "");
      if (filledPhones.length === 0) return t("create.errPhone");
      const phonesValid = filledPhones.every((p) =>
        isValidNationalNumber(p.number, countryByIso(p.country)),
      );
      if (!phonesValid) return t("create.errPhoneInvalid");
      // A buyer request only needs to say what's wanted — brand, type and the
      // category spec fields are seller-side details, so skip them in request mode.
      if (!isRequest) {
        if (category === "car" && !carBrand) return t("create.errBrand");
        if (category === "industrial" && !industrialType) {
          return t("create.errIndustrialType");
        }
        if (category) {
          for (const f of requiredSpecFields) {
            if (!specs[f.key]?.trim()) {
              return t("create.errSpecRequired", { field: t(f.labelKey) });
            }
          }
        }
      }
      return null;
    }
    if (s === 2) {
      // Photos are optional for buyer requests — they're looking, not selling.
      if (isRequest) return null;
      // Min applies to IMAGES only — videos are additive and never count toward
      // the photo floor (and can never be the card thumbnail).
      const imageCount = photos.filter((p) => !isVideoAsset(p)).length;
      if (imageCount < MIN_PHOTOS) {
        return t("create.errMinPhotos", { count: MIN_PHOTOS });
      }
      return null;
    }
    if (s === 3) {
      // Requests have no price and no payment plans — nothing to validate here.
      if (isRequest) return null;
      const price = digitsToNumber(cashPrice);
      if (!price || price <= 0) return t("create.errPrice");
      for (const plan of plans) {
        const monthly = digitsToNumber(plan.monthlyPayment);
        const duration = digitsToNumber(plan.durationMonths);
        if (!monthly || !duration) return t("create.errInstallment");
        const down = digitsToNumber(plan.downPayment);
        if (down && down > price) return t("create.errDownPayment");
      }
      return null;
    }
    if (s === 4) {
      if (freeRemaining === 0) return t("create.errQuota");
      return null;
    }
    return null;
  };

  const goNext = () => {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    Haptics.selectionAsync();
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  };

  // Leave the create flow back to whatever screen opened it (Facebook-style:
  // return to the PREVIOUS page, not a hardcoded tab). Only when there is no
  // history at all (deep link / replace entry) do we fall back to home — never
  // to the profile tab.
  const leaveCreate = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  const goBack = () => {
    setError(null);
    if (step === 0) {
      leaveCreate();
      return;
    }
    Haptics.selectionAsync();
    setStep((s) => Math.max(s - 1, 0));
  };

  // Header chevron + Android hardware back behave like a multi-step wizard:
  // step-by-step back through the form, then exit to the previous page. On the
  // success screen the back simply leaves.
  const handleHeaderBack = () => {
    if (done) {
      leaveCreate();
      return;
    }
    goBack();
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!done && step > 0) {
        setError(null);
        Haptics.selectionAsync();
        setStep((s) => Math.max(s - 1, 0));
        return true;
      }
      leaveCreate();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, step]);

  const handleSubmit = async () => {
    if (!category) return setError(t("create.errCategory"));
    // Re-validate every prior step so a deep-linked / edited draft can't slip an
    // invalid body to the API; jump back to the first failing step.
    for (const s of [1, 2, 3, 4]) {
      const err = validateStep(s);
      if (err) {
        setError(err);
        setStep(s);
        return;
      }
    }
    // Requests carry no sale price; omit base_price_cash entirely so the server
    // applies its request rules instead of a 0 price.
    const price = isRequest ? undefined : digitsToNumber(cashPrice);
    const cleanPhones = phones
      .filter((p) => p.number.trim() !== "")
      .map((p) => toE164(p.number, countryByIso(p.country)));

    // Cash is always available; only attach payment_options when the seller
    // has added at least one installment / finance plan. Requests never carry
    // payment plans.
    let paymentOptions: CreateListingBodyPaymentOptionsItem[] | undefined;
    if (!isRequest && plans.length > 0) {
      const built: CreateListingBodyPaymentOptionsItem[] = [];
      for (const plan of plans) {
        const monthly = digitsToNumber(plan.monthlyPayment);
        const duration = digitsToNumber(plan.durationMonths);
        if (!monthly || !duration) return setError(t("create.errInstallment"));
        built.push({
          mode: plan.mode,
          down_payment: digitsToNumber(plan.downPayment),
          monthly_payment: monthly,
          duration_months: Math.round(duration),
          is_islamic_compliant: plan.isIslamic,
        });
      }
      paymentOptions = [{ mode: "cash" }, ...built];
    }

    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      setSubmitting(true);
      // The card thumbnail (media_preview) is the media item flagged
      // is_thumbnail. It MUST be an image — the server drops listings whose
      // thumbnail is null and the feed renders it in an <Image>. So flag the
      // FIRST image (never a leading video) and explicitly set false elsewhere.
      // Requests are "wanted" posts: photos are optional, so no thumbnail is
      // required. Sale listings still MUST carry an image thumbnail.
      const firstImageIdx = photos.findIndex((p) => !isVideoAsset(p));
      if (!isRequest && firstImageIdx === -1) {
        setSubmitting(false);
        setError(t("create.errMinPhotos", { count: MIN_PHOTOS }));
        setStep(2);
        return;
      }
      // Media is uploaded + verified on-add. Assemble the stored urls in seller
      // order; the publish button is gated on every tile being "uploaded", but
      // re-check here so a race can never POST a half-uploaded set.
      if (photos.some((p) => uploadState[p.uri]?.status !== "uploaded")) {
        setSubmitting(false);
        setError(t("create.errMediaNotReady"));
        setStep(2);
        return;
      }
      const media: CreateListingBodyMediaItem[] = [];
      const mediaCaptions: Record<string, string> = {};
      photos.forEach((p, i) => {
        const entry = uploadState[p.uri];
        if (!entry?.url || !entry.type) return;
        media.push({
          type: entry.type,
          url: entry.url,
          is_thumbnail: i === firstImageIdx,
        });
        const cap = captions[p.uri]?.trim();
        if (cap) mediaCaptions[entry.url] = cap;
      });

      const specsClean: Record<string, unknown> = {};
      // Contact is the one spec dimension a buyer request also needs.
      specsClean.contact_phones = cleanPhones;
      // WhatsApp opt-in: buyers only see the WhatsApp contact path when the
      // seller explicitly enables it. Stored on the free-form specs and surfaced
      // via the additive `whatsapp_enabled` field on the feed + detail contract.
      specsClean.whatsapp_enabled = whatsappEnabled;
      // Seller-only spec dimensions (category spec fields, brand/model, the
      // industrial sub-type) never apply to a buyer request — the request form
      // doesn't even render them. Skip them entirely so a sell→request toggle
      // can't leak stale seller state into the lighter request body.
      if (!isRequest) {
        for (const field of specFields) {
          const value = specs[field.key];
          if (value == null || value.trim() === "") continue;
          specsClean[field.key] =
            field.type === "number" ? digitsToNumber(value) : value.trim();
        }
        // Industrial sub-type: explicit for industrial, fixed for raw materials
        // so the buyer feed groups it correctly under the industrial category.
        if (category === "industrial" && industrialType) {
          specsClean.industrial_type = industrialType;
        }
        if (category === "raw_materials") {
          specsClean.industrial_type = "raw_material";
        }
        // Cars: write the exact backend-known brand name (dbName) so
        // normalization resolves brand_id. Model is omitted for the "Other" path
        // (carModel null), letting the backend infer leniently from the title.
        if (category === "car" && carBrand) {
          specsClean.brand = carBrand.dbName ?? carBrand.en;
          if (carModel) specsClean.model = carModel;
        }
        // Free-form custom specs (philosophy: unlimited, save-everything). Stored
        // as top-level scalar keys so they display (formatSpecs) + become
        // searchable. Structured keys win; blanks + collisions are skipped.
        for (const cs of customSpecs) {
          const k = cs.name.trim();
          const v = cs.value.trim();
          if (!k || !v || k in specsClean) continue;
          specsClean[k] = v;
        }
      }
      // No dedicated media-caption column exists in the contract, so persist
      // per-media captions (keyed by servable url) inside the free-form specs the
      // backend already stores. Real, retrievable data — no server change needed.
      if (Object.keys(mediaCaptions).length > 0) {
        specsClean.media_captions = mediaCaptions;
      }

      const body: CreateListingBody = {
        title: title.trim(),
        description: description.trim() || undefined,
        category: apiCategoryForUi(category),
        base_price_cash: price,
        // Send the controlled location VALUE (e.g. "New Cairo") that the picker
        // stored in `locationValue`, NOT the Arabic display label in `location`.
        // The backend matches location against the English area/city taxonomy, so
        // sending the label fails the strict match and rejects the listing (400).
        location: (locationValue ?? location).trim(),
        // Optional precise pin (seller tapped "use my location"). Both axes go
        // together; the backend stores them as the listing's coordinate override.
        ...(pin ? { latitude: pin.lat, longitude: pin.lng } : {}),
        specs: specsClean,
        media,
        payment_options: paymentOptions,
        is_request: isRequest || undefined,
      };
      // Cars: persist local-vs-imported via the optional logistics block (the
      // same origin_type dimension the feed/search expose), nullable otherwise.
      // Seller-only — a buyer request carries no origin.
      if (!isRequest && category === "car" && carOrigin) {
        body.logistics = { origin_type: carOrigin };
      }

      setPhase("saving");
      const res = await createListing(body);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCreatedId(res.data?.id);
      setDone(true);
      // Listing published — the saved draft is now stale; clear it.
      AsyncStorage.removeItem(LISTING_DRAFT_KEY).catch(() => {});
      // Tell persistent listing surfaces (home feed, profile grid) to refetch so
      // the just-published listing appears immediately, no manual pull-to-refresh.
      bumpListings();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Surface the real failure instead of a silent generic retry. The API
      // client throws ApiError with a `status` and a human message shaped like
      // "HTTP 4xx ...: <reason>" — strip the prefix and show the actual reason.
      const status = (e as { status?: number } | null)?.status;
      if (status === 402 || status === 403) {
        setError(t("create.errQuota"));
      } else {
        const raw = e instanceof Error ? e.message : "";
        const reason = raw.includes(": ") ? raw.slice(raw.indexOf(": ") + 2) : raw;
        setError(reason ? t("create.errSubmitDetail", { reason }) : t("create.errSubmit"));
      }
    } finally {
      setSubmitting(false);
      setPhase("idle");
    }
  };

  const resetForm = () => {
    Object.values(controllers.current).forEach((c) => c.abort());
    controllers.current = {};
    cropResultsRef.current = {};
    setStep(0);
    setCategory(null);
    setPhotos([]);
    setCaptions({});
    setUploadState({});
    setCropResults({});
    setCropQueue([]);
    setEditAsset(null);
    setSpecs({});
    setCustomSpecs([]);
    setCarBrand(null);
    setCarModel(null);
    setIndustrialType(null);
    setCarOrigin(null);
    setTitle("");
    setDescription("");
    setLocation("");
    setLocationValue(null);
    setPin(null);
    setCashPrice("");
    setIsRequest(false);
    const seed = accountPhone?.trim();
    if (seed) {
      const parsed = parsePhone(seed);
      setPhones([{ country: parsed.iso, number: parsed.number }]);
    } else {
      setPhones([{ country: DEFAULT_COUNTRY.iso, number: "" }]);
    }
    setPhonePickerIdx(null);
    setShowOptionalSpecs(false);
    setPlans([]);
    setError(null);
    setCreatedId(undefined);
    setDone(false);
    AsyncStorage.removeItem(LISTING_DRAFT_KEY).catch(() => {});
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.secondary,
      color: colors.foreground,
      borderColor: colors.border,
      borderRadius: colors.radius,
      textAlign,
      writingDirection: writeDir,
    },
  ];

  const Header = (
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
      <Pressable
        onPress={handleHeaderBack}
        style={styles.iconBtn}
        hitSlop={12}
        testID="create-back"
      >
        <Feather
          name={isRTL ? "arrow-right" : "arrow-left"}
          size={22}
          color={colors.foreground}
        />
      </Pressable>
      <AppText style={[styles.headerTitle, { color: colors.foreground }]}>
        {t("create.title")}
      </AppText>
      <View style={styles.iconBtn} />
    </View>
  );

  const QuotaBanner =
    freeRemaining != null ? (
      <View
        style={[
          styles.quotaBanner,
          {
            backgroundColor: colors.card,
            borderColor: freeRemaining > 0 ? colors.border : colors.destructive,
            borderRadius: colors.radius,
            flexDirection: rowDir,
          },
        ]}
      >
        <Feather
          name="info"
          size={15}
          color={freeRemaining > 0 ? colors.primary : colors.destructive}
        />
        <AppText
          style={[styles.quotaBannerText, { color: colors.foreground, textAlign }]}
        >
          {freeRemaining > 0
            ? t("create.freeListingsLeft", { count: freeRemaining })
            : t("create.freeListingsUsed")}
        </AppText>
      </View>
    ) : null;

  if (isLoaded && !isSignedIn) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {Header}
        <View style={styles.stateWrap}>
          <MaterialIcon colors={colors} />
          <AppText style={[styles.stateTitle, { color: colors.foreground }]}>
            {t("create.signInRequired")}
          </AppText>
          <AppText style={[styles.stateText, { color: colors.mutedForeground }]}>
            {t("create.signInBody")}
          </AppText>
          <Pressable
            onPress={() => router.replace("/(tabs)/profile")}
            style={[
              styles.primaryBtn,
              { backgroundColor: colors.primary, borderRadius: colors.radius },
            ]}
            testID="create-go-profile"
          >
            <AppText
              style={[styles.primaryBtnText, { color: colors.primaryForeground }]}
            >
              {t("create.goToProfile")}
            </AppText>
          </Pressable>
        </View>
      </View>
    );
  }

  if (done) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {Header}
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.successHero}>
            <View
              style={[
                styles.successIcon,
                { backgroundColor: colors.primary + "1F", borderRadius: 999 },
              ]}
            >
              <Feather name="check" size={36} color={colors.primary} />
            </View>
            <AppText style={[styles.stateTitle, { color: colors.foreground }]}>
              {t("create.successTitle")}
            </AppText>
            <AppText style={[styles.stateText, { color: colors.mutedForeground }]}>
              {t("create.successBody")}
            </AppText>
          </View>

          {/* Post-publish performance tips */}
          <View
            style={[
              styles.tipsCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <AppText
              style={[styles.tipsTitle, { color: colors.foreground, textAlign }]}
            >
              {t("create.tipsTitle")}
            </AppText>
            {[t("create.tip1"), t("create.tip2"), t("create.tip3")].map(
              (tip, i) => (
                <View
                  key={`tip-${i}`}
                  style={[styles.tipRow, { flexDirection: rowDir }]}
                >
                  <Feather
                    name="check-circle"
                    size={16}
                    color={colors.primary}
                  />
                  <AppText
                    style={[styles.tipText, { color: colors.mutedForeground, textAlign }]}
                  >
                    {tip}
                  </AppText>
                </View>
              ),
            )}
          </View>

          {/* Pay-for-your-ad suggestion → plans/promotion surface */}
          <Pressable
            onPress={() => router.push("/plans")}
            style={[
              styles.boostCard,
              {
                backgroundColor: colors.primary + "14",
                borderColor: colors.primary + "33",
                borderRadius: colors.radius,
                flexDirection: rowDir,
              },
            ]}
            testID="create-boost"
          >
            <Feather name="trending-up" size={22} color={colors.primary} />
            <View style={styles.boostTextWrap}>
              <AppText
                style={[styles.boostTitle, { color: colors.foreground, textAlign }]}
              >
                {t("create.boostTitle")}
              </AppText>
              <AppText
                style={[styles.boostBody, { color: colors.mutedForeground, textAlign }]}
              >
                {t("create.boostBody")}
              </AppText>
            </View>
            <Feather
              name={isRTL ? "chevron-left" : "chevron-right"}
              size={18}
              color={colors.mutedForeground}
            />
          </Pressable>

          {!!createdId && (
            <Pressable
              onPress={() => router.replace(`/listing/${createdId}`)}
              style={[
                styles.primaryBtn,
                { backgroundColor: colors.primary, borderRadius: colors.radius },
              ]}
              testID="create-view-listing"
            >
              <AppText
                style={[styles.primaryBtnText, { color: colors.primaryForeground }]}
              >
                {t("create.viewListing")}
              </AppText>
            </Pressable>
          )}
          <Pressable onPress={resetForm} style={styles.linkBtn} testID="create-post-another">
            <AppText style={[styles.linkText, { color: colors.foreground }]}>
              {t("create.postAnother")}
            </AppText>
          </Pressable>
          <Pressable
            onPress={() => router.replace("/(tabs)")}
            style={styles.linkBtn}
            testID="create-done"
          >
            <AppText style={[styles.linkText, { color: colors.mutedForeground }]}>
              {t("create.done")}
            </AppText>
          </Pressable>
        </KeyboardAwareScrollViewCompat>
      </View>
    );
  }

  const renderCategory = () => (
    <>
      {QuotaBanner}
      <SectionLabel text={t("create.listingKind")} colors={colors} textAlign={textAlign} />
      <AppText style={[styles.hint, { color: colors.mutedForeground, textAlign }]}>
        {t("create.listingKindHint")}
      </AppText>
      <View style={[styles.optionRow, { flexDirection: rowDir }]}>
        {(
          [
            { value: false, labelKey: "create.kindSell" },
            { value: true, labelKey: "create.kindRequest" },
          ] as { value: boolean; labelKey: string }[]
        ).map((opt) => {
          const active = isRequest === opt.value;
          return (
            <Pressable
              key={opt.labelKey}
              onPress={() => {
                Haptics.selectionAsync();
                setIsRequest(opt.value);
                // A request has no price or payment plans — clear any stale
                // entries so they can never be submitted with the request.
                if (opt.value) {
                  setCashPrice("");
                  setPlans([]);
                }
                setError(null);
              }}
              style={[
                styles.optionChip,
                {
                  backgroundColor: active ? colors.primary : colors.card,
                  borderColor: active ? colors.primary : colors.border,
                  borderRadius: colors.radius,
                },
              ]}
              testID={`create-kind-${opt.value ? "request" : "sell"}`}
            >
              <AppText
                style={[
                  styles.optionChipText,
                  { color: active ? colors.primaryForeground : colors.foreground },
                ]}
              >
                {t(opt.labelKey)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <SectionLabel text={t("create.categoryLabel")} colors={colors} textAlign={textAlign} />
      <AppText style={[styles.hint, { color: colors.mutedForeground, textAlign }]}>
        {t("create.categoryHint")}
      </AppText>
      <View style={[styles.catRow, { flexDirection: rowDir }]}>
        {UI_CATEGORIES.map((c) => {
          const active = category === c.value;
          return (
            <Pressable
              key={c.value}
              onPress={() => {
                Haptics.selectionAsync();
                setCategory(c.value);
                setSpecs({});
                setCustomSpecs([]);
                setCarBrand(null);
                setCarModel(null);
                setIndustrialType(null);
                setError(null);
              }}
              style={[
                styles.catChip,
                {
                  backgroundColor: active ? colors.primary : colors.card,
                  borderColor: active ? colors.primary : colors.border,
                  borderRadius: colors.radius,
                },
              ]}
              testID={`create-category-${c.value}`}
            >
              <Feather
                name={c.icon}
                size={20}
                color={active ? colors.primaryForeground : colors.mutedForeground}
              />
              <AppText
                style={[
                  styles.catChipText,
                  { color: active ? colors.primaryForeground : colors.foreground },
                ]}
              >
                {t(c.labelKey)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </>
  );

  const renderSpecField = (field: (typeof specFields)[number]) => (
    <View key={field.key}>
      <FieldLabel
        label={t(field.labelKey)}
        tag={field.required ? t("create.required") : t("create.optional")}
        colors={colors}
        rowDir={rowDir}
      />
      {field.type === "select" && field.options ? (
        <View style={[styles.optionRow, { flexDirection: rowDir }]}>
          {field.options.map((opt) => {
            const active = specs[field.key] === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSpec(field.key, active ? "" : opt.value);
                  setError(null);
                }}
                style={[
                  styles.optionChip,
                  {
                    backgroundColor: active ? colors.primary : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
                testID={`create-spec-${field.key}-${opt.value}`}
              >
                <AppText
                  style={[
                    styles.optionChipText,
                    { color: active ? colors.primaryForeground : colors.foreground },
                  ]}
                >
                  {opt.labelKey
                    ? t(opt.labelKey)
                    : isRTL
                      ? opt.label?.ar
                      : opt.label?.en}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <TextInput
          value={specs[field.key] ?? ""}
          onChangeText={(v) => setSpec(field.key, v)}
          placeholder={field.placeholderKey ? t(field.placeholderKey) : ""}
          placeholderTextColor={colors.mutedForeground}
          keyboardType={field.type === "number" ? "numeric" : "default"}
          style={inputStyle}
          testID={`create-spec-${field.key}`}
        />
      )}
    </View>
  );

  const renderDetails = () => (
    <>
      <SectionLabel text={t("create.detailsLabel")} colors={colors} textAlign={textAlign} />
      <FieldLabel
        label={t("create.titleField")}
        tag={t("create.required")}
        colors={colors}
        rowDir={rowDir}
      />
      <TextInput
        value={title}
        onChangeText={(v) => {
          setTitle(v);
          setError(null);
        }}
        placeholder={t("create.titlePlaceholder")}
        placeholderTextColor={colors.mutedForeground}
        style={inputStyle}
        testID="create-title"
      />
      <FieldLabel
        label={t("create.descriptionField")}
        tag={isRequest ? t("create.required") : t("create.optional")}
        colors={colors}
        rowDir={rowDir}
      />
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder={
          isRequest
            ? t("create.requestDescriptionPlaceholder")
            : t("create.descriptionPlaceholder")
        }
        placeholderTextColor={colors.mutedForeground}
        style={[inputStyle, styles.textArea]}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        testID="create-description"
      />
      <FieldLabel
        label={t("create.locationField")}
        tag={t("create.required")}
        colors={colors}
        rowDir={rowDir}
      />
      <Pressable
        onPress={() => setLocationPickerOpen(true)}
        style={[...inputStyle, styles.pickerBtn, { flexDirection: rowDir }]}
        testID="create-location"
      >
        <AppText
          style={{
            color: location ? colors.foreground : colors.mutedForeground,
            textAlign,
            flex: 1,
            fontFamily: "Inter_400Regular",
            fontSize: 15,
          }}
        >
          {location || t("create.locationPlaceholder")}
        </AppText>
        <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
      </Pressable>

      {/* Optional precise GPS pin (#4) — never required to publish. */}
      <Pressable
        onPress={captureLocation}
        disabled={pinBusy}
        style={[...inputStyle, styles.pickerBtn, { flexDirection: rowDir, marginTop: 8 }]}
        testID="create-use-location"
      >
        <Feather
          name={pin ? "check-circle" : "map-pin"}
          size={18}
          color={pin ? "#16a34a" : colors.mutedForeground}
        />
        <AppText
          style={{
            color: pin ? colors.foreground : colors.mutedForeground,
            textAlign,
            flex: 1,
            fontFamily: "Inter_400Regular",
            fontSize: 14,
            marginHorizontal: 8,
          }}
        >
          {pinBusy
            ? t("create.locationCapturing")
            : pin
              ? t("create.locationCaptured")
              : t("create.useMyLocation")}
        </AppText>
      </Pressable>

      {category && !isRequest && (
        <>
          <SectionLabel
            text={t("create.specsLabel")}
            colors={colors}
            textAlign={textAlign}
          />
          {category === "car" && (
            <View>
              <FieldLabel
                label={t("create.fields.brandModel")}
                tag={t("create.required")}
                colors={colors}
                rowDir={rowDir}
              />
              <Pressable
                onPress={() => setCarPickerOpen(true)}
                style={[...inputStyle, styles.pickerBtn, { flexDirection: rowDir }]}
                testID="create-car-brand"
              >
                <AppText
                  style={{
                    color: carBrand ? colors.foreground : colors.mutedForeground,
                    textAlign,
                    flex: 1,
                    fontFamily: "Inter_400Regular",
                    fontSize: 15,
                  }}
                >
                  {carBrand
                    ? `${brandLabel(carBrand, isRTL)}${carModel ? " · " + carModel : ""}`
                    : t("create.fields.brandModelPh")}
                </AppText>
                <Feather
                  name="chevron-down"
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </View>
          )}
          {category === "car" && (
            <View>
              <FieldLabel
                label={t("create.fields.origin")}
                tag={t("create.optional")}
                colors={colors}
                rowDir={rowDir}
              />
              <View style={[styles.optionRow, { flexDirection: rowDir }]}>
                {(["local", "imported"] as const).map((value) => {
                  const active = carOrigin === value;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setCarOrigin(active ? null : value);
                        setError(null);
                      }}
                      style={[
                        styles.optionChip,
                        {
                          backgroundColor: active ? colors.primary : colors.card,
                          borderColor: active ? colors.primary : colors.border,
                          borderRadius: colors.radius,
                        },
                      ]}
                      testID={`create-origin-${value}`}
                    >
                      <AppText
                        style={[
                          styles.optionChipText,
                          {
                            color: active
                              ? colors.primaryForeground
                              : colors.foreground,
                          },
                        ]}
                      >
                        {value === "local"
                          ? t("create.opts.local")
                          : t("create.opts.imported")}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          {category === "industrial" && (
            <View>
              <FieldLabel
                label={t("create.industrialType")}
                tag={t("create.required")}
                colors={colors}
                rowDir={rowDir}
              />
              <View style={[styles.optionRow, { flexDirection: rowDir }]}>
                {INDUSTRIAL_TYPES.map((opt) => {
                  const active = industrialType === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setIndustrialType(active ? null : opt.value);
                        setError(null);
                      }}
                      style={[
                        styles.optionChip,
                        {
                          backgroundColor: active ? colors.primary : colors.card,
                          borderColor: active ? colors.primary : colors.border,
                          borderRadius: colors.radius,
                        },
                      ]}
                      testID={`create-industrial-type-${opt.value}`}
                    >
                      <AppText
                        style={[
                          styles.optionChipText,
                          {
                            color: active
                              ? colors.primaryForeground
                              : colors.foreground,
                          },
                        ]}
                      >
                        {t(opt.labelKey)}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          {requiredSpecFields.map(renderSpecField)}
          {optionalSpecFields.length > 0 && (
            <>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setShowOptionalSpecs((v) => !v);
                }}
                style={[
                  styles.moreToggle,
                  {
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    flexDirection: rowDir,
                  },
                ]}
                testID="create-toggle-optional-specs"
              >
                <Feather
                  name="sliders"
                  size={16}
                  color={colors.mutedForeground}
                />
                <AppText
                  style={[styles.moreToggleText, { color: colors.foreground }]}
                >
                  {t("create.moreDetails")}
                </AppText>
                <Feather
                  name={showOptionalSpecs ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
              {showOptionalSpecs && optionalSpecFields.map(renderSpecField)}
            </>
          )}

          {/* Free-form custom specs — UNLIMITED (philosophy: flexibility +
              save-everything). Any name/value the seller adds is stored as a
              real spec, displayed on the listing, and becomes searchable. */}
          <SectionLabel
            text={t("create.customSpecs.title")}
            colors={colors}
            textAlign={textAlign}
          />
          <AppText style={[styles.hint, { color: colors.mutedForeground, textAlign }]}>
            {t("create.customSpecs.hint")}
          </AppText>
          {customSpecs.map((cs, i) => (
            <View key={`cs-${i}`} style={[styles.customSpecRow, { flexDirection: rowDir }]}>
              <TextInput
                value={cs.name}
                onChangeText={(txt) =>
                  setCustomSpecs((prev) => prev.map((x, idx) => (idx === i ? { ...x, name: txt } : x)))
                }
                placeholder={t("create.customSpecs.namePlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.customSpecName,
                  { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius, textAlign },
                ]}
                testID={`custom-spec-name-${i}`}
              />
              <TextInput
                value={cs.value}
                onChangeText={(txt) =>
                  setCustomSpecs((prev) => prev.map((x, idx) => (idx === i ? { ...x, value: txt } : x)))
                }
                placeholder={t("create.customSpecs.valuePlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.customSpecValue,
                  { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border, borderRadius: colors.radius, textAlign },
                ]}
                testID={`custom-spec-value-${i}`}
              />
              <Pressable
                onPress={() => setCustomSpecs((prev) => prev.filter((_, idx) => idx !== i))}
                style={styles.customSpecRemove}
                hitSlop={8}
                testID={`custom-spec-remove-${i}`}
              >
                <Feather name="x" size={18} color={colors.destructive} />
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setCustomSpecs((prev) => [...prev, { name: "", value: "" }]);
            }}
            style={[styles.moreToggle, { borderColor: colors.border, borderRadius: colors.radius, flexDirection: rowDir }]}
            testID="create-add-custom-spec"
          >
            <Feather name="plus" size={16} color={colors.primary} />
            <AppText style={[styles.moreToggleText, { color: colors.primary }]}>
              {t("create.customSpecs.add")}
            </AppText>
          </Pressable>
        </>
      )}

      {/* Contact numbers */}
      <SectionLabel text={t("create.contactLabel")} colors={colors} textAlign={textAlign} />
      <AppText style={[styles.hint, { color: colors.mutedForeground, textAlign }]}>
        {t("create.contactHint")}
      </AppText>
      {phones.map((phone, i) => {
        const country = countryByIso(phone.country);
        return (
          <View key={`phone-${i}`} style={styles.phoneGroup}>
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
                testID={`create-phone-country-${i}`}
              >
                <AppText style={styles.dialFlag}>{country.flag}</AppText>
                <AppText style={[styles.dialCode, { color: colors.foreground }]}>
                  +{country.dial}
                </AppText>
                <Feather
                  name="chevron-down"
                  size={16}
                  color={colors.mutedForeground}
                />
              </Pressable>
              <TextInput
                value={phone.number}
                onChangeText={(v) => {
                  setPhoneNumberAt(i, v);
                  setError(null);
                }}
                placeholder={country.sample}
                placeholderTextColor={colors.mutedForeground}
                keyboardType="phone-pad"
                autoCorrect={false}
                style={[inputStyle, styles.phoneInput]}
                testID={`create-phone-${i}`}
              />
              {phones.length > 1 && (
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    removePhoneAt(i);
                  }}
                  style={[
                    styles.phoneRemove,
                    { borderColor: colors.border, borderRadius: colors.radius },
                  ]}
                  hitSlop={6}
                  testID={`create-remove-phone-${i}`}
                >
                  <Feather name="trash-2" size={18} color={colors.destructive} />
                </Pressable>
              )}
            </View>
            <AppText
              style={[styles.phoneHint, { color: colors.mutedForeground, textAlign }]}
            >
              {t("create.phoneFormatHint", { sample: country.sample })}
            </AppText>
          </View>
        );
      })}
      {phones.length < MAX_PHONES && (
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
          testID="create-add-phone"
        >
          <Feather name="plus" size={18} color={colors.primary} />
          <AppText style={[styles.addRowText, { color: colors.primary }]}>
            {t("create.addPhone")}
          </AppText>
        </Pressable>
      )}
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
          <AppText
            style={[styles.whatsappTitle, { color: colors.foreground, textAlign }]}
          >
            {t("create.whatsappTitle")}
          </AppText>
          <AppText
            style={[styles.whatsappHint, { color: colors.mutedForeground, textAlign }]}
          >
            {t("create.whatsappHint")}
          </AppText>
        </View>
        <Switch
          value={whatsappEnabled}
          onValueChange={(v) => {
            Haptics.selectionAsync();
            setWhatsappEnabled(v);
          }}
          trackColor={{ false: colors.border, true: "#25D366" }}
          thumbColor="#ffffff"
          testID="create-whatsapp-toggle"
        />
      </View>
    </>
  );

  // Per-tile upload status: a centered overlay while uploading/verifying, a
  // tappable retry on failure, and a small check badge once stored. Returns null
  // when the tile has no upload state yet.
  const renderUploadOverlay = (
    asset: ImagePicker.ImagePickerAsset,
    index: number,
  ) => {
    const st = uploadState[asset.uri];
    if (!st) return null;
    if (st.status === "uploaded") {
      return (
        <View
          style={[styles.uploadDoneBadge, { backgroundColor: colors.primary }]}
        >
          <Feather name="check" size={11} color={colors.primaryForeground} />
        </View>
      );
    }
    if (st.status === "failed") {
      return (
        <Pressable
          onPress={() => startUpload(asset)}
          style={[styles.uploadOverlay, { borderRadius: colors.radius }]}
          testID={`create-retry-${index}`}
        >
          <Feather name="rotate-ccw" size={20} color="#FFFFFF" />
          <AppText style={styles.uploadOverlayText}>{t("create.retry")}</AppText>
        </Pressable>
      );
    }
    return (
      <View
        style={[styles.uploadOverlay, { borderRadius: colors.radius }]}
        pointerEvents="none"
      >
        <ActivityIndicator size="small" color="#FFFFFF" />
        <AppText style={styles.uploadOverlayText}>
          {st.status === "verifying"
            ? t("create.verifying")
            : `${Math.round((st.progress ?? 0) * 100)}%`}
        </AppText>
      </View>
    );
  };

  const renderMedia = () => {
    const imageCount = photos.filter((p) => !isVideoAsset(p)).length;
    const videoCount = photos.length - imageCount;
    const firstImageIndex = photos.findIndex((p) => !isVideoAsset(p));
    return (
    <>
      <SectionLabel text={t("create.photos")} colors={colors} textAlign={textAlign} />
      <AppText style={[styles.hint, { color: colors.mutedForeground, textAlign }]}>
        {isRequest ? t("create.photosOptionalHint") : t("create.photosHint")}
      </AppText>
      <View style={[styles.photoCountRow, { flexDirection: rowDir }]}>
        <AppText style={[styles.photosCount, { color: colors.foreground }]}>
          {videoCount > 0
            ? t("create.mediaCount", {
                count: imageCount,
                max: MAX_PHOTOS,
                videos: videoCount,
              })
            : t("create.photosCount", { count: imageCount, max: MAX_PHOTOS })}
        </AppText>
        {!isRequest && imageCount < MIN_PHOTOS ? (
          <AppText style={[styles.minPhotos, { color: colors.destructive }]}>
            {t("create.minPhotos", { count: MIN_PHOTOS })}
          </AppText>
        ) : null}
      </View>
      <View style={[styles.photoRow, { flexDirection: rowDir }]}>
        {photos.map((p, i) => {
          const isVid = isVideoAsset(p);
          return (
          <View key={p.uri} style={styles.photoWrap}>
            {isVid ? (
              <View
                style={[
                  styles.photo,
                  styles.videoTile,
                  { backgroundColor: colors.muted, borderRadius: colors.radius },
                ]}
              >
                <Ionicons name="play-circle" size={30} color={colors.foreground} />
              </View>
            ) : (
              <Image
                source={{ uri: cropResults[p.uri]?.uri ?? p.uri }}
                style={[styles.photo, { borderRadius: colors.radius }]}
                contentFit="cover"
              />
            )}
            {renderUploadOverlay(p, i)}
            {!isVid && (
              <Pressable
                onPress={() => setEditAsset(p)}
                style={[styles.editCropBtn, { flexDirection: rowDir }]}
                hitSlop={6}
                testID={`create-edit-crop-${i}`}
              >
                <Feather name="edit-2" size={12} color="#FFFFFF" />
                <AppText style={styles.editCropText}>
                  {t("create.editCrop")}
                </AppText>
              </Pressable>
            )}
            {i === firstImageIndex && (
              <View
                style={[
                  styles.coverBadge,
                  { backgroundColor: colors.primary, borderRadius: 6 },
                ]}
              >
                <AppText style={[styles.coverText, { color: colors.primaryForeground }]}>
                  {t("create.cover")}
                </AppText>
              </View>
            )}
            {isVid && (
              <View
                style={[
                  styles.videoBadge,
                  { backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 6 },
                ]}
              >
                <AppText style={[styles.coverText, { color: "#FFFFFF" }]}>
                  {t("create.video")}
                </AppText>
              </View>
            )}
            <Pressable
              onPress={() => removePhoto(p.uri)}
              style={styles.photoRemove}
              hitSlop={8}
              testID={`create-remove-photo-${i}`}
            >
              <Ionicons name="close-circle" size={22} color="#FFFFFF" />
            </Pressable>
            {photos.length > 1 && (
              <View style={[styles.reorderRow, { flexDirection: rowDir }]}>
                <Pressable
                  onPress={() => moveMedia(i, -1)}
                  disabled={i === 0}
                  hitSlop={6}
                  accessibilityLabel={t("create.moveMediaBack")}
                  style={[
                    styles.reorderBtn,
                    { backgroundColor: colors.muted, opacity: i === 0 ? 0.35 : 1 },
                  ]}
                  testID={`create-move-back-${i}`}
                >
                  <Ionicons
                    name={isRTL ? "chevron-forward" : "chevron-back"}
                    size={15}
                    color={colors.foreground}
                  />
                </Pressable>
                <Pressable
                  onPress={() => moveMedia(i, 1)}
                  disabled={i === photos.length - 1}
                  hitSlop={6}
                  accessibilityLabel={t("create.moveMediaForward")}
                  style={[
                    styles.reorderBtn,
                    {
                      backgroundColor: colors.muted,
                      opacity: i === photos.length - 1 ? 0.35 : 1,
                    },
                  ]}
                  testID={`create-move-forward-${i}`}
                >
                  <Ionicons
                    name={isRTL ? "chevron-back" : "chevron-forward"}
                    size={15}
                    color={colors.foreground}
                  />
                </Pressable>
              </View>
            )}
            <TextInput
              value={captions[p.uri] ?? ""}
              onChangeText={(v) =>
                setCaptions((prev) => ({ ...prev, [p.uri]: v }))
              }
              placeholder={t("create.captionPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.captionInput,
                { color: colors.foreground, borderColor: colors.border, textAlign },
              ]}
              maxLength={80}
              testID={`create-caption-${i}`}
            />
          </View>
          );
        })}
        {photos.length < MAX_MEDIA && (
          <Pressable
            onPress={openPhotoSource}
            style={[
              styles.addPhoto,
              { borderColor: colors.border, borderRadius: colors.radius },
            ]}
            testID="create-add-photo"
          >
            <Feather name="plus" size={24} color={colors.mutedForeground} />
            <AppText style={[styles.addPhotoText, { color: colors.mutedForeground }]}>
              {t("create.addPhoto")}
            </AppText>
          </Pressable>
        )}
        {videoCount < MAX_VIDEOS && photos.length < MAX_MEDIA && (
          <Pressable
            onPress={launchVideoTrimPicker}
            style={[
              styles.addPhoto,
              { borderColor: colors.border, borderRadius: colors.radius },
            ]}
            testID="create-add-video"
          >
            <Feather name="video" size={22} color={colors.mutedForeground} />
            <AppText style={[styles.addPhotoText, { color: colors.mutedForeground }]}>
              {t("create.addVideo")}
            </AppText>
          </Pressable>
        )}
      </View>
      {imageCount < MAX_PHOTOS ? (
        <View
          style={[
            styles.boostHintRow,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
              flexDirection: rowDir,
            },
          ]}
        >
          <Feather name="zap" size={15} color={colors.primary} />
          <AppText style={[styles.boostHintText, { color: colors.mutedForeground, textAlign }]}>
            {t("create.boostHint")}
          </AppText>
        </View>
      ) : null}
    </>
    );
  };

  const renderPrice = () => {
    // Request/wanted mode: no sale price, no payment plans. Show an honest note
    // that the listing will display "طلب سعر / Price requested" once published.
    if (isRequest) {
      return (
        <>
          <SectionLabel text={t("create.pricingLabel")} colors={colors} textAlign={textAlign} />
          <View
            style={[
              styles.planCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <AppText
              style={[styles.hint, { color: colors.mutedForeground, textAlign, marginBottom: 0 }]}
            >
              {t("create.requestPriceNote")}
            </AppText>
          </View>
        </>
      );
    }
    return (
    <>
      <SectionLabel text={t("create.pricingLabel")} colors={colors} textAlign={textAlign} />
      <FieldLabel
        label={t("create.cashPrice")}
        tag={t("create.required")}
        colors={colors}
        rowDir={rowDir}
      />
      <TextInput
        value={cashPrice}
        onChangeText={(v) => {
          setCashPrice(v);
          setError(null);
        }}
        placeholder={t("create.cashPricePlaceholder")}
        placeholderTextColor={colors.mutedForeground}
        keyboardType="numeric"
        style={inputStyle}
        testID="create-cash-price"
      />

      <SectionLabel text={t("create.paymentPlansLabel")} colors={colors} textAlign={textAlign} />
      <AppText style={[styles.hint, { color: colors.mutedForeground, textAlign }]}>
        {t("create.paymentPlansHint")}
      </AppText>

      {plans.map((plan, i) => (
        <View
          key={`plan-${i}`}
          style={[
            styles.planCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          <View style={[styles.planHeader, { flexDirection: rowDir }]}>
            <AppText style={[styles.planTitle, { color: colors.foreground }]}>
              {t("create.planLabel", { n: i + 1 })}
            </AppText>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                removePlan(i);
              }}
              style={styles.planRemove}
              hitSlop={8}
              testID={`create-remove-plan-${i}`}
            >
              <Feather name="trash-2" size={18} color={colors.destructive} />
            </Pressable>
          </View>

          <FieldLabel label={t("create.planType")} colors={colors} rowDir={rowDir} />
          <View style={[styles.optionRow, { flexDirection: rowDir }]}>
            {(
              [
                { value: "seller_installment", labelKey: "create.sellerInstallment" },
                { value: "bank_finance", labelKey: "create.bankFinance" },
              ] as { value: InstallmentMode; labelKey: string }[]
            ).map((opt) => {
              const active = plan.mode === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    Haptics.selectionAsync();
                    updatePlan(i, { mode: opt.value });
                  }}
                  style={[
                    styles.optionChip,
                    {
                      backgroundColor: active ? colors.primary : colors.secondary,
                      borderColor: active ? colors.primary : colors.border,
                      borderRadius: colors.radius,
                    },
                  ]}
                  testID={`create-plan-${i}-mode-${opt.value}`}
                >
                  <AppText
                    style={[
                      styles.optionChipText,
                      { color: active ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {t(opt.labelKey)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <FieldLabel label={t("create.compliance")} colors={colors} rowDir={rowDir} />
          <View style={[styles.optionRow, { flexDirection: rowDir }]}>
            {(
              [
                { value: true, labelKey: "create.islamic" },
                { value: false, labelKey: "create.conventional" },
              ] as { value: boolean; labelKey: string }[]
            ).map((opt) => {
              const active = plan.isIslamic === opt.value;
              return (
                <Pressable
                  key={String(opt.value)}
                  onPress={() => {
                    Haptics.selectionAsync();
                    updatePlan(i, { isIslamic: opt.value });
                  }}
                  style={[
                    styles.optionChip,
                    {
                      backgroundColor: active ? colors.primary : colors.secondary,
                      borderColor: active ? colors.primary : colors.border,
                      borderRadius: colors.radius,
                    },
                  ]}
                  testID={`create-plan-${i}-islamic-${String(opt.value)}`}
                >
                  <AppText
                    style={[
                      styles.optionChipText,
                      { color: active ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {t(opt.labelKey)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <FieldLabel label={t("create.downPayment")} colors={colors} rowDir={rowDir} />
          <TextInput
            value={plan.downPayment}
            onChangeText={(v) => updatePlan(i, { downPayment: v })}
            placeholder="0"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="numeric"
            style={inputStyle}
            testID={`create-plan-${i}-down`}
          />
          <FieldLabel
            label={t("create.monthlyPayment")}
            tag={t("create.required")}
            colors={colors}
            rowDir={rowDir}
          />
          <TextInput
            value={plan.monthlyPayment}
            onChangeText={(v) => updatePlan(i, { monthlyPayment: v })}
            placeholder="0"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="numeric"
            style={inputStyle}
            testID={`create-plan-${i}-monthly`}
          />
          <FieldLabel
            label={t("create.duration")}
            tag={t("create.required")}
            colors={colors}
            rowDir={rowDir}
          />
          <TextInput
            value={plan.durationMonths}
            onChangeText={(v) => updatePlan(i, { durationMonths: v })}
            placeholder="0"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="numeric"
            style={inputStyle}
            testID={`create-plan-${i}-duration`}
          />
        </View>
      ))}

      <Pressable
        onPress={addPlan}
        style={[
          styles.addRowBtn,
          {
            borderColor: colors.border,
            borderRadius: colors.radius,
            flexDirection: rowDir,
          },
        ]}
        testID="create-add-plan"
      >
        <Feather name="plus" size={18} color={colors.primary} />
        <AppText style={[styles.addRowText, { color: colors.primary }]}>
          {t("create.addPlan")}
        </AppText>
      </Pressable>

      <AppText style={[styles.cashNote, { color: colors.mutedForeground, textAlign }]}>
        {t("create.cashNote")}
      </AppText>
    </>
    );
  };

  const renderPreview = () => (
    <>
      <SectionLabel text={t("create.steps.preview")} colors={colors} textAlign={textAlign} />
      <AppText style={[styles.previewCaption, { color: colors.mutedForeground, textAlign }]}>
        {t("create.previewCaption")}
      </AppText>
      <View style={styles.previewWrap}>
        {/* Preview is a non-interactive mirror of the live card — block taps so
            it reads as a preview, not a navigable listing. */}
        <View style={styles.previewCard} pointerEvents="none">
          {previewItem ? <SmartAssetCard item={previewItem} /> : null}
        </View>
      </View>
      {QuotaBanner}
      <AppText style={[styles.disclaimer, { color: colors.mutedForeground, textAlign }]}>
        {t("listing.disclaimer")}
      </AppText>
    </>
  );

  const renderStep = () => {
    switch (step) {
      case 0:
        return renderCategory();
      case 1:
        return renderDetails();
      case 2:
        return renderMedia();
      case 3:
        return renderPrice();
      case 4:
        return renderPreview();
      default:
        return null;
    }
  };

  const isLastStep = step === TOTAL_STEPS - 1;
  // The publish button stays pressable (never a silently-dead grey button):
  // handleSubmit re-validates every step and surfaces the EXACT reason it can't
  // publish yet — photos still uploading, missing photo, quota reached, etc. —
  // so the seller always gets actionable feedback instead of a frozen button.
  // Only an in-flight submit disables it (prevents a double-publish).
  const publishDisabled = submitting;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {Header}

      {/* Wizard progress */}
      <View style={styles.progressWrap}>
        <View style={[styles.progressTrack, { backgroundColor: colors.secondary }]}>
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: colors.primary,
                width: `${((step + 1) / TOTAL_STEPS) * 100}%`,
              },
            ]}
          />
        </View>
        <AppText style={[styles.progressLabel, { color: colors.mutedForeground, textAlign }]}>
          {t("create.stepOf", { current: step + 1, total: TOTAL_STEPS })}
          {"  ·  "}
          {t(`create.steps.${STEP_KEYS[step]}`)}
        </AppText>
      </View>

      <KeyboardAwareScrollViewCompat
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {renderStep()}

        {!!error && (
          <View
            style={[
              styles.errorBox,
              {
                backgroundColor: colors.destructive + "1A",
                borderColor: colors.destructive,
                borderRadius: colors.radius,
                flexDirection: rowDir,
              },
            ]}
          >
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <AppText style={[styles.errorText, { color: colors.destructive, textAlign }]}>
              {error}
            </AppText>
          </View>
        )}
      </KeyboardAwareScrollViewCompat>

      {/* Footer navigation */}
      <View
        style={[
          styles.footer,
          {
            flexDirection: rowDir,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
            paddingBottom: (Platform.OS === "web" ? 12 : insets.bottom) + 10,
          },
        ]}
      >
        <Pressable
          onPress={goBack}
          style={[
            styles.footerBackBtn,
            { borderColor: colors.border, borderRadius: colors.radius },
          ]}
          testID="create-prev"
        >
          <AppText style={[styles.footerBackText, { color: colors.foreground }]}>
            {t("create.back")}
          </AppText>
        </Pressable>

        {isLastStep ? (
          <Pressable
            onPress={handleSubmit}
            disabled={publishDisabled}
            style={[
              styles.footerNextBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: publishDisabled ? 0.6 : 1,
                flexDirection: rowDir,
              },
            ]}
            testID="create-submit"
          >
            {submitting ? (
              <>
                <ActivityIndicator size="small" color={colors.primaryForeground} />
                <AppText style={[styles.footerNextText, { color: colors.primaryForeground }]}>
                  {phase === "uploading" ? t("create.uploading") : t("create.publishing")}
                </AppText>
              </>
            ) : (
              <>
                <Feather name="upload-cloud" size={18} color={colors.primaryForeground} />
                <AppText style={[styles.footerNextText, { color: colors.primaryForeground }]}>
                  {t("create.publish")}
                </AppText>
              </>
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={goNext}
            style={[
              styles.footerNextBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                flexDirection: rowDir,
              },
            ]}
            testID="create-next"
          >
            <AppText style={[styles.footerNextText, { color: colors.primaryForeground }]}>
              {t("create.next")}
            </AppText>
            <Feather
              name={isRTL ? "arrow-left" : "arrow-right"}
              size={18}
              color={colors.primaryForeground}
            />
          </Pressable>
        )}
      </View>

      <PermissionRationaleModal
        visible={showPhotoRationale}
        config={{
          icon: "images-outline",
          title: t("create.photoPermTitle"),
          message: t("create.photoPermBody"),
          bullets: [t("create.photoPermBullet1"), t("create.photoPermBullet2")],
          confirmLabel: t("create.photoPermConfirm"),
        }}
        onAcknowledge={launchPicker}
        onCancel={() => setShowPhotoRationale(false)}
      />

      <LocationPicker
        visible={locationPickerOpen}
        selectedValue={locationValue ?? undefined}
        onClose={() => setLocationPickerOpen(false)}
        onSelect={(value, label) => {
          setLocationValue(value);
          setLocation(label);
          setLocationPickerOpen(false);
          setError(null);
        }}
        onClear={() => {
          setLocationValue(null);
          setLocation("");
          setLocationPickerOpen(false);
        }}
      />

      <CarPicker
        visible={carPickerOpen}
        mode="create"
        selectedBrand={carBrand?.value}
        selectedModel={carModel ?? undefined}
        onClose={() => setCarPickerOpen(false)}
        onSelect={(brand, model) => {
          setCarBrand(brand);
          setCarModel(model);
          setCarPickerOpen(false);
          setError(null);
        }}
        onClear={() => {
          setCarBrand(null);
          setCarModel(null);
          setCarPickerOpen(false);
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
          setError(null);
        }}
      />

      <ImageCropModal
        uri={cropAsset?.uri ?? null}
        sourceWidth={cropAsset?.width ?? 0}
        sourceHeight={cropAsset?.height ?? 0}
        onCancel={handleCropCancel}
        onConfirm={handleCropConfirm}
      />
    </View>
  );
}

type Colors = ReturnType<typeof useColors>;

function MaterialIcon({ colors }: { colors: Colors }) {
  return (
    <View
      style={[
        styles.successIcon,
        { backgroundColor: colors.muted, borderRadius: 999 },
      ]}
    >
      <Feather name="lock" size={32} color={colors.mutedForeground} />
    </View>
  );
}

function SectionLabel({
  text,
  colors,
  textAlign,
}: {
  text: string;
  colors: Colors;
  textAlign: "left" | "right";
}) {
  return (
    <AppText style={[styles.sectionLabel, { color: colors.foreground, textAlign }]}>
      {text}
    </AppText>
  );
}

function FieldLabel({
  label,
  tag,
  colors,
  rowDir,
}: {
  label: string;
  tag?: string;
  colors: Colors;
  rowDir: "row" | "row-reverse";
}) {
  return (
    <View style={[styles.fieldLabelRow, { flexDirection: rowDir }]}>
      <AppText style={[styles.fieldLabel, { color: colors.foreground }]}>
        {label}
      </AppText>
      {!!tag && (
        <AppText style={[styles.fieldTag, { color: colors.mutedForeground }]}>
          {tag}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  progressWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  progressTrack: { height: 4, borderRadius: 999, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 999 },
  progressLabel: { fontSize: 12.5, fontFamily: "Inter_500Medium" },
  sectionLabel: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    marginTop: 22,
    marginBottom: 4,
  },
  hint: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 },
  quotaBanner: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    marginTop: 16,
    marginBottom: 4,
  },
  quotaBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  catRow: { gap: 10, flexWrap: "wrap" },
  catChip: {
    flexGrow: 1,
    flexBasis: "46%",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 18,
    borderWidth: 1,
  },
  catChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  photoCountRow: {
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 8,
  },
  photosCount: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  minPhotos: { fontSize: 12.5, fontFamily: "Inter_500Medium" },
  photoRow: { flexWrap: "wrap", gap: 10, alignItems: "flex-start" },
  photoWrap: { width: 96 },
  photo: { width: 96, height: 96 },
  reorderRow: { marginTop: 6, gap: 6, justifyContent: "center" },
  reorderBtn: {
    width: 30,
    height: 26,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  captionInput: {
    width: 96,
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 11,
  },
  videoTile: { alignItems: "center", justifyContent: "center" },
  videoBadge: {
    position: "absolute",
    top: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  coverBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  coverText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  photoRemove: {
    position: "absolute",
    top: -8,
    right: -8,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 999,
  },
  uploadOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 96,
    height: 96,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  uploadOverlayText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
  uploadDoneBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  editCropBtn: {
    position: "absolute",
    bottom: 4,
    left: 4,
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  editCropText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
  addPhoto: {
    width: 96,
    height: 96,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  addPhotoText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  boostHintRow: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    marginTop: 14,
  },
  boostHintText: { flex: 1, fontSize: 12.5, fontFamily: "Inter_400Regular", lineHeight: 18 },
  fieldLabelRow: {
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
    marginBottom: 6,
  },
  fieldLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fieldTag: { fontSize: 12, fontFamily: "Inter_400Regular" },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  textArea: { height: 110, paddingTop: 12 },
  pickerBtn: { alignItems: "center", justifyContent: "space-between" },
  optionRow: { flexWrap: "wrap", gap: 8 },
  optionChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
  },
  optionChipText: { fontSize: 13.5, fontFamily: "Inter_500Medium" },
  phoneGroup: { marginBottom: 10 },
  phoneRow: { alignItems: "center", gap: 8 },
  phoneInput: { flex: 1, marginBottom: 0 },
  dialBtn: {
    alignItems: "center",
    gap: 6,
    height: 48,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  dialFlag: { fontSize: 18 },
  dialCode: { fontSize: 14.5, fontFamily: "Inter_600SemiBold" },
  phoneHint: { fontSize: 11.5, fontFamily: "Inter_400Regular", marginTop: 4 },
  moreToggle: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    marginTop: 4,
    marginBottom: 4,
  },
  moreToggleText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  customSpecRow: { alignItems: "center", gap: 8, marginBottom: 8 },
  customSpecName: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  customSpecValue: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  customSpecRemove: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  phoneRemove: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  addRowBtn: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    marginTop: 4,
  },
  addRowText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  whatsappRow: {
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: 1,
    marginTop: 12,
  },
  whatsappTextWrap: { flex: 1 },
  whatsappTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  whatsappHint: {
    fontSize: 11.5,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
    lineHeight: 16,
  },
  planCard: {
    padding: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  planHeader: {
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  planTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  planRemove: { padding: 4 },
  cashNote: {
    fontSize: 12.5,
    fontFamily: "Inter_400Regular",
    marginTop: 10,
  },
  previewCaption: {
    fontSize: 12.5,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    marginBottom: 8,
  },
  previewWrap: { alignItems: "center", marginTop: 4 },
  previewCard: { width: "100%", maxWidth: 340 },
  errorBox: {
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderWidth: 1,
    marginTop: 18,
  },
  errorText: { flex: 1, fontSize: 13.5, fontFamily: "Inter_500Medium" },
  disclaimer: {
    fontSize: 11.5,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
    marginTop: 20,
  },
  footer: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  footerBackBtn: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  footerBackText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  footerNextBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
  },
  footerNextText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  stateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 10,
  },
  successHero: { alignItems: "center", gap: 8, marginTop: 16 },
  successIcon: {
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  stateTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginTop: 4,
  },
  stateText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 21,
  },
  tipsCard: {
    padding: 16,
    borderWidth: 1,
    marginTop: 24,
    gap: 10,
  },
  tipsTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  tipRow: { alignItems: "flex-start", gap: 8 },
  tipText: { flex: 1, fontSize: 13.5, fontFamily: "Inter_400Regular", lineHeight: 20 },
  boostCard: {
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderWidth: 1,
    marginTop: 14,
  },
  boostTextWrap: { flex: 1, gap: 2 },
  boostTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  boostBody: { fontSize: 12.5, fontFamily: "Inter_400Regular", lineHeight: 18 },
  primaryBtn: {
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 15,
    marginTop: 18,
  },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  linkBtn: { paddingVertical: 10, alignItems: "center" },
  linkText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
