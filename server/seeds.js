export const AGENT_DEFS = [
  {
    id: 'A1',
    name: 'Archon',
    color: '#e07a5f',
    personality: 'methodical and careful, prefers building on well-established foundations, verifies thoroughly before extending',
    derive_probability: 0.7,
  },
  {
    id: 'A2',
    name: 'Bion',
    color: '#3d85c6',
    personality: 'creative and adventurous, looks for surprising combinations of existing results, willing to attempt ambitious derivations',
    derive_probability: 0.5,
  },
  {
    id: 'A3',
    name: 'Callias',
    color: '#81b29a',
    personality: 'skeptical and rigorous, prioritizes verification over derivation, looks for flaws in others\' proofs',
    derive_probability: 0.3,
  },
];

export const DEFINITIONS = [
  { id: 'D01', claim: 'A mark is that which has no part.', type: 'definition' },
  { id: 'D02', claim: 'A trace is breadthless length.', type: 'definition' },
  { id: 'D03', claim: 'The extremities of a trace are marks.', type: 'definition' },
  { id: 'D04', claim: 'A true trace is a trace which lies evenly with the marks on itself.', type: 'definition' },
  { id: 'D05', claim: 'A surface is that which has length and breadth only.', type: 'definition' },
  { id: 'D06', claim: 'The extremities of a surface are traces.', type: 'definition' },
  { id: 'D07', claim: 'A flat surface, or field, is a surface which lies evenly with the true traces on itself.', type: 'definition' },
  { id: 'D08', claim: 'A field spread is the inclination to one another of two traces in a field which meet one another and do not lie in a true trace.', type: 'definition' },
  { id: 'D09', claim: 'When the traces containing the spread are true, the spread is called a true-trace spread.', type: 'definition' },
  { id: 'D10', claim: 'When a true trace standing on a true trace makes the neighboring spreads alike to one another, each of the alike spreads is a square spread, and the true trace standing on the other is called cross-standing to that on which it stands.', type: 'definition' },
  { id: 'D11', claim: 'A wide spread is a spread greater than a square spread.', type: 'definition' },
  { id: 'D12', claim: 'A narrow spread is a spread less than a square spread.', type: 'definition' },
  { id: 'D13', claim: 'A boundary is that which is an extremity of anything.', type: 'definition' },
  { id: 'D14', claim: 'A figure is that which is contained by any boundary or boundaries.', type: 'definition' },
  { id: 'D15', claim: 'A ring is a field figure contained by one trace such that all the true traces falling upon it from one mark among those lying within the figure are alike to one another.', type: 'definition' },
  { id: 'D16', claim: 'And that mark is called the center mark of the ring.', type: 'definition' },
  { id: 'D17', claim: 'A full ring-span is any true trace drawn through the center mark and terminated in both directions by the ring-path, and such a true trace also halves the ring.', type: 'definition' },
  { id: 'D18', claim: 'A half-ring is the figure contained by the full ring-span and the ring-path cut off by it.', type: 'definition' },
  { id: 'D19', claim: 'True-trace figures are those contained by true traces: triads being those contained by three, four-trace figures by four, and many-trace figures by more than four true traces.', type: 'definition' },
  { id: 'D20', claim: 'Of triads, an all-alike-span triad has its three spans alike, a two-alike-span triad has two of its spans alone alike, and a no-alike-span triad has its three spans all unalike.', type: 'definition' },
  { id: 'D21', claim: 'Further, of triads: a square-spread triad has a square spread, a wide-spread triad has a wide spread, and a narrow-spread triad has three narrow spreads.', type: 'definition' },
  { id: 'D22', claim: 'Of four-trace figures: an alike-span square-spread figure is both all-alike-span and all-square-spread; a long figure is square-spread but not alike-span; a tilt-alike figure is alike-span but not square-spread; and a tilt-long figure has its opposite spans and spreads alike to one another but is neither alike-span nor square-spread.', type: 'definition' },
  { id: 'D23', claim: 'Co-running true traces are true traces which, being in the same field and being extended indefinitely in both directions, do not meet one another in either direction.', type: 'definition' },
];

export const POSTULATES = [
  { id: 'P1', claim: 'A true trace can be drawn from any mark to any mark.', type: 'postulate' },
  { id: 'P2', claim: 'A finite true trace can be extended continuously in a true trace.', type: 'postulate' },
  { id: 'P3', claim: 'A ring can be described with any center mark and any gap.', type: 'postulate' },
  { id: 'P4', claim: 'All square spreads are alike to one another.', type: 'postulate' },
  { id: 'P5', claim: 'If a true trace falling on two true traces makes the inside spreads on the same side less than two square spreads, the two true traces, if extended indefinitely, meet on that side.', type: 'postulate' },
];

export const COMMON_NOTIONS = [
  { id: 'CN1', claim: 'Things which are alike to the same thing are alike to one another.', type: 'common_notion' },
  { id: 'CN2', claim: 'If alikes are added to alikes, the wholes are alike.', type: 'common_notion' },
  { id: 'CN3', claim: 'If alikes are subtracted from alikes, the remainders are alike.', type: 'common_notion' },
  { id: 'CN4', claim: 'Things which coincide with one another are alike to one another.', type: 'common_notion' },
  { id: 'CN5', claim: 'The whole is greater than the part.', type: 'common_notion' },
];

export const ALL_SEEDS = [...DEFINITIONS, ...POSTULATES, ...COMMON_NOTIONS];
