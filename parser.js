export function parseGenBankText(text, sourceName = 'uploaded.gb') {
  const records = text
    .split(/^\/\/\s*$/m)
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map((chunk, index) => parseRecord(chunk, sourceName, index + 1));

  return records.filter(Boolean);
}

function parseRecord(chunk, sourceName, fallbackIndex) {
  const locusMatch = chunk.match(/^LOCUS\s+(\S+)/m);
  const definitionMatch = chunk.match(/^DEFINITION\s+(.+(?:\n {12}.+)*)/m);
  const accessionMatch = chunk.match(/^ACCESSION\s+(.+)/m);

  const originMatch = chunk.match(/^ORIGIN([\s\S]*)$/m);
  if (!originMatch) return null;

  const sequence = originMatch[1].replace(/[^acgturykmswbdhvn]/gi, '').toUpperCase();
  if (!sequence.length) return null;

  const featuresSection = extractSection(chunk, 'FEATURES', 'ORIGIN');
  const features = featuresSection ? parseFeatures(featuresSection) : [];

  return {
    id: `${sourceName}::${fallbackIndex}`,
    sourceName,
    locus: locusMatch?.[1] ?? `record_${fallbackIndex}`,
    definition: normalizeWrappedField(definitionMatch?.[1] ?? ''),
    accession: accessionMatch?.[1]?.trim() ?? '',
    length: sequence.length,
    sequence,
    features,
  };
}

function extractSection(text, startLabel, endLabel) {
  const pattern = new RegExp(`^${startLabel}[\\s\\S]*?(?=^${endLabel}\\b)`, 'm');
  const match = text.match(pattern);
  return match ? match[0] : '';
}

function normalizeWrappedField(value) {
  return value.replace(/\n\s+/g, ' ').trim();
}

function parseFeatures(featuresSection) {
  const lines = featuresSection.split(/\r?\n/);
  const features = [];
  let current = null;

  for (const line of lines.slice(1)) {
    const featureMatch = line.match(/^\s{5}(\S+)\s+(.+)$/);
    if (featureMatch) {
      if (current) finalizeFeature(current, features);
      current = {
        type: featureMatch[1],
        locationText: featureMatch[2].trim(),
        qualifiers: {},
        rawQualifierLines: [],
      };
      continue;
    }

    const qualifierMatch = line.match(/^\s{21}(.+)$/);
    if (qualifierMatch && current) {
      current.rawQualifierLines.push(qualifierMatch[1]);
    }
  }

  if (current) finalizeFeature(current, features);
  return features;
}

function finalizeFeature(current, features) {
  current.qualifiers = parseQualifierLines(current.rawQualifierLines);
  const location = parseLocation(current.locationText);
  const feature = {
    type: current.type,
    locationText: current.locationText,
    start: location.start,
    end: location.end,
    strand: location.strand,
    segments: location.segments,
    qualifiers: current.qualifiers,
    name: featureName(current.type, current.qualifiers),
  };
  features.push(feature);
}

function parseQualifierLines(lines) {
  const qualifiers = {};
  let activeKey = null;

  for (const raw of lines) {
    if (raw.startsWith('/')) {
      const eqIndex = raw.indexOf('=');
      if (eqIndex === -1) {
        const key = raw.slice(1).trim();
        qualifiers[key] = true;
        activeKey = key;
      } else {
        const key = raw.slice(1, eqIndex).trim();
        let value = raw.slice(eqIndex + 1).trim();
        qualifiers[key] = stripQuotes(value);
        activeKey = key;
      }
    } else if (activeKey) {
      qualifiers[activeKey] = `${qualifiers[activeKey]} ${stripQuotes(raw.trim())}`.trim();
    }
  }

  return qualifiers;
}

function stripQuotes(value) {
  return value.replace(/^"|"$/g, '');
}

function featureName(type, q) {
  return q.gene || q.locus_tag || q.product || q.label || q.note || type;
}

function parseLocation(locationText) {
  let strand = 1;
  let text = locationText.replace(/\s+/g, '');

  while (/^(complement|join|order)\(/.test(text)) {
    if (text.startsWith('complement(')) {
      strand *= -1;
      text = unwrapOuter(text);
    } else if (text.startsWith('join(') || text.startsWith('order(')) {
      text = unwrapOuter(text);
    } else {
      break;
    }
  }

  const segments = [];
  const rangeRegex = /<?(\d+)\.\.>?(\d+)/g;
  let match;
  while ((match = rangeRegex.exec(text)) !== null) {
    segments.push({ start: Number(match[1]), end: Number(match[2]) });
  }

  if (!segments.length) {
    const singleRegex = /<?(\d+)/g;
    while ((match = singleRegex.exec(text)) !== null) {
      const pos = Number(match[1]);
      segments.push({ start: pos, end: pos });
    }
  }

  const starts = segments.map(s => s.start);
  const ends = segments.map(s => s.end);
  return {
    strand,
    segments,
    start: starts.length ? Math.min(...starts) : 1,
    end: ends.length ? Math.max(...ends) : 1,
  };
}

function unwrapOuter(text) {
  const first = text.indexOf('(');
  const last = text.lastIndexOf(')');
  return first >= 0 && last > first ? text.slice(first + 1, last) : text;
}
