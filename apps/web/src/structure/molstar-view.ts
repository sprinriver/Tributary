// Mol* viewer (Phase 29, STRUC-03). Loaded on demand (a dynamic import), so pages without a 3D view never download it.
import 'molstar/build/viewer/molstar.css';
import { Viewer } from 'molstar/lib/apps/viewer/app';

/** The pLDDT preset of Mol*'s ModelCIF quality-assessment extension (colours by AlphaFold's confidence bands). */
const PLDDT_PRESET = 'preset-structure-representation-ma-quality-assessment-plddt';

export interface MountedViewer {
  dispose(): void;
}

/** Shows one mmCIF model in `element`, coloured by pLDDT when the file carries it. */
export async function mountModel(
  element: HTMLElement,
  cif: string,
  label: string,
  plddt: boolean,
): Promise<MountedViewer> {
  const viewer = await Viewer.create(element, {
    layoutIsExpanded: false,
    layoutShowControls: false,
    layoutShowLeftPanel: false,
    layoutShowLog: false,
    layoutShowSequence: true,
    viewportShowExpand: true,
    viewportShowSelectionMode: false,
    viewportShowAnimation: false,
  });
  const { plugin } = viewer;
  const data = await plugin.builders.data.rawData({ data: cif, label });
  const trajectory = await plugin.builders.structure.parseTrajectory(data, 'mmcif');
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default', {
    // The extension registers this preset at runtime (Mol*'s own loadAlphaFoldDb passes the same id); the static
    // type lists built-in presets only.
    ...(plddt ? { representationPreset: PLDDT_PRESET as 'auto' } : {}),
  });
  return { dispose: () => viewer.dispose() };
}
