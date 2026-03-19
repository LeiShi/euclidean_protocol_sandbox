export const VOCAB = {
  point: 'mark',
  line: 'trace',
  circle: 'ring',
  angle: 'spread',
  triangle: 'triad',
  right_angle: 'square spread',
  parallel: 'co-running',
  congruent: 'matched',
  equal: 'alike',
  perpendicular: 'cross-standing',
  bisect: 'halve',
  segment: 'span',
  ray: 'beam',
  straight: 'true',
  plane: 'field',
  distance: 'gap',
  midpoint: 'center mark',
  equilateral: 'all-alike-span',
  isosceles: 'two-alike-span',
  scalene: 'no-alike-span',
  acute: 'narrow spread',
  obtuse: 'wide spread',
  polygon: 'closed trace figure',
  quadrilateral: 'four-trace figure',
  rectangle: 'all-square-spread figure',
  square: 'alike-span square-spread figure',
  radius: 'ring-span',
  diameter: 'full ring-span',
  circumference: 'ring-path',
  arc: 'ring-part',
  chord: 'ring-cut',
  tangent: 'ring-touch',
  exterior: 'outside',
  interior: 'inside',
  adjacent: 'neighboring',
  supplementary: 'completing spreads',
  complementary: 'half-completing spreads',
  vertical_angles: 'cross-spreads',
  corresponding: 'echo-placed',
  alternate: 'flip-placed',
  transversal: 'crossing trace',
};

const DEOBFUSCATE_ENTRIES = Object.entries(VOCAB)
  .map(([standard, obfuscated]) => [obfuscated, standard])
  .sort((a, b) => b[0].length - a[0].length);

export function deobfuscate(text) {
  if (!text) return text;
  let result = text;
  for (const [obfuscated, standard] of DEOBFUSCATE_ENTRIES) {
    const regex = new RegExp(obfuscated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, (match) => {
      if (match[0] === match[0].toUpperCase()) {
        return standard.charAt(0).toUpperCase() + standard.slice(1);
      }
      return standard;
    });
  }
  return result;
}
