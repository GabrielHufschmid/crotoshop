const INVALID_FILE_CHARS = /[<>:"/\\|?*]/g;

export function fileBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim();
}

export function safeFileName(name: string): string {
  const withoutControls = Array.from(name, (char) => char.charCodeAt(0) < 32 ? '-' : char).join('');
  return withoutControls.replace(INVALID_FILE_CHARS, '-').replace(/[. ]+$/, '').trim() || 'Nueva imagen';
}

export function fileTimestamp(date = new Date()): string {
  const part = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}-${part(date.getMinutes())}-${part(date.getSeconds())}`;
}

export function defaultDocumentFileName(sourceName?: string, date = new Date()): string {
  const base = sourceName ? fileBaseName(sourceName) : 'Nueva imagen';
  return `${safeFileName(base)} - ${fileTimestamp(date)}`;
}
