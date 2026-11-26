# scripts/extractCatalogImages.py
import json
from pathlib import Path
import openpyxl
import pandas as pd


def main():
    xlsx_path = Path("Taparia_Tools_Catalog_April2026.xlsx")
    out_dir = Path("public/images/taparia")
    out_dir.mkdir(parents=True, exist_ok=True)

    wb = openpyxl.load_workbook(xlsx_path)
    ws = wb["Tools Catalog"]
    raw_df = pd.read_excel(xlsx_path, sheet_name="Tools Catalog", header=None)

    image_map = {}
    saved_count = 0

    for idx, img in enumerate(ws._images):
        anchor = img.anchor
        row_idx = (
            anchor._from.row
            if hasattr(anchor, "_from")
            else getattr(anchor, "row", None)
        )
        if row_idx is None or row_idx >= len(raw_df):
            continue

        section = str(raw_df.iloc[row_idx, 1] or "").strip()
        tool_name = str(raw_df.iloc[row_idx, 2] or "").strip()
        if not section and not tool_name:
            continue

        ext = (img.format or "png").lower()
        safe_stem = f"{section}-{tool_name}".lower()
        safe_stem = "".join(ch if ch.isalnum() else "-" for ch in safe_stem).strip("-")[:60]
        filename = f"{idx + 1:03d}-{safe_stem or 'tool'}.{ext}"
        file_path = out_dir / filename

        file_path.write_bytes(img._data())
        image_map[f"{section}__{tool_name}"] = f"/images/taparia/{filename}"
        saved_count += 1

    map_path = Path("scripts/taparia_images.json")
    map_path.write_text(json.dumps(image_map, indent=2), encoding="utf-8")
    print(f"Extracted {saved_count} images to {out_dir} and wrote {map_path}")


if __name__ == "__main__":
    main()