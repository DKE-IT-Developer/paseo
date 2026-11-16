import { type PluginFilePanelProps, useFileUrl } from "@getpaseo/plugin/client";
import { DocumentFrame, Loading } from "@getpaseo/plugin/client/ui";
import { useCallback, useState } from "react";
import { PANEL_AUTOLOAD_MAX_BYTES } from "../../shared/limits";
import { shouldAutoLoad } from "../autoload";
import { ErrorText, SizeGate } from "../size-gate";

function PdfBody({ file, theme }: PluginFilePanelProps) {
  const url = useFileUrl(file);
  if (url.status === "loading") return <Loading />;
  if (url.status === "error") {
    return <ErrorText message={url.error.message} theme={theme} />;
  }
  return <DocumentFrame url={url.url} testID="pdf-panel" />;
}

export function PdfPanel(props: PluginFilePanelProps) {
  const [confirmed, setConfirmed] = useState(false);
  const onLoad = useCallback(() => setConfirmed(true), []);
  const size = props.file.size;
  if (!confirmed && !shouldAutoLoad(size, PANEL_AUTOLOAD_MAX_BYTES)) {
    return (
      <SizeGate size={size} max={PANEL_AUTOLOAD_MAX_BYTES} onLoad={onLoad} theme={props.theme} />
    );
  }
  return <PdfBody {...props} />;
}
