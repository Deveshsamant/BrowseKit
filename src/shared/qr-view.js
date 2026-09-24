/**
 * Render QR symbols from qr.js as SVG elements and PNG blobs (all local).
 */
import { encodeQr, qrToSvgPath } from './qr.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const QR_BORDER = 4;

/**
 * @param {string} text
 * @param {{ ecc?: 'L' | 'M' | 'Q' | 'H', label?: string }} [options]
 * @returns {{ svg: SVGSVGElement, qr: ReturnType<typeof encodeQr> }}
 */
export function renderQrSvg(text, { ecc = 'M', label = 'QR code' } = {}) {
  const qr = encodeQr(text, { ecc });
  const dim = qr.size + QR_BORDER * 2;
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG_NS, 'svg'));
  svg.setAttribute('viewBox', `0 0 ${dim} ${dim}`);
  svg.setAttribute('class', 'qr');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(dim));
  bg.setAttribute('height', String(dim));
  bg.setAttribute('fill', '#ffffff');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', qrToSvgPath(qr.modules, QR_BORDER));
  path.setAttribute('fill', '#000000');
  svg.append(bg, path);
  return { svg, qr };
}

/**
 * Standalone SVG file text for download.
 * @param {ReturnType<typeof encodeQr>} qr
 */
export function qrSvgFile(qr) {
  const dim = qr.size + QR_BORDER * 2;
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#fff"/><path d="${qrToSvgPath(qr.modules, QR_BORDER)}" fill="#000"/></svg>\n`;
}

/**
 * @param {ReturnType<typeof encodeQr>} qr
 * @param {number} [scale] pixels per module
 * @returns {Promise<Blob>}
 */
export async function qrPngBlob(qr, scale = 10) {
  const dim = (qr.size + QR_BORDER * 2) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  g.fillStyle = '#fff';
  g.fillRect(0, 0, dim, dim);
  g.fillStyle = '#000';
  qr.modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) g.fillRect((x + QR_BORDER) * scale, (y + QR_BORDER) * scale, scale, scale);
    }),
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create PNG'))), 'image/png'),
  );
}
