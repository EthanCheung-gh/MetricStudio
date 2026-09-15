/**
 * v1.7.1: unified file save. In the Tauri desktop shell, `<a download>` +
 * blob URLs are unreliable (WKWebView ignores the download attribute and the
 * click silently does nothing), so exports go through the native save dialog
 * and the fs plugin instead. Browser / LAN builds keep the classic download.
 */

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type SaveOutcome = 'native' | 'browser' | 'cancelled';

export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function saveFile(
  filename: string,
  content: string | Uint8Array,
): Promise<SaveOutcome> {
  if (isTauri) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({ defaultPath: filename });
      if (!path) return 'cancelled';
      const fs = await import('@tauri-apps/plugin-fs');
      if (typeof content === 'string') await fs.writeTextFile(path, content);
      else await fs.writeFile(path, content);
      return 'native';
    } catch (err) {
      // Plugin missing or permission denied — degrade to the browser path
      // instead of failing the export.
      console.warn('[fileSave] native save unavailable, falling back to browser download', err);
    }
  }
  const blob =
    typeof content === 'string'
      ? new Blob([content], { type: 'text/plain;charset=utf-8' })
      : new Blob([content as BlobPart]);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return 'browser';
}

/** Fetch a backend-exported file and save it (Tauri) or open it (browser). */
export async function saveFromUrl(url: string, filename: string): Promise<SaveOutcome> {
  if (isTauri) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${filename}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return saveFile(filename, bytes);
  }
  window.open(url, '_blank');
  return 'browser';
}
