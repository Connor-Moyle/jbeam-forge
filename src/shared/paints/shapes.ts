/**
 * The vinyl shape library: every shape as an SVG path in a 100 × 100 box
 * (y down), drawn into a mask when a layer uses it. Grouped the way a
 * livery editor's shape picker is: basics, stripes and bars, graphics.
 */

export interface VinylShape {
  id: string;
  name: string;
  category: 'Basic' | 'Stripes' | 'Graphics';
  path: string;
  /** Holes (rings, frames) need the even-odd fill rule. */
  evenOdd?: boolean;
}

/** A regular polygon or star centred in the box. */
function polygon(points: number, inner = 1, turn = -90): string {
  const n = inner < 1 ? points * 2 : points;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = 50 * (inner < 1 && i % 2 ? inner : 1);
    const a = ((turn + (i * 360) / n) * Math.PI) / 180;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

const circle = (cx: number, cy: number, r: number, reverse = false) => `M${cx} ${cy - r}A${r} ${r} 0 1 ${reverse ? 0 : 1} ${cx} ${cy + r}A${r} ${r} 0 1 ${reverse ? 0 : 1} ${cx} ${cy - r}Z`;

export const VINYL_SHAPES: VinylShape[] = [
  // Basic
  { id: 'square', name: 'Square', category: 'Basic', path: 'M0 0H100V100H0Z' },
  { id: 'circle', name: 'Circle', category: 'Basic', path: circle(50, 50, 50) },
  { id: 'rounded', name: 'Rounded square', category: 'Basic', path: 'M20 0H80A20 20 0 0 1 100 20V80A20 20 0 0 1 80 100H20A20 20 0 0 1 0 80V20A20 20 0 0 1 20 0Z' },
  { id: 'triangle', name: 'Triangle', category: 'Basic', path: 'M50 0L100 100H0Z' },
  { id: 'right-triangle', name: 'Right triangle', category: 'Basic', path: 'M0 0L100 100H0Z' },
  { id: 'diamond', name: 'Diamond', category: 'Basic', path: 'M50 0L100 50L50 100L0 50Z' },
  { id: 'pentagon', name: 'Pentagon', category: 'Basic', path: polygon(5) },
  { id: 'hexagon', name: 'Hexagon', category: 'Basic', path: polygon(6, 1, 0) },
  { id: 'octagon', name: 'Octagon', category: 'Basic', path: polygon(8, 1, -67.5) },
  { id: 'star', name: 'Star', category: 'Basic', path: polygon(5, 0.42) },
  { id: 'star-6', name: 'Six-point star', category: 'Basic', path: polygon(6, 0.55) },
  { id: 'burst', name: 'Burst', category: 'Basic', path: polygon(16, 0.72) },
  { id: 'ring', name: 'Ring', category: 'Basic', path: `${circle(50, 50, 50)}${circle(50, 50, 34, true)}`, evenOdd: true },
  { id: 'frame', name: 'Frame', category: 'Basic', path: 'M0 0H100V100H0ZM12 12V88H88V12Z', evenOdd: true },
  { id: 'half-circle', name: 'Half circle', category: 'Basic', path: 'M0 100A50 50 0 0 1 100 100Z' },
  { id: 'quarter-circle', name: 'Quarter circle', category: 'Basic', path: 'M0 0A100 100 0 0 1 100 100H0Z' },
  { id: 'heart', name: 'Heart', category: 'Basic', path: 'M50 92C22 72 0 54 0 30A26 26 0 0 1 50 18A26 26 0 0 1 100 30C100 54 78 72 50 92Z' },
  { id: 'cross', name: 'Cross', category: 'Basic', path: 'M35 0H65V35H100V65H65V100H35V65H0V35H35Z' },
  // Stripes and bars
  { id: 'bar', name: 'Bar', category: 'Stripes', path: 'M0 30H100V70H0Z' },
  { id: 'pill', name: 'Pill', category: 'Stripes', path: 'M25 20H75A30 30 0 0 1 75 80H25A30 30 0 0 1 25 20Z' },
  { id: 'parallelogram', name: 'Slanted bar', category: 'Stripes', path: 'M25 0H100L75 100H0Z' },
  { id: 'wedge', name: 'Tapered stripe', category: 'Stripes', path: 'M0 40L100 0V100L0 60Z' },
  { id: 'blade', name: 'Blade', category: 'Stripes', path: 'M0 50C30 20 70 10 100 0C80 30 50 60 0 50Z' },
  { id: 'swoosh', name: 'Swoosh', category: 'Stripes', path: 'M0 80C30 20 70 0 100 0C75 20 45 55 30 100Z' },
  { id: 'wave', name: 'Wave', category: 'Stripes', path: 'M0 40C17 20 33 20 50 40S83 60 100 40V60C83 80 67 80 50 60S17 40 0 60Z' },
  { id: 'zigzag', name: 'Zigzag', category: 'Stripes', path: 'M0 60L20 30L40 60L60 30L80 60L100 30V50L80 80L60 50L40 80L20 50L0 80Z' },
  { id: 'chevron', name: 'Chevron', category: 'Stripes', path: 'M0 0H40L100 50L40 100H0L60 50Z' },
  { id: 'double-chevron', name: 'Double chevron', category: 'Stripes', path: 'M0 0H25L60 50L25 100H0L35 50ZM40 0H65L100 50L65 100H40L75 50Z' },
  { id: 'hash', name: 'Hash marks', category: 'Stripes', path: 'M0 0H18L38 100H20ZM28 0H46L66 100H48ZM56 0H74L94 100H76Z' },
  { id: 'checker', name: 'Chequered', category: 'Stripes', path: 'M0 0H25V25H0ZM50 0H75V25H50ZM25 25H50V50H25ZM75 25H100V50H75ZM0 50H25V75H0ZM50 50H75V75H50ZM25 75H50V100H25ZM75 75H100V100H75Z' },
  // Graphics
  { id: 'arrow', name: 'Arrow', category: 'Graphics', path: 'M0 35H60V10L100 50L60 90V65H0Z' },
  { id: 'bolt', name: 'Lightning bolt', category: 'Graphics', path: 'M62 0L12 58H45L32 100L90 36H56Z' },
  { id: 'flame', name: 'Flame', category: 'Graphics', path: 'M50 100C20 100 5 80 10 55C14 38 28 30 25 8C40 22 46 36 42 50C52 40 56 24 62 10C76 30 92 50 90 70C88 90 72 100 50 100Z' },
  { id: 'flames-side', name: 'Hot-rod flames', category: 'Graphics', path: 'M0 40C20 38 30 30 45 20C40 30 44 34 55 32C62 22 70 18 85 15C76 24 78 30 90 30C84 36 86 40 100 42C86 48 84 52 90 60C78 58 74 62 82 72C68 66 60 64 52 70C50 62 42 58 30 62C32 56 24 52 0 58Z' },
  { id: 'teardrop', name: 'Teardrop', category: 'Graphics', path: 'M50 0C65 30 90 50 90 70A40 30 0 0 1 10 70C10 50 35 30 50 0Z' },
  { id: 'tribal', name: 'Tribal curl', category: 'Graphics', path: 'M10 90C10 40 40 10 90 10C60 20 40 45 45 70C48 85 65 88 75 75C70 95 40 100 10 90Z' },
  { id: 'claw', name: 'Claw marks', category: 'Graphics', path: 'M10 0C20 30 25 60 20 100C30 65 30 30 22 0ZM42 0C50 30 55 60 50 100C60 65 60 30 54 0ZM74 0C82 30 87 60 82 100C92 65 92 30 86 0Z' },
  { id: 'splat', name: 'Splat', category: 'Graphics', path: 'M50 12C58 12 60 24 66 22C74 18 78 6 84 12C90 18 78 28 82 36C86 44 100 42 98 52C96 62 82 56 78 64C74 72 86 84 78 90C70 96 64 82 56 86C48 90 50 100 40 98C30 96 36 84 30 78C24 72 8 80 4 70C0 60 16 58 18 50C20 42 6 34 12 26C18 18 30 30 36 24C42 18 42 12 50 12Z' },
  { id: 'crosshair', name: 'Roundel', category: 'Graphics', path: `${circle(50, 50, 50)}${circle(50, 50, 40, true)}${circle(50, 50, 30)}`, evenOdd: true },
  { id: 'shield', name: 'Shield', category: 'Graphics', path: 'M50 0L95 15V50C95 75 75 92 50 100C25 92 5 75 5 50V15Z' },
  { id: 'crown', name: 'Crown', category: 'Graphics', path: 'M0 30L25 55L50 15L75 55L100 30L90 90H10Z' },
  { id: 'wing', name: 'Wing', category: 'Graphics', path: 'M0 60C30 40 60 20 100 10C90 25 70 35 50 42C70 40 85 42 95 48C75 55 55 58 35 62C50 64 62 68 70 76C45 78 20 72 0 60Z' },
];

export const shapeById = (id: string): VinylShape => VINYL_SHAPES.find((s) => s.id === id) ?? VINYL_SHAPES[0]!;
