import type { MetadataFieldDef } from '@tributary/contracts';
import type { ColDef } from 'ag-grid-community';
import { OntologyEditor } from './OntologyEditor.tsx';
import { quantityDisplay } from './validation.ts';

export interface Row {
  id: string;
  cells: Record<string, string>;
}

/** Grid columns of the manifest editor: quantities formatted, ontology fields with the term picker. */
export function buildColumnDefs({
  visible,
  fieldDefs,
  readOnly,
  setCell,
  errorAt,
  pickTerm,
}: {
  visible: string[];
  fieldDefs: MetadataFieldDef[];
  readOnly: boolean;
  setCell: (id: string, key: string, value: string) => void;
  errorAt: (id: string, key: string) => string | undefined;
  pickTerm: (ontology: string) => (term: { id: string; label: string }) => void;
}): ColDef<Row>[] {
  return visible.map((key) => {
    const def = fieldDefs.find((f) => f.key === key);
    const quantity = def?.type === 'quantity' ? (def.quantityKind ?? 'concentration') : undefined;
    return {
      colId: key,
      field: key as never,
      headerName: key,
      editable: !readOnly,
      minWidth: key === 'sample_key' ? 120 : 110,
      valueGetter: (p) => p.data?.cells[key] ?? '',
      valueSetter: (p) => {
        if (p.data) setCell(p.data.id, key, String(p.newValue ?? '').trim());
        return false;
      },
      ...(quantity ? { valueFormatter: (p) => quantityDisplay(String(p.value ?? ''), quantity) } : {}),
      ...(def?.type === 'ontology_term'
        ? {
            cellEditor: OntologyEditor,
            cellEditorPopup: true,
            cellEditorParams: { ontology: def.ontology ?? '', onPick: pickTerm(def.ontology ?? '') },
          }
        : {}),
      cellClassRules: { 'cell-invalid': (p) => !!p.data && !!errorAt(p.data.id, key) },
      tooltipValueGetter: (p) => (p.data ? errorAt(p.data.id, key) : undefined),
    } satisfies ColDef<Row>;
  });
}
