import { Feather, Ionicons } from "@/components/icons";
import { AppText } from "@/components/AppText";
import {
  ImageCropModal,
  type CropModalResult,
} from "@/components/ImageCropModal";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
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
import {
  buildResolvedMedia,
  isUploadAbortError,
  isVideoAsset,
  uploadErrorMessageKey,
  uploadResolvedMedia,
  verifyUploadWithRetry,
} from "@/lib/upload";
import type {
  MediaItem,
  UpdateListingBodyMediaItem,
} from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

type UploadTileState =
  | { status: "uploading"; progress: number }
  | {
      status: "verifying";
      progress: number;
      url: string;
      type: "image" | "video";
    }
  | { status: "uploaded"; progress: 1; url: string; type: "image" | "video" }
  | { status: "failed"; progress: 0; error: string };

type CropResult = {
  uri: string;
  width: number;
  height: number;
  contentType: string;
};

export type ListingMediaEditorHandle = {
  hasPendingUploads(): boolean;
  /** Returns null when validation fails (caller shows error). */
  buildMediaPayload(): UpdateListingBodyMediaItem[] | null;
};

type ListingMediaEditorProps = {
  initialMedia?: MediaItem[];
  isRequest?: boolean;
  testIdPrefix?: string;
};

function remoteAsset(m: MediaItem): ImagePicker.ImagePickerAsset {
  return {
    uri: m.url,
    width: 800,
    height: 600,
    type: m.type === "video" ? "video" : "image",
    mimeType: m.type === "video" ? "video/mp4" : "image/jpeg",
  };
}

function initialUploadState(media: MediaItem[]): Record<string, UploadTileState> {
  const out: Record<string, UploadTileState> = {};
  for (const m of media) {
    out[m.url] = {
      status: "uploaded",
      progress: 1,
      url: m.url,
      type: m.type,
    };
  }
  return out;
}

export const ListingMediaEditor = forwardRef<
  ListingMediaEditorHandle,
  ListingMediaEditorProps
>(function ListingMediaEditor(
  { initialMedia = [], isRequest = false, testIdPrefix = "edit" },
  ref,
) {
  const colors = useColors();
  const { t, isRTL } = useI18n();
  const rowDir = isRTL ? "row-reverse" : "row";
  const textAlign = isRTL ? "right" : "left";

  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>(() =>
    initialMedia.map(remoteAsset),
  );
  const [uploadState, setUploadState] = useState<Record<string, UploadTileState>>(
    () => initialUploadState(initialMedia),
  );
  const [cropQueue, setCropQueue] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [editAsset, setEditAsset] = useState<ImagePicker.ImagePickerAsset | null>(
    null,
  );
  const [cropResults, setCropResults] = useState<Record<string, CropResult>>({});
  const cropResultsRef = useRef<Record<string, CropResult>>({});
  const controllers = useRef<Record<string, AbortController>>({});
  const [hydratedKey, setHydratedKey] = useState("");

  useEffect(() => {
    const key = initialMedia.map((m) => m.url).join("|");
    if (!key || key === hydratedKey) return;
    setPhotos(initialMedia.map(remoteAsset));
    setUploadState(initialUploadState(initialMedia));
    setHydratedKey(key);
  }, [initialMedia, hydratedKey]);

  const cropAsset = editAsset ?? cropQueue[0] ?? null;

  const verifyWithRetry = (url: string, signal: AbortSignal) =>
    verifyUploadWithRetry(url, { signal });

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
            setUploadState((s) => ({
              ...s,
              [uri]: { status: "uploading", progress: f },
            })),
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
          [uri]: {
            status: "failed",
            progress: 0,
            error: t(uploadErrorMessageKey(e)),
          },
        }));
      } finally {
        if (controllers.current[uri] === controller) {
          delete controllers.current[uri];
        }
      }
    })();
  };

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

  const handleCropCancel = () => {
    const asset = cropAsset;
    if (!asset) return;
    if (editAsset) {
      setEditAsset(null);
      return;
    }
    removePhoto(asset.uri);
  };

  const removePhoto = (uri: string) => {
    controllers.current[uri]?.abort();
    delete controllers.current[uri];
    setPhotos((prev) => prev.filter((p) => p.uri !== uri));
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
    delete cropResultsRef.current[uri];
    setCropQueue((q) => q.filter((a) => a.uri !== uri));
    if (editAsset?.uri === uri) setEditAsset(null);
  };

  const moveMedia = (index: number, dir: -1 | 1) => {
    setPhotos((prev) => moveMediaItem(prev, index, dir));
  };

  const requestLibraryPermission = async (): Promise<boolean> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.granted) return true;
    if (Platform.OS !== "web" && !perm.canAskAgain) {
      Alert.alert(t("create.libraryDeniedTitle"), t("create.libraryDeniedBody"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("create.openSettings"),
          onPress: () => Linking.openSettings().catch(() => {}),
        },
      ]);
    }
    return false;
  };

  const launchPicker = async () => {
    try {
      if (!(await requestLibraryPermission())) return;
      const remaining = MAX_MEDIA - photos.length;
      if (remaining <= 0) return;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, remaining),
        quality: 0.7,
      });
      if (result.canceled) return;
      const { accepted, rejectedLong, rejectedBig } = partitionPickedAssets(
        result.assets,
      );
      const next = capMedia([...photos, ...accepted]);
      const added = next.filter((p) => !photos.some((prev) => prev.uri === p.uri));
      setPhotos(next);
      handleAddedAssets(added);
      if (rejectedLong) {
        Alert.alert(
          t("common.error"),
          t("create.errVideoTooLong", { seconds: MAX_VIDEO_SECONDS }),
        );
      } else if (rejectedBig) {
        Alert.alert(
          t("common.error"),
          t("create.errVideoTooLarge", { mb: MAX_VIDEO_MB }),
        );
      }
    } catch {
      Alert.alert(t("common.error"), t("create.errUpload"));
    }
  };

  const launchVideoTrimPicker = async () => {
    try {
      if (!(await requestLibraryPermission())) return;
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
      const added = next.filter((p) => !photos.some((prev) => prev.uri === p.uri));
      setPhotos(next);
      handleAddedAssets(added);
      if (rejectedLong) {
        Alert.alert(
          t("common.error"),
          t("create.errVideoTooLong", { seconds: MAX_VIDEO_SECONDS }),
        );
      } else if (rejectedBig) {
        Alert.alert(
          t("common.error"),
          t("create.errVideoTooLarge", { mb: MAX_VIDEO_MB }),
        );
      }
    } catch {
      Alert.alert(t("common.error"), t("create.errUpload"));
    }
  };

  const openPhotoSource = () => {
    if (photos.length >= MAX_MEDIA) return;
    if (Platform.OS === "web") {
      void launchPicker();
      return;
    }
    Alert.alert(t("create.photoSource"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("create.chooseFromLibrary"), onPress: () => void launchPicker() },
    ]);
  };

  useImperativeHandle(ref, () => ({
    hasPendingUploads(): boolean {
      return photos.some((p) => uploadState[p.uri]?.status !== "uploaded");
    },
    buildMediaPayload(): UpdateListingBodyMediaItem[] | null {
      if (photos.some((p) => uploadState[p.uri]?.status !== "uploaded")) {
        return null;
      }
      const firstImageIdx = photos.findIndex((p) => !isVideoAsset(p));
      if (!isRequest && firstImageIdx === -1) {
        return null;
      }
      if (photos.length === 0) {
        return [];
      }
      const media: UpdateListingBodyMediaItem[] = [];
      photos.forEach((p, i) => {
        const entry = uploadState[p.uri];
        if (!entry || entry.status !== "uploaded") return;
        media.push({
          type: entry.type,
          url: entry.url,
          is_thumbnail: i === firstImageIdx,
        });
      });
      return media;
    },
  }));

  const imageCount = photos.filter((p) => !isVideoAsset(p)).length;
  const videoCount = photos.length - imageCount;
  const firstImageIndex = photos.findIndex((p) => !isVideoAsset(p));

  const renderUploadOverlay = (p: ImagePicker.ImagePickerAsset) => {
    const st = uploadState[p.uri];
    if (!st || st.status === "uploaded") return null;
    if (st.status === "failed") {
      return (
        <Pressable
          onPress={() => startUpload(p)}
          style={[styles.uploadOverlay, { borderRadius: colors.radius }]}
        >
          <Feather name="refresh-cw" size={18} color="#FFFFFF" />
          <AppText style={styles.uploadOverlayText}>{st.error}</AppText>
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

  return (
    <View style={{ gap: 8 }}>
      <AppText style={{ color: colors.foreground, fontWeight: "600", textAlign }}>
        {t("create.photos")}
      </AppText>
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
          const previewUri = cropResults[p.uri]?.uri ?? p.uri;
          return (
            <View key={`${testIdPrefix}-media-${p.uri}`} style={styles.photoWrap}>
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
                  source={{ uri: previewUri }}
                  style={[styles.photo, { borderRadius: colors.radius }]}
                  contentFit="cover"
                />
              )}
              {renderUploadOverlay(p)}
              {!isVid ? (
                <Pressable
                  onPress={() => setEditAsset(p)}
                  style={[styles.editCropBtn, { flexDirection: rowDir }]}
                  hitSlop={6}
                  testID={`${testIdPrefix}-edit-crop-${i}`}
                >
                  <Feather name="edit-2" size={12} color="#FFFFFF" />
                  <AppText style={styles.editCropText}>{t("create.editCrop")}</AppText>
                </Pressable>
              ) : null}
              {i === firstImageIndex ? (
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
              ) : null}
              <Pressable
                onPress={() => removePhoto(p.uri)}
                style={styles.photoRemove}
                hitSlop={8}
                testID={`${testIdPrefix}-remove-photo-${i}`}
              >
                <Ionicons name="close-circle" size={22} color="#FFFFFF" />
              </Pressable>
              {photos.length > 1 ? (
                <View style={[styles.reorderRow, { flexDirection: rowDir }]}>
                  <Pressable
                    onPress={() => moveMedia(i, -1)}
                    disabled={i === 0}
                    hitSlop={6}
                    style={[
                      styles.reorderBtn,
                      { backgroundColor: colors.muted, opacity: i === 0 ? 0.35 : 1 },
                    ]}
                    testID={`${testIdPrefix}-move-back-${i}`}
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
                    style={[
                      styles.reorderBtn,
                      {
                        backgroundColor: colors.muted,
                        opacity: i === photos.length - 1 ? 0.35 : 1,
                      },
                    ]}
                    testID={`${testIdPrefix}-move-forward-${i}`}
                  >
                    <Ionicons
                      name={isRTL ? "chevron-back" : "chevron-forward"}
                      size={15}
                      color={colors.foreground}
                    />
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
        {photos.length < MAX_MEDIA ? (
          <Pressable
            onPress={openPhotoSource}
            style={[
              styles.addPhoto,
              { borderColor: colors.border, borderRadius: colors.radius },
            ]}
            testID={`${testIdPrefix}-add-photo`}
          >
            <Feather name="plus" size={24} color={colors.mutedForeground} />
            <AppText style={[styles.addPhotoText, { color: colors.mutedForeground }]}>
              {t("create.addPhoto")}
            </AppText>
          </Pressable>
        ) : null}
        {videoCount < MAX_VIDEOS && photos.length < MAX_MEDIA ? (
          <Pressable
            onPress={() => void launchVideoTrimPicker()}
            style={[
              styles.addPhoto,
              { borderColor: colors.border, borderRadius: colors.radius },
            ]}
            testID={`${testIdPrefix}-add-video`}
          >
            <Feather name="video" size={22} color={colors.mutedForeground} />
            <AppText style={[styles.addPhotoText, { color: colors.mutedForeground }]}>
              {t("create.addVideo")}
            </AppText>
          </Pressable>
        ) : null}
      </View>

      <ImageCropModal
        uri={cropAsset?.uri ?? null}
        sourceWidth={cropAsset?.width ?? 0}
        sourceHeight={cropAsset?.height ?? 0}
        onConfirm={handleCropConfirm}
        onCancel={handleCropCancel}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  hint: { fontSize: 13, lineHeight: 18 },
  photoCountRow: {
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  photosCount: { fontSize: 13, fontWeight: "600" },
  minPhotos: { fontSize: 12, fontWeight: "600" },
  photoRow: { flexWrap: "wrap", gap: 12 },
  photoWrap: { width: 112, gap: 6 },
  photo: { width: 112, height: 112 },
  videoTile: { alignItems: "center", justifyContent: "center" },
  photoRemove: { position: "absolute", top: 4, right: 4 },
  coverBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  coverText: { fontSize: 10, fontWeight: "700" },
  editCropBtn: {
    position: "absolute",
    bottom: 28,
    left: 4,
    alignItems: "center",
    gap: 2,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  editCropText: { color: "#FFFFFF", fontSize: 9, fontWeight: "600" },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
    gap: 4,
  },
  uploadOverlayText: { color: "#FFFFFF", fontSize: 10, textAlign: "center" },
  reorderRow: { gap: 6, justifyContent: "center" },
  reorderBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  addPhoto: {
    width: 112,
    height: 112,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    padding: 8,
  },
  addPhotoText: { fontSize: 11, textAlign: "center" },
});
