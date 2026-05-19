/**
 * Demo clinic seed — deterministic. One command boots a clickable hospital EMR:
 *   pnpm seed && pnpm dev  →  http://localhost:3000
 *
 * Includes: clinic/depts/wards, all-role staff, RBAC matrix, curated drug master
 * (provenance-enforced) + receipt-import pipeline demo, 30+ patients (allergy/
 * infection/同姓同名/VIP/仮ID/family/pregnant), today's reception list, a
 * multi-version chart (版数管理), and prescriptions that trip the safety engine.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── load .env before importing @medixus/db (Prisma reads env at construction) ──
const seedDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(seedDir, '..');
if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
    }
  } catch {
    /* noop */
  }
}

const { prisma } = await import('@medixus/db');
const { hashPassword } = await import('@medixus/auth');
const { DEFAULT_MATRIX } = await import('@medixus/authz');
const { loadCuratedDrugMaster, importReceiptDrugMaster } = await import('@medixus/master-import');
const { runPrescriptionChecks } = await import('@medixus/order-checks');
const { writeAudit } = await import('@medixus/audit');

const TABLES = [
  'PatientDiagnosis', 'Referral', 'ClinicalDocument', 'DischargeSummary',
  'PrescriptionOverride', 'RuleCheckResult', 'PrescriptionItem', 'Prescription',
  'OrderExecution', 'OrderReception', 'Order', 'NoteAttachment', 'Countersign',
  'ClinicalNote', 'ClinicalRecord', 'ClinicalSession', 'EncounterStatusTransition',
  'Encounter', 'Appointment', 'AppointmentSlot', 'DrugSafetyReviewLog',
  'DrugInteraction', 'DrugContraindication', 'DrugDosage', 'DrugIndication',
  'DrugProductIngredient', 'DrugCodeCrosswalk', 'DrugProduct', 'DrugIngredient',
  'ExamMaster', 'DiseaseMaster', 'MasterVersion', 'ImportRun', 'PatientSelectionLog',
  'PatientAccessControl', 'PatientProfile', 'Allergy', 'Infection', 'MedicalHistory',
  'FamilyMember', 'Insurance', 'Patient', 'ChartLock', 'AuditEvent', 'AuthSession',
  'LoginAttempt', 'MfaFactor', 'StaffCredential', 'UserPermission', 'UserFavoriteTool',
  'RolePermission', 'SavedSearchCondition', 'StaffUser', 'Bed', 'Room', 'Ward',
  'Department', 'Clinic',
];

async function reset() {
  // TRUNCATE is statement-level → not blocked by the append-only ROW triggers.
  // Prisma created PascalCase identifiers → must double-quote each.
  const list = TABLES.map((t) => `"${t}"`).join(',');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}

const KANA = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ', 'キ', 'ク', 'ケ', 'コ'];
const dob = (y: number, m = 4, d = 10) => new Date(y, m - 1, d);
const minsAgo = (n: number) => new Date(Date.now() - n * 60_000);

async function main() {
  console.log('[seed] reset…');
  await reset();

  const clinic = await prisma.clinic.create({
    data: { name: 'Medixus Clinic 1号院', kind: 'CLINIC' },
  });
  const deptIM = await prisma.department.create({
    data: { clinicId: clinic.id, code: 'IM', name: '内科' },
  });
  await prisma.department.create({ data: { clinicId: clinic.id, code: 'SUR', name: '外科' } });
  const ward = await prisma.ward.create({
    data: { clinicId: clinic.id, code: 'W3', name: '3階病棟' },
  });
  const room = await prisma.room.create({
    data: { wardId: ward.id, code: '301', genderPolicy: 'MIXED' },
  });
  await prisma.bed.createMany({
    data: [
      { roomId: room.id, code: '301-1' },
      { roomId: room.id, code: '301-2' },
    ],
  });

  // ── staff (all roles) ──
  const pw = hashPassword('Medixus#2026');
  const mkUser = async (loginId: string, name: string, kana: string, jobType: any) => {
    const u = await prisma.staffUser.create({
      data: { clinicId: clinic.id, staffNo: `S-${loginId}`, loginId, name, nameKana: kana, jobType },
    });
    await prisma.staffCredential.create({ data: { userId: u.id, passwordHash: pw } });
    return u;
  };
  const doctor = await mkUser('doctor', '研修 太郎', 'ケンシュウ タロウ', 'DOCTOR');
  await mkUser('nurse', '看護 花子', 'カンゴ ハナコ', 'NURSE');
  const pharma = await mkUser('pharma', '薬剤 一郎', 'ヤクザイ イチロウ', 'PHARMACIST');
  await mkUser('clerk', '受付 桜', 'ウケツケ サクラ', 'CLERK');
  await mkUser('admin', '管理 健', 'カンリ ケン', 'ADMIN');

  // ── RBAC matrix ──
  for (const [jobType, res] of Object.entries(DEFAULT_MATRIX)) {
    for (const [resource, actions] of Object.entries(res as Record<string, string[]>)) {
      for (const action of actions) {
        await prisma.rolePermission.create({
          data: { jobType: jobType as any, resource, action, allow: true },
        });
      }
    }
  }

  // ── drug master: receipt-import pipeline demo (no file → fallback) + curated ──
  const imp = await importReceiptDrugMaster({ sourceRelease: '2026.04' });
  await writeAudit({
    action: 'MASTER_IMPORT',
    resource: 'MHLW_RECEIPT',
    result: imp.skipped ? 'no-file:fallback-to-curated-seed' : `imported:${imp.imported}`,
  });
  const drug = await loadCuratedDrugMaster(pharma.id);
  console.log(
    `[seed] drug master: ${drug.counts.products}品目 / ${drug.counts.ingredients}成分 / 安全データ${drug.counts.safety}件 (CURATED_SEED, provenance付き・AI非生成)`,
  );

  // ── patients ──
  type P = Awaited<ReturnType<typeof prisma.patient.create>>;
  const patients: P[] = [];
  for (let i = 1; i <= 30; i++) {
    const k = KANA[i % KANA.length]!;
    patients.push(
      await prisma.patient.create({
        data: {
          clinicId: clinic.id,
          patientNo: (1000 + i).toString().padStart(8, '0'),
          kanaLastName: `カンジャ${k}`,
          kanaFirstName: 'タロウ',
          kanjiLastName: `患者${k}`,
          kanjiFirstName: '太郎',
          dateOfBirth: dob(1950 + i),
          gender: i % 2 === 0 ? 'FEMALE' : 'MALE',
          bloodTypeABO: (['A', 'B', 'O', 'AB'] as const)[i % 4],
        },
      }),
    );
  }
  // special patients
  await prisma.patient.create({
    data: { clinicId: clinic.id, patientNo: '00009001', kanaLastName: 'ヤマダ', kanaFirstName: 'タロウ', kanjiLastName: '山田', kanjiFirstName: '太郎', dateOfBirth: dob(1970), gender: 'MALE' },
  });
  await prisma.patient.create({
    data: { clinicId: clinic.id, patientNo: '00009002', kanaLastName: 'ヤマダ', kanaFirstName: 'タロウ', kanjiLastName: '山田', kanjiFirstName: '太郎', dateOfBirth: dob(1985), gender: 'MALE' },
  });
  await prisma.patient.create({
    data: { clinicId: clinic.id, patientNo: '00009100', kanaLastName: 'ブイ', kanaFirstName: 'アイピー', kanjiLastName: '要', kanjiFirstName: '人', dateOfBirth: dob(1965), gender: 'FEMALE', isVip: true, vipPasswordHash: hashPassword('Vip#202600') },
  });
  await prisma.patient.create({
    data: { clinicId: clinic.id, patientNo: '00009999', kanaLastName: 'カリ', kanaFirstName: 'トウロク', kanjiLastName: '仮', kanjiFirstName: '登録', dateOfBirth: dob(1990), gender: 'UNKNOWN', isTemporaryId: true },
  });

  // family link (patients[3] ↔ patients[4])
  await prisma.familyMember.create({
    data: { patientId: patients[3]!.id, relation: '配偶者', name: '患者エ 太郎', relatedPatientId: patients[4]!.id },
  });
  // drug allergy → aspirin (matches DrugIngredient.ingredientCode for the rule engine)
  const allergyPatient = patients[0]!;
  await prisma.allergy.create({
    data: { patientId: allergyPatient.id, type: 'DRUG', substance: 'アスピリン', ingredientCode: 'ING_ASPIRIN', reaction: 'アスピリン喘息', severity: 'severe' },
  });
  // pregnant patient (warfarin contraindication demo)
  const pregnantPatient = patients[1]!;
  await prisma.patientProfile.create({
    data: { patientId: pregnantPatient.id, heightCm: 160, weightKg: 58, isPregnant: true },
  });
  // infection flag
  await prisma.infection.create({
    data: { patientId: patients[2]!.id, pathogen: 'HBV', status: '陽性', testedAt: dob(2025, 1, 1) },
  });
  // restricted-access patient (ACL demo — 別紙3 #50-55)
  await prisma.patientAccessControl.create({
    data: { patientId: patients[7]!.id, level: 'VIEW_ONLY', scope: 'ALL' },
  });

  // ── today's reception list ──
  const statuses = [
    'ARRIVED', 'QUESTIONNAIRE_DONE', 'READY', 'IN_CONSULTATION', 'IN_CONSULTATION',
    'READY', 'ARRIVED', 'SUSPENDED', 'READY', 'CONSULTATION_DONE',
  ] as const;
  let recNo = 1;
  for (let i = 0; i < 10; i++) {
    await prisma.encounter.create({
      data: {
        patientId: patients[i]!.id,
        encounterType: 'OUTPATIENT',
        visitType: i % 3 === 0 ? 'FIRST' : 'RETURN',
        contactType: 'FACE',
        departmentId: deptIM.id,
        receptionNo: i % 3 === 0 ? null : recNo++,
        receptionStatus: statuses[i]!,
        arrivedAt: minsAgo(8 + i * 9),
      },
    });
  }

  // 入院患者（病棟タブ）
  for (const idx of [10, 11]) {
    await prisma.encounter.create({
      data: {
        patientId: patients[idx]!.id,
        encounterType: 'INPATIENT',
        contactType: 'FACE',
        departmentId: deptIM.id,
        wardId: ward.id,
        receptionStatus: 'IN_CONSULTATION',
        arrivedAt: minsAgo(60 * 24),
      },
    });
  }
  // 救急患者（救急タブ）
  const triage = ['L2_EMERGENT', 'L3_URGENT'] as const;
  for (let j = 0; j < 2; j++) {
    await prisma.encounter.create({
      data: {
        patientId: patients[12 + j]!.id,
        encounterType: 'EMERGENCY',
        contactType: 'FACE',
        departmentId: deptIM.id,
        receptionStatus: 'ARRIVED',
        triageLevel: triage[j],
        arrivalMethod: j === 0 ? '救急車' : '独歩',
        arrivedAt: minsAgo(15 + j * 10),
      },
    });
  }
  // 予約（予約一覧タブ）
  for (let j = 0; j < 4; j++) {
    await prisma.appointment.create({
      data: {
        patientId: patients[14 + j]!.id,
        departmentId: deptIM.id,
        scheduledAt: new Date(Date.now() + (j + 1) * 3600_000),
        kind: 'CONSULT',
        status: 'BOOKED',
      },
    });
  }

  // ── multi-version chart (版数管理 / 改竄防止 demo) on patients[5] ──
  const encChart = await prisma.encounter.findFirstOrThrow({
    where: { patientId: patients[5]!.id },
  });
  const ses = await prisma.clinicalSession.create({
    data: {
      encounterId: encChart.id,
      recordedDate: new Date(),
      departmentId: deptIM.id,
      createdByUserId: doctor.id,
    },
  });
  const v1 = await prisma.clinicalNote.create({
    data: {
      sessionId: ses.id,
      encounterId: encChart.id,
      patientId: patients[5]!.id,
      noteType: 'PROGRESS',
      recordedDate: new Date(),
      authorUserId: doctor.id,
      authorJobType: 'DOCTOR',
      departmentId: deptIM.id,
      status: 'LOCKED',
      lockedAt: new Date(),
      blocks: [
        { kind: 'S', spans: [{ text: '咳と微熱が3日続く。' }] },
        { kind: 'O', spans: [{ text: '体温37.4℃、咽頭発赤あり。' }] },
        { kind: 'A', spans: [{ text: '急性上気道炎の疑い。' }] },
        { kind: 'P', spans: [{ text: '対症療法、3日後再診。' }] },
      ],
    },
  });
  const v2 = await prisma.clinicalNote.create({
    data: {
      sessionId: ses.id,
      encounterId: encChart.id,
      patientId: patients[5]!.id,
      noteType: 'PROGRESS',
      recordedDate: new Date(),
      authorUserId: doctor.id,
      authorJobType: 'DOCTOR',
      departmentId: deptIM.id,
      version: 2,
      rootNoteId: v1.id,
      previousVersionId: v1.id,
      isLatest: true,
      status: 'SAVED',
      amendReason: '所見追記（A/P修正）',
      blocks: [
        { kind: 'S', spans: [{ text: '咳と微熱が3日続く。咽頭痛増悪。' }] },
        { kind: 'O', spans: [{ text: '体温37.8℃、咽頭発赤・白苔あり。' }] },
        { kind: 'A', spans: [{ text: '急性扁桃炎の疑い。' }] },
        { kind: 'P', spans: [{ text: '抗菌薬を考慮、培養提出。3日後再診。' }] },
      ],
    },
  });
  await prisma.clinicalNote.update({
    where: { id: v1.id },
    data: { isLatest: false, status: 'SUPERSEDED', supersededById: v2.id },
  });
  await prisma.clinicalRecord.create({
    data: {
      sessionId: ses.id,
      status: 'approved',
      s: '咳と微熱が3日続く。咽頭痛増悪。',
      o: '体温37.8℃、咽頭発赤・白苔あり。',
      a: '急性扁桃炎の疑い。',
      p: '抗菌薬を考慮、培養提出。3日後再診。',
      approvedByUserId: doctor.id,
      approvedAt: new Date(),
    },
  });

  // ── prescriptions that trip the deterministic safety engine ──
  const D = drug.productIdByBrand;
  async function makeRx(patientId: string, items: { brand: string; dose: number; tpd: number; days: number }[], label: string) {
    const enc = await prisma.encounter.create({
      data: {
        patientId,
        encounterType: 'OUTPATIENT',
        visitType: 'RETURN',
        contactType: 'FACE',
        departmentId: deptIM.id,
        receptionStatus: 'IN_CONSULTATION',
        arrivedAt: minsAgo(20),
      },
    });
    const order = await prisma.order.create({
      data: {
        orderNo: `SEED-${label}-${Date.now()}`,
        patientId,
        encounterId: enc.id,
        orderType: 'RX',
        departmentId: deptIM.id,
        ordererUserId: doctor.id,
        status: 'DRAFT',
        detail: { items } as object,
      },
    });
    const rx = await prisma.prescription.create({
      data: {
        orderId: order.id,
        patientId,
        encounterId: enc.id,
        status: 'proposed',
        issuedByUserId: doctor.id,
        items: {
          create: items.map((it) => ({
            drugProductId: D[it.brand]!,
            dosePerTime: it.dose,
            doseUnit: '錠',
            timesPerDay: it.tpd,
            days: it.days,
            route: '内服',
          })),
        },
      },
    });
    const r = await runPrescriptionChecks(rx.id);
    console.log(`[seed] Rx(${label}) → ${r.overall} : ${r.findings.map((f) => f.checkType).join(',') || 'なし'}`);
  }

  // pregnant + warfarin (絶対禁忌) + loxoprofen (相互作用)
  await makeRx(pregnantPatient.id, [
    { brand: 'ワーファリン錠1mg', dose: 1, tpd: 1, days: 14 },
    { brand: 'ロキソニン錠60mg', dose: 1, tpd: 3, days: 5 },
  ], 'pregnancy+interaction');
  // aspirin allergy + aspirin product (アレルギー BLOCKED)
  await makeRx(allergyPatient.id, [
    { brand: 'バイアスピリン錠100mg', dose: 1, tpd: 1, days: 30 },
  ], 'allergy');
  // duplicate same ingredient (アムロジン + ノルバスク)
  await makeRx(patients[8]!.id, [
    { brand: 'アムロジン錠5mg', dose: 1, tpd: 1, days: 28 },
    { brand: 'ノルバスク錠5mg', dose: 1, tpd: 1, days: 28 },
  ], 'duplicate');

  // ── 標準病名マスタ（MEDIS相当・ICD10）＋ 病名/紹介状/文書 デモ ──
  const DISEASES: [string, string, string][] = [
    ['8843339', '本態性高血圧症', 'I10'],
    ['2500013', '2型糖尿病', 'E119'],
    ['4660016', '急性上気道炎', 'J069'],
    ['4109014', '急性扁桃炎', 'J039'],
    ['5723001', '脂質異常症', 'E785'],
    ['4279005', '気管支喘息', 'J459'],
    ['5859001', '慢性腎臓病', 'N189'],
    ['5309006', '逆流性食道炎', 'K219'],
    ['7243003', '腰痛症', 'M545'],
    ['4660020', 'インフルエンザ', 'J111'],
    ['3829003', '鉄欠乏性貧血', 'D509'],
    ['2449001', '甲状腺機能低下症', 'E039'],
    ['4139001', '狭心症', 'I209'],
    ['4275003', '心房細動', 'I489'],
    ['5990003', '尿路感染症', 'N390'],
    ['7152008', '変形性膝関節症', 'M179'],
    ['3004005', '不安障害', 'F419'],
    ['3119001', 'うつ病', 'F329'],
    ['4870006', '肺炎', 'J189'],
    ['5645007', '便秘症', 'K590'],
  ];
  for (const [code, name, icd10] of DISEASES) {
    await prisma.diseaseMaster.create({
      data: { code, name, icd10: [icd10], source: 'MEDIS', sourceMasterVersion: 'MEDIS:2026.04' },
    });
  }
  await prisma.patientDiagnosis.createMany({
    data: [
      { patientId: patients[5]!.id, masterCode: '4109014', displayName: '急性扁桃炎', icd10: 'J039', isMain: true, acuteChronic: 'ACUTE', recordedByUserId: doctor.id },
      { patientId: patients[8]!.id, masterCode: '8843339', displayName: '本態性高血圧症', icd10: 'I10', isMain: true, acuteChronic: 'CHRONIC', recordedByUserId: doctor.id },
      { patientId: patients[8]!.id, masterCode: '5723001', displayName: '脂質異常症', icd10: 'E785', acuteChronic: 'CHRONIC', recordedByUserId: doctor.id },
      { patientId: pregnantPatient.id, masterCode: '3829003', displayName: '鉄欠乏性貧血', icd10: 'D509', isSuspected: true, recordedByUserId: doctor.id },
    ],
  });
  await prisma.referral.create({
    data: {
      patientId: patients[8]!.id,
      direction: 'OUTBOUND',
      partnerFacility: '中央総合病院 循環器内科',
      partnerDoctor: '循環器 部長',
      purpose: '精査加療依頼（高血圧・心房細動疑い）',
      chiefComplaint: '動悸',
      diseaseState: '本態性高血圧で加療中。心電図にて不整脈を認め精査依頼。',
      status: 'SENT',
      createdByUserId: doctor.id,
    },
  });
  await prisma.clinicalDocument.create({
    data: {
      patientId: patients[5]!.id,
      docType: '説明書',
      title: '抗菌薬投与に関する説明書',
      format: 'TEXT',
      body: '急性扁桃炎に対する抗菌薬投与の目的・副作用・注意点について説明。',
      createdByUserId: doctor.id,
    },
  });

  const counts = {
    patients: await prisma.patient.count(),
    encounters: await prisma.encounter.count(),
    drugs: await prisma.drugProduct.count(),
    diagnoses: await prisma.patientDiagnosis.count(),
    referrals: await prisma.referral.count(),
    checks: await prisma.ruleCheckResult.count(),
    audit: await prisma.auditEvent.count(),
  };
  console.log('[seed] counts', counts);
}

await main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('[seed] done — login: doctor / Medixus#2026');
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
