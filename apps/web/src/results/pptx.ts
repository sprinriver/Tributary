// Draws a slide plan with pptxgenjs (Phase 33), loaded on demand.
import type { SlideSpec } from './report-slides.ts';

const INK = '102A43';
const MUTED = '52606D';

export async function writePptx(slides: SlideSpec[], fileName: string): Promise<void> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in
  pptx.title = slides[0]?.title ?? 'Report';
  slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    const first = i === 0;
    slide.addText(s.title, {
      x: 0.5,
      y: first ? 2.4 : 0.35,
      w: 12.3,
      h: first ? 1.1 : 0.7,
      fontSize: first ? 34 : 24,
      bold: true,
      color: INK,
    });
    const top = first ? 3.6 : 1.15;
    if (s.lines?.length)
      slide.addText(s.lines.join('\n'), {
        x: 0.5,
        y: top,
        w: s.image ? 4.6 : 12.3,
        h: s.image ? 5.6 : first ? 1.2 : 5.8,
        fontSize: first ? 16 : s.image ? 14 : 13,
        color: first ? MUTED : INK,
        valign: 'top',
      });
    if (s.image)
      slide.addImage({
        data: s.image,
        x: 5.3,
        y: 1.15,
        w: 7.6,
        h: 5.9,
        sizing: { type: 'contain', w: 7.6, h: 5.9 },
      });
    if (s.table)
      slide.addTable(
        s.table.map((row, r) =>
          row.map((text) => ({ text, options: r === 0 ? { bold: true, fill: { color: 'EDF2FF' } } : {} })),
        ),
        {
          x: 0.5,
          y: 1.15,
          w: 12.3,
          fontSize: 11,
          color: INK,
          border: { type: 'solid', pt: 0.5, color: 'D9E2EC' },
        },
      );
  });
  await pptx.writeFile({ fileName });
}
