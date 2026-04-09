#!/usr/bin/env python3
"""Batch PAM extraction helper for PAM Scout.

This optional local script is useful for command-line batch export outside the browser.
It uses Biopython to parse GenBank files and emits a CSV or TSV file with the same core
logic as the web app:
- PAM patterns: NNAGAAW and NNGGAA
- optional tolerance for G at W in NNAGAAW
- scan both strands
- spacer = 20 nt adjacent to PAM, except use 21 nt when nt20 != G and nt21 == G

Example:
    python scripts/batch_extract_pams.py data/demo_phage.gb -o demo_pams.csv
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import Iterable, List, Dict

from Bio import SeqIO
from Bio.Seq import Seq


IUPAC = {
    "A": {"A"},
    "C": {"C"},
    "G": {"G"},
    "T": {"T"},
    "U": {"T"},
    "R": {"A", "G"},
    "Y": {"C", "T"},
    "S": {"G", "C"},
    "W": {"A", "T"},
    "K": {"G", "T"},
    "M": {"A", "C"},
    "B": {"C", "G", "T"},
    "D": {"A", "G", "T"},
    "H": {"A", "C", "T"},
    "V": {"A", "C", "G"},
    "N": {"A", "C", "G", "T"},
}


def matches_iupac(window: str, motif: str) -> bool:
    return len(window) == len(motif) and all(window[i] in IUPAC[motif[i]] for i in range(len(motif)))


def reverse_complement(seq: str) -> str:
    return str(Seq(seq).reverse_complement())


def feature_name(feature) -> str:
    q = feature.qualifiers
    for key in ("gene", "locus_tag", "product", "label", "note"):
        if key in q:
            value = q[key]
            return value[0] if isinstance(value, list) else str(value)
    return feature.type


def get_plus_spacer(seq: str, pam_start0: int, prefer21: bool):
    if pam_start0 < 20:
        return None
    start = pam_start0 - 20
    if prefer21 and pam_start0 >= 21 and seq[pam_start0 - 20] != "G" and seq[pam_start0 - 21] == "G":
        start = pam_start0 - 21
    genomic = seq[start:pam_start0]
    return start + 1, pam_start0, genomic, genomic


def get_minus_spacer(seq: str, pam_start0: int, motif_len: int, prefer21: bool):
    right_edge = pam_start0 + motif_len
    if len(seq) - right_edge < 20:
        return None
    end_exclusive = right_edge + 20
    if prefer21 and len(seq) - right_edge >= 21 and seq[right_edge + 19] != "G" and seq[right_edge + 20] == "G":
        end_exclusive = right_edge + 21
    genomic = seq[right_edge:end_exclusive]
    return right_edge + 1, end_exclusive, genomic, reverse_complement(genomic)


def nearest_feature(record, proto_start: int, proto_end: int):
    features = [f for f in record.features if f.type != "source"]
    overlaps = []
    for feat in features:
        start = int(feat.location.start) + 1
        end = int(feat.location.end)
        if proto_start <= end and start <= proto_end:
            overlaps.append(feat)
    if overlaps:
        overlaps.sort(key=lambda f: (0 if f.type == "CDS" else 1, int(f.location.end) - int(f.location.start)))
        return overlaps[0]
    return None


def scan_record(record, allow_g_at_w: bool, prefer21: bool) -> List[Dict[str, str]]:
    seq = str(record.seq).upper()
    pattern1 = "NNAGAAD" if allow_g_at_w else "NNAGAAW"
    motifs = [("NNAGAAW", pattern1), ("NNGGAA", "NNGGAA")]
    rows = []

    for pam_key, motif in motifs:
        motif_len = len(motif)
        reverse_motif = reverse_complement(motif)

        for i in range(len(seq) - motif_len + 1):
            window = seq[i : i + motif_len]
            if matches_iupac(window, motif):
                spacer = get_plus_spacer(seq, i, prefer21)
                if spacer is not None:
                    proto_start, proto_end, genomic, guide = spacer
                    feat = nearest_feature(record, proto_start, proto_end)
                    rows.append(build_row(record, pam_key, "+", i, motif_len, window, proto_start, proto_end, genomic, guide, feat))

            if matches_iupac(window, reverse_motif):
                spacer = get_minus_spacer(seq, i, motif_len, prefer21)
                if spacer is not None:
                    proto_start, proto_end, genomic, guide = spacer
                    feat = nearest_feature(record, proto_start, proto_end)
                    rows.append(build_row(record, pam_key, "-", i, motif_len, reverse_complement(window), proto_start, proto_end, genomic, guide, feat))

    rows.sort(key=lambda r: (int(r["pam_start"]), r["strand"]))
    for idx, row in enumerate(rows, start=1):
        row["index"] = idx
    return rows


def build_row(record, pam_key, strand, i, motif_len, pam_5to3, proto_start, proto_end, genomic, guide, feat):
    feat_name = feature_name(feat) if feat is not None else ""
    feat_type = feat.type if feat is not None else ""
    feat_span = ""
    if feat is not None:
        feat_span = f"{int(feat.location.start) + 1}..{int(feat.location.end)}"
    gc_pct = round((guide.count("G") + guide.count("C")) / len(guide) * 100, 1) if guide else 0.0
    return {
        "index": 0,
        "record": record.id,
        "pam_label": pam_key,
        "strand": strand,
        "pam_start": i + 1,
        "pam_end": i + motif_len,
        "pam_seq_5to3": pam_5to3,
        "protospacer_start": proto_start,
        "protospacer_end": proto_end,
        "protospacer_length": len(guide),
        "spacer_seq_5to3": guide,
        "genomic_protospacer_seq": genomic,
        "guide_starts_with_G": guide.startswith("G"),
        "gc_pct": gc_pct,
        "feature_name": feat_name,
        "feature_type": feat_type,
        "feature_span": feat_span,
    }


def iter_records(paths: Iterable[Path]):
    for path in paths:
        yield from SeqIO.parse(str(path), "genbank")


def main() -> None:
    parser = argparse.ArgumentParser(description="Batch extract PAM sites and spacers from GenBank files.")
    parser.add_argument("inputs", nargs="+", help="Input GenBank files")
    parser.add_argument("-o", "--output", required=True, help="Output CSV/TSV file")
    parser.add_argument("--allow-g-at-w", action="store_true", help="Allow G at W in NNAGAAW")
    parser.add_argument("--no-prefer21g", action="store_true", help="Disable 21-nt rule when nt21 is G and nt20 is not")
    args = parser.parse_args()

    output_path = Path(args.output)
    delimiter = "\t" if output_path.suffix.lower() == ".tsv" else ","
    rows: List[Dict[str, str]] = []
    for record in iter_records([Path(p) for p in args.inputs]):
        rows.extend(scan_record(record, allow_g_at_w=args.allow_g_at_w, prefer21=not args.no_prefer21g))

    if not rows:
        raise SystemExit("No PAM sites found or no readable GenBank records supplied.")

    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()), delimiter=delimiter)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {output_path}")


if __name__ == "__main__":
    main()
