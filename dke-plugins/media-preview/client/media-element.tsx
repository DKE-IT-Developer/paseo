import type { PluginTheme } from "@getpaseo/plugin";
import { DocumentFrame } from "@getpaseo/plugin/client/ui";
import * as React from "react";

export interface MediaElementProps {
  kind: "audio" | "video";
  url: string;
  theme: PluginTheme;
  platform: "ios" | "android" | "web";
}

export function MediaElement({ kind, url, theme, platform }: MediaElementProps) {
  if (platform !== "web") return <DocumentFrame url={url} testID={`${kind}-panel`} />;
  const style = {
    width: "100%",
    height: kind === "video" ? "100%" : undefined,
    backgroundColor: theme.colors.surface0,
  };
  // REJECT plugin no-HTML rule — lihat spec
  return React.createElement(kind, { src: url, controls: true, preload: "metadata", style });
}
