import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasSize, drawingBounds, mapCoordinates, padCanvas, setCanvas } from '../dist/plantuml/geometry.js';
import { fillFrameHeading } from '../dist/plantuml/frame.js';
import { decodeEntities, embedFonts } from '../dist/plantuml/fonts.js';
import { wrapLines, wrappedDisplayText } from '../dist/plantuml/wrap.js';
import { theme } from '../dist/core/theme.js';

// The helpers that post-process PlantUML's SVG run only with the PlantUML
// runtime in the integration suite. These tests pin their behaviour on small
// hand-written SVG, so the unit suite covers them without Java.

const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="100px" height="80px" style="width:100px;height:80px;" viewBox="0 0 100 80">${body}</svg>`;

test('mapCoordinates moves every coordinate of every shape PlantUML draws, and nothing else', () => {
  const body = [
    '<line x1="1" y1="2" x2="3" y2="4"/>',
    '<rect x="10" y="20" width="5" height="6"/>',
    '<text x="7" y="8" font-size="12">a</text>',
    '<ellipse cx="30" cy="40" rx="2" ry="3"/>',
    '<polygon points="1,2 3,4 5,6"/>',
    '<polyline points="1,2 3,4"/>',
    '<path d="M1,2 L3,4 H5 V6 A1,1 0 0 1 7,8 Z"/>',
    '<g class="untouched" x="1"/>',
  ].join('');
  const out = mapCoordinates(svg(body), { x: v => v * 2, y: v => v + 100 });
  assert.match(out, /<line x1="2" y1="102" x2="6" y2="104"\/>/);
  assert.match(out, /<rect x="20" y="120" width="10" height="6"\/>/);
  assert.match(out, /<text x="14" y="108" font-size="12">a<\/text>/);
  assert.match(out, /<ellipse cx="60" cy="140" rx="2" ry="3"\/>/);
  assert.match(out, /<polygon points="2,102,6,104,10,106"\/>/);
  assert.match(out, /<polyline points="2,102 6,104"\/>/);
  assert.match(out, /<path d="M2,102 L6,104 H10 V106 A1,1 0 0 1 14,108 Z"\/>/);
  assert.match(out, /<g class="untouched" x="1"\/>/);
  // Only one axis given: the other stays as it was.
  assert.match(mapCoordinates('<line x1="1" y1="2" x2="3" y2="4"/>', { y: v => -v }), /x1="1" y1="-2" x2="3" y2="-4"/);
});

test('canvas helpers read and set the size, and padCanvas gives a drawing an even margin', () => {
  assert.deepEqual(canvasSize(svg('')), { width: 100, height: 80 });
  assert.equal(canvasSize('<svg xmlns="x"></svg>'), undefined);
  const resized = setCanvas(svg(''), 120.2, 90);
  assert.match(resized, / width="121px" height="90px" style="width:121px;height:90px;" viewBox="0 0 121 90"/);

  const drawing = svg('<rect x="30" y="40" width="10" height="10"/><text x="35" y="60" font-size="10" textLength="20">t</text><path d="M30,40 A5,5 0 0 1 45,70"/><polygon points="31,41 33,43"/><ellipse cx="50" cy="45" rx="2" ry="2"/>');
  assert.deepEqual(drawingBounds(drawing), { minX: 30, minY: 40, maxX: 55, maxY: 70 });
  const padded = padCanvas(drawing, 8);
  assert.deepEqual(drawingBounds(padded), { minX: 8, minY: 8, maxX: 33, maxY: 38 });
  assert.deepEqual(canvasSize(padded), { width: 41, height: 46 });
  // Already at the margin: only the canvas changes. Nothing drawn: unchanged.
  assert.equal(drawingBounds(padCanvas(padded, 8)).minX, 8);
  assert.equal(padCanvas(svg(''), 8), svg(''));
});

test('fillFrameHeading closes and fills only the exact heading shape PlantUML emits', () => {
  const rect = '<g><rect fill="#FFFFFF" height="50" style="stroke:#000;" width="90" x="5" y="5"/>';
  const heading = `${rect}<path d="M60,5 L60,15 L50,25 L5,25" fill="none"`;
  assert.equal(fillFrameHeading(heading), `${rect}<path d="M5,5 L60,5 L60,15 L50,25 L5,25 Z" fill="${theme.color.frameHeadingFill}"`);
  // A path of another shape (does not end on the frame's left edge) is left alone.
  const other = `${rect}<path d="M60,5 L60,15 L50,25 L9,25" fill="none"`;
  assert.equal(fillFrameHeading(other), other);
});

test('decodeEntities decodes named, decimal and hex entities exactly once', () => {
  assert.equal(decodeEntities('&lt;a&gt; &quot;b&quot; &apos;c&apos; &#65;&#x42; &amp;lt;'), '<a> "b" \'c\' AB &lt;');
});

test('embedFonts adds one style element with the fonts the drawing uses, or nothing', async () => {
  const plain = svg('<rect x="1" y="1" width="1" height="1"/>');
  assert.equal(await embedFonts(plain), plain);
  const out = await embedFonts(svg('<text x="1" y="1">Ab</text><text x="1" y="1" font-weight="700" font-style="italic">C&amp;</text>'));
  assert.equal(out.match(/<style>/g)?.length, 1);
  assert.match(out, /^<svg[^>]*><style>@font-face/);
  assert.match(out, /data:font\//);
});

test('PlantUML text wrapping keeps every character and encodes each line separately', () => {
  const text = 'a fairly long name with someCamelCaseIdentifier';
  const lines = wrapLines(text, 12);
  assert.ok(lines.length > 2);
  assert.equal(lines.join(''), text);
  assert.ok(lines.every(l => [...l].length <= 12), lines.join('|'));
  assert.equal(wrappedDisplayText(text, 12).split('\\n').length, lines.length);
});
