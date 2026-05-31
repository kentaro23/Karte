/**
 * 差込テンプレート文書（docx/xlsx）の差込解決ヘルパ — FR-DOC-01 / G20。
 *
 * 単一データソース（患者 / 保険 / 病名 / 投薬 / 検査 / 医療機関プロファイル）から
 * プレースホルダ `{{key}}` を解決する。二重入力ゼロ（UX-3）。本ファイルは純関数のみで、
 * Prisma 取得は documents/actions.ts が行い、整形済みの {@link MergeSource} を渡す。
 *
 * 対応差込変数（AC(1)(2)）:
 *  - 患者基本: 西暦/和暦の生年月日・年齢・カナ・ローマ字（簡易ヘボン式）
 *  - 住所分解: 郵便番号 / 都道府県 / 市区町村 / 番地・建物
 *  - 医療機関: 名称 / 種別 / 住所 / 電話 / 管理者・医師名
 *  - 未転帰傷病名（outcome 未確定の ACTIVE 病名）
 *  - 直近投薬・直近検査（H/L 判定付き）
 *  - 保険一式（保険者番号 / 記号 / 番号 / 枝番）＋公費1-3＋労災
 *  - バイタル（身長 / 体重 / BMI / 血圧 / 脈拍 / 体温 / SpO2）
 */

/* ───────────────────────── 単一データソース型 ───────────────────────── */

export interface MergeAddress {
  postalCode?: string | null;
  prefecture?: string | null;
  city?: string | null;
  line?: string | null; // 番地・建物
}

export interface MergePatient {
  patientNo: string;
  kanjiLastName: string;
  kanjiFirstName: string;
  kanaLastName: string;
  kanaFirstName: string;
  /** 英字氏名（指定があれば優先。無ければカナからヘボン式で近似生成）。 */
  romanLastName?: string | null;
  romanFirstName?: string | null;
  dateOfBirth?: Date | string | null;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN' | string | null;
  address?: MergeAddress | null;
  phone?: string | null;
}

export interface MergeFacility {
  name?: string | null;
  kind?: string | null; // CLINIC | HOSPITAL
  address?: string | null;
  phone?: string | null;
  director?: string | null; // 開設者/管理者
  doctorName?: string | null; // 主治医・記載医
  departmentName?: string | null;
}

export interface MergeDiagnosis {
  displayName: string;
  isMain?: boolean;
  isSuspected?: boolean;
  startDate?: Date | string | null;
  /** outcome が null/undefined = 未転帰。 */
  outcome?: string | null;
}

export interface MergeMedication {
  name: string;
  dosage?: string | null; // 例: "1回1錠 1日3回 7日分"
  date?: Date | string | null;
}

export interface MergeLab {
  name: string;
  value?: number | string | null;
  unit?: string | null;
  flag?: string | null; // H | L | N
  date?: Date | string | null;
}

export interface MergeInsurance {
  payerType?: string | null;
  payerNo?: string | null;
  symbol?: string | null;
  number?: string | null;
  branchNo?: string | null; // 被保険者枝番（2桁）
  public1?: { payer?: string | null; recipient?: string | null } | null;
  public2?: { payer?: string | null; recipient?: string | null } | null;
  public3?: { payer?: string | null; recipient?: string | null } | null;
  workersComp?: boolean | null;
  specialNote?: string | null;
}

export interface MergeVitals {
  heightCm?: number | null;
  weightKg?: number | null;
  systolic?: number | null;
  diastolic?: number | null;
  pulse?: number | null;
  temperature?: number | null;
  spo2?: number | null;
}

export interface MergeSource {
  patient?: MergePatient | null;
  facility?: MergeFacility | null;
  diagnoses?: MergeDiagnosis[];
  medications?: MergeMedication[];
  labs?: MergeLab[];
  insurance?: MergeInsurance | null;
  vitals?: MergeVitals | null;
  /** 文書作成日（既定は now）。 */
  issuedOn?: Date | string | null;
}

/* ───────────────────────── 日付・和暦 ───────────────────────── */

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** 西暦 yyyy/mm/dd（ゼロ詰め）。 */
export function formatGregorian(v: Date | string | null | undefined): string {
  const d = toDate(v);
  if (!d) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}/${mm}/${dd}`;
}

interface Era {
  name: string;
  abbr: string;
  start: Date;
}
// 元号開始日（施行日）。元年は1年表記。
const ERAS: Era[] = [
  { name: '令和', abbr: 'R', start: new Date('2019-05-01') },
  { name: '平成', abbr: 'H', start: new Date('1989-01-08') },
  { name: '昭和', abbr: 'S', start: new Date('1926-12-25') },
  { name: '大正', abbr: 'T', start: new Date('1912-07-30') },
  { name: '明治', abbr: 'M', start: new Date('1868-01-25') },
];

/**
 * 和暦（例: 令和7年3月9日）。元年は「元年」と表記。施行日より前は西暦にフォールバック。
 */
export function formatWareki(v: Date | string | null | undefined): string {
  const d = toDate(v);
  if (!d) return '';
  const era = ERAS.find((e) => d.getTime() >= e.start.getTime());
  if (!era) return formatGregorian(d);
  const yearNo = d.getFullYear() - era.start.getFullYear() + 1;
  const y = yearNo === 1 ? '元' : String(yearNo);
  return `${era.name}${y}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 満年齢。 */
export function calcAge(v: Date | string | null | undefined, on: Date = new Date()): number | null {
  const d = toDate(v);
  if (!d) return null;
  let age = on.getFullYear() - d.getFullYear();
  const m = on.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

/* ───────────────────────── ローマ字（簡易ヘボン式） ───────────────────────── */

const ROMAJI_DIGRAPH: Record<string, string> = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo', みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo', びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
};
const ROMAJI_MONO: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ー: '', '・': ' ',
};

function katakanaToHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * カナ氏名 → ローマ字（簡易ヘボン式）。促音「っ」は次子音重ね、撥音「ん」+母音/yは
 * アポストロフィを付す。英字氏名が登録されていればそちらを使うこと（本関数は近似）。
 */
export function kanaToRomaji(kana: string | null | undefined): string {
  if (!kana) return '';
  const src = katakanaToHiragana(kana.trim());
  let out = '';
  let sokuon = false;
  for (let i = 0; i < src.length; i++) {
    const two = src.slice(i, i + 2);
    const digraph = ROMAJI_DIGRAPH[two];
    if (digraph !== undefined) {
      let r = digraph;
      if (sokuon) { r = (r[0] ?? '') + r; sokuon = false; }
      out += r;
      i++;
      continue;
    }
    const ch = src[i] ?? '';
    if (ch === 'っ') { sokuon = true; continue; }
    const mono = ROMAJI_MONO[ch];
    if (mono === undefined) { out += ch; continue; }
    let r = mono;
    // 撥音 n の後に母音・y が続く場合はアポストロフィ。
    if (out.endsWith('n') && /^[aiueoy]/.test(r)) out += "'";
    if (sokuon) { r = (r[0] ?? '') + r; sokuon = false; }
    out += r;
  }
  return out;
}

/** "Yamada Taro" のように姓名を大文字頭で連結。 */
function romanFull(last: string, first: string): string {
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  return [cap(last), cap(first)].filter(Boolean).join(' ');
}

/* ───────────────────────── 補助フォーマッタ ───────────────────────── */

const GENDER_LABEL: Record<string, string> = {
  MALE: '男', FEMALE: '女', OTHER: 'その他', UNKNOWN: '不明',
};

function bmi(heightCm?: number | null, weightKg?: number | null): number | null {
  if (!heightCm || !weightKg || heightCm <= 0) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

function joinAddress(a?: MergeAddress | null): string {
  if (!a) return '';
  return [a.prefecture, a.city, a.line].filter(Boolean).join('');
}

/* ───────────────────────── 差込辞書の構築 ───────────────────────── */

/**
 * {@link MergeSource} から `{{key}}` → 値 の差込辞書を構築する。
 * 値が無い変数は空文字（テンプレ上は空欄として描画される）。
 */
export function buildMergeMap(src: MergeSource): Record<string, string> {
  const now = toDate(src.issuedOn) ?? new Date();
  const m: Record<string, string> = {};
  const set = (k: string, v: string | number | null | undefined) => {
    m[k] = v === null || v === undefined ? '' : String(v);
  };

  // ── 患者基本 ──
  const p = src.patient ?? undefined;
  if (p) {
    set('患者番号', p.patientNo);
    set('患者氏名', `${p.kanjiLastName} ${p.kanjiFirstName}`.trim());
    set('患者姓', p.kanjiLastName);
    set('患者名', p.kanjiFirstName);
    set('患者カナ', `${p.kanaLastName} ${p.kanaFirstName}`.trim());
    const last = (p.romanLastName && p.romanLastName.trim()) || kanaToRomaji(p.kanaLastName);
    const first = (p.romanFirstName && p.romanFirstName.trim()) || kanaToRomaji(p.kanaFirstName);
    set('患者ローマ字', romanFull(last, first));
    set('生年月日西暦', formatGregorian(p.dateOfBirth));
    set('生年月日和暦', formatWareki(p.dateOfBirth));
    const age = calcAge(p.dateOfBirth, now);
    set('年齢', age === null ? '' : `${age}`);
    set('性別', p.gender ? GENDER_LABEL[String(p.gender)] ?? String(p.gender) : '');
    set('患者電話', p.phone);
    // 住所分解
    set('郵便番号', p.address?.postalCode);
    set('都道府県', p.address?.prefecture);
    set('市区町村', p.address?.city);
    set('番地建物', p.address?.line);
    set('患者住所', joinAddress(p.address));
  }

  // ── 医療機関 ──
  const f = src.facility ?? undefined;
  set('医療機関名', f?.name);
  set('医療機関種別', f?.kind === 'HOSPITAL' ? '病院' : f?.kind === 'CLINIC' ? '診療所' : f?.kind ?? '');
  set('医療機関住所', f?.address);
  set('医療機関電話', f?.phone);
  set('管理者名', f?.director);
  set('医師名', f?.doctorName);
  set('診療科', f?.departmentName);

  // ── 未転帰傷病名（outcome 未確定） ──
  const open = (src.diagnoses ?? []).filter((d) => !d.outcome);
  set('未転帰傷病名', open.map((d) => formatDx(d)).join('、'));
  const main = open.find((d) => d.isMain) ?? open[0];
  set('主病名', main ? formatDx(main) : '');
  open.forEach((d, i) => set(`未転帰傷病名${i + 1}`, formatDx(d)));

  // ── 直近投薬 ──
  const meds = src.medications ?? [];
  set('直近投薬', meds.map((x) => formatMed(x)).join('\n'));
  meds.forEach((x, i) => set(`直近投薬${i + 1}`, formatMed(x)));

  // ── 直近検査 ──
  const labs = src.labs ?? [];
  set('直近検査', labs.map((x) => formatLab(x)).join('\n'));
  labs.forEach((x, i) => set(`直近検査${i + 1}`, formatLab(x)));

  // ── 保険一式（枝番含む）＋公費 ──
  const ins = src.insurance ?? undefined;
  set('保険者番号', ins?.payerNo);
  set('保険記号', ins?.symbol);
  set('保険番号', ins?.number);
  set('被保険者枝番', ins?.branchNo);
  set(
    '記号番号枝番',
    ins
      ? [ins.symbol, ins.number].filter(Boolean).join('・') + (ins.branchNo ? `（枝番${ins.branchNo}）` : '')
      : '',
  );
  set('公費負担者番号1', ins?.public1?.payer);
  set('公費受給者番号1', ins?.public1?.recipient);
  set('公費負担者番号2', ins?.public2?.payer);
  set('公費受給者番号2', ins?.public2?.recipient);
  set('公費負担者番号3', ins?.public3?.payer);
  set('公費受給者番号3', ins?.public3?.recipient);
  set('労災自賠', ins?.workersComp ? '有' : '');
  set('保険特記事項', ins?.specialNote);

  // ── バイタル ──
  const v = src.vitals ?? undefined;
  set('身長', v?.heightCm != null ? `${v.heightCm}cm` : '');
  set('体重', v?.weightKg != null ? `${v.weightKg}kg` : '');
  const b = bmi(v?.heightCm, v?.weightKg);
  set('BMI', b != null ? `${b}` : '');
  const bp = v?.systolic != null && v?.diastolic != null ? `${v.systolic}/${v.diastolic}mmHg` : '';
  set('血圧', bp);
  set('収縮期血圧', v?.systolic != null ? `${v.systolic}` : '');
  set('拡張期血圧', v?.diastolic != null ? `${v.diastolic}` : '');
  set('脈拍', v?.pulse != null ? `${v.pulse}回/分` : '');
  set('体温', v?.temperature != null ? `${v.temperature}℃` : '');
  set('SpO2', v?.spo2 != null ? `${v.spo2}%` : '');

  // ── 文書共通 ──
  set('作成日西暦', formatGregorian(now));
  set('作成日和暦', formatWareki(now));

  return m;
}

function formatDx(d: MergeDiagnosis): string {
  const tags: string[] = [];
  if (d.isMain) tags.push('主');
  if (d.isSuspected) tags.push('疑い');
  return tags.length ? `${d.displayName}（${tags.join('・')}）` : d.displayName;
}
function formatMed(x: MergeMedication): string {
  return [x.name, x.dosage].filter(Boolean).join(' ');
}
function formatLab(x: MergeLab): string {
  const mark = x.flag === 'H' ? ' H↑' : x.flag === 'L' ? ' L↓' : '';
  const val = x.value != null && x.value !== '' ? `${x.value}${x.unit ? ` ${x.unit}` : ''}` : '';
  return `${x.name} ${val}${mark}`.trim();
}

/* ───────────────────────── 差込実行 ───────────────────────── */

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;

export interface MergeResult {
  /** 差込後の本文。 */
  output: string;
  /** テンプレ内で見つかったプレースホルダ key。 */
  used: string[];
  /** 値が空/未解決だった key。 */
  unresolved: string[];
}

/**
 * テンプレ本文の `{{key}}` を差込辞書で置換する。docx/xlsx もテキスト抽出後はこの形。
 * 未知 key・空値はそのまま空欄化（テンプレに穴が残らないよう除去）。
 */
export function applyMerge(template: string, map: Record<string, string>): MergeResult {
  const used: string[] = [];
  const unresolved: string[] = [];
  const output = (template ?? '').replace(PLACEHOLDER, (_full, rawKey: string) => {
    const key = rawKey.trim();
    used.push(key);
    const val = map[key];
    if (val === undefined || val === '') {
      unresolved.push(key);
      return '';
    }
    return val;
  });
  return { output, used: dedupe(used), unresolved: dedupe(unresolved) };
}

/** テンプレ文字列に含まれるプレースホルダ key 一覧（重複排除）。 */
export function extractPlaceholders(template: string): string[] {
  const keys: string[] = [];
  let mm: RegExpExecArray | null;
  PLACEHOLDER.lastIndex = 0;
  while ((mm = PLACEHOLDER.exec(template ?? '')) !== null) {
    keys.push(mm[1]!.trim());
  }
  return dedupe(keys);
}

/** buildMergeMap が生成しうる全変数 key（テンプレ作成のチートシート用）。 */
export const MERGE_VARIABLE_KEYS: { group: string; keys: string[] }[] = [
  {
    group: '患者基本',
    keys: [
      '患者番号', '患者氏名', '患者姓', '患者名', '患者カナ', '患者ローマ字',
      '生年月日西暦', '生年月日和暦', '年齢', '性別', '患者電話',
    ],
  },
  { group: '住所分解', keys: ['郵便番号', '都道府県', '市区町村', '番地建物', '患者住所'] },
  { group: '医療機関', keys: ['医療機関名', '医療機関種別', '医療機関住所', '医療機関電話', '管理者名', '医師名', '診療科'] },
  { group: '傷病名', keys: ['未転帰傷病名', '主病名', '未転帰傷病名1'] },
  { group: '投薬・検査', keys: ['直近投薬', '直近投薬1', '直近検査', '直近検査1'] },
  {
    group: '保険・公費',
    keys: [
      '保険者番号', '保険記号', '保険番号', '被保険者枝番', '記号番号枝番',
      '公費負担者番号1', '公費受給者番号1', '公費負担者番号2', '公費受給者番号2',
      '公費負担者番号3', '公費受給者番号3', '労災自賠', '保険特記事項',
    ],
  },
  { group: 'バイタル', keys: ['身長', '体重', 'BMI', '血圧', '収縮期血圧', '拡張期血圧', '脈拍', '体温', 'SpO2'] },
  { group: '文書共通', keys: ['作成日西暦', '作成日和暦'] },
];

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
