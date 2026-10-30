import type { Compression, FileFormat, QcCheck } from '@tributary/contracts';
import {
  CFB_MAGIC,
  headLines,
  PAR1,
  SOURCES,
  splitCsv,
  SQLITE_MAGIC,
  THERMO_MAGIC,
  type Detection,
} from './sniff.ts';

// QC rules per format (SPEC M3). Head/tail checks are cheap; gzip integrity reads the whole stream (inspect.ts).

/** SAMv1 §4.1.2: the 28-byte empty BGZF block that ends every BGZF file. */
export const BGZF_EOF = Buffer.from('1f8b08040000000000ff0600424302001b0003000000000000000000', 'hex');

export interface QcInput {
  detection: Detection;
  /** Whole-object facts gathered while streaming. */
  size: number;
  tail: Uint8Array;
  /** The head is the whole (uncompressed) object. */
  complete: boolean;
  /** zlib error while decompressing the whole stream, if any. */
  gzipError: Error | undefined;
}

const check = (id: string, passed: boolean, message: string, source: string): QcCheck => ({
  id,
  passed,
  message,
  source,
});
const startsWith = (bytes: Uint8Array, prefix: readonly number[]) => prefix.every((b, i) => bytes[i] === b);
const endsWith = (bytes: Uint8Array, suffix: ArrayLike<number>) =>
  bytes.length >= suffix.length &&
  Array.from(suffix).every((b, i) => bytes[bytes.length - suffix.length + i] === b);

function gzipChecks(compression: Compression, input: QcInput): QcCheck[] {
  if (compression === 'none') return [];
  const error = input.gzipError;
  const truncated = error && /unexpected end/i.test(error.message);
  const checks = [
    check(
      'gzip.integrity',
      !error,
      !error
        ? 'The gzip stream decompresses completely and its CRC-32 checks pass.'
        : truncated
          ? 'The gzip stream is truncated (unexpected end of file).'
          : `The gzip stream is corrupt: ${error.message}.`,
      SOURCES.gzip,
    ),
  ];
  if (compression === 'bgzf') {
    const eof = endsWith(input.tail, BGZF_EOF);
    checks.push(
      check(
        'bgzf.eof',
        eof,
        eof
          ? 'The BGZF end-of-file marker is present.'
          : 'The BGZF end-of-file marker is missing (file truncated?).',
        SOURCES.bgzf,
      ),
    );
  }
  return checks;
}

const innerText = (input: QcInput) => new TextDecoder().decode(input.detection.inner);
const innerComplete = (input: QcInput) => input.complete && input.detection.compression === 'none';

function fastqChecks(input: QcInput): QcCheck[] {
  const lines = headLines(innerText(input), innerComplete(input));
  const records = Math.floor(lines.length / 4);
  for (let r = 0; r < Math.min(records, 1000); r++) {
    const [title, seq, plus, qual] = lines.slice(r * 4, r * 4 + 4) as [string, string, string, string];
    const n = r + 1;
    if (!title.startsWith('@'))
      return [
        check(
          'fastq.records',
          false,
          `FASTQ record ${n}: the title line must start with "@".`,
          SOURCES.fastq,
        ),
      ];
    if (!plus.startsWith('+'))
      return [
        check(
          'fastq.records',
          false,
          `FASTQ record ${n}: the third line must start with "+".`,
          SOURCES.fastq,
        ),
      ];
    if (seq.length !== qual.length) {
      return [
        check(
          'fastq.records',
          false,
          `FASTQ record ${n}: quality length ${qual.length} differs from sequence length ${seq.length}.`,
          SOURCES.fastq,
        ),
      ];
    }
  }
  if (!records) return [check('fastq.records', false, 'No complete FASTQ record found.', SOURCES.fastq)];
  return [
    check(
      'fastq.records',
      true,
      `The first ${Math.min(records, 1000)} FASTQ records are well formed.`,
      SOURCES.fastq,
    ),
  ];
}

function vcfChecks(input: QcInput): QcCheck[] {
  const lines = headLines(innerText(input), innerComplete(input));
  const first = lines[0]?.startsWith('##fileformat=VCFv') ?? false;
  const headerIndex = lines.findIndex((l) => !l.startsWith('##'));
  const header = headerIndex >= 0 ? lines[headerIndex]! : '';
  const hasHeader = /^#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO(\t|$)/.test(header);
  return [
    check(
      'vcf.fileformat',
      first,
      first ? 'The ##fileformat line is present.' : 'The first line must be ##fileformat=VCFv4.x.',
      SOURCES.vcf,
    ),
    check(
      'vcf.header',
      hasHeader,
      hasHeader
        ? 'The #CHROM header line is present.'
        : 'The VCF header line (#CHROM POS ID REF ALT QUAL FILTER INFO) is missing.',
      SOURCES.vcf,
    ),
  ];
}

function tableChecks(format: 'csv' | 'tsv', input: QcInput): QcCheck[] {
  const source = SOURCES[format];
  const lines = headLines(innerText(input), innerComplete(input)).filter((l) => l !== '');
  if (!lines.length) return [check(`${format}.header`, false, 'The table has no header line.', source)];
  const split = format === 'csv' ? splitCsv : (l: string) => l.split('\t');
  const width = split(lines[0]!).length;
  for (let i = 1; i < Math.min(lines.length, 10_000); i++) {
    const n = split(lines[i]!).length;
    if (n !== width) {
      return [
        check(`${format}.columns`, false, `Line ${i + 1} has ${n} fields; the header has ${width}.`, source),
      ];
    }
  }
  return [
    check(`${format}.columns`, true, `Every checked line has ${width} fields like the header.`, source),
  ];
}

function headTailChecks(format: FileFormat, input: QcInput): QcCheck[] {
  const head = input.detection.inner;
  const tail = input.tail;
  switch (format) {
    case 'parquet': {
      const ok = startsWith(head, PAR1) && endsWith(tail, PAR1) && input.size >= 12;
      return [
        check(
          'parquet.magic',
          ok,
          ok
            ? 'PAR1 magic found at both ends.'
            : 'The Parquet footer magic PAR1 is missing (file truncated?).',
          SOURCES.parquet,
        ),
      ];
    }
    case 'zip': {
      const eocd = Buffer.from(tail).lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      const ok = eocd >= 0 && tail.length - eocd >= 22;
      return [
        check(
          'zip.eocd',
          ok,
          ok
            ? 'The end of central directory record is present.'
            : 'The zip end of central directory record was not found (file truncated?).',
          SOURCES.zip,
        ),
      ];
    }
    case 'mzml': {
      const text = new TextDecoder().decode(head);
      const root = /<indexedmzML[\s>]/.test(text) ? 'indexedmzML' : 'mzML';
      const closing = `</${root}>`;
      const ok = new TextDecoder().decode(tail).trimEnd().endsWith(closing);
      return [
        check(
          'mzml.closing',
          ok,
          ok
            ? `The closing ${closing} tag is present.`
            : `The closing ${closing} tag was not found (file truncated?).`,
          SOURCES.mzml,
        ),
      ];
    }
    case 'thermo_raw': {
      const ok = startsWith(head, THERMO_MAGIC);
      return [
        check(
          'thermo_raw.header',
          ok,
          ok
            ? 'The Thermo RAW (Finnigan) header is present.'
            : 'The Thermo RAW header ("Finnigan") was not found.',
          SOURCES.thermo_raw,
        ),
      ];
    }
    case 'sciex_wiff': {
      const ok = startsWith(head, CFB_MAGIC);
      return [
        check(
          'wiff.header',
          ok,
          ok ? 'The compound-file header is present.' : 'The SCIEX .wiff compound-file header was not found.',
          SOURCES.cfb,
        ),
      ];
    }
    case 'bruker_tdf': {
      const ok = startsWith(head, SQLITE_MAGIC);
      return [
        check(
          'tdf.header',
          ok,
          ok ? 'analysis.tdf is an SQLite database.' : 'analysis.tdf is not an SQLite database.',
          SOURCES.sqlite,
        ),
      ];
    }
    default:
      return [];
  }
}

/** All QC checks for an inspected object. */
export function qcChecks(input: QcInput): QcCheck[] {
  const { format, compression, detected_by } = input.detection;
  const checks: QcCheck[] = [
    check(
      'size',
      input.size > 0,
      input.size > 0 ? `${input.size} bytes.` : 'The file is empty.',
      SOURCES.size,
    ),
    ...gzipChecks(compression, input),
  ];
  if (format === 'fastq') checks.push(...fastqChecks(input));
  else if (format === 'vcf') checks.push(...vcfChecks(input));
  else if (format === 'csv' || format === 'tsv') checks.push(...tableChecks(format, input));
  // Tail checks only make sense on uncompressed objects (the tail of a gzip is compressed bytes).
  else if (compression === 'none') checks.push(...headTailChecks(format, input));
  if (detected_by === 'extension') {
    checks.push(
      check('format.extension', true, `Recognised as ${format} by its file extension.`, SOURCES.extension),
    );
  }
  return checks;
}
