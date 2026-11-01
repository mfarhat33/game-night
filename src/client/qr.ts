// QR codes rendered locally to inline SVG (no network calls).
import { encode } from 'uqr';

export function qrSvg(text: string): string {
  const { data, size } = encode(text, { ecc: 'M', border: 2 });
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (data[y][x]) path += `M${x} ${y}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#0b1f24"/></svg>`;
}
