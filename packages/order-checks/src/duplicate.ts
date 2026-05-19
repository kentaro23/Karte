/**
 * 重複チェック (pure). 同一成分(塩違い正規化後) と 同種同効(同一ATC) を検出.
 */
export interface RxItemForDup {
  itemId: string;
  drugName: string;
  /** salt-normalized active ingredient root ids */
  ingredientRootIds: string[];
  atcCode?: string | null;
}

export interface DuplicateFinding {
  kind: 'SAME_INGREDIENT' | 'SAME_ATC';
  itemIds: string[];
  key: string;
  message: string;
}

export function findDuplicates(items: RxItemForDup[]): DuplicateFinding[] {
  const out: DuplicateFinding[] = [];

  const byIngredient = new Map<string, RxItemForDup[]>();
  for (const it of items) {
    for (const root of new Set(it.ingredientRootIds)) {
      const arr = byIngredient.get(root) ?? [];
      arr.push(it);
      byIngredient.set(root, arr);
    }
  }
  for (const [root, arr] of byIngredient) {
    const ids = [...new Set(arr.map((a) => a.itemId))];
    if (ids.length > 1) {
      out.push({
        kind: 'SAME_INGREDIENT',
        itemIds: ids,
        key: root,
        message: `同一成分の重複: ${[...new Set(arr.map((a) => a.drugName))].join(' / ')}`,
      });
    }
  }

  const byAtc = new Map<string, RxItemForDup[]>();
  for (const it of items) {
    if (!it.atcCode) continue;
    const arr = byAtc.get(it.atcCode) ?? [];
    arr.push(it);
    byAtc.set(it.atcCode, arr);
  }
  for (const [atc, arr] of byAtc) {
    const ids = [...new Set(arr.map((a) => a.itemId))];
    if (ids.length > 1) {
      out.push({
        kind: 'SAME_ATC',
        itemIds: ids,
        key: atc,
        message: `同種同効薬の重複 (ATC ${atc}): ${[...new Set(arr.map((a) => a.drugName))].join(' / ')}`,
      });
    }
  }
  return out;
}
