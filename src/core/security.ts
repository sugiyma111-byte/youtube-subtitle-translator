export function isYouTubePage(url: string | undefined): boolean {
  try {
    const parsed = new URL(url ?? '');
    return parsed.protocol === 'https:' && parsed.hostname === 'www.youtube.com';
  } catch { return false; }
}

export function isOptionsPage(url: string | undefined, extensionOrigin: string): boolean {
  try {
    const parsed = new URL(url ?? '');
    const expected = new URL(extensionOrigin);
    return parsed.protocol === expected.protocol && parsed.host === expected.host && parsed.pathname === '/options.html';
  } catch { return false; }
}
