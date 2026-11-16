import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginTimelineItemProps, useRpc } from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { MediaKind } from "../../shared/kinds";
import { CHAT_CARD_MAX_BYTES } from "../../shared/limits";
import type { MediaMessageData } from "../../shared/media-message";
import { fileRead, fileStat } from "../../shared/rpc";
import { formatSize } from "../autoload";
import { revokeBlobUrl, toBlobUrl } from "../blob-url";
import { MediaElement } from "../media-element";
import { encodeBase64, readAllChunks } from "../read-chunks";
import { SPACING } from "../ui-spacing";
import { fileLinkMarkdown } from "./file-link";

const MAX_CARDS = 6;

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
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "playing"; url: string }
  | { phase: "native-playing" }
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
  const rpcRef = useRef({ stat, read });
  rpcRef.current = { stat, read };

  const [state, setState] = useState<CardState>({ phase: "loading" });
  const [play, setPlay] = useState<PlayState>({ phase: "idle" });
  const urlRef = useRef<string | null>(null);
  const aliveRef = useRef(true);

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
      if (urlRef.current) revokeBlobUrl(urlRef.current);
      urlRef.current = null;
    };
  }, [file.path]);

  const onPlay = useCallback(async () => {
    if (state.phase !== "ready") return;
    // Native has no <video> and no binary blobs: audio goes through the host player, video is web-only.
    if (platform !== "web" && file.kind !== "audio") {
      setPlay({ phase: "unsupported" });
      return;
    }
    setPlay({ phase: "reading" });
    try {
      const bytes = await readAllChunks(
        (offset) => rpcRef.current.read({ path: file.path, offset }),
        CHAT_CARD_MAX_BYTES,
        state.stat.size,
      );
      if (!aliveRef.current) return;
      if (platform !== "web") {
        setPlay({ phase: "native-playing" });
        await playAudio({ base64: encodeBase64(bytes), mimeType: state.stat.mimeType });
        if (aliveRef.current) setPlay({ phase: "idle" });
        return;
      }
      const url = toBlobUrl(bytes, state.stat.mimeType);
      if (url === null) {
        setPlay({ phase: "unsupported" });
        return;
      }
      urlRef.current = url;
      setPlay({ phase: "playing", url });
    } catch (error) {
      if (aliveRef.current) setPlay({ phase: "error", message: describeError(error) });
    }
  }, [file.path, file.kind, platform, playAudio, state]);

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

  const tooBig = state.stat.size > CHAT_CARD_MAX_BYTES;
  return (
    <View style={styles.card}>
      {header}
      {playable && !tooBig ? (
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
          {play.phase === "reading" ? <Text style={styles.meta}>Memuat...</Text> : null}
          {play.phase === "native-playing" ? <Text style={styles.meta}>Memutar...</Text> : null}
          {play.phase === "error" ? <Text style={styles.error}>{play.message}</Text> : null}
          {play.phase === "unsupported" ? (
            <Text style={styles.meta}>
              {file.kind === "video"
                ? "Video hanya bisa diputar di web"
                : "Pemutar hanya tersedia di web"}
            </Text>
          ) : null}
          {play.phase === "playing" ? (
            <MediaElement
              kind={file.kind as "audio" | "video"}
              url={play.url}
              theme={theme}
              platform={platform}
            />
          ) : null}
        </>
      ) : null}
      {playable && tooBig ? (
        <Text style={styles.meta}>
          {`Terlalu besar untuk diputar di chat (${formatSize(state.stat.size)})`}
        </Text>
      ) : null}
      {!playable || tooBig ? <Markdown>{fileLinkMarkdown(file.path)}</Markdown> : null}
    </View>
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
