import * as React from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import {
  Apple,
  ArrowLeft,
  ArrowRight,
  Award,
  BadgeCheck,
  Banknote,
  Bell,
  Bookmark,
  Box,
  Briefcase,
  Building2,
  Calendar,
  CalendarDays,
  Camera,
  Car,
  ChartColumn,
  ChartLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleArrowDown,
  CircleCheck,
  CircleDot,
  CirclePlay,
  CirclePlus,
  CircleQuestionMark,
  CircleX,
  ClipboardList,
  Clock,
  CloudUpload,
  Cog,
  CreditCard,
  Earth,
  Ellipsis,
  EllipsisVertical,
  Eye,
  EyeOff,
  Facebook,
  Factory,
  FilePen,
  FileText,
  Flag,
  Gift,
  Globe,
  Heart,
  Bed,
  CircleMinus,
  CornerUpLeft,
  CornerUpRight,
  Copy,
  Download,
  Smile,
  ThumbsDown,
  Hourglass,
  House,
  Image,
  Images,
  Inbox,
  Info,
  Instagram,
  Landmark,
  LayoutGrid,
  Link,
  Linkedin,
  Lock,
  LogOut,
  type LucideIcon,
  List,
  LockOpen,
  Play,
  Share2,
  Video,
  Map,
  MapPin,
  MessageCircle,
  MessageSquare,
  Minus,
  Moon,
  MoonStar,
  Package,
  Pencil,
  Phone,
  PhoneOff,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  SquareCheck,
  Star,
  Store,
  Tag,
  Tags,
  Trash2,
  TrendingDown,
  TrendingUp,
  Trophy,
  Truck,
  Twitter,
  User,
  UserCheck,
  Users,
  Slash,
  Wallet,
  WifiOff,
  X,
  Youtube,
  Zap,
} from "lucide-react-native";

/**
 * App-owned icon registry — the radical, permanent fix for the Android
 * app-wide ".notdef"/tofu (□ / X) icon bug.
 *
 * WHY SVG, NOT FONTS
 * ------------------
 * The bug was caused by ICON FONTS. `@expo/vector-icons` ships a JS glyph map
 * (name → codepoint) plus a bundled TTF. On Android, a font family can only be
 * registered ONCE per process: when Expo Go (or another lib) had already
 * registered the stock "feather"/"ionicons"/"material-community" families from a
 * DIFFERENT TTF version, our glyph map pointed at the wrong TTF and EVERY icon
 * rendered as a missing-glyph box. We chased it with unique family names and
 * exact version pins, but font registration on Android is fundamentally fragile.
 *
 * The radical fix is to STOP using fonts entirely. Every icon below is an SVG
 * (lucide-react-native, rendered via react-native-svg) — there is no font to
 * register, no glyph map to mismatch, and therefore no ".notdef" failure mode.
 * SVGs render identically in Expo Go, custom dev builds, and EAS builds.
 *
 * HOW USAGE STAYS UNCHANGED
 * -------------------------
 * Call sites still import { Feather, Ionicons, MaterialCommunityIcons } from
 * "@/components/icons" and use them exactly as before
 * (`<Feather name="search" size={20} color={c} />`). All three are the SAME
 * underlying SVG component, cast to the original `@expo/vector-icons` component
 * TYPES (type-only — erased at build) so `keyof typeof Ionicons.glyphMap`,
 * typed `name` props, etc. keep type-checking. Under the hood, the `name` string
 * is looked up in the registry below and resolved to a lucide SVG.
 *
 * ADDING AN ICON
 * --------------
 * Map the old `@expo/vector-icons` name (the string call sites already use) to a
 * lucide component in ICONS. Unknown names render a loud CircleAlert placeholder
 * (and warn in dev) — never a blank or a box. Guarded by tests/icons.test.mjs.
 */

type IconProps = {
  name?: string;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * old `@expo/vector-icons` name  →  lucide SVG component.
 * Keys are the exact strings used at call sites across all three former sets
 * (Feather / Ionicons / MaterialCommunityIcons), merged into one registry.
 */
const ICONS: Record<string, LucideIcon> = {
  // Newly registered names that previously rendered the CircleAlert fallback
  // (caught by tests/icons.test.mjs once it is part of validation):
  "clipboard-outline": ClipboardList,
  "clock-outline": Clock,
  "image-multiple-outline": Images,
  "list": List,
  "map": Map,
  "package": Package,
  "play": Play,
  "ribbon": Award,
  "share-social-outline": Share2,
  "unlock": LockOpen,
  "video": Video,
  "account-cash-outline": Banknote,
  "account-group-outline": Users,
  "account-lock-outline": Lock,
  "account-outline": User,
  "alert-circle": CircleAlert,
  "alert-triangle": CircleAlert,
  "arrow-down-circle": CircleArrowDown,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "award": Award,
  "bank-outline": Landmark,
  "bell": Bell,
  "bookmark": Bookmark,
  "box": Box,
  "briefcase": Briefcase,
  "business-outline": Building2,
  "calendar": Calendar,
  "calendar-month-outline": CalendarDays,
  "call-outline": Phone,
  "camera": Camera,
  "car": Car,
  "car-outline": Car,
  "cash-outline": Banknote,
  "chart-box-outline": ChartColumn,
  "chart-line": ChartLine,
  "check": Check,
  "check-circle": CircleCheck,
  "check-circle-outline": CircleCheck,
  "check-decagram": BadgeCheck,
  "checkbox": SquareCheck,
  "chevron-back": ChevronLeft,
  "chevron-down": ChevronDown,
  "chevron-forward": ChevronRight,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  "clipboard-text-outline": ClipboardList,
  "clock": Clock,
  "close-circle": CircleX,
  "cog": Cog,
  "cog-outline": Cog,
  "credit-card": CreditCard,
  "earth": Earth,
  "dots-horizontal": Ellipsis,
  "dots-vertical": EllipsisVertical,
  "ellipsis-horizontal": Ellipsis,
  "ellipsis-vertical": EllipsisVertical,
  "edit-2": Pencil,
  "eye": Eye,
  "eye-off": EyeOff,
  "factory": Factory,
  "file-document-edit-outline": FilePen,
  "file-text": FileText,
  "flag": Flag,
  "flash-outline": Zap,
  "globe-outline": Globe,
  "gift": Gift,
  "grid": LayoutGrid,
  "grid-outline": LayoutGrid,
  "heart": Heart,
  "heart-outline": Heart,
  // Previously unmapped → rendered the fallback glyph (wrong icon). Now real:
  "bed-outline": Bed,
  "corner-up-left": CornerUpLeft,
  "corner-up-right": CornerUpRight,
  "copy": Copy,
  "download": Download,
  "minus-circle": CircleMinus,
  "smile": Smile,
  "thumbs-down": ThumbsDown,
  "help-circle": CircleQuestionMark,
  "home": House,
  "image": Image,
  "image-outline": Image,
  "images-outline": Images,
  "inbox": Inbox,
  "info": Info,
  "link-outline": Link,
  "location-outline": MapPin,
  "lock": Lock,
  "lock-outline": Lock,
  "log-out": LogOut,
  "map-outline": Map,
  "map-pin": MapPin,
  "chatbubble-outline": MessageCircle,
  "message-circle": MessageCircle,
  "message-square": MessageSquare,
  "minus": Minus,
  "moon": Moon,
  "notifications-outline": Bell,
  "office-building-outline": Building2,
  "package-variant-closed": Package,
  "people-outline": Users,
  "phone": Phone,
  "phone-off": PhoneOff,
  "phone-portrait-outline": Smartphone,
  "play-circle": CirclePlay,
  "plus": Plus,
  "plus-circle": CirclePlus,
  "radio-button-off": Circle,
  "radio-button-on": CircleDot,
  "refresh-cw": RefreshCw,
  "rotate-ccw": RotateCcw,
  "search": Search,
  "search-outline": Search,
  "send": Send,
  "settings": Settings,
  "shield": Shield,
  "shield-check": ShieldCheck,
  "sliders": SlidersHorizontal,
  "sparkles": Sparkles,
  "square-outline": Square,
  "star": Star,
  "star-crescent": MoonStar,
  "star-outline": Star,
  "star-plus-outline": Star,
  "store-outline": Store,
  "storefront": Store,
  "storefront-check-outline": Store,
  "storefront-outline": Store,
  "tag": Tag,
  "tag-multiple-outline": Tags,
  "tag-text-outline": Tag,
  "timer-sand": Hourglass,
  "trash-2": Trash2,
  "trash-can-outline": Trash2,
  "trending-down": TrendingDown,
  "trending-up": TrendingUp,
  "trophy-variant": Trophy,
  "truck": Truck,
  "truck-outline": Truck,
  "upload-cloud": CloudUpload,
  "user": User,
  "user-check": UserCheck,
  "users": Users,
  "wallet": Wallet,
  "wifi-off": WifiOff,
  "slash": Slash,
  "x": X,
  "x-circle": CircleX,
  "zap": Zap,
  // Brand logos lucide ships as outline glyphs (close enough, theme-colored):
  "logo-apple": Apple,
  "logo-facebook": Facebook,
  "logo-instagram": Instagram,
  "logo-linkedin": Linkedin,
  "logo-twitter": Twitter,
  "logo-youtube": Youtube,
};

/**
 * Names whose intended glyph is a FILLED shape — an active/saved heart, a rated
 * star. Lucide icons are stroke-only by default, so we paint the interior with
 * the icon color to preserve the filled-vs-outline distinction the UI relies on
 * (`saved ? "heart" : "heart-outline"`, `rated ? "star" : "star-outline"`).
 */
const FILLED = new Set(["heart", "star"]);

type BrandProps = { size: number; color: string; style?: StyleProp<ViewStyle> };

/**
 * Brand logos lucide does NOT ship (Google) or has dropped (WhatsApp, TikTok),
 * kept as self-contained inline SVG so they never depend on a font and never
 * render as a box. Google keeps its official multi-color mark; WhatsApp/TikTok
 * are monochrome and follow the passed `color`.
 */
function GoogleMark({ size, style }: BrandProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" style={style}>
      <Path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <Path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <Path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <Path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </Svg>
  );
}

function WhatsAppMark({ size, color, style }: BrandProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={style}>
      <Path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </Svg>
  );
}

function TikTokMark({ size, color, style }: BrandProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={style}>
      <Path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </Svg>
  );
}

const BRAND: Record<string, React.ComponentType<BrandProps>> = {
  "logo-google": GoogleMark,
  "logo-whatsapp": WhatsAppMark,
  "whatsapp": WhatsAppMark,
  "logo-tiktok": TikTokMark,
};

/**
 * The single SVG icon component behind every export. Resolves `name` against the
 * registry; renders a custom brand mark, a filled/outline lucide glyph, or — for
 * an unknown name — a loud CircleAlert placeholder (warns in dev). Never a box.
 */
function IconBase({ name, size = 24, color = "#000000", style }: IconProps) {
  if (name && BRAND[name]) {
    const Brand = BRAND[name];
    return <Brand size={size} color={color} style={style} />;
  }

  const Glyph = name ? ICONS[name] : undefined;
  if (!Glyph) {
    if (__DEV__ && name) {
      console.warn(
        `[icons] Unmapped icon "${name}" — add it to components/icons.tsx`,
      );
    }
    return <CircleAlert size={size} color={color} style={style} />;
  }

  const fill = name && FILLED.has(name) ? color : "none";
  return <Glyph size={size} color={color} fill={fill} style={style} />;
}

// All three former sets are the SAME SVG component, cast to the original
// `@expo/vector-icons` component TYPES (type-only `import(...)` — erased at
// build, no runtime dependency) so existing `name` typing and
// `keyof typeof X.glyphMap` references at call sites keep type-checking.
type VectorIcons = typeof import("@expo/vector-icons");

export const Feather = IconBase as unknown as VectorIcons["Feather"];
export const Ionicons = IconBase as unknown as VectorIcons["Ionicons"];
export const MaterialCommunityIcons =
  IconBase as unknown as VectorIcons["MaterialCommunityIcons"];
