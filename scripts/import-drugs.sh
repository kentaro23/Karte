#!/usr/bin/env bash
# 保険収載 全医薬品マスタ 取込（厚労省/社会保険診療報酬支払基金 医薬品マスター）。
#
#   bash scripts/import-drugs.sh <医薬品マスター.zip | y.csv> [release]
#
# 公的マスタは Shift_JIS。zip の場合は展開し、iconv で UTF-8 化してから取込む。
# 入手元（無料・要利用登録）:
#   ・診療報酬情報提供サービス  https://shinryohoshu.mhlw.go.jp/  → 基本マスター → 医薬品マスター(y)
#   ・社会保険診療報酬支払基金 「基本マスター」
#   ・厚労省「使用薬剤の薬価（薬価基準）収載品目リスト」(代替) も可
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-}"
RELEASE="${2:-$(date +%Y-%m)}"
[ -z "$SRC" ] && { echo "usage: import-drugs.sh <zip|csv> [release]"; exit 1; }
[ -f "$SRC" ] || { echo "ファイルが見つかりません: $SRC"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
RAW="$TMP/raw.csv"

case "$SRC" in
  *.zip)
    # 医薬品マスターは zip 内に y*.csv（または単一CSV）
    INNER="$(unzip -Z1 "$SRC" | grep -iE '\.csv$' | head -1)"
    [ -z "$INNER" ] && { echo "zip 内に CSV が見つかりません"; exit 1; }
    unzip -p "$SRC" "$INNER" > "$RAW"
    ;;
  *.csv) cp "$SRC" "$RAW" ;;
  *) echo "対応形式: .zip / .csv"; exit 1 ;;
esac

UTF8="$TMP/y_utf8.csv"
# Shift_JIS(CP932) → UTF-8（既に UTF-8 ならそのままコピー）
if iconv -f CP932 -t UTF-8 "$RAW" > "$UTF8" 2>/dev/null; then :; else cp "$RAW" "$UTF8"; fi

echo "[import-drugs] rows: $(wc -l < "$UTF8") / release: $RELEASE"
cd "$ROOT"
pnpm --filter @medixus/seed exec tsx import-drugs.ts "$UTF8" "$RELEASE"
