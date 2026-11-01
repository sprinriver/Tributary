// Test helper: a valid 96-sample proteomics manifest as raw string cells (as parsed from a TSV).
export type RawRow = Record<string, string>;

const ROWS = 'ABCDEFGH';

export function validManifestRows(): RawRow[] {
  const rows: RawRow[] = [];
  for (let i = 0; i < 96; i += 1) {
    const row = ROWS[Math.floor(i / 12)] ?? 'A';
    const col = String((i % 12) + 1).padStart(2, '0');
    const isVehicle = i % 12 === 0;
    rows.push({
      sample_key: `S${String(i + 1).padStart(3, '0')}`,
      source_name: `source-${i + 1}`,
      organism: 'Homo sapiens',
      cell_line: 'not applicable',
      compound_id: isVehicle ? 'vehicle' : `CPD-${String((i % 4) + 1).padStart(4, '0')}`,
      vehicle: 'DMSO',
      dose: isVehicle ? 'not applicable' : '1 µM',
      time: '24 h',
      replicate_group: `G${(i % 12) + 1}`,
      biological_replicate: String(Math.floor(i / 12) + 1),
      plate: 'P1',
      well: `${row}${col}`,
      raw_file: `s3://example-raw/run-${i + 1}.raw`,
    });
  }
  return rows;
}
