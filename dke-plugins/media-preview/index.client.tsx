import type { PluginClientContext } from "@getpaseo/plugin/client";
import { EXTENSIONS } from "./shared/kinds";
import { createMediaPanel } from "./client/panels/media-panel";
import { OfficePanel } from "./client/panels/office-panel";
import { PdfPanel } from "./client/panels/pdf-panel";
import { SheetPanel } from "./client/panels/sheet-panel";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addFilePanel({
      id: "audio",
      title: "Audio",
      icon: "Music",
      files: { extensions: EXTENSIONS.audio },
      Component: createMediaPanel("audio"),
    }),
    client.addFilePanel({
      id: "video",
      title: "Video",
      icon: "Film",
      files: { extensions: EXTENSIONS.video },
      Component: createMediaPanel("video"),
    }),
    client.addFilePanel({
      id: "pdf",
      title: "PDF",
      icon: "FileText",
      files: { extensions: EXTENSIONS.pdf },
      Component: PdfPanel,
    }),
    client.addFilePanel({
      id: "office",
      title: "Dokumen",
      icon: "FileText",
      files: { extensions: EXTENSIONS.office },
      Component: OfficePanel,
    }),
    client.addFilePanel({
      id: "sheet",
      title: "Spreadsheet",
      icon: "Sheet",
      files: { extensions: EXTENSIONS.sheet },
      Component: SheetPanel,
    }),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
