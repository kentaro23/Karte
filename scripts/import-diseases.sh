#!/usr/bin/env bash
# 傷病名マスター取込（厚労省/支払基金 基本マスター s / b）。zip / csv / txt 対応・Shift_JIS自動変換。
#   bash scripts/import-diseases.sh <R06_s.zip | s.csv | b_YYYYMMDD.txt> [release]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-}"; RELEASE="${2:-$(date +%Y-%m)}"
[ -z "$SRC" ] && { echo "usage: import-diseases.sh <zip|csv|txt> [release]"; exit 1; }
[ -f "$SRC" ] || { echo "見つかりません: $SRC"; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
RAW="$TMP/raw"
case "$SRC" in
  *.zip)
    INNER="$(unzip -Z1 "$SRC" | grep -iE '\.csv$' | head -1)"
    [ -z "$INNER" ] && { echo "zip内にCSVなし"; exit 1; }
    unzip -p "$SRC" "$INNER" > "$RAW" ;;
  *.csv|*.txt) cp "$SRC" "$RAW" ;;
  *) echo "対応: .zip/.csv/.txt"; exit 1 ;;
esac
UTF8="$TMP/s_utf8.csv"
if iconv -f CP932 -t UTF-8 "$RAW" > "$UTF8" 2>/dev/null; then :; else cp "$RAW" "$UTF8"; fi
echo "[import-diseases] rows: $(wc -l < "$UTF8") / release: $RELEASE"
cd "$ROOT"
pnpm --filter @medixus/seed exec tsx import-diseases.ts "$UTF8" "$RELEASE"
