const IUPAC = {
  A: new Set(['A']),
  C: new Set(['C']),
  G: new Set(['G']),
  T: new Set(['T']),
  U: new Set(['T']),
  R: new Set(['A', 'G']),
  Y: new Set(['C', 'T']),
  S: new Set(['G', 'C']),
  W: new Set(['A', 'T']),
  K: new Set(['G', 'T']),
  M: new Set(['A', 'C']),
  B: new Set(['C', 'G', 'T']),
  D: new Set(['A', 'G', 'T']),
  H: new Set(['A', 'C', 'T']),
  V: new Set(['A', 'C', 'G']),
  N: new Set(['A', 'C', 'G', 'T']),
};

export function reverseComplement(seq) {
  const map = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N' };
  return seq
    .split('')
    .reverse()
    .map(base => map[base] || 'N')
    .join('');
}

export function findPamSites(record, options = {}) {
  const sequence = record.sequence.toUpperCase();
  const sites = [];
  const pattern1 = options.allowGAtW ? 'NNAGAAD' : 'NNAGAAW';
  const motifs = [
    { key: 'NNAGAAW', motif: pattern1, canonicalLabel: options.allowGAtW ? 'NNAGAAW(+G)' : 'NNAGAAW', colorKey: 'pattern1' },
    { key: 'NNGGAA', motif: 'NNGGAA', canonicalLabel: 'NNGGAA', colorKey: 'pattern2' },
  ];

  for (const motif of motifs) {
    if (!options.showPattern1 && motif.key === 'NNAGAAW') continue;
    if (!options.showPattern2 && motif.key === 'NNGGAA') continue;

    const motifLength = motif.motif.length;
    const reverseMotif = reverseComplement(motif.motif);

    if (options.showPlus !== false) {
      for (let i = 0; i <= sequence.length - motifLength; i += 1) {
        const window = sequence.slice(i, i + motifLength);
        if (!matchesIupac(window, motif.motif)) continue;
        const spacerInfo = getPlusStrandSpacer(sequence, i, options.prefer21G !== false);
        if (!spacerInfo) continue;
        sites.push(buildSite(record, motif, '+', i, motifLength, spacerInfo, window));
      }
    }

    if (options.showMinus !== false) {
      for (let i = 0; i <= sequence.length - motifLength; i += 1) {
        const window = sequence.slice(i, i + motifLength);
        if (!matchesIupac(window, reverseMotif)) continue;
        const spacerInfo = getMinusStrandSpacer(sequence, i, motifLength, options.prefer21G !== false);
        if (!spacerInfo) continue;
        sites.push(buildSite(record, motif, '-', i, motifLength, spacerInfo, reverseComplement(window)));
      }
    }
  }

  sites.sort((a, b) => a.pamStart - b.pamStart || a.strand.localeCompare(b.strand));
  sites.forEach((site, idx) => {
    site.index = idx + 1;
    site.id = `${record.id}::pam::${idx + 1}`;
  });

  return sites;
}

function buildSite(record, motif, strand, zeroStart, motifLength, spacerInfo, pam5to3) {
  const pamStart = zeroStart + 1;
  const pamEnd = zeroStart + motifLength;
  const feature = nearestFeature(record.features, spacerInfo.protoStart, spacerInfo.protoEnd);

  return {
    patternKey: motif.key,
    pamLabel: motif.canonicalLabel,
    colorKey: motif.colorKey,
    strand,
    pamStart,
    pamEnd,
    pamSeq5to3: pam5to3,
    protospacerLength: spacerInfo.length,
    protospacerGenomeSeq: spacerInfo.genomicSeq,
    spacerSeq5to3: spacerInfo.spacer5to3,
    protoStart: spacerInfo.protoStart,
    protoEnd: spacerInfo.protoEnd,
    gcPct: gcPercent(spacerInfo.spacer5to3),
    guideStartsWithG: spacerInfo.spacer5to3.startsWith('G'),
    featureName: feature?.name || '',
    featureType: feature?.type || '',
    featureStrand: feature?.strand || null,
    featureSpan: feature ? `${feature.start}..${feature.end}` : '',
    distanceToFeatureCenter: feature ? distanceToFeatureCenter(feature, spacerInfo.protoStart, spacerInfo.protoEnd) : null,
  };
}

function matchesIupac(window, motif) {
  if (window.length !== motif.length) return false;
  for (let i = 0; i < motif.length; i += 1) {
    const allowed = IUPAC[motif[i]];
    if (!allowed || !allowed.has(window[i])) return false;
  }
  return true;
}

function getPlusStrandSpacer(sequence, pamZeroStart, prefer21G) {
  if (pamZeroStart < 20) return null;
  let start = pamZeroStart - 20;
  let end = pamZeroStart - 1;

  if (prefer21G && pamZeroStart >= 21) {
    const base20 = sequence[pamZeroStart - 20];
    const base21 = sequence[pamZeroStart - 21];
    if (base20 !== 'G' && base21 === 'G') start = pamZeroStart - 21;
  }

  const genomicSeq = sequence.slice(start, pamZeroStart);
  return {
    protoStart: start + 1,
    protoEnd: pamZeroStart,
    length: genomicSeq.length,
    genomicSeq,
    spacer5to3: genomicSeq,
  };
}

function getMinusStrandSpacer(sequence, pamZeroStart, motifLength, prefer21G) {
  const rightEdge = pamZeroStart + motifLength;
  if (sequence.length - rightEdge < 20) return null;
  let endExclusive = rightEdge + 20;

  if (prefer21G && sequence.length - rightEdge >= 21) {
    const base20 = sequence[rightEdge + 19];
    const base21 = sequence[rightEdge + 20];
    if (base20 !== 'G' && base21 === 'G') endExclusive = rightEdge + 21;
  }

  const genomicSeq = sequence.slice(rightEdge, endExclusive);
  return {
    protoStart: rightEdge + 1,
    protoEnd: endExclusive,
    length: genomicSeq.length,
    genomicSeq,
    spacer5to3: reverseComplement(genomicSeq),
  };
}

function gcPercent(seq) {
  if (!seq.length) return 0;
  const gc = (seq.match(/[GC]/g) || []).length;
  return Number(((100 * gc) / seq.length).toFixed(1));
}

function nearestFeature(features, start, end) {
  if (!Array.isArray(features) || !features.length) return null;

  const overlapping = features
    .filter(f => f.type !== 'source')
    .filter(f => rangesOverlap(start, end, f.start, f.end))
    .sort((a, b) => featurePriority(a) - featurePriority(b) || (a.end - a.start) - (b.end - b.start));

  if (overlapping.length) return overlapping[0];

  return features
    .filter(f => f.type !== 'source')
    .slice()
    .sort((a, b) => distanceToFeature(start, end, a) - distanceToFeature(start, end, b))[0] || null;
}

function featurePriority(feature) {
  const priority = { CDS: 1, gene: 2, misc_feature: 3 };
  return priority[feature.type] || 10;
}

function rangesOverlap(a1, a2, b1, b2) {
  return a1 <= b2 && b1 <= a2;
}

function distanceToFeature(start, end, feature) {
  if (rangesOverlap(start, end, feature.start, feature.end)) return 0;
  if (end < feature.start) return feature.start - end;
  return start - feature.end;
}

function distanceToFeatureCenter(feature, start, end) {
  const center = (feature.start + feature.end) / 2;
  const protoCenter = (start + end) / 2;
  return Math.round(protoCenter - center);
}
