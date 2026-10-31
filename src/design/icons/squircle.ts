// The tile shape (`docs/design/system.md` §2.9, §3.2): a square with continuous corners of radius 22.5% of
// the side, as one SVG path so iOS and Android draw the same plate. Each corner is a circular arc of that
// radius eased into the straight edges by two cubic Béziers (60% corner smoothing, the iOS continuous
// corner), so the curvature has no step where an edge meets a corner. Pure geometry, no RN/DOM import.

/** Corner radius as a fraction of the side. */
export const SQUIRCLE_CORNER = 0.225;

const SMOOTHING = 0.6;

const fmt = (n: number): string => String(Number(n.toFixed(3)));

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** The closed path of a `size` × `size` tile plate with its top-left at the origin. */
export function squirclePath(size: number): string {
  const half = size / 2;
  const radius = Math.min(SQUIRCLE_CORNER * size, half);
  const smoothing = radius === 0 ? 0 : Math.min(SMOOTHING, half / radius - 1);
  const extent = Math.min((1 + smoothing) * radius, half);

  const arcMeasure = 90 * (1 - smoothing);
  const arcLength = Math.sin(radians(arcMeasure / 2)) * radius * Math.SQRT2;
  const alpha = (90 - arcMeasure) / 2;
  const tangentLength = radius * Math.tan(radians(alpha / 2));
  const beta = 45 * smoothing;
  const c = tangentLength * Math.cos(radians(beta));
  const d = c * Math.tan(radians(beta));
  const b = (extent - arcLength - c - d) / 3;
  const a = 2 * b;

  // The top-right corner, from the end of the top edge to the start of the right edge.
  type Point = readonly [number, number];
  const start: Point = [size - extent, 0];
  const curveIn: Point[] = [
    [size - extent + a, 0],
    [size - extent + a + b, 0],
    [size - extent + a + b + c, d],
  ];
  const arcEnd: Point = [size - d, extent - a - b - c];
  const curveOut: Point[] = [
    [size, extent - a - b],
    [size, extent - a],
    [size, extent],
  ];

  // Quarter turns clockwise about the centre carry the corner to the other three.
  const turn = ([x, y]: Point, quarter: number): Point => {
    let point: Point = [x, y];
    for (let i = 0; i < quarter; i++) point = [half - (point[1] - half), half + (point[0] - half)];
    return point;
  };
  const at = (point: Point, quarter: number): string => {
    const [x, y] = turn(point, quarter);
    return `${fmt(x)} ${fmt(y)}`;
  };

  let path = '';
  for (let quarter = 0; quarter < 4; quarter++) {
    path += `${quarter === 0 ? 'M' : 'L'}${at(start, quarter)}`;
    path += `C${curveIn.map((point) => at(point, quarter)).join(' ')}`;
    path += `A${fmt(radius)} ${fmt(radius)} 0 0 1 ${at(arcEnd, quarter)}`;
    path += `C${curveOut.map((point) => at(point, quarter)).join(' ')}`;
  }
  return `${path}Z`;
}
