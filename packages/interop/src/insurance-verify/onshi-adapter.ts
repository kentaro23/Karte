/**
 * IF-EXT-02 オンライン資格確認/マイナ保険証 — オン資アダプタ (STUB)。
 *
 * 本番接続は行わず IntegrationResult を status:'STUB' で返す型安全スタブ。
 * ただし完了条件(WP-IOP2)に従い、資格確認結果型/6情報の閲覧結果型を `data` に
 * 代表値で充填して返す (フロントのみモードで「保険証確認」結果が描画できるように)。
 *
 * 院内ゲートウェイ前提 (本番化時に注入する):
 *   - 実通信は『院内ゲートウェイ端末』『資格確認端末(顔認証付きカードリーダ等)』経由で
 *     オンライン資格確認等システム(支払基金/国保中央会)へ。閉域網(オンライン資格確認用
 *     回線/医療機関等向け中間サーバ)を介す。
 *   - マイナ保険証の券面/電子証明書読取・本人同意取得は資格確認端末側で完結し、本アダプタ
 *     には mynaCardToken (トークン化済み読取結果) のみが渡る前提。
 *   - 本スタブを本番アダプタに置換する際は『ゲートウェイのエンドポイント/クライアント証明書/
 *     閲覧サービスごとの同意区分』を実装時に注入する (要件定義書 IF-EXT-02 業務ルール)。
 */
import type { IntegrationResult } from '../types.js';
import type {
  InsuranceVerifyRequest,
  InsuranceVerifyResult,
  OnshiInfoService,
  OnshiPatientInfoResult,
} from './types.js';

/**
 * STUB 資格確認結果の代表値 (フロントのみモードでの描画用ダミー)。
 * 本番では院内ゲートウェイ経由でオンライン資格確認等システムから取得する。
 */
const STUB_VERIFY_RESULT: InsuranceVerifyResult = {
  eligible: true,
  insurerNo: '01130012',
  insuredName: '見本 太郎',
  insuredNameKana: 'ミホン タロウ',
  symbol: '12',
  number: '3456',
  branchNo: '01',
  validFrom: '2025-04-01',
  validTo: '2026-03-31',
  copaymentRatio: 3,
  copaymentCategory: '本人',
};

/** STUB で「取得できた」とみなす閲覧サービス区分。 */
const STUB_CONSENTED_SERVICES: OnshiInfoService[] = [
  'MEDICATION',
  'CHECKUP',
  'DIAGNOSIS',
  'INFECTION',
  'ALLERGY',
  'LAB',
  'PRESCRIPTION',
];

/**
 * STUB 薬剤情報・特定健診・6情報一覧の代表値 (フロントのみモードでの描画用ダミー)。
 * 6情報(傷病名/感染症/薬剤アレルギー等/その他アレルギー等/検査/処方)を正式名称で表現。
 */
const STUB_PATIENT_INFO: OnshiPatientInfoResult = {
  medications: [
    {
      yjCode: '1149019F1ZZZ',
      name: 'アムロジピンOD錠5mg',
      usage: '1日1回 朝食後 1錠',
      dispensedDate: '2026-04-12',
      facilityName: '見本調剤薬局',
    },
  ],
  checkups: [
    {
      jlac10: '3F015000002327101',
      itemName: 'HbA1c (NGSP)',
      value: '6.2',
      unit: '%',
      examDate: '2025-11-20',
      outOfRange: false,
    },
  ],
  allergies: [
    { jFagy: '620000000', category: 'DRUG', substance: 'ペニシリン系', reaction: '発疹' },
  ],
  diagnoses: [
    {
      standardDiseaseCode: '8833465',
      icd10: 'I10',
      name: '本態性高血圧症',
      category: '主病',
      startDate: '2024-06-01',
    },
  ],
  infections: [
    { jlac10: '5F015000001930101', itemName: 'HBs抗原', result: '陰性', examDate: '2025-03-10' },
  ],
  labs: [
    {
      jlac10: '3F015000002327101',
      itemName: 'LDLコレステロール',
      value: '128',
      unit: 'mg/dL',
      refLow: '70',
      refHigh: '139',
      examDate: '2026-04-12',
    },
  ],
  prescriptions: [
    {
      yjCode: '1149019F1ZZZ',
      name: 'アムロジピンOD錠5mg',
      usage: '1日1回 朝食後 1錠 30日分',
      prescribedDate: '2026-04-12',
      facilityName: '見本内科クリニック',
    },
  ],
  consentedServices: STUB_CONSENTED_SERVICES,
};

/**
 * 「保険証確認」で資格をリアルタイム取得する。
 * AC(1): 院内ゲートウェイ/資格確認端末経由でリアルタイムに資格確認結果を返す。
 * STUB では status:'STUB' のまま、資格確認結果型を `data` に充填して返す。
 */
export async function verifyEligibility(
  _req: InsuranceVerifyRequest,
): Promise<IntegrationResult<InsuranceVerifyResult>> {
  return { status: 'STUB', data: STUB_VERIFY_RESULT };
}

/**
 * オン資経由で薬剤情報・特定健診・6情報一覧を閲覧する。
 * AC(2): オン資経由で薬剤情報/6情報を参照できる。
 * STUB では status:'STUB' のまま、6情報を含む閲覧結果型を `data` に充填して返す。
 */
export async function fetchPatientInfo(
  _req: InsuranceVerifyRequest,
): Promise<IntegrationResult<OnshiPatientInfoResult>> {
  return { status: 'STUB', data: STUB_PATIENT_INFO };
}
