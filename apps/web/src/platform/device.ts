/** The browser's name for the server's Devices list ("Chrome", "Firefox"). ASCII, as it goes in a header. */
export function browserName(userAgent: string): string {
  if (/Edg\//.test(userAgent)) {
    return 'Edge';
  }
  if (/Firefox\//.test(userAgent)) {
    return 'Firefox';
  }
  if (/(Chrome|CriOS)\//.test(userAgent)) {
    return 'Chrome';
  }
  if (/Safari\//.test(userAgent)) {
    return 'Safari';
  }
  return 'Web Browser';
}
