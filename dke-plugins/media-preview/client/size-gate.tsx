import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { formatSize } from "./autoload";
import { SPACING } from "./ui-spacing";

export interface SizeGateProps {
  size: number;
  max: number;
  onLoad: () => void;
  theme: PluginTheme;
  onPdf?: () => void;
}

export function SizeGate({ size, onLoad, onPdf, theme }: SizeGateProps) {
  const styles = useMemo(
    () => ({
      root: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        padding: SPACING.lg,
        backgroundColor: theme.colors.surface0,
      },
      text: { color: theme.colors.foreground, marginBottom: SPACING.md },
      button: {
        backgroundColor: theme.colors.accent,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.sm,
        borderRadius: SPACING.radius,
      },
      buttonText: { color: theme.colors.accentForeground },
    }),
    [theme],
  );
  return (
    <View style={styles.root}>
      <Text style={styles.text}>{`File ini ${formatSize(size)}. Muat untuk diputar?`}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Muat"
        onPress={onLoad}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Muat</Text>
      </Pressable>
      {onPdf ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Lihat sebagai PDF"
          onPress={onPdf}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Lihat sebagai PDF</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ErrorText({ message, theme }: { message: string; theme: PluginTheme }) {
  const style = useMemo(() => ({ color: theme.colors.statusDanger }), [theme]);
  return <Text style={style}>{message}</Text>;
}
