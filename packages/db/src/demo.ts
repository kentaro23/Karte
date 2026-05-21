/**
 * Demo / frontend-only Prisma proxy.
 *
 * Activated automatically when `DATABASE_URL` is unset, so the EMR UI can
 * render and all buttons are clickable without provisioning a database.
 * Returns predefined sample data for known models and sensible empty
 * defaults (`[]`, `null`, `0`) for everything else.
 *
 * NOT FOR PRODUCTION USE — never persists anything, never enforces any of
 * the regulatory invariants (append-only, audit chain, RBAC, etc.).
 * The real `PrismaClient` is used the moment `DATABASE_URL` is set.
 */

const ago = (days: number): Date => new Date(Date.now() - days * 86_400_000);

const DEMO_CLINIC = {
  id: 'demo-clinic',
  name: 'Medixus デモクリニック',
  postalCode: '100-0001',
  address: '東京都千代田区千代田1-1',
  phone: '03-0000-0000',
  fax: '03-0000-0001',
  websiteUrl: 'https://medixus.example.com',
  createdAt: ago(365),
  updatedAt: ago(7),
};

const DEMO_DEPARTMENTS = [
  { id: 'demo-dep-1', clinicId: 'demo-clinic', code: 'IM',  name: '内科',    isActive: true },
  { id: 'demo-dep-2', clinicId: 'demo-clinic', code: 'PED', name: '小児科',  isActive: true },
  { id: 'demo-dep-3', clinicId: 'demo-clinic', code: 'GYN', name: '婦人科',  isActive: true },
  { id: 'demo-dep-4', clinicId: 'demo-clinic', code: 'ORT', name: '整形外科',isActive: true },
  { id: 'demo-dep-5', clinicId: 'demo-clinic', code: 'DRM', name: '皮膚科',  isActive: true },
];

// Nested ward → rooms → beds. Pre-embedded so that pages relying on
// Prisma's `include: { rooms: { include: { beds: true } } }` still receive
// the related rows in demo mode (the proxy itself doesn't synthesise
// includes — it just hands back whatever we put on the sample row).
const DEMO_WARD_DEFS = [
  { id: 'demo-w-1', clinicId: 'demo-clinic', name: '3階東病棟', code: '3E', floor: 3, roomCount: 4 },
  { id: 'demo-w-2', clinicId: 'demo-clinic', name: '3階西病棟', code: '3W', floor: 3, roomCount: 4 },
  { id: 'demo-w-3', clinicId: 'demo-clinic', name: '4階南病棟', code: '4S', floor: 4, roomCount: 5 },
] as const;

const DEMO_WARDS = DEMO_WARD_DEFS.map((w) => {
  const rooms = Array.from({ length: w.roomCount }, (_, ri) => {
    const roomCode = `${w.code}-${ri + 1}`;
    const beds = Array.from({ length: 4 }, (_, bi) => ({
      id: `demo-bed-${w.id}-${ri + 1}-${bi + 1}`,
      roomId: `demo-room-${w.id}-${ri + 1}`,
      code: `${roomCode}-${bi + 1}`,
      number: bi + 1,
      isOccupied: bi < 2,
    }));
    return {
      id: `demo-room-${w.id}-${ri + 1}`,
      wardId: w.id,
      code: roomCode,
      name: `${roomCode} 号室`,
      capacity: 4,
      beds,
    };
  });
  return { id: w.id, clinicId: w.clinicId, name: w.name, code: w.code, floor: w.floor, rooms };
});

const DEMO_ROOMS = DEMO_WARDS.flatMap((w) => w.rooms);
const DEMO_BEDS = DEMO_ROOMS.flatMap((r) => r.beds);

const PATIENT_LAST = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '山口', '松本'];
const PATIENT_FIRST = ['太郎', '花子', '次郎', '美咲', '三郎', '由美', '四郎', '加奈', '五郎', '麻衣', '誠', '愛', '健', '智子', '翔'];
const KANA_LAST = ['サトウ', 'スズキ', 'タカハシ', 'タナカ', 'イトウ', 'ワタナベ', 'ヤマモト', 'ナカムラ', 'コバヤシ', 'カトウ', 'ヨシダ', 'ヤマダ', 'ササキ', 'ヤマグチ', 'マツモト'];
const KANA_FIRST = ['タロウ', 'ハナコ', 'ジロウ', 'ミサキ', 'サブロウ', 'ユミ', 'シロウ', 'カナ', 'ゴロウ', 'マイ', 'マコト', 'アイ', 'タケシ', 'トモコ', 'ショウ'];

const DEMO_PATIENTS = Array.from({ length: 15 }, (_, i) => ({
  id: `demo-pat-${i + 1}`,
  clinicId: 'demo-clinic',
  patientNo: String(100000 + i + 1),
  kanjiLastName: PATIENT_LAST[i],
  kanjiFirstName: PATIENT_FIRST[i],
  kanaLastName: KANA_LAST[i],
  kanaFirstName: KANA_FIRST[i],
  dateOfBirth: new Date(1940 + i * 4, i % 12, 1 + ((i * 3) % 28)),
  gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
  postalCode: '100-0001',
  address: '東京都千代田区千代田1-1',
  phone: `090-0000-${String(i + 1).padStart(4, '0')}`,
  email: null,
  isVip: i === 0,
  isProvisional: false,
  mergedIntoId: null,
  createdAt: ago(60 - i * 3),
  updatedAt: ago(7),
  // Embedded relations so `include: { allergies, infections, profile }`
  // returns populated lists when read through the demo proxy.
  allergies:
    i === 1
      ? [{ id: `demo-allerg-${i}-1`, patientId: `demo-pat-${i + 1}`, substance: 'ペニシリン', severity: 'SEVERE', note: '蕁麻疹' }]
      : i === 3
        ? [{ id: `demo-allerg-${i}-1`, patientId: `demo-pat-${i + 1}`, substance: '卵', severity: 'MODERATE', note: null }]
        : [],
  infections:
    i === 2
      ? [{ id: `demo-inf-${i}-1`, patientId: `demo-pat-${i + 1}`, pathogen: 'HBV', status: 'CARRIER', testedAt: ago(180) }]
      : [],
  profile: {
    id: `demo-profile-${i + 1}`,
    patientId: `demo-pat-${i + 1}`,
    bloodType: ['A', 'B', 'O', 'AB'][i % 4],
    height: 150 + (i % 30),
    weight: 50 + (i % 30),
    note: null,
  },
}));

const DEMO_STAFF = [
  { id: 'demo-staff-1', clinicId: 'demo-clinic', staffNo: 'D001', loginId: 'doctor',  name: '研修 太郎', kana: 'ケンシュウ タロウ', jobType: 'DOCTOR',     isActive: true, createdAt: ago(180) },
  { id: 'demo-staff-2', clinicId: 'demo-clinic', staffNo: 'N001', loginId: 'nurse',   name: '看護 花子', kana: 'カンゴ ハナコ',   jobType: 'NURSE',      isActive: true, createdAt: ago(180) },
  { id: 'demo-staff-3', clinicId: 'demo-clinic', staffNo: 'P001', loginId: 'pharma',  name: '薬剤 次郎', kana: 'ヤクザイ ジロウ', jobType: 'PHARMACIST', isActive: true, createdAt: ago(180) },
  { id: 'demo-staff-4', clinicId: 'demo-clinic', staffNo: 'C001', loginId: 'clerk',   name: '受付 美咲', kana: 'ウケツケ ミサキ', jobType: 'CLERK',      isActive: true, createdAt: ago(180) },
  { id: 'demo-staff-5', clinicId: 'demo-clinic', staffNo: 'A001', loginId: 'admin',   name: '管理 三郎', kana: 'カンリ サブロウ', jobType: 'ADMIN',      isActive: true, createdAt: ago(180) },
];

const RECEPTION_STATUSES = ['ARRIVED', 'QUESTIONNAIRE_DONE', 'IN_EXAM', 'EXAM_DONE', 'BILLING_DONE'];
const DEMO_ENCOUNTERS = DEMO_PATIENTS.slice(0, 8).map((p, i) => ({
  id: `demo-enc-${i + 1}`,
  clinicId: 'demo-clinic',
  patientId: p.id,
  patient: p,
  encounterType: i < 6 ? 'OUTPATIENT' : 'INPATIENT',
  encounterDate: ago(i),
  visitType: i % 3 === 0 ? 'FIRST_VISIT' : 'REVISIT',
  departmentId: DEMO_DEPARTMENTS[i % DEMO_DEPARTMENTS.length]!.id,
  wardId: i >= 6 ? DEMO_WARDS[i % 3]!.id : null,
  receptionNo: i + 1,
  receptionStatus: RECEPTION_STATUSES[i % RECEPTION_STATUSES.length]!,
  receivedAt: ago(i),
  createdAt: ago(i),
  updatedAt: ago(i),
}));

const DEMO_APPOINTMENTS = DEMO_PATIENTS.slice(0, 6).map((p, i) => ({
  id: `demo-apt-${i + 1}`,
  clinicId: 'demo-clinic',
  patientId: p.id,
  patient: p,
  departmentId: DEMO_DEPARTMENTS[i % DEMO_DEPARTMENTS.length]!.id,
  scheduledAt: new Date(Date.now() + (i + 1) * 3600 * 1000),
  status: 'BOOKED',
  notes: null,
  createdAt: ago(7 - i),
}));

// A small but recognisable drug catalogue so the chart screen's drug
// picker is browseable in demo mode. Real production data comes from
// the public formulary import; this is purely cosmetic.
const DRUG_SEED: ReadonlyArray<{
  brand: string;
  generic: string;
  unit: string;
  route: string;
}> = [
  { brand: 'カロナール錠200mg',         generic: 'アセトアミノフェン',     unit: 'mg', route: 'PO' },
  { brand: 'ロキソニン錠60mg',           generic: 'ロキソプロフェンナトリウム', unit: 'mg', route: 'PO' },
  { brand: 'ボルタレン錠25mg',           generic: 'ジクロフェナクナトリウム', unit: 'mg', route: 'PO' },
  { brand: 'ムコダイン錠500mg',          generic: 'カルボシステイン',       unit: 'mg', route: 'PO' },
  { brand: 'ムコサール錠15mg',           generic: 'アンブロキソール塩酸塩', unit: 'mg', route: 'PO' },
  { brand: 'メジコン錠15mg',             generic: 'デキストロメトルファン臭化水素酸塩', unit: 'mg', route: 'PO' },
  { brand: 'アレグラ錠60mg',             generic: 'フェキソフェナジン塩酸塩', unit: 'mg', route: 'PO' },
  { brand: 'クラリチン錠10mg',           generic: 'ロラタジン',             unit: 'mg', route: 'PO' },
  { brand: 'タリオン錠10mg',             generic: 'ベポタスチンベシル酸塩', unit: 'mg', route: 'PO' },
  { brand: 'PL配合顆粒',                  generic: '総合感冒薬',             unit: 'g',  route: 'PO' },
  { brand: 'クラビット錠500mg',          generic: 'レボフロキサシン水和物', unit: 'mg', route: 'PO' },
  { brand: 'サワシリン錠250mg',          generic: 'アモキシシリン水和物',   unit: 'mg', route: 'PO' },
  { brand: 'クラリス錠200mg',            generic: 'クラリスロマイシン',     unit: 'mg', route: 'PO' },
  { brand: 'メイアクトMS錠100mg',        generic: 'セフジトレンピボキシル', unit: 'mg', route: 'PO' },
  { brand: 'ジスロマック錠250mg',        generic: 'アジスロマイシン水和物', unit: 'mg', route: 'PO' },
  { brand: 'タミフルカプセル75mg',       generic: 'オセルタミビルリン酸塩', unit: 'mg', route: 'PO' },
  { brand: 'リレンザ',                    generic: 'ザナミビル水和物',       unit: 'mg', route: 'INH' },
  { brand: 'オメプラール錠20mg',         generic: 'オメプラゾール',         unit: 'mg', route: 'PO' },
  { brand: 'タケプロンOD錠15mg',         generic: 'ランソプラゾール',       unit: 'mg', route: 'PO' },
  { brand: 'ネキシウムカプセル20mg',     generic: 'エソメプラゾールマグネシウム水和物', unit: 'mg', route: 'PO' },
  { brand: 'ガスター錠20mg',             generic: 'ファモチジン',           unit: 'mg', route: 'PO' },
  { brand: 'マグミット錠330mg',          generic: '酸化マグネシウム',       unit: 'mg', route: 'PO' },
  { brand: 'プルゼニド錠12mg',           generic: 'センノシド',             unit: 'mg', route: 'PO' },
  { brand: 'ノルバスク錠5mg',            generic: 'アムロジピンベシル酸塩', unit: 'mg', route: 'PO' },
  { brand: 'ブロプレス錠8mg',            generic: 'カンデサルタンシレキセチル', unit: 'mg', route: 'PO' },
  { brand: 'ディオバン錠80mg',           generic: 'バルサルタン',           unit: 'mg', route: 'PO' },
  { brand: 'メインテート錠2.5mg',        generic: 'ビソプロロールフマル酸塩', unit: 'mg', route: 'PO' },
  { brand: 'ラシックス錠40mg',           generic: 'フロセミド',             unit: 'mg', route: 'PO' },
  { brand: 'クレストール錠2.5mg',        generic: 'ロスバスタチンカルシウム', unit: 'mg', route: 'PO' },
  { brand: 'リピトール錠10mg',           generic: 'アトルバスタチンカルシウム水和物', unit: 'mg', route: 'PO' },
  { brand: 'メトグルコ錠250mg',          generic: 'メトホルミン塩酸塩',     unit: 'mg', route: 'PO' },
  { brand: 'アマリール錠1mg',            generic: 'グリメピリド',           unit: 'mg', route: 'PO' },
  { brand: 'ジャヌビア錠50mg',           generic: 'シタグリプチンリン酸塩水和物', unit: 'mg', route: 'PO' },
  { brand: 'デパス錠0.5mg',              generic: 'エチゾラム',             unit: 'mg', route: 'PO' },
  { brand: 'マイスリー錠5mg',            generic: 'ゾルピデム酒石酸塩',     unit: 'mg', route: 'PO' },
  { brand: 'プレドニン錠5mg',            generic: 'プレドニゾロン',         unit: 'mg', route: 'PO' },
  { brand: 'ワーファリン錠1mg',          generic: 'ワルファリンカリウム',   unit: 'mg', route: 'PO' },
  { brand: 'バイアスピリン錠100mg',      generic: 'アスピリン',             unit: 'mg', route: 'PO' },
  { brand: 'ヘパリンナトリウム注5000単位/5mL', generic: 'ヘパリンナトリウム', unit: '単位', route: 'IV' },
  { brand: '生理食塩液 100mL',           generic: '生理食塩液',             unit: 'mL', route: 'IV' },
];
const DEMO_DRUGS = DRUG_SEED.map((d, i) => ({
  id: `demo-drug-${i + 1}`,
  brandName: d.brand,
  genericName: d.generic,
  strengthUnit: d.unit,
  administrationRoute: d.route,
  yjCode: `${String(i + 1).padStart(4, '0')}001F1027`,
  receiptCode: String(620000000 + i),
  unitPrice: 10 + i * 3,
  isActive: true,
  createdAt: ago(365),
  updatedAt: ago(30),
}));

// Map model name (camelCase as Prisma uses it) -> sample rows.
const SAMPLE: Record<string, ReadonlyArray<Record<string, unknown>>> = {
  clinic: [DEMO_CLINIC],
  department: DEMO_DEPARTMENTS,
  ward: DEMO_WARDS,
  room: DEMO_ROOMS,
  bed: DEMO_BEDS,
  patient: DEMO_PATIENTS,
  staffUser: DEMO_STAFF,
  encounter: DEMO_ENCOUNTERS,
  appointment: DEMO_APPOINTMENTS,
  authSession: [],
  rolePermission: [
    { id: 'demo-rp-1', jobType: 'DOCTOR',     permissionKey: 'CHART_WRITE',  isAllowed: true },
    { id: 'demo-rp-2', jobType: 'DOCTOR',     permissionKey: 'ORDER_RX',     isAllowed: true },
    { id: 'demo-rp-3', jobType: 'NURSE',      permissionKey: 'CHART_WRITE',  isAllowed: true },
    { id: 'demo-rp-4', jobType: 'PHARMACIST', permissionKey: 'DISPENSE',     isAllowed: true },
    { id: 'demo-rp-5', jobType: 'CLERK',      permissionKey: 'RECEPTION',    isAllowed: true },
    { id: 'demo-rp-6', jobType: 'ADMIN',      permissionKey: 'ADMIN',        isAllowed: true },
  ],
  auditEvent: [],
  prescription: [],
  countersign: [],
  patientSelectionLog: [],
  drugProduct: DEMO_DRUGS,
  drugIngredient: [],
  drugContraindication: [],
  drugIndication: [],
  drugProductIngredient: [],
  examMaster: [],
  diseaseMaster: [],
  importRun: [],
  referral: [],
  clinicalDocument: [],
  dischargeSummary: [],
  clinicalNote: [],
  patientDiagnosis: [],
  sticky: [],
};

function applyTake<T>(arr: readonly T[], take?: unknown): T[] {
  if (typeof take === 'number' && take >= 0) return arr.slice(0, take);
  return [...arr];
}

function modelProxy(modelName: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, methodName: string | symbol) {
        if (typeof methodName !== 'string') return undefined;
        return async (...args: unknown[]) => {
          const data = SAMPLE[modelName] ?? [];
          const arg = (args[0] ?? {}) as {
            where?: { id?: string };
            take?: number;
            data?: Record<string, unknown>;
          };
          switch (methodName) {
            case 'findMany':
              return applyTake(data, arg?.take);
            case 'findFirst':
              return data[0] ?? null;
            case 'findUnique':
            case 'findUniqueOrThrow':
            case 'findFirstOrThrow': {
              const id = arg?.where?.id;
              // In demo mode we want any deep-linked id to land on a real
              // (sample) record so the chart/print/etc. screens render
              // instead of 404'ing. Match-by-id first, then fall back to
              // the first sample row.
              const hit =
                (id ? data.find((d) => (d as { id?: string }).id === id) : undefined) ??
                data[0] ??
                null;
              if (!hit && methodName.endsWith('OrThrow')) {
                throw new Error(`[demo] ${modelName}.${methodName}: not found`);
              }
              return hit;
            }
            case 'count':
              return data.length;
            case 'aggregate':
              return { _count: data.length, _sum: {}, _avg: {}, _min: {}, _max: {} };
            case 'groupBy':
              return [];
            case 'create':
              return { id: `demo-new-${Date.now()}`, ...(arg.data ?? {}) };
            case 'createMany':
              return { count: 0 };
            case 'update':
            case 'upsert':
              return { id: arg?.where?.id ?? 'demo-id', ...(arg.data ?? {}) };
            case 'updateMany':
            case 'deleteMany':
              return { count: 0 };
            case 'delete':
              return { id: arg?.where?.id ?? 'demo-id' };
            default:
              return null;
          }
        };
      },
    },
  );
}

export function makeDemoClient(): unknown {
  const self: unknown = new Proxy(
    {},
    {
      get(_target, name: string | symbol) {
        if (typeof name !== 'string') return undefined;
        // Raw query helpers.
        if (name === '$queryRaw' || name === '$queryRawUnsafe') {
          return async () => [{ ok: 1 }];
        }
        if (name === '$executeRaw' || name === '$executeRawUnsafe') {
          return async () => 0;
        }
        if (name === '$transaction') {
          return async (input: unknown) => {
            if (typeof input === 'function') return (input as (tx: unknown) => unknown)(self);
            if (Array.isArray(input)) return Promise.all(input);
            return undefined;
          };
        }
        if (name === '$connect' || name === '$disconnect') {
          return async () => undefined;
        }
        // Chain-friendly no-ops so `prisma.$extends(...)` keeps working.
        if (name === '$extends' || name === '$on' || name === '$use') {
          return () => self;
        }
        if (name.startsWith('$')) return undefined;
        return modelProxy(name);
      },
    },
  );
  return self;
}

/** True when the app should run as a frontend-only demo (no DATABASE_URL). */
export const isDemoMode = !process.env.DATABASE_URL;
