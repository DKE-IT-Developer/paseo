import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginFile, type PluginFilePanelProps, useRpc } from "@getpaseo/plugin/client";
import { DocumentFrame, Loading } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { PANEL_AUTOLOAD_MAX_BYTES } from "../../shared/limits";
import { convertCancel, convertRead, convertStart, convertStatus } from "../../shared/rpc";
import { shouldAutoLoad } from "../autoload";
import { revokeBlobUrl, toBlobUrl } from "../blob-url";
import { ErrorText, SizeGate } from "../size-gate";
import { SPACING } from "../ui-spacing";
import { runOfficeConversion } from "./office-run";
import { officeReducer } from "./office-state";

const POLL_INTERVAL_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ActionButton({
  label,
  onPress,
  theme,
}: {
  label: string;
  onPress: () => void;
  theme: PluginTheme;
}) {
  const style = useMemo(
    () => ({
      backgroundColor: theme.colors.accent,
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.sm,
      borderRadius: SPACING.radius,
      marginTop: SPACING.md,
    }),
    [theme],
  );
  const textStyle = useMemo(() => ({ color: theme.colors.accentForeground }), [theme]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={style}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

export function OfficeFlow({ file, theme }: { file: PluginFile; theme: PluginTheme }) {
  const start = useRpc(convertStart);
  const status = useRpc(convertStatus);
  const cancel = useRpc(convertCancel);
  const read = useRpc(convertRead);
  const rpcRef = useRef({ start, status, cancel, read });
  rpcRef.current = { start, status, cancel, read };

  const [state, dispatch] = useReducer(officeReducer, { phase: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const jobRef = useRef<string | null>(null);
  const stopCurrentRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Per-run flag: a later run (after "Coba lagi") can never revive this one.
    let stopped = false;
    let created: string | null = null;
    stopCurrentRef.current = () => {
      stopped = true;
    };
    const rpc = rpcRef.current;
    void runOfficeConversion(
      {
        path: file.path,
        maxBytes: PANEL_AUTOLOAD_MAX_BYTES,
        rpc: { start: rpc.start, status: rpc.status, read: rpc.read },
        dispatch,
        onJobId: (jobId) => {
          jobRef.current = jobId;
        },
        onUrl: (blobUrl) => {
          created = blobUrl;
          setUrl(blobUrl);
        },
        toBlobUrl,
        revokeBlobUrl,
        sleep,
        pollMs: POLL_INTERVAL_MS,
      },
      () => stopped,
    );
    return () => {
      stopped = true;
      if (created) revokeBlobUrl(created);
      setUrl(null);
    };
  }, [file.path, attempt]);

  const onCancel = useCallback(() => {
    stopCurrentRef.current?.();
    dispatch({ type: "cancel" });
    const jobId = jobRef.current;
    if (jobId) void rpcRef.current.cancel({ jobId }).catch(() => undefined);
  }, []);
  const onRetry = useCallback(() => {
    dispatch({ type: "retry" });
    setAttempt((n) => n + 1);
  }, []);

  const centered = useMemo(
    () => ({
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: SPACING.lg,
      backgroundColor: theme.colors.surface0,
    }),
    [theme],
  );
  const textStyle = useMemo(() => ({ color: theme.colors.foreground }), [theme]);

  if (state.phase === "ready" && url) return <DocumentFrame url={url} testID="office-panel" />;
  if (state.phase === "idle" || state.phase === "loading") return <Loading />;
  if (state.phase === "converting") {
    return (
      <View style={centered}>
        <Text style={textStyle}>Mengonversi dokumen…</Text>
        <ActionButton label="Batal" onPress={onCancel} theme={theme} />
      </View>
    );
  }
  if (state.phase === "cancelled") {
    return (
      <View style={centered}>
        <Text style={textStyle}>Konversi dibatalkan</Text>
        <ActionButton label="Coba lagi" onPress={onRetry} theme={theme} />
      </View>
    );
  }
  return (
    <View style={centered}>
      <ErrorText message={state.error ?? "Konversi gagal"} theme={theme} />
      <ActionButton label="Coba lagi" onPress={onRetry} theme={theme} />
    </View>
  );
}

export function OfficePanel(props: PluginFilePanelProps) {
  const [confirmed, setConfirmed] = useState(false);
  const onLoad = useCallback(() => setConfirmed(true), []);
  const size = props.file.size;
  if (!confirmed && !shouldAutoLoad(size, PANEL_AUTOLOAD_MAX_BYTES)) {
    return (
      <SizeGate size={size} max={PANEL_AUTOLOAD_MAX_BYTES} onLoad={onLoad} theme={props.theme} />
    );
  }
  return <OfficeFlow file={props.file} theme={props.theme} />;
}
