import { forwardRef } from "react";
import { TextInput as RNTextInput, StyleSheet, type TextInputProps } from "react-native";

import { useI18n } from "@/context/LanguageContext";

// Inter has NO Arabic glyphs, so any input that pins an Inter weight renders
// Arabic as broken, disconnected letters ("حروف مش كلام"). Swap to the matching
// Cairo weight in Arabic — the same contract AppText uses for <Text>.
const INTER_TO_CAIRO: Record<string, string> = {
  Inter_400Regular: "Cairo_400Regular",
  Inter_500Medium: "Cairo_500Medium",
  Inter_600SemiBold: "Cairo_600SemiBold",
  Inter_700Bold: "Cairo_700Bold",
};

/**
 * Drop-in replacement for react-native's <TextInput>. In Arabic it swaps the
 * Inter font family for the matching Cairo weight and sets RTL writing
 * direction, so typed Arabic shapes correctly. In English it renders untouched.
 */
export const AppTextInput = forwardRef<RNTextInput, TextInputProps>(
  function AppTextInput({ style, ...props }, ref) {
    const { isRTL } = useI18n();
    if (!isRTL) {
      return <RNTextInput ref={ref} style={style} {...props} />;
    }
    const flat = (StyleSheet.flatten(style) || {}) as { fontFamily?: string };
    const family = flat.fontFamily;
    // Only remap a pinned Inter weight → Cairo. A non-Inter family, or none at
    // all (system font, which shapes Arabic fine), is left untouched — so this is
    // a safe drop-in for ANY TextInput and never changes a field that already works.
    const mapped = family ? INTER_TO_CAIRO[family] : undefined;
    return (
      <RNTextInput
        ref={ref}
        style={[style, mapped ? { fontFamily: mapped } : null, { writingDirection: "rtl" }]}
        {...props}
      />
    );
  },
);
