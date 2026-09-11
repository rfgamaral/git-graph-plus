import * as vscode from 'vscode';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function loadGitHubImage(url: string): Promise<string | null> {
  if (typeof url !== 'string' || !/^https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(url)) return null;
  try {
    const session = await vscode.authentication.getSession('github', ['repo'], { silent: true });
    if (!session) return null;
    const signal = AbortSignal.timeout(10_000);
    let response = await fetch(url, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      redirect: 'manual',
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) return null;
      const target = new URL(location, url);
      if (target.protocol !== 'https:' || target.username || target.password || target.port
        || !(target.hostname.endsWith('.githubusercontent.com') || target.hostname === 'github-production-user-asset-6210df.s3.amazonaws.com')) return null;
      response = await fetch(target, { redirect: 'error', signal });
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
    if (!response.ok || !/^image\/(?:png|jpeg|gif|webp|avif|bmp)$/.test(contentType)
      || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
      await response.body?.cancel();
      return null;
    }
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) return null;
        chunks.push(value);
      }
      return size ? `data:${contentType};base64,${Buffer.concat(chunks).toString('base64')}` : null;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch {
    return null;
  }
}
