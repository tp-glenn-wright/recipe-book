// Zero-dependency image metadata inspection and stripping.
//
// Why this exists: a photo taken on a phone in your kitchen carries the GPS
// coordinates of your house in its EXIF, and this repo is public. Publishing the
// JPEG publishes the address. So no image reaches images/ with metadata attached,
// and CI fails the build if one ever does.
//
// The rule enforced is deliberately blunt: committed images must carry no metadata
// segments at all. That is far easier to verify than "no GPS specifically", and it
// also sweeps up XMP, IPTC and embedded thumbnails, which can carry location too.
// Colour-critical segments (JFIF density, ICC profiles) are preserved.

const JPEG_SOI = 0xffd8;
const JPEG_EOI = 0xffd9;
const JPEG_SOS = 0xffda;

/** JPEG markers that carry no length-prefixed payload. */
const STANDALONE = new Set([0xff01, ...Array.from({ length: 8 }, (_, i) => 0xffd0 + i)]);

function isJpeg(buf) {
  return buf.length > 3 && buf.readUInt16BE(0) === JPEG_SOI;
}

function isPng(buf) {
  return buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function appName(marker, header) {
  if (marker === 0xffe0) return 'jfif';
  if (marker === 0xffe1) {
    if (header.startsWith('Exif\0')) return 'exif';
    if (header.startsWith('http://ns.adobe.com/xap/')) return 'xmp';
    return 'app1-other';
  }
  if (marker === 0xffe2 && header.startsWith('ICC_PROFILE')) return 'icc';
  if (marker === 0xffed) return 'iptc';
  if (marker === 0xfffe) return 'comment';
  if (marker >= 0xffe0 && marker <= 0xffef) return `app${marker - 0xffe0}`;
  return null;
}

/** Walk the JPEG marker segments up to the start of scan data. */
function jpegSegments(buf) {
  const segments = [];
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf.readUInt16BE(i);
    if (marker === JPEG_EOI) break;
    if (STANDALONE.has(marker)) {
      i += 2;
      continue;
    }
    if (marker === JPEG_SOS) {
      segments.push({ marker, name: 'sos', start: i, end: buf.length });
      break;
    }
    const length = buf.readUInt16BE(i + 2);
    if (length < 2) break;
    const dataStart = i + 4;
    const dataEnd = Math.min(i + 2 + length, buf.length);
    const header = buf.subarray(dataStart, Math.min(dataStart + 32, dataEnd)).toString('latin1');
    segments.push({
      marker,
      name: appName(marker, header) ?? `marker-${marker.toString(16)}`,
      start: i,
      end: dataEnd,
      dataStart,
      dataEnd,
    });
    i = dataEnd;
  }
  return segments;
}

/** Parse an EXIF APP1 payload far enough to say whether it carries a GPS IFD. */
function exifHasGps(payload) {
  try {
    const tiff = payload.subarray(6); // skip "Exif\0\0"
    if (tiff.length < 8) return false;
    const order = tiff.subarray(0, 2).toString('latin1');
    const le = order === 'II';
    if (!le && order !== 'MM') return false;
    const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
    const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
    if (u16(2) !== 0x002a) return false;

    const seen = new Set();
    const walk = (offset, depth) => {
      if (depth > 4 || offset <= 0 || offset + 2 > tiff.length || seen.has(offset)) return false;
      seen.add(offset);
      const count = u16(offset);
      let entry = offset + 2;
      for (let n = 0; n < count; n += 1, entry += 12) {
        if (entry + 12 > tiff.length) return false;
        const tag = u16(entry);
        if (tag === 0x8825) return true; // GPS IFD pointer
        if (tag === 0x8769 && walk(u32(entry + 8), depth + 1)) return true; // EXIF sub-IFD
      }
      return false;
    };
    return walk(u32(4), 0);
  } catch {
    return false;
  }
}

const JPEG_KEEP = new Set(['jfif', 'icc', 'sos']);

/** Metadata segments found in a JPEG, with a GPS flag where we can prove it. */
function inspectJpeg(buf) {
  const findings = [];
  for (const seg of jpegSegments(buf)) {
    if (seg.name === 'sos') break;
    if (JPEG_KEEP.has(seg.name)) continue;
    if (seg.marker < 0xffe0 || seg.marker > 0xffef) {
      if (seg.marker !== 0xfffe) continue; // structural marker, not metadata
    }
    const payload = buf.subarray(seg.dataStart, seg.dataEnd);
    findings.push({
      kind: seg.name,
      bytes: seg.dataEnd - seg.dataStart,
      hasGps: seg.name === 'exif' ? exifHasGps(payload) : false,
    });
  }
  return findings;
}

/** Rebuild a JPEG without its metadata segments. */
function stripJpeg(buf) {
  const parts = [buf.subarray(0, 2)];
  let cursor = 2;
  for (const seg of jpegSegments(buf)) {
    if (seg.name === 'sos') break;
    const isMetadata =
      (seg.marker >= 0xffe0 && seg.marker <= 0xffef && !JPEG_KEEP.has(seg.name)) ||
      seg.marker === 0xfffe;
    if (!isMetadata) continue;
    parts.push(buf.subarray(cursor, seg.start));
    cursor = seg.end;
  }
  parts.push(buf.subarray(cursor));
  return Buffer.concat(parts);
}

const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

function pngChunks(buf) {
  const chunks = [];
  let i = 8;
  while (i + 8 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + length;
    if (end > buf.length) break;
    chunks.push({ type, start: i, end, length });
    if (type === 'IEND') break;
    i = end;
  }
  return chunks;
}

function inspectPng(buf) {
  return pngChunks(buf)
    .filter((c) => PNG_METADATA_CHUNKS.has(c.type))
    .map((c) => ({
      kind: `png-${c.type}`,
      bytes: c.length,
      // eXIf chunks hold a bare TIFF block, so reuse the parser with a synthetic prefix.
      hasGps: c.type === 'eXIf'
        ? exifHasGps(Buffer.concat([Buffer.from('Exif\0\0'), buf.subarray(c.start + 8, c.end - 4)]))
        : false,
    }));
}

/** Removing whole chunks needs no CRC recalculation, since survivors keep their own. */
function stripPng(buf) {
  const parts = [buf.subarray(0, 8)];
  for (const chunk of pngChunks(buf)) {
    if (PNG_METADATA_CHUNKS.has(chunk.type)) continue;
    parts.push(buf.subarray(chunk.start, chunk.end));
  }
  return Buffer.concat(parts);
}

/**
 * Report metadata segments in an image buffer.
 * Returns { format, findings: [{ kind, bytes, hasGps }] }.
 * Throws on a format we cannot inspect, because silently passing an
 * uninspectable image would defeat the point of the gate.
 */
export function inspect(buf) {
  if (isJpeg(buf)) return { format: 'jpeg', findings: inspectJpeg(buf) };
  if (isPng(buf)) return { format: 'png', findings: inspectPng(buf) };
  throw new Error('unsupported image format: expected JPEG or PNG');
}

/** Return a copy of the image with all metadata segments removed. */
export function strip(buf) {
  if (isJpeg(buf)) return stripJpeg(buf);
  if (isPng(buf)) return stripPng(buf);
  throw new Error('unsupported image format: expected JPEG or PNG');
}
