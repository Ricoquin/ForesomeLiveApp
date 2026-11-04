import React, { useEffect, useMemo, useRef, useState } from 'react';
import './hole-map.css';

const FW_W = 540;
const FW_H = 360;
const GR_W = 540;
const GR_H = 340;

const TEE_POS = { x: 282, y: 332 };
const PIN_POS = { x: 286, y: 58 };

function recommendClub(yds) {
  if (yds >= 235) return 'Driver';
  if (yds >= 210) return '3 Wood';
  if (yds >= 192) return '5 Wood';
  if (yds >= 178) return '4 Iron';
  if (yds >= 165) return '5 Iron';
  if (yds >= 152) return '6 Iron';
  if (yds >= 140) return '7 Iron';
  if (yds >= 128) return '8 Iron';
  if (yds >= 115) return '9 Iron';
  if (yds >= 98) return 'PW';
  if (yds >= 78) return 'GW';
  if (yds >= 52) return 'SW';
  return 'LW';
}

function shortClub(club) {
  const map = {
    'Driver': 'Driver',
    '3 Wood': '3W',
    '5 Wood': '5W',
    '4 Iron': '4i',
    '5 Iron': '5i',
    '6 Iron': '6i',
    '7 Iron': '7i',
    '8 Iron': '8i',
    '9 Iron': '9i',
    'PW': 'PW',
    'GW': 'GW',
    'SW': 'SW',
    'LW': '60°'
  };
  return map[club] || club;
}

// Thermal slope color ramp (0% -> 7%+) matching the LiDAR screenshot
function slopeColorRGB(slopePct) {
  const t = Math.max(0, Math.min(1, slopePct / 7.2));
  const stops = [
    { t: 0.00, r: 10,  g: 98,  b: 220 }, // deep blue
    { t: 0.18, r: 0,   g: 210, b: 235 }, // cyan
    { t: 0.36, r: 32,  g: 214, b: 115 }, // emerald green
    { t: 0.56, r: 245, g: 215, b: 35  }, // yellow
    { t: 0.74, r: 238, g: 95,  b: 40  }, // orange-red
    { t: 1.00, r: 185, g: 22,  b: 52  }  // crimson/magenta
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / (b.t - a.t);
      return [
        Math.round(a.r + (b.r - a.r) * u),
        Math.round(a.g + (b.g - a.g) * u),
        Math.round(a.b + (b.b - a.b) * u)
      ];
    }
  }
  return [185, 22, 52];
}

// Continuous 3D green surface elevation z(nx, ny) in inches (nx, ny in [-1, 1])
// Produces the central false-front / ridge tier & upper/lower swale basins seen in the LiDAR screenshot
function evalGreenSurface(nx, ny, holeSeed = 1) {
  const s = ((holeSeed % 5) - 2) * 0.08;
  // Strong central tier ramp (steep red/burgundy band across the middle)
  const tierRamp = -28 * Math.tanh((ny - 0.04 + 0.14 * Math.sin(nx * 1.7 + s)) * 3.3);
  // General back-to-front tilt + subtle left-to-right cant
  const baseTilt = -12 * ny + (4.5 + holeSeed % 4) * nx;
  // Upper-left depression / collection bowl (blue eye in top-left of screenshot)
  const upperBowl = -15 * Math.exp(-((nx + 0.34) ** 2 / 0.11 + (ny + 0.52) ** 2 / 0.09));
  // Lower-right crown / mound (blue flat spot at bottom-right of screenshot)
  const lowerCrown = 13 * Math.exp(-((nx - 0.26) ** 2 / 0.12 + (ny - 0.58) ** 2 / 0.09));
  return tierRamp + baseTilt + upperBowl + lowerCrown;
}

function evalGreenGradient(nx, ny, holeSeed = 1) {
  const eps = 0.008;
  const dzdx = (evalGreenSurface(nx + eps, ny, holeSeed) - evalGreenSurface(nx - eps, ny, holeSeed)) / (2 * eps);
  const dzdy = (evalGreenSurface(nx, ny + eps, holeSeed) - evalGreenSurface(nx, ny - eps, holeSeed)) / (2 * eps);
  // Convert to % grade (green radius ~ 18 yards = 648 inches)
  const slopePct = Math.hypot(dzdx, dzdy) / 11.5;
  return { dzdx, dzdy, slopePct };
}

// Super-ellipse / kidney golf green boundary check (nx, ny in [-1, 1])
function insideGreenMask(nx, ny) {
  // Slight kidney pinch at top & bottom
  const modY = ny + 0.05 * Math.cos(nx * Math.PI);
  const d = (nx * nx) / (0.94 * 0.94) + (modY * modY) / (0.86 * 0.86);
  return d;
}

export default function HoleMapView({
  courseName = 'Pebble Cove Championship',
  currentHole = 1,
  onSelectHole,
  par = 4,
  yards = 418,
  hcp = 7,
  distanceToPinGps = null,
  score = 4,
  putts = 2,
  fir = false,
  gir = false,
  pen = false,
  vsParText = 'E',
  holeScores = [],
  onAdjustScore,
  onAdjustPutts,
  onToggleStat,
  onPrevHole,
  onNextHole,
  onExit,
  compact = false
}) {
  const fwCanvasRef = useRef(null);
  const grCanvasRef = useRef(null);
  const stripRef = useRef(null);

  // Target point on Fairway canvas (default matches screenshot: ~113y from tee, 264y approach)
  const [targetsByHole, setTargetsByHole] = useState({});
  const target = targetsByHole[currentHole] || { x: 252, y: 248 };

  // Ball and Pin positions on LiDAR Green canvas (normalized in green coordinates)
  const [greenStateByHole, setGreenStateByHole] = useState({});
  const greenState = greenStateByHole[currentHole] || {
    ball: { x: 222, y: 226 },
    pin: { x: 296, y: 124 }
  };

  const [moveMode, setMoveMode] = useState('ball'); // 'ball' | 'pin'
  const [flowOn, setFlowOn] = useState(true);
  const [draggingFw, setDraggingFw] = useState(false);
  const [draggingGr, setDraggingGr] = useState(null); // 'ball' | 'pin' | null

  // Scroll active hole chip into view
  useEffect(() => {
    const el = stripRef.current?.querySelector('.hm-hole-chip.active');
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [currentHole]);

  // Calculate Fairway distances & club recommendations
  const fwMetrics = useMemo(() => {
    const totalPx = Math.hypot(PIN_POS.x - TEE_POS.x, PIN_POS.y - TEE_POS.y);
    const scale = (yards || 418) / totalPx;
    const teeToTarget = Math.max(10, Math.round(Math.hypot(target.x - TEE_POS.x, target.y - TEE_POS.y) * scale));
    const targetToPin = Math.max(5, Math.round(Math.hypot(PIN_POS.x - target.x, PIN_POS.y - target.y) * scale));
    const teeClub = recommendClub(teeToTarget);
    const appClub = recommendClub(targetToPin);
    const dispersion = Math.max(4, Math.round(targetToPin * 0.045));
    const pinYds = distanceToPinGps !== null ? distanceToPinGps : targetToPin;
    const frontYds = Math.max(1, pinYds - 35);
    const backYds = pinYds + 20;
    const windDelta = +4;
    const playsLike = pinYds + windDelta;
    return {
      teeToTarget,
      targetToPin,
      teeClub,
      appClub,
      dispersion,
      pinYds,
      frontYds,
      backYds,
      playsLike,
      windDelta
    };
  }, [target, yards, distanceToPinGps]);

  // Calculate Putt Break physics & telemetry on the LiDAR Green
  const puttData = useMemo(() => {
    const cx = GR_W / 2;
    const cy = GR_H / 2 + 4;
    const rx = 148;
    const ry = 122;

    const bNx = (greenState.ball.x - cx) / rx;
    const bNy = (greenState.ball.y - cy) / ry;
    const pNx = (greenState.pin.x - cx) / rx;
    const pNy = (greenState.pin.y - cy) / ry;

    // Putt distance in feet (green width ~ 90 ft)
    const distPx = Math.hypot(greenState.pin.x - greenState.ball.x, greenState.pin.y - greenState.ball.y);
    const puttFeet = Math.max(2, Math.round(distPx * 0.27));

    // Elevation difference in inches
    const zBall = evalGreenSurface(bNx, bNy, currentHole);
    const zPin = evalGreenSurface(pNx, pNy, currentHole);
    const slopeInches = Math.round(zPin - zBall);

    // Sample cross-slope along the putt line to compute break curve & AimPoint offset
    const steps = 40;
    let avgGradX = 0;
    let avgGradY = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const nx = bNx + (pNx - bNx) * t;
      const ny = bNy + (pNy - bNy) * t;
      const g = evalGreenGradient(nx, ny, currentHole);
      // Weight middle of putt strongest
      const w = Math.sin(t * Math.PI) + 0.35;
      avgGradX += g.dzdx * w;
      avgGradY += g.dzdy * w;
    }
    avgGradX /= steps;
    avgGradY /= steps;

    // Unit vector from ball to pin
    const dx = greenState.pin.x - greenState.ball.x;
    const dy = greenState.pin.y - greenState.ball.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // Right-hand perpendicular vector (relative to golfer looking from Ball -> Pin)
    const px = -uy;
    const py = ux;

    // Uphill component along perpendicular
    // Gravity pulls ball toward -grad; so to hole the putt we must aim toward +grad!
    const crossGravity = -(avgGradX * px + avgGradY * py);
    const breakPx = Math.max(-75, Math.min(75, crossGravity * (distPx / 125) * 2.1));
    const breakInches = Math.round(Math.abs(breakPx) * 1.15);
    const breakDir = breakPx >= 0 ? 'L → R' : 'R → L';

    // Aim point (where golfer must aim so gravity curves ball into the cup)
    const aimPoint = {
      x: greenState.pin.x - px * breakPx * 0.95,
      y: greenState.pin.y - py * breakPx * 0.95
    };

    // Quadratic/cubic Bezier control point for the curved yellow putt line
    const ctrlPoint = {
      x: (greenState.ball.x + greenState.pin.x) / 2 - px * breakPx * 0.62,
      y: (greenState.ball.y + greenState.pin.y) / 2 - py * breakPx * 0.62
    };

    // Rollout tail past the cup (white line curving downhill past the pin, as in screenshot)
    const pinGrad = evalGreenGradient(pNx, pNy, currentHole);
    const tailEnd = {
      x: greenState.pin.x + ux * 68 - pinGrad.dzdx * 2.2,
      y: greenState.pin.y + uy * 22 - pinGrad.dzdy * 1.4
    };
    const tailCtrl = {
      x: greenState.pin.x + ux * 28,
      y: greenState.pin.y + uy * 8 - 14
    };

    return {
      puttFeet,
      breakInches,
      breakDir,
      slopeInches,
      aimPoint,
      ctrlPoint,
      tailCtrl,
      tailEnd
    };
  }, [greenState, currentHole]);

  // ─────────────────── DRAW CARD 1: 3D SATELLITE FAIRWAY GPS ───────────────────
  useEffect(() => {
    const canvas = fwCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, FW_W, FW_H);

    // 1. Deep emerald rough background with subtle radial vignette
    const bgGrad = ctx.createRadialGradient(275, 180, 40, 275, 180, 340);
    bgGrad.addColorStop(0, '#143822');
    bgGrad.addColorStop(1, '#091d11');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, FW_W, FW_H);

    // Subtle organic turf speckles
    ctx.fillStyle = 'rgba(255,255,255,0.018)';
    for (let i = 0; i < 240; i++) {
      const sx = ((i * 97) % FW_W);
      const sy = ((i * 53) % FW_H);
      ctx.fillRect(sx, sy, 2, 2);
    }

    // 2. Intermediate rough corridor wrapping Tee -> Fairway -> Green
    const drawCorridorPath = () => {
      ctx.beginPath();
      ctx.moveTo(235, 348);
      ctx.bezierCurveTo(175, 310, 155, 235, 172, 162);
      ctx.bezierCurveTo(188, 95, 224, 38, 286, 36);
      ctx.bezierCurveTo(342, 38, 348, 105, 342, 175);
      ctx.bezierCurveTo(336, 245, 326, 305, 316, 348);
      ctx.closePath();
    };
    drawCorridorPath();
    ctx.fillStyle = '#1b4d2e';
    ctx.fill();

    // 3. Winding Cart Path on the right
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(332, 360);
    ctx.bezierCurveTo(362, 260, 362, 140, 315, 34);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = '#5c665f';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();

    // 4. Contoured Main Fairway with Cross-Cut Diamond Mowing Stripes
    const defineFairway = () => {
      ctx.beginPath();
      ctx.moveTo(255, 320);
      ctx.bezierCurveTo(212, 288, 198, 232, 212, 172);
      ctx.bezierCurveTo(224, 128, 255, 108, 288, 114);
      ctx.bezierCurveTo(322, 120, 324, 178, 318, 232);
      ctx.bezierCurveTo(312, 282, 302, 308, 288, 322);
      ctx.closePath();
    };

    ctx.save();
    defineFairway();
    ctx.fillStyle = '#286c3b';
    ctx.fill();
    ctx.clip();

    // Diagonal stripe pass 1
    ctx.strokeStyle = 'rgba(72, 168, 96, 0.26)';
    ctx.lineWidth = 10;
    for (let d = -200; d < 600; d += 22) {
      ctx.beginPath();
      ctx.moveTo(d, 90);
      ctx.lineTo(d + 190, 340);
      ctx.stroke();
    }
    // Diagonal stripe pass 2 (cross-cut diamonds)
    ctx.strokeStyle = 'rgba(20, 65, 34, 0.22)';
    for (let d = -100; d < 700; d += 22) {
      ctx.beginPath();
      ctx.moveTo(d, 90);
      ctx.lineTo(d - 190, 340);
      ctx.stroke();
    }
    ctx.restore();

    // Fairway edge highlight
    defineFairway();
    ctx.strokeStyle = 'rgba(88, 190, 112, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 5. Distance Arc Rings across the Fairway (red, white, yellow dashed arcs)
    const arcRings = [
      { r: 108, color: 'rgba(235, 95, 85, 0.55)' },
      { r: 148, color: 'rgba(255, 255, 255, 0.55)' },
      { r: 188, color: 'rgba(245, 208, 66, 0.65)' }
    ];
    arcRings.forEach(ring => {
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([6, 6]);
      ctx.arc(PIN_POS.x, PIN_POS.y, ring.r, Math.PI * 0.36, Math.PI * 0.68);
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    });

    // 6. Coastal Water Hazard on the Left with Sand/Stone Bank & Depth Ripples
    const defineLake = () => {
      ctx.beginPath();
      ctx.moveTo(92, 108);
      ctx.bezierCurveTo(154, 104, 166, 152, 164, 212);
      ctx.bezierCurveTo(162, 266, 138, 288, 68, 294);
      ctx.bezierCurveTo(22, 296, 16, 252, 20, 195);
      ctx.bezierCurveTo(25, 138, 44, 110, 92, 108);
      ctx.closePath();
    };
    ctx.save();
    defineLake();
    ctx.strokeStyle = '#bda982';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = '#1b5f9c';
    ctx.lineWidth = 3;
    ctx.stroke();

    const lakeGrad = ctx.createLinearGradient(20, 110, 160, 290);
    lakeGrad.addColorStop(0, '#0a3d6b');
    lakeGrad.addColorStop(0.5, '#0f528c');
    lakeGrad.addColorStop(1, '#082f54');
    ctx.fillStyle = lakeGrad;
    ctx.fill();
    ctx.clip();

    // Horizontal water depth shimmer lines
    ctx.strokeStyle = 'rgba(110, 195, 255, 0.16)';
    ctx.lineWidth = 1.5;
    for (let y = 116; y < 292; y += 9) {
      ctx.beginPath();
      ctx.moveTo(18, y);
      ctx.lineTo(168, y);
      ctx.stroke();
    }
    ctx.restore();

    // 7. Putting Green at Top with Mowing Stripes & Collar
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(PIN_POS.x, PIN_POS.y + 8, 33, 24, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#267841';
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(PIN_POS.x, PIN_POS.y + 8, 29, 20, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#38c768';
    ctx.fill();
    ctx.clip();

    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let y = PIN_POS.y - 14; y < PIN_POS.y + 30; y += 6) {
      ctx.fillRect(PIN_POS.x - 32, y, 64, 3);
    }
    ctx.restore();

    // 8. Recessed Augusta-style Silica Sand Bunkers
    const drawBunker = (cx, cy, rx, ry, rot) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      // Outer grass lip shadow
      ctx.beginPath();
      ctx.ellipse(0, 0, rx + 2.5, ry + 2.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#14331e';
      ctx.fill();
      // Steep top-left bunker lip shadow
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#a39274';
      ctx.fill();
      // Bright silica sand floor offset slightly SE
      ctx.beginPath();
      ctx.ellipse(1.5, 2, rx * 0.88, ry * 0.86, 0, 0, Math.PI * 2);
      const sGrad = ctx.createRadialGradient(-2, -2, 2, 0, 0, Math.max(rx, ry));
      sGrad.addColorStop(0, '#fcf6e8');
      sGrad.addColorStop(1, '#e3d5b8');
      ctx.fillStyle = sGrad;
      ctx.fill();
      ctx.restore();
    };

    // Left greenside, Right greenside, Left fairway, Right fairway bunkers
    drawBunker(242, 74, 13, 9, -0.45);
    drawBunker(320, 68, 10, 13, 0.25);
    drawBunker(174, 214, 11, 18, 0.22);
    drawBunker(320, 190, 9, 15, -0.2);

    // 9. Tee Box at bottom
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(TEE_POS.x - 10, TEE_POS.y - 18, 20, 12, 4);
    ctx.fillStyle = '#33b862';
    ctx.fill();
    ctx.strokeStyle = '#74e39b';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Glowing player tee ring
    ctx.beginPath();
    ctx.arc(TEE_POS.x, TEE_POS.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(56, 182, 255, 0.25)';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(TEE_POS.x, TEE_POS.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#38b6ff';
    ctx.fill();
    ctx.restore();

    // 10. 3D Multi-layered Tree Canopies with Cast Ground Shadows
    const trees = [
      // Top-left cluster above lake
      { x: 42, y: 92, r: 22 }, { x: 82, y: 84, r: 20 }, { x: 135, y: 82, r: 22 },
      { x: 194, y: 66, r: 24 },
      // Bottom-left cluster below lake
      { x: 92, y: 298, r: 23 }, { x: 142, y: 278, r: 21 }, { x: 158, y: 314, r: 22 },
      { x: 75, y: 342, r: 22 }, { x: 122, y: 344, r: 21 },
      // Right forest cluster
      { x: 376, y: 68, r: 24 }, { x: 432, y: 82, r: 27 }, { x: 402, y: 112, r: 22 },
      { x: 392, y: 162, r: 23 }, { x: 436, y: 150, r: 26 }, { x: 424, y: 198, r: 24 },
      { x: 382, y: 224, r: 22 }, { x: 422, y: 256, r: 25 }, { x: 398, y: 300, r: 23 },
      { x: 452, y: 306, r: 26 }, { x: 404, y: 346, r: 22 }, { x: 446, y: 350, r: 22 }
    ];

    trees.forEach(t => {
      ctx.save();
      // Drop shadow on ground (SE offset)
      ctx.beginPath();
      ctx.arc(t.x + 8, t.y + 9, t.r * 1.02, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.fill();

      // Base dark foliage sphere
      const baseGrad = ctx.createRadialGradient(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.15, t.x, t.y, t.r);
      baseGrad.addColorStop(0, '#2e6e40');
      baseGrad.addColorStop(0.65, '#194526');
      baseGrad.addColorStop(1, '#0d2915');
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fillStyle = baseGrad;
      ctx.fill();

      // Layered sub-lobes for 3D canopy crown
      const lobes = [
        { dx: -t.r * 0.28, dy: -t.r * 0.22, r: t.r * 0.62, c1: '#3b8750', c2: '#1d4f2c' },
        { dx: t.r * 0.22, dy: -t.r * 0.18, r: t.r * 0.52, c1: '#347847', c2: '#174224' },
        { dx: -t.r * 0.1, dy: t.r * 0.22, r: t.r * 0.56, c1: '#2d6b3e', c2: '#13381e' }
      ];
      lobes.forEach(l => {
        const lg = ctx.createRadialGradient(
          t.x + l.dx - l.r * 0.25,
          t.y + l.dy - l.r * 0.25,
          1,
          t.x + l.dx,
          t.y + l.dy,
          l.r
        );
        lg.addColorStop(0, l.c1);
        lg.addColorStop(1, l.c2);
        ctx.beginPath();
        ctx.arc(t.x + l.dx, t.y + l.dy, l.r, 0, Math.PI * 2);
        ctx.fillStyle = lg;
        ctx.fill();
      });
      ctx.restore();
    });

    // 11. 50% / 90% Shot Dispersion Cone / Ellipses around Fairway Target
    const angleToPin = Math.atan2(PIN_POS.y - target.y, PIN_POS.x - target.x);
    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.rotate(angleToPin + Math.PI / 2);

    // 90% outer dispersion ellipse
    ctx.beginPath();
    ctx.ellipse(0, 0, 29, 44, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(56, 182, 255, 0.10)';
    ctx.fill();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(116, 192, 252, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 50% inner dispersion ellipse
    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 26, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(56, 182, 255, 0.16)';
    ctx.fill();
    ctx.restore();

    // 12. Ground Shadow Line (dark dashed line along the turf)
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.moveTo(TEE_POS.x, TEE_POS.y);
    ctx.lineTo(target.x, target.y);
    ctx.lineTo(PIN_POS.x, PIN_POS.y);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();

    // 13. 3D Lofted Ball-Flight Tracer Arcs (Glowing Cyan & Emerald Neon Arcs)
    // Tee -> Target lofted arc
    const drawLoftedArc = (p1, p2, glowColor, loftOffset) => {
      const mx = (p1.x + p2.x) / 2 - loftOffset;
      const my = (p1.y + p2.y) / 2 - Math.abs(loftOffset) * 0.35;

      // Outer glow
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.quadraticCurveTo(mx, my, p2.x, p2.y);
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 12;
      ctx.stroke();

      // Crisp white core
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.quadraticCurveTo(mx, my, p2.x, p2.y);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    };

    drawLoftedArc(TEE_POS, target, 'rgba(56, 182, 255, 0.85)', 12);
    drawLoftedArc(target, PIN_POS, 'rgba(56, 235, 165, 0.85)', 24);

    // 14. Pin Cup & Red Flagstick at Top Green
    ctx.save();
    ctx.beginPath();
    ctx.arc(PIN_POS.x, PIN_POS.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    // Flag pole
    ctx.beginPath();
    ctx.moveTo(PIN_POS.x, PIN_POS.y);
    ctx.lineTo(PIN_POS.x, PIN_POS.y - 18);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // Red pennant
    ctx.beginPath();
    ctx.moveTo(PIN_POS.x, PIN_POS.y - 18);
    ctx.lineTo(PIN_POS.x + 12, PIN_POS.y - 13);
    ctx.lineTo(PIN_POS.x, PIN_POS.y - 8);
    ctx.closePath();
    ctx.fillStyle = '#ff4757';
    ctx.fill();
    ctx.restore();

    // 15. Interactive Target Crosshair on Fairway
    ctx.save();
    ctx.translate(target.x, target.y);
    // Outer white target ring
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 4 crosshair ticks
    const tick = 20;
    ctx.beginPath();
    ctx.moveTo(-tick, 0); ctx.lineTo(-9, 0);
    ctx.moveTo(9, 0); ctx.lineTo(tick, 0);
    ctx.moveTo(0, -tick); ctx.lineTo(0, -9);
    ctx.moveTo(0, 9); ctx.lineTo(0, tick);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    // Center cyan dot
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#38b6ff';
    ctx.fill();
    ctx.restore();

    // 16. Callout Badges on Canvas (matching screenshot: "264 YDS / Driver" and "113 YDS / PW")
    const drawCalloutBox = (bx, by, ydsText, clubText, borderColor, textColor) => {
      const w = 78;
      const h = 38;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(bx - w / 2, by - h / 2, w, h, 8);
      ctx.fillStyle = 'rgba(7, 15, 11, 0.9)';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '800 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${ydsText} YDS`, bx, by - 3);

      ctx.fillStyle = textColor;
      ctx.font = '700 11px Inter, sans-serif';
      ctx.fillText(clubText, bx, by + 12);
      ctx.restore();
    };

    // Approach callout (left of upper arc)
    const appBadgeX = Math.max(60, Math.min(FW_W - 60, target.x - 52));
    const appBadgeY = Math.max(50, Math.min(FW_H - 60, (target.y + PIN_POS.y) / 2 + 22));
    drawCalloutBox(appBadgeX, appBadgeY, fwMetrics.targetToPin, fwMetrics.appClub, '#2bd980', '#38d976');

    // Tee-to-Target callout (right of lower arc)
    const teeBadgeX = Math.max(60, Math.min(FW_W - 60, target.x + 56));
    const teeBadgeY = Math.max(60, Math.min(FW_H - 46, (target.y + TEE_POS.y) / 2 + 6));
    drawCalloutBox(teeBadgeX, teeBadgeY, fwMetrics.teeToTarget, shortClub(fwMetrics.teeClub), '#38b6ff', '#4dabf7');
  }, [target, fwMetrics, currentHole]);

  // ─────────────── DRAW CARD 2: 3D HILLSHADED LiDAR GREEN & PUTT SIMULATOR ───────────────
  useEffect(() => {
    const canvas = grCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, GR_W, GR_H);

    // 1. Dark rough backdrop
    const bgGrad = ctx.createRadialGradient(GR_W / 2, GR_H / 2, 40, GR_W / 2, GR_H / 2, 300);
    bgGrad.addColorStop(0, '#12321e');
    bgGrad.addColorStop(1, '#07170d');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, GR_W, GR_H);

    const cx = GR_W / 2;
    const cy = GR_H / 2 + 4;
    const rx = 148;
    const ry = 122;

    // 2. Left & Right Greenside Augusta Silica Bunkers (matching screenshot)
    const drawSideBunker = (bx, by, brx, bry, rot) => {
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, brx + 3, bry + 3, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#0f2918';
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(0, 0, brx, bry, 0, 0, Math.PI * 2);
      const g = ctx.createLinearGradient(-brx, -bry, brx, bry);
      g.addColorStop(0, '#c8b898');
      g.addColorStop(0.35, '#efe4cc');
      g.addColorStop(1, '#fbf7ec');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = '#8d7f63';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    };

    drawSideBunker(92, 188, 35, 48, 0.28);
    drawSideBunker(448, 122, 38, 42, -0.35);

    // 3. Pixel-shaded 3D Hillshade + Thermal Slope Heatmap + Iso-Contours inside the Green
    const imgData = ctx.getImageData(0, 0, GR_W, GR_H);
    const data = imgData.data;

    // Sun direction from NW for 3D relief shading
    const lightX = -0.62;
    const lightY = -0.62;
    const lightZ = 0.48;

    for (let py = Math.max(0, cy - ry - 18); py < Math.min(GR_H, cy + ry + 18); py++) {
      for (let px = Math.max(0, cx - rx - 18); px < Math.min(GR_W, cx + rx + 18); px++) {
        const nx = (px - cx) / rx;
        const ny = (py - cy) / ry;
        const maskD = insideGreenMask(nx, ny);

        if (maskD <= 1.16) {
          const idx = (py * GR_W + px) * 4;
          if (maskD > 1.0) {
            // Green fringe collar ring
            data[idx] = 35;
            data[idx + 1] = 112;
            data[idx + 2] = 62;
            data[idx + 3] = 255;
          } else if (maskD > 0.975) {
            // Crisp white inner green outline
            data[idx] = 230;
            data[idx + 1] = 245;
            data[idx + 2] = 235;
            data[idx + 3] = 255;
          } else {
            const z = evalGreenSurface(nx, ny, currentHole);
            const { dzdx, dzdy, slopePct } = evalGreenGradient(nx, ny, currentHole);
            const [rBase, gBase, bBase] = slopeColorRGB(slopePct);

            // 3D surface normal hillshading
            const normLen = Math.hypot(-dzdx * 0.045, -dzdy * 0.045, 1);
            const dot = ((-dzdx * 0.045) * lightX + (-dzdy * 0.045) * lightY + lightZ) / normLen;
            const shade = Math.max(0.62, Math.min(1.22, 0.55 + dot * 0.68));

            // Major & minor topological contour lines
            const majorMod = Math.abs(((z % 7) + 7) % 7);
            const minorMod = Math.abs(((z % 2.33) + 2.33) % 2.33);
            let contourFactor = 1.0;
            if (majorMod < 0.34) {
              contourFactor = 0.38; // bold dark major contour
            } else if (minorMod < 0.18) {
              contourFactor = 0.72; // subtle minor contour
            }

            // Subtle vertical LiDAR scanline texture
            const scan = (px % 4 === 0) ? 0.96 : 1.0;

            data[idx]     = Math.min(255, Math.round(rBase * shade * contourFactor * scan));
            data[idx + 1] = Math.min(255, Math.round(gBase * shade * contourFactor * scan));
            data[idx + 2] = Math.min(255, Math.round(bBase * shade * contourFactor * scan));
            data[idx + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // 4. White Tier Contours & Downhill Flow Streamlines / Arrows (when Flow: ON)
    ctx.save();
    // Clip to green interior
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2; a += 0.05) {
      const ux = Math.cos(a) * 0.93;
      const uy = Math.sin(a) * 0.85;
      const gx = cx + ux * rx;
      const gy = cy + (uy - 0.04 * Math.cos(ux * Math.PI)) * ry;
      if (a === 0) ctx.moveTo(gx, gy);
      else ctx.lineTo(gx, gy);
    }
    ctx.closePath();
    ctx.clip();

    // White dashed flow contours across the central tier
    const tierYOffsets = [-36, -16, 4, 24, 44];
    tierYOffsets.forEach((yo, idx) => {
      ctx.beginPath();
      if (idx % 2 === 1) ctx.setLineDash([7, 5]);
      else ctx.setLineDash([]);
      for (let x = cx - rx; x <= cx + rx; x += 8) {
        const nx = (x - cx) / rx;
        const y = cy + yo - 16 * Math.sin(nx * 1.65) - (x - cx) * 0.11;
        if (x === cx - rx) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = idx % 2 === 0 ? 'rgba(255, 255, 255, 0.72)' : 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = idx % 2 === 0 ? 1.3 : 1.0;
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Downhill flow vector arrows on grid
    if (flowOn) {
      for (let gy = cy - ry + 18; gy <= cy + ry - 18; gy += 22) {
        for (let gx = cx - rx + 18; gx <= cx + rx - 18; gx += 24) {
          const nx = (gx - cx) / rx;
          const ny = (gy - cy) / ry;
          if (insideGreenMask(nx, ny) > 0.9) continue;
          const { dzdx, dzdy, slopePct } = evalGreenGradient(nx, ny, currentHole);
          const gLen = Math.hypot(dzdx, dzdy);
          if (gLen < 0.8) continue;
          // Downhill unit vector (-grad)
          const vx = -dzdx / gLen;
          const vy = -dzdy / gLen;
          const arrowLen = Math.min(13, 5 + slopePct * 1.2);
          const ex = gx + vx * arrowLen;
          const ey = gy + vy * arrowLen;

          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.lineTo(ex, ey);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
          ctx.lineWidth = 1.3;
          ctx.stroke();

          // Arrowhead
          const ah = 3.2;
          const px = -vy;
          const py = vx;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - vx * ah + px * ah * 0.65, ey - vy * ah + py * ah * 0.65);
          ctx.lineTo(ex - vx * ah - px * ah * 0.65, ey - vy * ah - py * ah * 0.65);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.fill();
        }
      }
    }

    // 5. Straight Blue Dashed AimPoint Line + Aim Circle
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.moveTo(greenState.ball.x, greenState.ball.y);
    ctx.lineTo(puttData.aimPoint.x, puttData.aimPoint.y);
    ctx.strokeStyle = '#38b6ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    // Blue AimPoint target ring
    ctx.beginPath();
    ctx.arc(puttData.aimPoint.x, puttData.aimPoint.y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#38b6ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // 6. Rollout tail past the Pin (white curve)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(greenState.pin.x, greenState.pin.y);
    ctx.quadraticCurveTo(
      puttData.tailCtrl.x,
      puttData.tailCtrl.y,
      puttData.tailEnd.x,
      puttData.tailEnd.y
    );
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    // 7. Glowing Curved Yellow Putt Track (Ball -> Pin)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(greenState.ball.x, greenState.ball.y);
    ctx.quadraticCurveTo(
      puttData.ctrlPoint.x,
      puttData.ctrlPoint.y,
      greenState.pin.x,
      greenState.pin.y
    );
    ctx.strokeStyle = 'rgba(255, 196, 0, 0.9)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#ffae00';
    ctx.shadowBlur = 12;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(greenState.ball.x, greenState.ball.y);
    ctx.quadraticCurveTo(
      puttData.ctrlPoint.x,
      puttData.ctrlPoint.y,
      greenState.pin.x,
      greenState.pin.y
    );
    ctx.strokeStyle = '#fff3b0';
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.restore();

    ctx.restore(); // end green clip

    // 8. Draw Pin Cup & Red Flagstick on Green
    ctx.save();
    // Black cup with white rim
    ctx.beginPath();
    ctx.arc(greenState.pin.x, greenState.pin.y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = '#0b131e';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Flagstaff
    ctx.beginPath();
    ctx.moveTo(greenState.pin.x, greenState.pin.y - 2);
    ctx.lineTo(greenState.pin.x, greenState.pin.y - 28);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Red flag pennant
    ctx.beginPath();
    ctx.moveTo(greenState.pin.x, greenState.pin.y - 28);
    ctx.lineTo(greenState.pin.x + 22, greenState.pin.y - 21);
    ctx.lineTo(greenState.pin.x, greenState.pin.y - 14);
    ctx.closePath();
    ctx.fillStyle = '#ff4757';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 9. Draw 3D Golf Ball on Green
    ctx.save();
    ctx.beginPath();
    ctx.arc(greenState.ball.x, greenState.ball.y, 7.5, 0, Math.PI * 2);
    const ballGrad = ctx.createRadialGradient(
      greenState.ball.x - 2,
      greenState.ball.y - 2,
      1,
      greenState.ball.x,
      greenState.ball.y,
      7.5
    );
    ballGrad.addColorStop(0, '#ffffff');
    ballGrad.addColorStop(0.75, '#e8f4fc');
    ballGrad.addColorStop(1, '#90caf9');
    ctx.fillStyle = ballGrad;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.strokeStyle = '#38b6ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }, [greenState, puttData, flowOn, currentHole]);

  // ─────────────── POINTER HANDLERS FOR FAIRWAY & GREEN CANVASES ───────────────
  const getCanvasCoords = (canvas, e, logicalW, logicalH) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * logicalW,
      y: ((e.clientY - rect.top) / rect.height) * logicalH
    };
  };

  const updateFairwayTarget = (e) => {
    const canvas = fwCanvasRef.current;
    if (!canvas) return;
    const pt = getCanvasCoords(canvas, e, FW_W, FW_H);
    const clamped = {
      x: Math.max(70, Math.min(FW_W - 70, pt.x)),
      y: Math.max(62, Math.min(FW_H - 36, pt.y))
    };
    setTargetsByHole(prev => ({ ...prev, [currentHole]: clamped }));
  };

  const clampToGreen = (pt) => {
    const cx = GR_W / 2;
    const cy = GR_H / 2 + 4;
    const rx = 132;
    const ry = 106;
    let nx = (pt.x - cx) / rx;
    let ny = (pt.y - cy) / ry;
    const d = Math.hypot(nx, ny);
    if (d > 1) {
      nx /= d;
      ny /= d;
    }
    return { x: Math.round(cx + nx * rx), y: Math.round(cy + ny * ry) };
  };

  const handleGreenDown = (e) => {
    const canvas = grCanvasRef.current;
    if (!canvas) return;
    const pt = getCanvasCoords(canvas, e, GR_W, GR_H);
    const dBall = Math.hypot(pt.x - greenState.ball.x, pt.y - greenState.ball.y);
    const dPin = Math.hypot(pt.x - greenState.pin.x, pt.y - greenState.pin.y);

    // If user grabs near pin or ball directly, move that one; otherwise use active moveMode
    let which = moveMode;
    if (dPin < 28 && dPin < dBall) {
      which = 'pin';
      setMoveMode('pin');
    } else if (dBall < 28) {
      which = 'ball';
      setMoveMode('ball');
    }

    setDraggingGr(which);
    const clamped = clampToGreen(pt);
    setGreenStateByHole(prev => ({
      ...prev,
      [currentHole]: {
        ...greenState,
        [which]: clamped
      }
    }));
    if (e.currentTarget.setPointerCapture && e.pointerId != null) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    }
  };

  const handleGreenMove = (e) => {
    if (!draggingGr) return;
    const canvas = grCanvasRef.current;
    if (!canvas) return;
    const pt = getCanvasCoords(canvas, e, GR_W, GR_H);
    const clamped = clampToGreen(pt);
    setGreenStateByHole(prev => ({
      ...prev,
      [currentHole]: {
        ...greenState,
        [draggingGr]: clamped
      }
    }));
  };

  // Score word formatting
  const diff = score - par;
  const scoreWord =
    diff <= -2 ? 'Eagle' :
    diff === -1 ? 'Birdie' :
    diff === 0 ? 'Par' :
    diff === 1 ? 'Bogey' :
    diff === 2 ? 'Double' : `+${diff}`;

  return (
    <div className="hm-tour-wrap">
      {/* Top Broadcast Header */}
      <div className="hm-tour-header">
        <div className="hm-hole-badge">
          <div className="hm-hb-top">HOLE {currentHole}</div>
          <div className="hm-hb-sub">PAR {par}</div>
        </div>
        <div className="hm-title-col">
          <div className="hm-title-row">
            <span className="hm-course-name">{courseName} · {yards} Yds</span>
            <span className="hm-wind-pill">Wind: 8 mph ↙</span>
            {onExit && (
              <button type="button" className="hm-exit-pill" onClick={onExit}>
                EXIT
              </button>
            )}
          </div>
          <div className="hm-subtitle-hint">
            Drag target on <b>Fairway</b> for live layup &amp; dispersion · Drag <b>Ball</b> or <b>Pin</b> on Green for live break simulation
          </div>
        </div>
      </div>

      {/* 4-Column Yardage Telemetry Bar (FRONT | PIN | BACK | PLAYS LIKE) */}
      <div className="hm-yard-bar">
        <div className="hm-yard-cell">
          <div className="hm-yard-lbl">FRONT</div>
          <div className="hm-yard-val front">{fwMetrics.frontYds}y</div>
        </div>
        <div className="hm-yard-cell">
          <div className="hm-yard-lbl">PIN</div>
          <div className="hm-yard-val pin">{fwMetrics.pinYds}y</div>
        </div>
        <div className="hm-yard-cell">
          <div className="hm-yard-lbl">BACK</div>
          <div className="hm-yard-val back">{fwMetrics.backYds}y</div>
        </div>
        <div className="hm-yard-cell">
          <div className="hm-yard-lbl">PLAYS LIKE</div>
          <div className="hm-yard-val plays">
            {fwMetrics.playsLike}y ({fwMetrics.windDelta >= 0 ? `+${fwMetrics.windDelta}` : fwMetrics.windDelta})
          </div>
        </div>
      </div>

      {/* Hole 1-18 Quick Switcher Strip */}
      <div className="hm-holestrip" ref={stripRef} role="tablist" aria-label="Hole Selector">
        {Array.from({ length: 18 }, (_, i) => {
          const hNum = i + 1;
          const isDone = hNum < currentHole || (holeScores[i] && holeScores[i].score !== undefined && hNum < currentHole);
          return (
            <button
              key={hNum}
              type="button"
              role="tab"
              aria-selected={hNum === currentHole}
              className={`hm-hole-chip ${hNum === currentHole ? 'active' : ''} ${isDone ? 'done' : ''}`}
              onClick={() => onSelectHole && onSelectHole(hNum)}
            >
              {hNum}
            </button>
          );
        })}
      </div>

      {/* Dual Tour-Broadcast Panels: 1) 3D Satellite Fairway GPS  2) LiDAR 3D Slope & Putt Break */}
      <div className="hm-panels-grid">
        {/* PANEL 1: 3D SATELLITE FAIRWAY GPS */}
        <div className="hm-card">
          <div className="hm-card-top">
            <div className="hm-pill-title">
              <span className="hm-dot green" />
              3D Satellite Fairway GPS
            </div>
            <div className="hm-pill-rec">
              Rec: <span>{shortClub(fwMetrics.teeClub)} → {fwMetrics.appClub}</span>
            </div>
          </div>

          <canvas
            ref={fwCanvasRef}
            width={FW_W}
            height={FW_H}
            className="hm-canvas"
            onPointerDown={(e) => {
              setDraggingFw(true);
              updateFairwayTarget(e);
              if (e.currentTarget.setPointerCapture && e.pointerId != null) {
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
              }
            }}
            onPointerMove={(e) => {
              if (draggingFw) updateFairwayTarget(e);
            }}
            onPointerUp={() => setDraggingFw(false)}
            onPointerCancel={() => setDraggingFw(false)}
          />

          <div className="hm-card-foot">
            <div>
              Tee → Target: <span className="hm-c-blue">{fwMetrics.teeToTarget}y</span> · Approach: <span className="hm-c-green">{fwMetrics.targetToPin}y</span>
            </div>
            <div>
              Dispersion: <b>±{fwMetrics.dispersion}y</b>
            </div>
          </div>
        </div>

        {/* PANEL 2: LiDAR 3D SLOPE & PUTT BREAK */}
        <div className="hm-card">
          <div className="hm-card-top">
            <div className="hm-pill-title">
              <span className="hm-dot red" />
              LiDAR 3D Slope &amp; Putt Break
            </div>
            <div className="hm-lidar-controls">
              <button
                type="button"
                className={`hm-lidar-btn ${moveMode === 'ball' ? 'active' : ''}`}
                onClick={() => setMoveMode('ball')}
              >
                Move: Ball
              </button>
              <button
                type="button"
                className={`hm-lidar-btn ${moveMode === 'pin' ? 'active' : ''}`}
                onClick={() => setMoveMode('pin')}
              >
                Move: Pin
              </button>
              <button
                type="button"
                className={`hm-lidar-btn ${flowOn ? 'active' : ''}`}
                onClick={() => setFlowOn(f => !f)}
              >
                Flow: {flowOn ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          <canvas
            ref={grCanvasRef}
            width={GR_W}
            height={GR_H}
            className="hm-canvas"
            onPointerDown={handleGreenDown}
            onPointerMove={handleGreenMove}
            onPointerUp={() => setDraggingGr(null)}
            onPointerCancel={() => setDraggingGr(null)}
          />

          <div className="hm-card-foot">
            <div>
              Putt: <span className="hm-c-blue">{puttData.puttFeet} ft</span> · Break: <span className="hm-c-gold">{puttData.breakInches}&quot; ({puttData.breakDir})</span> · Slope:{' '}
              <span className="hm-c-green">
                {puttData.slopeInches >= 0 ? `+${puttData.slopeInches}" Up` : `${puttData.slopeInches}" Down`}
              </span>
            </div>
            <div className="hm-slope-legend">
              <span>0%</span>
              <span className="hm-slope-ramp" />
              <span>7%+</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Hole-by-Hole Score, Putts & Stat Entry Dock */}
      {onAdjustScore && (
        <div className="hm-score-dock">
          <div className="hm-dock-top">
            {/* SCORE */}
            <div className="hm-dock-box">
              <div className="hm-stepper-row">
                <button
                  type="button"
                  className="hm-round-btn"
                  onClick={() => onAdjustScore(-1)}
                  aria-label="Decrease score"
                >
                  −
                </button>
                <div className="hm-score-readout">
                  <div className="hm-sr-main">{score}</div>
                  <div className="hm-sr-sub">{scoreWord}</div>
                </div>
                <button
                  type="button"
                  className="hm-round-btn"
                  onClick={() => onAdjustScore(1)}
                  aria-label="Increase score"
                >
                  +
                </button>
              </div>
              <div className="hm-box-caption">SCORE ({vsParText})</div>
            </div>

            {/* PUTTS */}
            <div className="hm-dock-box">
              <div className="hm-stepper-row">
                <button
                  type="button"
                  className="hm-round-btn"
                  onClick={() => onAdjustPutts && onAdjustPutts(Math.max(0, putts - 1))}
                  aria-label="Decrease putts"
                >
                  −
                </button>
                <div className="hm-score-readout">
                  <div className="hm-sr-main">{putts}</div>
                  <div className="hm-sr-sub">PUTTS</div>
                </div>
                <button
                  type="button"
                  className="hm-round-btn"
                  onClick={() => onAdjustPutts && onAdjustPutts(Math.min(6, putts + 1))}
                  aria-label="Increase putts"
                >
                  +
                </button>
              </div>
              <div className="hm-box-caption">PUTTS</div>
            </div>

            {/* PREV / NEXT HOLE */}
            <div className="hm-dock-box">
              <div className="hm-nav-btns">
                {onPrevHole && currentHole > 1 && (
                  <button
                    type="button"
                    className="hm-hole-nav-btn prev"
                    onClick={onPrevHole}
                    title="Previous Hole"
                  >
                    ←
                  </button>
                )}
                {onNextHole && (
                  <button
                    type="button"
                    className="hm-hole-nav-btn"
                    onClick={onNextHole}
                  >
                    {currentHole === 18 ? 'FINISH ✓' : `HOLE ${currentHole + 1} →`}
                  </button>
                )}
              </div>
              <div className="hm-box-caption">NEXT HOLE</div>
            </div>
          </div>

          {onToggleStat && (
            <div className="hm-stat-row">
              <button
                type="button"
                className={`hm-stat-chip ${par === 3 ? 'disabled' : ''} ${fir ? 'active' : ''}`}
                onClick={() => onToggleStat('fir')}
              >
                🎯 FIR {fir ? '✓' : ''}
              </button>
              <button
                type="button"
                className={`hm-stat-chip ${gir ? 'active' : ''}`}
                onClick={() => onToggleStat('gir')}
              >
                ⛳ GIR {gir ? '✓' : ''}
              </button>
              <button
                type="button"
                className={`hm-stat-chip ${pen ? 'active' : ''}`}
                onClick={() => onToggleStat('pen')}
              >
                💧 PENALTY {pen ? '✓' : ''}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
