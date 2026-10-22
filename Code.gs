/**
 * 지역사회봉사 보고서 점검 — 기록 서버 (Google Apps Script 웹앱)
 * 저장하는 것: 점검 시각, 전공, 학번, 이름, 오류 수, 점수, 항목별 판정, 파일 지문(SHA-256).
 * 보고서 파일 자체는 받지도 저장하지도 않는다.
 * 교수 화면 비밀번호는 스크립트 속성 ADMIN_PW 에만 둔다(코드에 적지 않는다).
 */
const SHEET_CHECKS = '점검기록';
const SHEET_JUDGE = '교수판정';
const CHECK_HEADERS = ['점검ID', '시각', '전공', '학번', '이름', '학생키', '점검차례', '오류수', '확인필요수', '점수', '보완필요', '인정시간', '쪽수', '파일지문', '규칙판', '흐린쪽', '항목JSON', '참고신호JSON', '발급번호JSON'];
const JUDGE_HEADERS = ['시각', '점검ID', '항목ID', '판정'];

function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return out_({ ok: true, service: '지역사회봉사 보고서 점검 기록 서버' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: '요청 형식 오류' }); }
  try {
    if (req.action === 'log') return out_(log_(req));
    if (req.action === 'admin') return out_(admin_(req));
    if (req.action === 'judge') return out_(judge_(req));
    if (req.action === 'deleteChecks') return out_(deleteChecks_(req));
    return out_({ ok: false, error: '알 수 없는 요청' });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

const MAJORS = ['사회복지학과', '원전제어시스템공학과', '전기공학전공', '전력시스템공학과', '특수교육'];

function clean_(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, '').trim().slice(0, n); }

function log_(req) {
  const st = req.student || {};
  const major = clean_(st.major, 30);
  const sid = clean_(st.sid, 20).toUpperCase();
  const name = clean_(st.name, 20);
  if (MAJORS.indexOf(major) < 0 || !/^[0-9A-Z]{4,15}$/.test(sid) || !/^[가-힣A-Za-z ]{2,20}$/.test(name)) {
    return { ok: false, error: '입장 정보 형식 오류' };
  }
  const r = req.result || {};
  const key = sid + '|' + name;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(SHEET_CHECKS, CHECK_HEADERS);
    const last = sh.getLastRow();
    let prev = null, n = 0;
    const others = [];
    if (last > 1) {
      const vals = sh.getRange(2, 1, last - 1, 17).getValues();
      for (const v of vals) {
        if (v[5] === key) { n++; prev = v; }
        else if (r.hash && v[13] === r.hash) others.push(v[5]);
      }
    }
    const id = Utilities.getUuid();
    const items = Array.isArray(r.items) ? r.items.slice(0, 300) : [];
    sh.appendRow([
      id, new Date(), major, sid, name, key, n + 1,
      Number(r.errors) || 0, Number(r.reviews) || 0, Number(r.score) || 0, r.mustFix ? 'Y' : 'N',
      Number(r.hours) || 0, Number(r.pageCount) || 0, clean_(r.hash, 64), clean_(r.rules, 20),
      (r.blurry || []).join(','),
      JSON.stringify(items).slice(0, 45000),
      JSON.stringify(r.flags || []).slice(0, 8000),
      JSON.stringify(r.issues || []).slice(0, 2000),
    ]);
    let prevErrorIds = [];
    if (prev) {
      try { prevErrorIds = JSON.parse(prev[16]).filter(x => x.status === 'error').map(x => x.id); } catch (e) {}
    }
    return { ok: true, id, checkNo: n + 1, prevErrors: prev ? Number(prev[7]) : null, prevErrorIds };
  } finally {
    lock.releaseLock();
  }
}

function checkPw_(pw) {
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PW');
  if (!real) throw new Error('교수 비밀번호가 아직 설정되지 않았습니다');
  if (String(pw || '') !== real) throw new Error('비밀번호가 맞지 않습니다');
}

function admin_(req) {
  checkPw_(req.pw);
  const sh = sheet_(SHEET_CHECKS, CHECK_HEADERS);
  const jh = sheet_(SHEET_JUDGE, JUDGE_HEADERS);
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, CHECK_HEADERS.length).getValues() : [];
  const checks = rows.map(v => ({
    id: v[0], time: v[1] instanceof Date ? v[1].toISOString() : String(v[1]), major: v[2], sid: v[3], name: v[4], key: v[5], no: v[6],
    errors: v[7], reviews: v[8], score: v[9], mustFix: v[10] === 'Y', hours: v[11], pages: v[12], hash: v[13], rules: v[14],
    blurry: v[15] ? String(v[15]).split(',').map(Number) : [],
    items: safe_(v[16], []), flags: safe_(v[17], []), issues: safe_(v[18], []),
  }));
  const jrows = jh.getLastRow() > 1 ? jh.getRange(2, 1, jh.getLastRow() - 1, 4).getValues() : [];
  const judgments = jrows.map(v => ({ time: v[0] instanceof Date ? v[0].toISOString() : String(v[0]), checkId: v[1], itemId: v[2], verdict: v[3] }));
  return { ok: true, checks, judgments };
}

function judge_(req) {
  checkPw_(req.pw);
  if (['ok', 'error', 'clear'].indexOf(req.verdict) < 0) return { ok: false, error: '판정 값 오류' };
  const jh = sheet_(SHEET_JUDGE, JUDGE_HEADERS);
  jh.appendRow([new Date(), clean_(req.checkId, 60), clean_(req.itemId, 120), req.verdict]);
  return { ok: true };
}

// 시험 기록 정리용: 교수 비밀번호로 지정한 점검ID 행만 지운다
function deleteChecks_(req) {
  checkPw_(req.pw);
  const ids = (req.ids || []).map(String);
  const sh = sheet_(SHEET_CHECKS, CHECK_HEADERS);
  let removed = 0;
  for (let r = sh.getLastRow(); r >= 2; r--) {
    if (ids.indexOf(String(sh.getRange(r, 1).getValue())) >= 0) { sh.deleteRow(r); removed++; }
  }
  const jh = sheet_(SHEET_JUDGE, JUDGE_HEADERS);
  for (let r = jh.getLastRow(); r >= 2; r--) {
    if (ids.indexOf(String(jh.getRange(r, 2).getValue())) >= 0) jh.deleteRow(r);
  }
  return { ok: true, removed };
}

function safe_(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }

// 처음 한 번: 편집기에서 setAdminPassword('원하는 비밀번호') 를 실행하거나,
// 프로젝트 설정 > 스크립트 속성에서 ADMIN_PW 를 직접 넣는다.
function setAdminPassword(pw) {
  if (!pw || String(pw).length < 6) throw new Error('6자 이상으로 정해 주세요');
  PropertiesService.getScriptProperties().setProperty('ADMIN_PW', String(pw));
}
