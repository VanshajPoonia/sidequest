// The sketch map: an SVG drawn from coordinates, no tiles, so it works with no signal.
// Shared by the quest card and the team event page.
import { sketch } from './plan.js';

export function mapSvg(start, stops, done = []) {
  const W = 340, H = 230;
  const { points, scaleBar } = sketch(start, stops, W, H);
  const [s, ...ps] = points;
  const d = `M${s.x},${s.y} ` + ps.map((p) => `L${p.x},${p.y}`).join(' ') + ` L${s.x},${s.y}`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sketch map of the loop">
    <path d="${d}" class="route"/>
    <g class="start"><circle cx="${s.x}" cy="${s.y}" r="9"/><text x="${s.x}" y="${s.y + 4}">S</text></g>
    ${ps.map((p, i) => `<g class="pin${done[i] ? ' done' : ''}"><circle cx="${p.x}" cy="${p.y}" r="11"/><text x="${p.x}" y="${p.y + 4}">${i + 1}</text></g>`).join('')}
    <g class="north" transform="translate(${W - 20},24)"><path d="M0,-12 L6,6 L0,2 L-6,6 Z"/><text y="18">N</text></g>
    <g class="scale" transform="translate(14,${H - 14})"><path d="M0,0 H${scaleBar.px}"/><text x="${scaleBar.px / 2}" y="-6">${scaleBar.metres} m</text></g>
  </svg>`;
}
