// Court geometry — ported from a horizontal full-court SVG (940×500 viewBox),
// using only the LEFT half (the half-court we plot LeBron's shots into). The
// reference SVG uses true-ish NBA proportions: lane 190×160, FT radius 60,
// three-point radius 237.5, restricted-area radius 40, rim radius 15, corners
// at y=30/470. Our render keeps the dark-canvas / white-lines aesthetic; only
// the geometry is borrowed.
//
// Reference frame ("court" coords) — right-handed, basket on the LEFT:
//   x ∈ [0, 470]   — baseline (x=0) → half-court line (x=470)
//   y ∈ [0, 500]   — top sideline (y=0) → bottom sideline (y=500)
//   rim center     = (55, 250)
//   backboard      = x=40, y=220..280
//   lane (paint)   = x∈[0,190], y∈[170,330]
//   FT circle      = r=60 at (190, 250); back half (toward baseline) dashed
//   restricted     = r=40 at (55, 250), opens toward half-court (right)
//   3pt corners    = horizontal segments at y=30 and y=470 from x=0..x=139
//   3pt arc        = r=237.5 around rim (55,250), opens toward half-court
//   center circle  = r=60 at (470, 250) — only the inner edge (half) shows

export const COURT = {
  width: 470,
  height: 500,
  baseline: 0,
  midcourt: 470,
  rim: { x: 55, y: 250, r: 15 },
  backboard: { x: 40, y0: 220, y1: 280 },
  lane: { x0: 0, x1: 190, y0: 170, y1: 330 },
  ft: { cx: 190, cy: 250, r: 60 },
  ra: { cx: 55, cy: 250, r: 40 },
  three: { r: 237.5, cornerX: 139, cornerYTop: 30, cornerYBot: 470 },
  centerCircle: { cx: 470, cy: 250, r: 60 },
  // Lane block + ticks (drawn on both top and bottom edges of the lane).
  laneBlocks: [{ x0: 75, x1: 90 }], // small solid block (player position)
  laneTicks: [110, 130, 155], // open ticks for FT alignment
} as const;

// NBA stat-API coords use the same units as our court frame: rim at (0, 0),
// baseline at loc_y ≈ -47.5, half-court at +470, sidelines at loc_x = ±250.
// Three-point radius is 237.5 in both systems, so the scale is 1. We just
// translate so NBA (0, 0) lands on the rim. (Earlier code stretched depth
// to make 47.5 NBA-units fit our court's 55-unit rim-to-baseline distance,
// which pushed 3PT shots ~16% past the painted arc.)
const SCALE_X = 1;
const SCALE_Y = 1;

// Compute the largest UNIFORM scale that fits the court rect (470×500) into
// the canvas with pad on all sides, so circles stay circles. The court is
// horizontally centered and vertically centered (pillar/letterboxed).
function fit(cw: number, ch: number, pad: number) {
  const innerW = cw - pad * 2;
  const innerH = ch - pad * 2;
  const scale = Math.min(innerW / COURT.width, innerH / COURT.height);
  const drawnW = COURT.width * scale;
  const drawnH = COURT.height * scale;
  const offX = pad + (innerW - drawnW) / 2;
  const offY = pad + (innerH - drawnH) / 2;
  return { scale, offX, offY };
}

// Map court coords → canvas pixels using the fitted, uniform scale.
function courtToCanvas(
  cx: number,
  cy: number,
  cw: number,
  ch: number,
  pad: number,
): { x: number; y: number } {
  const f = fit(cw, ch, pad);
  return { x: f.offX + cx * f.scale, y: f.offY + cy * f.scale };
}

// Project an NBA stat-API shot coord into canvas pixels via court coords.
//   NBA loc_y (depth, + = toward half-court) → court x
//   NBA loc_x (sideline, - = audience-left)  → court y (centered)
export function nbaToCanvas(
  locX: number,
  locY: number,
  cw: number,
  ch: number,
  pad: number,
): { x: number; y: number } {
  const courtX = COURT.rim.x + locY * SCALE_X;
  const courtY = COURT.height / 2 + locX * SCALE_Y;
  return courtToCanvas(courtX, courtY, cw, ch, pad);
}

function len(d: number, cw: number, ch: number, pad: number): number {
  return d * fit(cw, ch, pad).scale;
}

// Draw the half-court markings, ported from the reference full-court SVG.
export function drawCourt(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  pad: number,
  opts: { stroke: string; lineWidth: number },
) {
  ctx.save();
  ctx.strokeStyle = opts.stroke;
  ctx.lineWidth = opts.lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const map = (x: number, y: number) => courtToCanvas(x, y, cw, ch, pad);

  // Outer boundary: baseline (left), sidelines (top + bottom), half-court (right).
  const ob0 = map(0, 0);
  const ob1 = map(COURT.width, COURT.height);
  ctx.beginPath();
  ctx.rect(ob0.x, ob0.y, ob1.x - ob0.x, ob1.y - ob0.y);
  ctx.stroke();

  // Lane (paint).
  const ln0 = map(COURT.lane.x0, COURT.lane.y0);
  const ln1 = map(COURT.lane.x1, COURT.lane.y1);
  ctx.beginPath();
  ctx.rect(ln0.x, ln0.y, ln1.x - ln0.x, ln1.y - ln0.y);
  ctx.stroke();

  // Three-point corners (straight segments along the sidelines).
  const tA0 = map(0, COURT.three.cornerYTop);
  const tA1 = map(COURT.three.cornerX, COURT.three.cornerYTop);
  const tB0 = map(0, COURT.three.cornerYBot);
  const tB1 = map(COURT.three.cornerX, COURT.three.cornerYBot);
  ctx.beginPath();
  ctx.moveTo(tA0.x, tA0.y);
  ctx.lineTo(tA1.x, tA1.y);
  ctx.moveTo(tB0.x, tB0.y);
  ctx.lineTo(tB1.x, tB1.y);
  ctx.stroke();
  // Three-point arc — opens to the right (toward half-court). Compute end
  // angles so the arc meets the corner segments precisely.
  const rim = map(COURT.rim.x, COURT.rim.y);
  const tpRpx = len(COURT.three.r, cw, ch, pad);
  const startAngle = Math.atan2(tA1.y - rim.y, tA1.x - rim.x);
  const endAngle = Math.atan2(tB1.y - rim.y, tB1.x - rim.x);
  // Sweep clockwise from top-corner to bottom-corner (through the right side).
  ctx.beginPath();
  ctx.arc(rim.x, rim.y, tpRpx, startAngle, endAngle);
  ctx.stroke();

  // Free-throw circle. Front half (toward half-court, opens right) solid;
  // back half (toward baseline, opens left) dashed.
  const ftCenter = map(COURT.ft.cx, COURT.ft.cy);
  const ftRpx = len(COURT.ft.r, cw, ch, pad);
  ctx.beginPath();
  ctx.arc(ftCenter.x, ftCenter.y, ftRpx, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.arc(ftCenter.x, ftCenter.y, ftRpx, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.stroke();
  ctx.restore();

  // Restricted-area arc — opens toward half-court (right).
  const raCenter = map(COURT.ra.cx, COURT.ra.cy);
  const raRpx = len(COURT.ra.r, cw, ch, pad);
  ctx.beginPath();
  ctx.arc(raCenter.x, raCenter.y, raRpx, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();

  // Lane block + ticks (drawn on both top and bottom edges of the lane).
  const tickLen = 8; // court units; protrusion outward from the lane line
  for (const sideY of [COURT.lane.y0, COURT.lane.y1]) {
    const outY = sideY === COURT.lane.y0 ? sideY - tickLen : sideY + tickLen;
    // Solid block.
    for (const blk of COURT.laneBlocks) {
      const a = map(blk.x0, sideY);
      const b = map(blk.x1, outY);
      const x0 = Math.min(a.x, b.x);
      const y0 = Math.min(a.y, b.y);
      ctx.fillStyle = opts.stroke;
      ctx.fillRect(x0, y0, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
    // Open ticks.
    for (const tx of COURT.laneTicks) {
      const a = map(tx, sideY);
      const b = map(tx, outY);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  // Backboard.
  const bbA = map(COURT.backboard.x, COURT.backboard.y0);
  const bbB = map(COURT.backboard.x, COURT.backboard.y1);
  ctx.save();
  ctx.lineWidth = opts.lineWidth * 1.6;
  ctx.beginPath();
  ctx.moveTo(bbA.x, bbA.y);
  ctx.lineTo(bbB.x, bbB.y);
  ctx.stroke();
  ctx.restore();

  // Rim circle.
  const rimRpx = len(COURT.rim.r, cw, ch, pad);
  ctx.beginPath();
  ctx.arc(rim.x, rim.y, rimRpx, 0, Math.PI * 2);
  ctx.stroke();

  // Center-circle inner edge — only the half facing into our half-court is
  // visible (the other half belongs to the away end).
  const cc = map(COURT.centerCircle.cx, COURT.centerCircle.cy);
  const ccR = len(COURT.centerCircle.r, cw, ch, pad);
  ctx.beginPath();
  ctx.arc(cc.x, cc.y, ccR, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.stroke();

  ctx.restore();
}

// ── Full-court drawing ──────────────────────────────────────────────────

const FULL_COURT_W = 940; // 470 × 2
const FULL_COURT_H = 500;

function fitFull(cw: number, ch: number, pad: number) {
  const innerW = cw - pad * 2;
  const innerH = ch - pad * 2;
  const scale = Math.min(innerW / FULL_COURT_W, innerH / FULL_COURT_H);
  const drawnW = FULL_COURT_W * scale;
  const drawnH = FULL_COURT_H * scale;
  const offX = pad + (innerW - drawnW) / 2;
  const offY = pad + (innerH - drawnH) / 2;
  return { scale, offX, offY };
}

function courtToCanvasFull(
  cx: number,
  cy: number,
  cw: number,
  ch: number,
  pad: number,
): { x: number; y: number } {
  const f = fitFull(cw, ch, pad);
  return { x: f.offX + cx * f.scale, y: f.offY + cy * f.scale };
}

function lenFull(d: number, cw: number, ch: number, pad: number): number {
  return d * fitFull(cw, ch, pad).scale;
}

/** Map NBA shot coords to canvas pixels on the LEFT half of a full court. */
export function nbaToCanvasFullCourt(
  locX: number,
  locY: number,
  cw: number,
  ch: number,
  pad: number,
): { x: number; y: number } {
  const courtX = COURT.rim.x + locY * SCALE_X;
  const courtY = FULL_COURT_H / 2 + locX * SCALE_Y;
  return courtToCanvasFull(courtX, courtY, cw, ch, pad);
}

/** Draw a full NBA court (both halves, mirrored). */
export function drawFullCourt(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  pad: number,
  opts: { stroke: string; lineWidth: number },
) {
  ctx.save();
  ctx.strokeStyle = opts.stroke;
  ctx.lineWidth = opts.lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const map = (x: number, y: number) => courtToCanvasFull(x, y, cw, ch, pad);
  const lenF = (d: number) => lenFull(d, cw, ch, pad);

  // Outer boundary
  const ob0 = map(0, 0);
  const ob1 = map(FULL_COURT_W, FULL_COURT_H);
  ctx.beginPath();
  ctx.rect(ob0.x, ob0.y, ob1.x - ob0.x, ob1.y - ob0.y);
  ctx.stroke();

  // Half-court line
  const hc0 = map(470, 0);
  const hc1 = map(470, FULL_COURT_H);
  ctx.beginPath();
  ctx.moveTo(hc0.x, hc0.y);
  ctx.lineTo(hc1.x, hc1.y);
  ctx.stroke();

  // Center circle (full)
  const cc = map(470, 250);
  const ccR = lenF(COURT.centerCircle.r);
  ctx.beginPath();
  ctx.arc(cc.x, cc.y, ccR, 0, Math.PI * 2);
  ctx.stroke();

  // Draw both halves (left = home basket, right = mirrored)
  const drawHalf = (mirrorX: boolean) => {
    const mx = (x: number, y: number) => {
      const cx = mirrorX ? FULL_COURT_W - x : x;
      return map(cx, y);
    };

    // Lane
    const ln0 = mx(COURT.lane.x0, COURT.lane.y0);
    const ln1 = mx(COURT.lane.x1, COURT.lane.y1);
    const lx = Math.min(ln0.x, ln1.x);
    const ly = Math.min(ln0.y, ln1.y);
    ctx.beginPath();
    ctx.rect(lx, ly, Math.abs(ln1.x - ln0.x), Math.abs(ln1.y - ln0.y));
    ctx.stroke();

    // Three-point corners
    const tA0 = mx(0, COURT.three.cornerYTop);
    const tA1 = mx(COURT.three.cornerX, COURT.three.cornerYTop);
    const tB0 = mx(0, COURT.three.cornerYBot);
    const tB1 = mx(COURT.three.cornerX, COURT.three.cornerYBot);
    ctx.beginPath();
    ctx.moveTo(tA0.x, tA0.y);
    ctx.lineTo(tA1.x, tA1.y);
    ctx.moveTo(tB0.x, tB0.y);
    ctx.lineTo(tB1.x, tB1.y);
    ctx.stroke();

    // Three-point arc
    const rimPos = mx(COURT.rim.x, COURT.rim.y);
    const tpR = lenF(COURT.three.r);
    const sa = Math.atan2(tA1.y - rimPos.y, tA1.x - rimPos.x);
    const ea = Math.atan2(tB1.y - rimPos.y, tB1.x - rimPos.x);
    ctx.beginPath();
    ctx.arc(rimPos.x, rimPos.y, tpR, sa, ea, mirrorX);
    ctx.stroke();

    // FT circle
    const ftC = mx(COURT.ft.cx, COURT.ft.cy);
    const ftR = lenF(COURT.ft.r);
    const solidStart = mirrorX ? Math.PI / 2 : -Math.PI / 2;
    const solidEnd = mirrorX ? -Math.PI / 2 : Math.PI / 2;
    ctx.beginPath();
    ctx.arc(ftC.x, ftC.y, ftR, solidStart, solidEnd, mirrorX);
    ctx.stroke();
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(ftC.x, ftC.y, ftR, solidEnd, solidStart, mirrorX);
    ctx.stroke();
    ctx.restore();

    // Restricted area
    const raC = mx(COURT.ra.cx, COURT.ra.cy);
    const raR = lenF(COURT.ra.r);
    ctx.beginPath();
    ctx.arc(raC.x, raC.y, raR, solidStart, solidEnd, mirrorX);
    ctx.stroke();

    // Lane ticks
    const tickLen = 8;
    for (const sideY of [COURT.lane.y0, COURT.lane.y1]) {
      const outY = sideY === COURT.lane.y0 ? sideY - tickLen : sideY + tickLen;
      for (const blk of COURT.laneBlocks) {
        const a = mx(blk.x0, sideY);
        const b = mx(blk.x1, outY);
        const bx = Math.min(a.x, b.x);
        const by = Math.min(a.y, b.y);
        ctx.fillStyle = opts.stroke;
        ctx.fillRect(bx, by, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      }
      for (const tx of COURT.laneTicks) {
        const a = mx(tx, sideY);
        const b = mx(tx, outY);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Backboard
    const bbA = mx(COURT.backboard.x, COURT.backboard.y0);
    const bbB = mx(COURT.backboard.x, COURT.backboard.y1);
    ctx.save();
    ctx.lineWidth = opts.lineWidth * 1.6;
    ctx.beginPath();
    ctx.moveTo(bbA.x, bbA.y);
    ctx.lineTo(bbB.x, bbB.y);
    ctx.stroke();
    ctx.restore();

    // Rim
    const rimR = lenF(COURT.rim.r);
    ctx.beginPath();
    ctx.arc(rimPos.x, rimPos.y, rimR, 0, Math.PI * 2);
    ctx.stroke();
  };

  drawHalf(false); // Left half (shots go here)
  drawHalf(true);  // Right half (mirrored)

  ctx.restore();
}

// Compat shims for any caller still using the old NBA-units helpers. Both
// axes share the same uniform scale now, so cw is sufficient.
export function nbaScaleX(delta: number, cw: number, pad: number): number {
  // Approximate canvas height by guessing the typical aspect; callers that
  // need precision should use nbaToCanvas directly.
  return len(delta * SCALE_X, cw, cw, pad);
}
export function nbaScaleY(delta: number, ch: number, pad: number): number {
  return len(delta * SCALE_Y, ch, ch, pad);
}
