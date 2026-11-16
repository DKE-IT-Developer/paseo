import { type PluginFilePanelProps, useFileUrl } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { useCallback, useState } from "react";
import { PANEL_AUTOLOAD_MAX_BYTES } from "../../shared/limits";
import { shouldAutoLoad } from "../autoload";
import { MediaElement } from "../media-element";
import { ErrorText, SizeGate } from "../size-gate";

function MediaBody({
  file,
  theme,
  layout,
  kind,
}: PluginFilePanelProps & { kind: "audio" | "video" }) {
  const url = useFileUrl(file);
  if (url.status === "loading") return <Loading />;
  if (url.status === "error") {
    return <ErrorText message={url.error.message} theme={theme} />;
  }
  return <MediaElement kind={kind} url={url.url} theme={theme} platform={layout.platform} />;
}

export function createMediaPanel(kind: "audio" | "video") {
  return function MediaPanel(props: PluginFilePanelProps) {
    const [confirmed, setConfirmed] = useState(false);
    const onLoad = useCallback(() => setConfirmed(true), []);
    const size = props.file.size;
    if (!confirmed && !shouldAutoLoad(size, PANEL_AUTOLOAD_MAX_BYTES)) {
      return (
        <SizeGate size={size} max={PANEL_AUTOLOAD_MAX_BYTES} onLoad={onLoad} theme={props.theme} />
      );
    }
    return <MediaBody {...props} kind={kind} />;
  };
}
