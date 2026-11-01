import type { Compression, FileFormat } from '@tributary/contracts';
import { constants, gunzipSync } from 'node:zlib';

// Format detection: content signatures and structure first, the file extension only as a fallback (SPEC M3).
// Every signature cites its specification in `SOURCES`.

export const SOURCES = {
  gzip: 'RFC 1952 §2.3.1 (ID1=0x1f, ID2=0x8b, CM=8)',
  bgzf: 'SAM/BAM specification (SAMv1) §4.1 BGZF: FEXTRA with subfield SI1=66 SI2=67; §4.1.2 EOF block',
  bam: 'SAMv1 §4.2: BAM magic "BAM\\1"',
  vcf: 'VCF v4.3 specification §1.4: "##fileformat=VCFv4.x" first line; header line "#CHROM POS ID REF ALT QUAL FILTER INFO"',
  fastq:
    'Cock et al. 2010, Nucleic Acids Res 38:1767 (Sanger FASTQ): @title, sequence, + line, quality of equal length',
  csv: 'RFC 4180 §2: each record has the same number of fields as the header',
  tsv: 'IANA text/tab-separated-values: each line has the same number of tab-separated fields',
  parquet:
    'Apache Parquet file format: 4-byte magic "PAR1" at the start and at the end after the footer length',
  zip: 'PKWARE APPNOTE.TXT §4.3.7 local header 0x04034b50 and §4.3.16 end of central directory 0x06054b50',
  mzml: 'HUPO-PSI mzML 1.1.0 schema: root element <mzML> or <indexedmzML>',
  thermo_raw:
    'Thermo Fisher RAW (no public specification): header starts 0x01 0xA1 followed by "Finnigan" in UTF-16LE; extension .raw',
  cfb: '[MS-CFB] Compound File Binary Format §2.2: header signature D0 CF 11 E0 A1 B1 1A E1 (SCIEX .wiff)',
  sqlite:
    'SQLite file format §1.3: header string "SQLite format 3\\0" (Bruker timsTOF analysis.tdf is SQLite)',
  extension: 'File extension only: the vendor format has no public signature',
  size: 'An empty object cannot be a valid data file',
} as const;

export interface Detection {
  format: FileFormat;
  compression: Compression;
  detected_by: 'signature' | 'structure' | 'extension' | 'fallback';
  /** The decompressed head (equal to the head when not compressed). */
  inner: Uint8Array;
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[] | Uint8Array, offset = 0) =>
  bytes.length >= offset + prefix.length && prefix.every((b, i) => bytes[offset + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export const GZIP_MAGIC = [0x1f, 0x8b, 0x08];
export const PAR1 = ascii('PAR1');
const BAM_MAGIC = ascii('BAM\x01');
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];
export const THERMO_MAGIC = [0x01, 0xa1, ...[...Buffer.from('Finnigan', 'utf16le')]];
export const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
export const SQLITE_MAGIC = ascii('SQLite format 3\0');

/** BGZF: gzip with FLG.FEXTRA whose first extra subfield is "BC" (SAMv1 §4.1). */
export const isBgzf = (bytes: Uint8Array) =>
  startsWith(bytes, GZIP_MAGIC) && (bytes[3]! & 0x04) !== 0 && bytes[12] === 0x42 && bytes[13] === 0x43;

/** Decompresses as much of a (possibly truncated or damaged) gzip head as possible. */
function gunzipHead(head: Uint8Array): Uint8Array {
  for (let size = head.length; size >= 32; size = Math.floor(size / 2)) {
    try {
      return new Uint8Array(gunzipSync(head.subarray(0, size), { finishFlush: constants.Z_SYNC_FLUSH }));
    } catch {
      // Damaged within this prefix: try a shorter one.
    }
  }
  return new Uint8Array();
}

const EXTENSIONS: [RegExp, FileFormat][] = [
  [/\.wiff\.scan$/i, 'sciex_wiff_scan'],
  [/\.wiff2?$/i, 'sciex_wiff'],
  [/\.raw$/i, 'thermo_raw'],
  [/\.tdf_bin$/i, 'bruker_tdf_bin'],
  [/\.tdf$/i, 'bruker_tdf'],
  [/\.baf$/i, 'bruker_baf'],
  [/\.mzml$/i, 'mzml'],
  [/\.parquet$/i, 'parquet'],
  [/\.bam$/i, 'bam'],
  [/\.vcf$/i, 'vcf'],
  [/\.(fastq|fq)$/i, 'fastq'],
  [/\.csv$/i, 'csv'],
  [/\.(tsv|tab)$/i, 'tsv'],
  [/\.zip$/i, 'zip'],
];
const byExtension = (name: string): FileFormat | undefined => {
  const plain = name.replace(/\.(gz|bgz)$/i, '');
  return EXTENSIONS.find(([pattern]) => pattern.test(plain))?.[1];
};

/** Bytes that look like text: no NUL and few control characters in the sample. */
export function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  if (!sample.length) return false;
  let control = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return control / sample.length < 0.01;
}

/** Complete lines of a text head (the last line is dropped when the head was cut mid-line). */
export function headLines(text: string, complete: boolean): string[] {
  const lines = text.split(/\r?\n/);
  if (!complete || lines.at(-1) === '') lines.pop();
  return lines;
}

/** Splits one CSV record, honouring double quotes (RFC 4180 §2). */
export function splitCsv(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      fields.push(field);
      field = '';
    } else field += c;
  }
  fields.push(field);
  return fields;
}

function delimited(lines: string[]): 'csv' | 'tsv' | undefined {
  const sample = lines.filter((l) => l !== '').slice(0, 50);
  if (sample.length < 2) return undefined;
  const tabs = sample.map((l) => l.split('\t').length);
  if (tabs[0]! > 1 && tabs.every((n) => n === tabs[0])) return 'tsv';
  const commas = sample.map((l) => splitCsv(l).length);
  if (commas[0]! > 1 && commas.every((n) => n === commas[0])) return 'csv';
  return undefined;
}

function sniffText(
  bytes: Uint8Array,
  complete: boolean,
): Pick<Detection, 'format' | 'detected_by'> | undefined {
  if (!looksLikeText(bytes)) return undefined;
  const text = new TextDecoder().decode(bytes);
  if (text.startsWith('##fileformat=VCF')) return { format: 'vcf', detected_by: 'signature' };
  const lines = headLines(text, complete);
  if (lines[0]?.startsWith('@') && lines[2]?.startsWith('+'))
    return { format: 'fastq', detected_by: 'structure' };
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(indexedmzML|mzML)[\s>]/.test(text.slice(0, 4096))) {
    return { format: 'mzml', detected_by: 'structure' };
  }
  const table = delimited(lines);
  if (table) return { format: table, detected_by: 'structure' };
  return undefined;
}

/**
 * Detects the format of an object from its first bytes (`head`) and name. `complete` says the head is the whole
 * object. Compressed objects are detected by their decompressed content.
 */
export function sniff(head: Uint8Array, name: string, complete = false): Detection {
  if (startsWith(head, GZIP_MAGIC)) {
    const inner = gunzipHead(head);
    const compression: Compression = isBgzf(head) ? 'bgzf' : 'gzip';
    const found = sniffContent(inner, name, false);
    return { ...found, compression, inner };
  }
  return { ...sniffContent(head, name, complete), compression: 'none', inner: head };
}

function sniffContent(
  bytes: Uint8Array,
  name: string,
  complete: boolean,
): Pick<Detection, 'format' | 'detected_by'> {
  const base = name.split('/').at(-1) ?? name;
  if (startsWith(bytes, BAM_MAGIC)) return { format: 'bam', detected_by: 'signature' };
  if (startsWith(bytes, PAR1)) return { format: 'parquet', detected_by: 'signature' };
  if (startsWith(bytes, ZIP_LOCAL) || startsWith(bytes, ZIP_EMPTY))
    return { format: 'zip', detected_by: 'signature' };
  if (startsWith(bytes, THERMO_MAGIC)) return { format: 'thermo_raw', detected_by: 'signature' };
  if (startsWith(bytes, CFB_MAGIC) && /\.wiff2?$/i.test(base))
    return { format: 'sciex_wiff', detected_by: 'signature' };
  if (startsWith(bytes, SQLITE_MAGIC) && /^analysis\.tdf$/i.test(base)) {
    return { format: 'bruker_tdf', detected_by: 'structure' };
  }
  const text = sniffText(bytes, complete);
  if (text) return text;
  const ext = byExtension(name);
  if (ext) return { format: ext, detected_by: 'extension' };
  return { format: looksLikeText(bytes) ? 'text' : 'binary', detected_by: 'fallback' };
}
