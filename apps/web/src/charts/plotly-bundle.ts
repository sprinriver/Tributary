// Plotly partial bundle (web UI rule: never the full plotly.js): core + the trace types the registry declares.
// Loaded lazily by PlotlyFigure, so pages without charts never download it.
import Plotly from 'plotly.js/lib/core';
import heatmap from 'plotly.js/lib/heatmap';
import scatter from 'plotly.js/lib/scatter';
import scattergl from 'plotly.js/lib/scattergl';

Plotly.register([scatter, scattergl, heatmap]);

export default Plotly;
