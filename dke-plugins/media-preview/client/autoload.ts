export function shouldAutoLoad(size: number, max: number): boolean {
  return size <= max;
}

export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const text = i === 0 || value >= 100 ? Math.round(value).toString() : value.toFixed(1);
  return `${text} ${units[i]}`;
}
