export type MediaKind = "audio" | "video" | "pdf" | "office" | "sheet";

export const EXTENSIONS: Record<MediaKind, readonly string[]> = {
  audio: ["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "opus"],
  video: ["mp4", "m4v", "webm", "mov", "ogv"],
  pdf: ["pdf"],
  office: ["docx", "doc", "odt", "rtf", "pptx", "ppt", "odp"],
  sheet: ["xlsx", "xls", "ods"],
};

export function fileKind(path: string): MediaKind | null {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  for (const kind of Object.keys(EXTENSIONS) as MediaKind[]) {
    if (EXTENSIONS[kind].includes(ext)) return kind;
  }
  return null;
}
