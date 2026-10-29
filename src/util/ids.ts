/** RFC 4122 v4-style id. Not used for security: it identifies this install to the server. */
export function newDeviceId(random: () => number = Math.random): string {
  const hex = (n: number) => Math.floor(random() * n).toString(16);
  let out = '';
  for (let i = 0; i < 32; i++) {
    if (i === 12) {
      out += '4';
    } else if (i === 16) {
      out += (8 + Math.floor(random() * 4)).toString(16);
    } else {
      out += hex(16);
    }
  }
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}
