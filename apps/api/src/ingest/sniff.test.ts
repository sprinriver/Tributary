import { deflateRawSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { inspectObject, type Inspection } from './inspect.ts';
import { sniff } from './sniff.ts';

const text = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));

/** One BGZF block (SAMv1 §4.1): a gzip member with a `BC` extra subfield holding the block size − 1. */
function bgzfBlock(data: Uint8Array): Uint8Array {
  const deflated = deflateRawSync(data);
  const header = Buffer.from([0x1f, 0x8b, 8, 4, 0, 0, 0, 0, 0, 0xff, 6, 0, 0x42, 0x43, 2, 0, 0, 0]);
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(crc32(data), 0);
  trailer.writeUInt32LE(data.length, 4);
  header.writeUInt16LE(header.length + deflated.length + trailer.length - 1, 16);
  return concat(header, deflated, trailer);
}
const BGZF_EOF = Buffer.from('1f8b08040000000000ff0600424302001b0003000000000000000000', 'hex');
const bgzf = (data: Uint8Array, eof = true) => concat(bgzfBlock(data), eof ? BGZF_EOF : new Uint8Array());

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

async function inspect(bytes: Uint8Array, name: string, chunkSize = 7_919): Promise<Inspection> {
  async function* chunks() {
    for (let i = 0; i < bytes.length; i += chunkSize) yield bytes.subarray(i, i + chunkSize);
  }
  return inspectObject(chunks(), name);
}

const failed = (result: Inspection) => result.checks.filter((c) => !c.passed).map((c) => c.message);

const FASTQ = '@read1\nACGTACGT\n+\nIIIIIIII\n@read2\nTTGCA\n+\nIIIII\n';
const VCF =
  '##fileformat=VCFv4.3\n##source=synthetic\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n1\t100\t.\tA\tG\t50\tPASS\t.\n';
const PARQUET = concat(text('PAR1'), new Uint8Array(64).fill(7), Buffer.from([8, 0, 0, 0]), text('PAR1'));
const ZIP = concat(
  Buffer.from([0x50, 0x4b, 3, 4]),
  new Uint8Array(40),
  Buffer.from([0x50, 0x4b, 5, 6]),
  new Uint8Array(18),
);
const THERMO = concat(Buffer.from([0x01, 0xa1]), Buffer.from('Finnigan', 'utf16le'), new Uint8Array(1000));
const OLE = concat(Buffer.from('d0cf11e0a1b11ae1', 'hex'), new Uint8Array(1000));
const SQLITE = concat(text('SQLite format 3\0'), new Uint8Array(1000));
const MZML =
  '<?xml version="1.0" encoding="utf-8"?>\n<indexedmzML xmlns="http://psi.hupo.org/ms/mzml">\n<mzML version="1.1.0">\n</mzML>\n</indexedmzML>\n';

describe('ING-03: format sniffers', () => {
  it.each([
    ['FASTQ', text(FASTQ), 'reads.fastq', 'fastq', 'none'],
    ['gzipped FASTQ', gzipSync(text(FASTQ)), 'reads.fastq.gz', 'fastq', 'gzip'],
    ['VCF', text(VCF), 'calls.vcf', 'vcf', 'none'],
    ['BGZF VCF', bgzf(text(VCF)), 'calls.vcf.gz', 'vcf', 'bgzf'],
    ['BAM', bgzf(concat(text('BAM\x01'), new Uint8Array(32))), 'aln.bam', 'bam', 'bgzf'],
    ['CSV', text('protein,intensity\nP12345,10.5\nQ67890,11.25\n'), 'table.csv', 'csv', 'none'],
    ['TSV', text('protein\tintensity\nP12345\t10.5\nQ67890\t11.25\n'), 'table.tsv', 'tsv', 'none'],
    ['TSV named .txt', text('protein\tintensity\nP12345\t10.5\n'), 'report.txt', 'tsv', 'none'],
    ['Parquet', PARQUET, 'part-0.parquet', 'parquet', 'none'],
    ['zip', ZIP, 'bundle.zip', 'zip', 'none'],
    ['Thermo RAW', THERMO, 'run01.raw', 'thermo_raw', 'none'],
    ['Bruker timsTOF analysis.tdf', SQLITE, 'run01.d/analysis.tdf', 'bruker_tdf', 'none'],
    ['SCIEX WIFF', OLE, 'run01.wiff', 'sciex_wiff', 'none'],
    ['mzML', text(MZML), 'run01.mzML', 'mzml', 'none'],
  ] as const)('ING-03: detects %s', async (_label, bytes, name, format, compression) => {
    const result = await inspect(bytes, name);
    expect(result).toMatchObject({ format, compression });
    expect(failed(result)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('ING-03: detection uses content, not only the extension', () => {
    expect(sniff(text(FASTQ), 'reads.dat').format).toBe('fastq');
    expect(sniff(PARQUET, 'misnamed.csv').format).toBe('parquet');
    expect(sniff(gzipSync(text(VCF)), 'calls.bin')).toMatchObject({ format: 'vcf', compression: 'gzip' });
    expect(sniff(THERMO, 'run.raw').detected_by).toBe('signature');
  });

  it('ING-03: vendor formats without a signature fall back to the extension', () => {
    expect(sniff(new Uint8Array(100), 'run01.wiff.scan')).toMatchObject({
      format: 'sciex_wiff_scan',
      detected_by: 'extension',
    });
    expect(sniff(new Uint8Array(100), 'run01.d/analysis.tdf_bin')).toMatchObject({
      format: 'bruker_tdf_bin',
      detected_by: 'extension',
    });
    expect(sniff(Buffer.from([0, 1, 2, 3, 250, 251]), 'blob.bin').format).toBe('binary');
    expect(sniff(text('just some notes\n'), 'notes.md').format).toBe('text');
  });

  it('ING-03: checksum and size are computed over the whole stream', async () => {
    const bytes = gzipSync(text(FASTQ.repeat(5000)));
    const result = await inspect(bytes, 'reads.fastq.gz', 1000);
    const { createHash } = await import('node:crypto');
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(result.size_bytes).toBe(bytes.length);
  });
});

describe('ING-03: per-format QC', () => {
  it('ING-03: a corrupted gzip fails QC with a readable reason', async () => {
    const good = gzipSync(text(FASTQ.repeat(20_000)));
    const corrupted = new Uint8Array(good);
    for (let i = 2000; i < 2200; i++) corrupted[i] = corrupted[i]! ^ 0x5a;
    const result = await inspect(corrupted, 'reads.fastq.gz');
    expect(result.format).toBe('fastq');
    expect(result.passed).toBe(false);
    expect(failed(result).join(' ')).toMatch(/gzip/i);
  });

  it('ING-03: a truncated gzip fails QC', async () => {
    const good = gzipSync(text(FASTQ.repeat(20_000)));
    const result = await inspect(good.subarray(0, Math.floor(good.length / 2)), 'reads.fastq.gz');
    expect(result.passed).toBe(false);
    expect(failed(result).join(' ')).toMatch(/truncated|unexpected end/i);
  });

  it('ING-03: BGZF without the end-of-file marker fails QC', async () => {
    const result = await inspect(bgzf(text(VCF), false), 'calls.vcf.gz');
    expect(result.compression).toBe('bgzf');
    expect(failed(result).join(' ')).toMatch(/end-of-file marker/i);
  });

  it('ING-03: malformed FASTQ, VCF, CSV, Parquet, zip, mzML and RAW fail QC', async () => {
    const cases: [Uint8Array, string, RegExp][] = [
      [text('@read1\nACGT\n+\nIII\n'), 'bad.fastq', /quality/i],
      [text('##fileformat=VCFv4.3\n1\t100\t.\tA\tG\t50\tPASS\t.\n'), 'bad.vcf', /#CHROM/],
      [text('a,b,c\n1,2,3\n4,5\n'), 'bad.csv', /line 3/i],
      [PARQUET.subarray(0, PARQUET.length - 2), 'bad.parquet', /PAR1/],
      [ZIP.subarray(0, 30), 'bad.zip', /central directory/i],
      [text(MZML.slice(0, 120)), 'bad.mzML', /closing/i],
      [new Uint8Array(500), 'bad.raw', /Thermo/],
    ];
    for (const [bytes, name, reason] of cases) {
      const result = await inspect(bytes, name);
      expect(result.passed, name).toBe(false);
      expect(failed(result).join(' '), name).toMatch(reason);
    }
  });

  it('ING-03: every QC check cites its source', async () => {
    const result = await inspect(bgzf(text(VCF)), 'calls.vcf.gz');
    expect(result.checks.length).toBeGreaterThan(1);
    for (const check of result.checks) expect(check.source).not.toBe('');
  });
});
