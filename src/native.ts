import { invoke, isTauri } from '@tauri-apps/api/core';
export const native = isTauri();
export async function openNative(): Promise<Blob | null> {
  const bytes = await invoke<ArrayBuffer>('open_image');
  return bytes.byteLength ? new Blob([bytes]) : null;
}
export async function pasteImage(): Promise<Blob> {
  if (native) return new Blob([await invoke<ArrayBuffer>('read_clipboard_image')], { type: 'image/png' });
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find(type => type.startsWith('image/'));
    if (type) return item.getType(type);
  }
  throw new Error('No image on the clipboard. Copy an image first.');
}
export async function copyImage(blob: Promise<Blob>) {
  if (native) await invoke('copy_image', new Uint8Array(await (await blob).arrayBuffer()));
  else await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
export async function exportImage(blob: Blob, name: string) {
  if (native) return invoke<boolean>('save_image', new Uint8Array(await blob.arrayBuffer()), { headers: { 'x-export-name': name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) } });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

export async function copyText(text: string) {
  if (native) await invoke('copy_text', { text });
  else await navigator.clipboard.writeText(text);
}
