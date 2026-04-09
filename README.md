# PAM Scout

PAM Scout is a static GitHub Pages app for scanning annotated GenBank files for CRISPR-adjacent PAMs and exporting spacer candidates.

The app is designed for phage genomes or other annotated DNA molecules where you want to:

- upload one or more GenBank files
- scan both strands for `NNAGAAW` and `NNGGAA`
- optionally allow `G` at the `W` position in `NNAGAAW`
- define the protospacer as 20 nt adjacent to the PAM, with an automatic 21-nt extension when position 21 is `G` and position 20 is not
- view PAM locations on a pannable and zoomable genome map
- inspect gene annotations with orientation
- click PAM markers to build a selected guide list
- export all candidates or selected candidates as CSV/TSV

## Important design choice

This site runs entirely in the browser so it can be hosted on GitHub Pages. That means uploaded sequence files are parsed locally and do not need a backend.

## File structure

- `index.html` — main application shell
- `styles.css` — app styling
- `app.js` — UI, rendering, export, interactions
- `parser.js` — GenBank parser for browser use
- `pam.js` — PAM and spacer scanning logic
- `data/demo_phage.gb` — demo file for quick testing
- `scripts/batch_extract_pams.py` — optional local command-line helper for batch export
- `.github/workflows/deploy-pages.yml` — GitHub Pages deployment workflow

## How spacer sequences are reported

For convenience, the exported spacer is reported as a guide-ready 5'→3' sequence:

- for a PAM on the `+` strand, the protospacer is the genomic sequence immediately upstream of the PAM
- for a PAM on the `-` strand, the protospacer lies downstream in genomic coordinates and is exported as the reverse complement so the spacer is still given 5'→3'

The export also includes the genomic protospacer sequence separately.

## Local preview

Because the app uses ES modules, serve the folder with a lightweight static server instead of opening the HTML file directly.

### Python

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Publish with GitHub Pages

1. Create a new GitHub repository.
2. Copy the repo contents into that repository.
3. Push to the `main` branch.
4. In GitHub, open **Settings → Pages** and ensure **GitHub Actions** is the source.
5. The included workflow will publish the site automatically.

## Optional Python batch script

Install requirements:

```bash
pip install -r requirements.txt
```

Run batch extraction:

```bash
python scripts/batch_extract_pams.py data/demo_phage.gb -o demo_pams.csv
```

Optional flags:

```bash
--allow-g-at-w
--no-prefer21g
```

## Notes and current limits

- The browser parser is designed for standard GenBank feature formatting and common feature locations including `complement(...)`, `join(...)`, and `order(...)`.
- Very dense annotations can still overlap visually at low zoom, but the map remains scrollable and zoomable.
- If you want next steps later, sensible additions would be paired-guide ranking, restriction-site screening for oligo cloning, off-target scoring against a reference genome, and direct FASTA export for oligo ordering templates.
