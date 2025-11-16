// Asset helpers
export async function loadAssetArrayBuffer(path: string): Promise<ArrayBuffer> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Asset not found: ${path}`);
  return res.arrayBuffer();
}

export const b64ToBytes = (b64: string) =>
  Uint8Array.from(atob(b64), c => c.charCodeAt(0));

export const bytesToB64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...Array.from(bytes)));
