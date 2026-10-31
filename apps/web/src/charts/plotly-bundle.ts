// Plotly partial bundle (web UI rule: never the full plotly.js): core + the trace types the registry declares.
// Loaded lazily by PlotlyFigure, so pages without charts never download it.
import Plotly from 'plotly.js/lib/core';
import bar from 'plotly.js/lib/bar';
import box from 'plotly.js/lib/box';
import heatmap from 'plotly.js/lib/heatmap';
import histogram from 'plotly.js/lib/histogram';
import pie from 'plotly.js/lib/pie';
import scatter from 'plotly.js/lib/scatter';
import scatter3d from 'plotly.js/lib/scatter3d';
import scattergl from 'plotly.js/lib/scattergl';
import violin from 'plotly.js/lib/violin';

Plotly.register([scatter, scattergl, heatmap, bar, box, violin, histogram, pie, scatter3d]);

export default Plotly;
