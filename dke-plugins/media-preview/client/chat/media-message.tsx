import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginTimelineItemProps, useRpc } from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { MediaKind } from "../../shared/kinds";
import { CHAT_CARD_MAX_BYTES, DIRECT_PLAY_MAX_BYTES } from "../../shared/limits";
import type { MediaMessageData } from "../../shared/media-message";
import {
  fileRead,
  fileStat,
  previewCancel,
  previewRead,
  previewStart,
  previewStatus,
} from "../../shared/rpc";
import { formatSize } from "../autoload";
import { revokeBlobUrl, toBlobUrl } from "../blob-url";
import { MediaElement } from "../media-element";
import { encodeBase64, isAbortError } from "../read-chunks";
import { SPACING } from "../ui-spacing";
import { fileLinkMarkdown } from "./file-link";
import {
  PlayController,
  type PlayMode,
  type PlayProgress,
  chooseSource,
  runPlay,
} from "./play-run";

const MAX_CARDS = 6;
const POLL_INTERVAL_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const KIND_LABEL: Record<MediaKind, string> = {
  audio: "Audio",
  video: "Video",
  pdf: "PDF",
  office: "Dokumen",
  sheet: "Spreadsheet",
};

interface Stat {
  size: number;
  mimeType: string;
}

type CardState =
  | { phase: "loading" }
  | { phase: "ready"; stat: Stat }
  | { phase: "error"; message: string };

type PlayState =
  | { phase: "idle"; note?: string }
  | { phase: "preparing" }
  | { phase: "reading"; read: number; total: number }
  | { phase: "playing"; url: string; preview: boolean }
  | { phase: "native-playing"; preview: boolean }
  | { phase: "unsupported" }
  | { phase: "error"; message: string };

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (name === "PathNotAllowedError" || /tidak diizinkan/i.test(message)) {
    return "Tidak bisa dibaca (di luar folder yang diizinkan)";
  }
  return message;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function useCardStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      root: { gap: SPACING.sm, marginTop: SPACING.sm },
      card: {
        gap: SPACING.xs,
        padding: SPACING.md,
        borderRadius: SPACING.radius,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      name: { color: theme.colors.foreground },
      meta: { color: theme.colors.foregroundMuted },
      error: { color: theme.colors.statusDanger },
      button: {
        alignSelf: "flex-start" as const,
        backgroundColor: theme.colors.accent,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.sm,
        borderRadius: SPACING.radius,
      },
      buttonText: { color: theme.colors.accentForeground },
      secondaryButton: {
        alignSelf: "flex-start" as const,
        borderWidth: 1,
        borderColor: theme.colors.border,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.sm,
        borderRadius: SPACING.radius,
      },
      secondaryButtonText: { color: theme.colors.foreground },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        flexWrap: "wrap" as const,
        gap: SPACING.sm,
      },
    }),
    [theme],
  );
}

type PlayAudio = (source: { base64: string; mimeType: string }) => Promise<void>;

function MediaCard({
  file,
  theme,
  platform,
  playAudio,
}: {
  file: MediaMessageData["files"][number];
  theme: PluginTheme;
  platform: "ios" | "android" | "web";
  playAudio: PlayAudio;
}) {
  const styles = useCardStyles(theme);
  const stat = useRpc(fileStat);
  const read = useRpc(fileRead);
  const start = useRpc(previewStart);
  const status = useRpc(previewStatus);
  const cancel = useRpc(previewCancel);
  const readPreview = useRpc(previewRead);
  const rpcRef = useRef({ stat, read, start, status, cancel, readPreview });
  rpcRef.current = { stat, read, start, status, cancel, readPreview };

  const [state, setState] = useState<CardState>({ phase: "loading" });
  const [play, setPlay] = useState<PlayState>({ phase: "idle" });
  const urlRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const controllerRef = useRef<PlayController | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    const load = async () => {
      try {
        const result = await rpcRef.current.stat({ path: file.path });
        if (aliveRef.current) setState({ phase: "ready", stat: result });
      } catch (error) {
        if (aliveRef.current) setState({ phase: "error", message: describeError(error) });
      }
    };
    void load();
    return () => {
      aliveRef.current = false;
      // Leaving the card drops a still-queued preview job; a running one finishes into the cache.
      controllerRef.current?.abandon();
      controllerRef.current = null;
      if (urlRef.current) revokeBlobUrl(urlRef.current);
      urlRef.current = null;
    };
  }, [file.path]);

  const startPlay = useCallback(
    async (mode: PlayMode) => {
      if (state.phase !== "ready") return;
      // Native has no <video> and no binary blobs: audio goes through the host player, video is web-only.
      if (platform !== "web" && file.kind !== "audio") {
        setPlay({ phase: "unsupported" });
        return;
      }
      const kind = file.kind as "audio" | "video";
      controllerRef.current?.abandon();
      const controller = new PlayController((input) => rpcRef.current.cancel(input));
      controllerRef.current = controller;
      const isCurrent = () => aliveRef.current && controllerRef.current === controller;
      if (urlRef.current) {
        revokeBlobUrl(urlRef.current);
        urlRef.current = null;
      }
      const onProgress = (progress: PlayProgress) => {
        if (!isCurrent()) return;
        setPlay(
          progress.phase === "preparing"
            ? { phase: "preparing" }
            : { phase: "reading", read: progress.read, total: progress.total },
        );
      };
      setPlay(
        chooseSource(state.stat.size, mode) === "preview"
          ? { phase: "preparing" }
          : { phase: "reading", read: 0, total: state.stat.size },
      );
      try {
        const result = await runPlay({
          path: file.path,
          kind,
          size: state.stat.size,
          mimeType: state.stat.mimeType,
          mode,
          rpc: {
            fileRead: (input) => rpcRef.current.read(input),
            previewStart: (input) => rpcRef.current.start(input),
            previewStatus: (input) => rpcRef.current.status(input),
            previewRead: (input) => rpcRef.current.readPreview(input),
          },
          ...controller.hooks(onProgress),
          sleep,
          pollMs: POLL_INTERVAL_MS,
        });
        if (!isCurrent()) return;
        if (platform !== "web") {
          setPlay({ phase: "native-playing", preview: result.preview });
          await playAudio({ base64: encodeBase64(result.bytes), mimeType: result.mimeType });
          if (isCurrent()) setPlay({ phase: "idle" });
          return;
        }
        const url = toBlobUrl(result.bytes, result.mimeType);
        if (url === null) {
          setPlay({ phase: "unsupported" });
          return;
        }
        urlRef.current = url;
        setPlay({ phase: "playing", url, preview: result.preview });
      } catch (error) {
        if (!isCurrent()) return;
        setPlay(
          isAbortError(error)
            ? { phase: "idle", note: "Dibatalkan" }
            : { phase: "error", message: describeError(error) },
        );
      }
    },
    [file.path, file.kind, platform, playAudio, state],
  );

  const onPlay = useCallback(() => void startPlay("auto"), [startPlay]);
  const onPlayOriginal = useCallback(() => void startPlay("original"), [startPlay]);
  const onCancel = useCallback(() => controllerRef.current?.cancel(), []);

  const playable = file.kind === "audio" || file.kind === "video";
  const header = (
    <>
      <Text style={styles.name}>{baseName(file.path)}</Text>
      <Text style={styles.meta}>
        {state.phase === "ready"
          ? `${KIND_LABEL[file.kind]} · ${formatSize(state.stat.size)}`
          : KIND_LABEL[file.kind]}
      </Text>
    </>
  );

  if (state.phase === "loading") {
    return (
      <View style={styles.card}>
        {header}
        <Text style={styles.meta}>Memuat info berkas...</Text>
      </View>
    );
  }
  if (state.phase === "error") {
    return (
      <View style={styles.card}>
        {header}
        <Text style={styles.error}>{state.message}</Text>
      </View>
    );
  }

  // Large files play through a server-side preview; only the original is capped for the card.
  const originalTooBig = state.stat.size > CHAT_CARD_MAX_BYTES;
  return (
    <View style={styles.card}>
      {header}
      {playable ? (
        <PlayControls
          play={play}
          kind={file.kind as "audio" | "video"}
          size={state.stat.size}
          theme={theme}
          platform={platform}
          onPlay={onPlay}
          onPlayOriginal={onPlayOriginal}
          onCancel={onCancel}
        />
      ) : null}
      {!playable || originalTooBig ? <Markdown>{fileLinkMarkdown(file.path)}</Markdown> : null}
    </View>
  );
}

function PlayControls({
  play,
  kind,
  size,
  theme,
  platform,
  onPlay,
  onPlayOriginal,
  onCancel,
}: {
  play: PlayState;
  kind: "audio" | "video";
  size: number;
  theme: PluginTheme;
  platform: "ios" | "android" | "web";
  onPlay: () => void;
  onPlayOriginal: () => void;
  onCancel: () => void;
}) {
  const styles = useCardStyles(theme);
  const showOriginal =
    size <= CHAT_CARD_MAX_BYTES &&
    size > DIRECT_PLAY_MAX_BYTES &&
    (play.phase === "playing" || play.phase === "native-playing") &&
    play.preview;
  const originalLabel = `Putar kualitas asli (${formatSize(size)})`;
  return (
    <>
      {play.phase === "idle" || play.phase === "error" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Putar"
          onPress={onPlay}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Putar</Text>
        </Pressable>
      ) : null}
      {play.phase === "idle" && play.note ? <Text style={styles.meta}>{play.note}</Text> : null}
      {play.phase === "preparing" || play.phase === "reading" ? (
        <View style={styles.row}>
          <Text style={styles.meta}>
            {play.phase === "preparing"
              ? "Menyiapkan pratinjau..."
              : `Memuat ${formatSize(play.read)} / ${formatSize(play.total)}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Batal"
            onPress={onCancel}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Batal</Text>
          </Pressable>
        </View>
      ) : null}
      {play.phase === "native-playing" ? (
        <Text style={styles.meta}>{play.preview ? "Memutar pratinjau..." : "Memutar..."}</Text>
      ) : null}
      {play.phase === "error" ? <Text style={styles.error}>{play.message}</Text> : null}
      {play.phase === "unsupported" ? (
        <Text style={styles.meta}>
          {kind === "video" ? "Video hanya bisa diputar di web" : "Pemutar hanya tersedia di web"}
        </Text>
      ) : null}
      {play.phase === "playing" ? (
        <>
          {play.preview ? <Text style={styles.meta}>Pratinjau</Text> : null}
          <MediaElement kind={kind} url={play.url} theme={theme} platform={platform} />
        </>
      ) : null}
      {showOriginal ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={originalLabel}
          onPress={onPlayOriginal}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>{originalLabel}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

/** The renderer needs the client's audio player, which only `contribute` receives. */
export function createMediaMessage(playAudio: PlayAudio) {
  return function MediaMessageWithPlayer(props: PluginTimelineItemProps<MediaMessageData>) {
    return <MediaMessage {...props} playAudio={playAudio} />;
  };
}

function MediaMessage({
  item,
  theme,
  layout,
  playAudio,
}: PluginTimelineItemProps<MediaMessageData> & { playAudio: PlayAudio }) {
  const styles = useCardStyles(theme);
  const { text, files } = item.data;
  const shown = files.slice(0, MAX_CARDS);
  const extra = files.length - shown.length;
  return (
    <View>
      <Markdown>{text}</Markdown>
      <View style={styles.root}>
        {shown.map((file) => (
          <MediaCard
            key={file.path}
            file={file}
            theme={theme}
            platform={layout.platform}
            playAudio={playAudio}
          />
        ))}
        {extra > 0 ? <Text style={styles.meta}>{`+${extra} file lainnya`}</Text> : null}
      </View>
    </View>
  );
}
