import { API_URL } from './config.js';
import { summarize, CATS } from './rules.js';

const $ = id => document.getElementById(id);
let PW = '';
let DATA = { checks: [], judgments: [] };
let J = new Map(); // checkId -> {itemId: verdict}
let STUDENTS = [];
let sortKey = 'lastScore', sortDir = -1;

async function api(body) {
  if (!API_URL) throw new Error('기록 서버 주소가 설정되지 않았습니다');
  const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || '서버 오류');
  return j;
}

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('login-err').textContent = '';
  $('login-btn').disabled = true;
  try {
    PW = $('pw').value;
    await load();
    $('login').hidden = true; $('dash').hidden = false;
  } catch (err) {
    $('login-err').textContent = err.message;
  } finally { $('login-btn').disabled = false; }
});
$('reload').addEventListener('click', () => load().catch(err => alert(err.message)));

async function load() {
  const d = await api({ action: 'admin', pw: PW });
  DATA = d;
  buildJudgments();
  compute();
  renderAll();
  $('loaded-at').textContent = `불러온 시각 ${new Date().toLocaleString('ko-KR')} · 점검 ${DATA.checks.length}건`;
}

function buildJudgments() {
  J = new Map();
  const sorted = [...DATA.judgments].sort((a, b) => a.time.localeCompare(b.time));
  for (const j of sorted) {
    if (!J.has(j.checkId)) J.set(j.checkId, {});
    const m = J.get(j.checkId);
    if (j.verdict === 'clear') delete m[j.itemId]; else m[j.itemId] = j.verdict;
  }
}

function sumOf(c) { return summarize(c.items || [], J.get(c.id) || {}); }
const eff = (c, it) => (J.get(c.id) || {})[it.id] || it.status;

const KIND = id => {
  if (id === 'h1365') return '1365 확인서 없음';
  if (id === 'h20') return '20시간 미달';
  if (id === 'h8') return '하루 8시간 넘김';
  if (id.startsWith('seal')) return '기관 날인 누락';
  if (id.startsWith('blank')) return '빈칸';
  if (id === 'prof') return '담당교수 이름 오기·누락';
  if (id === 'form-guide') return '양식 안내 문구 남김';
  if (id === 'form-order') return '일지 차수 번호 겹침';
  if (id.startsWith('doc-')) return { cover: '표지 빠짐', plan: '계획서 빠짐', apply: '신청서 빠짐', log: '활동 일지 빠짐', result: '결과 보고서 빠짐' }[id.slice(4)] || '문서 빠짐';
  return id;
};

function compute() {
  const by = new Map();
  for (const c of [...DATA.checks].sort((a, b) => a.time.localeCompare(b.time))) {
    c.sum = sumOf(c);
    if (!by.has(c.key)) by.set(c.key, []);
    by.get(c.key).push(c);
  }
  const hashOwners = new Map();
  for (const c of DATA.checks) if (c.hash) { if (!hashOwners.has(c.hash)) hashOwners.set(c.hash, new Set()); hashOwners.get(c.hash).add(c.key); }
  STUDENTS = [...by.entries()].map(([key, cs]) => {
    const f = cs[0], l = cs[cs.length - 1];
    const same = new Set();
    for (const c of cs) if (c.hash && hashOwners.get(c.hash).size > 1) for (const k of hashOwners.get(c.hash)) if (k !== key) same.add(k);
    return {
      key, major: l.major, sid: l.sid, name: l.name, checks: cs, n: cs.length,
      firstErr: f.sum.errors, lastErr: l.sum.errors,
      drop: f.sum.errors > 0 ? (f.sum.errors - l.sum.errors) / f.sum.errors : null,
      firstScore: f.sum.score, lastScore: l.sum.score,
      firstMust: f.sum.mustFix, lastMust: l.sum.mustFix,
      reviews: l.sum.reviews, hours: l.hours, lastTime: l.time,
      same: [...same], flags: (l.flags || []).length,
    };
  });
}

const pct = x => x == null || isNaN(x) ? '–' : Math.round(x * 100) + '%';
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const r1 = x => x == null ? '–' : (Math.round(x * 10) / 10).toString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const when = t => { const d = new Date(t); return isNaN(d) ? t : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };

/* 삭제: 한 번 누르면 확인 상태, 두 번째에 실제 삭제 */
const SEL = new Set();
function twoStep(btn, armedText, run) {
  const orig = btn.textContent;
  let armed = false, timer = null;
  btn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!armed) {
      armed = true; btn.textContent = armedText; btn.classList.add('danger-armed');
      timer = setTimeout(() => { armed = false; btn.textContent = orig; btn.classList.remove('danger-armed'); }, 5000);
      return;
    }
    clearTimeout(timer); btn.disabled = true; btn.textContent = '지우는 중…';
    try { await run(); } catch (err) { btn.disabled = false; armed = false; btn.textContent = orig; btn.classList.remove('danger-armed'); alertBox(err.message); }
  });
}
function alertBox(msg) { const el = $('loaded-at'); if (el) el.textContent = msg; }
async function removeChecks(ids) {
  if (!ids.length) return;
  const r = await api({ action: 'deleteChecks', pw: PW, ids });
  for (const s of STUDENTS) if (s.checks.some(c => ids.includes(c.id))) SEL.delete(s.key);
  await load();
  alertBox(`점검 ${r.removed}건을 지웠습니다 · ` + $('loaded-at').textContent);
  return r;
}

function renderAll() {
  renderKpis(); renderStudents(); renderReview(); renderTypes(); renderMajors(); renderSignals();
}

function agreement() {
  let n = 0, same = 0;
  for (const c of DATA.checks) {
    const m = J.get(c.id); if (!m) continue;
    for (const it of c.items || []) {
      if (!(it.id in m) || it.status === 'review') continue;
      n++; if (m[it.id] === it.status) same++;
    }
  }
  return { n, rate: n ? same / n : null };
}

function renderKpis() {
  const S = STUDENTS;
  const multi = S.filter(s => s.n >= 2 && s.drop != null);
  const ag = agreement();
  const pendingReviews = S.reduce((a, s) => a + s.reviews, 0);
  const k = [
    ['점검한 학생', `${S.length}<small>명</small>`],
    ['전체 점검', `${DATA.checks.length}<small>건 · 1인 평균 ${r1(avg(S.map(s => s.n)))}회</small>`],
    ['필수 요건 충족률', `${pct(avg(S.map(s => s.firstMust ? 0 : 1)))} <small>첫 점검 → </small>${pct(avg(S.map(s => s.lastMust ? 0 : 1)))}<small> 최종</small>`],
    ['오류 감소율', `${pct(avg(multi.map(s => s.drop)))}<small> (2회 이상 ${multi.length}명)</small>`],
    ['학생 평균 오류', `${r1(avg(S.map(s => s.firstErr)))} <small>→</small> ${r1(avg(S.map(s => s.lastErr)))}<small>곳</small>`],
    ['환산 점수 평균', `${r1(avg(S.map(s => s.firstScore)))} <small>→</small> ${r1(avg(S.map(s => s.lastScore)))}`],
    ['확인 필요 남음', `${pendingReviews}<small>칸</small>`],
    ['자동 판정 일치율', `${pct(ag.rate)}<small> (교수 판정 ${ag.n}칸)</small>`],
  ];
  $('kpis').innerHTML = k.map(([a, b]) => `<div class="kpi"><dt>${a}</dt><dd>${b}</dd></div>`).join('');
  $('review-count').textContent = pendingReviews ? `(${pendingReviews})` : '';
}

const COLS = [
  ['major', '전공'], ['sid', '학번'], ['name', '이름'], ['n', '점검', 1], ['firstErr', '첫 오류', 1], ['lastErr', '최종 오류', 1],
  ['drop', '감소율', 1], ['firstScore', '첫 점수', 1], ['lastScore', '최종 점수', 1], ['lastMust', '최종 상태'], ['reviews', '확인 필요', 1], ['hours', '인정 시간', 1], ['lastTime', '최근 점검'],
];

function renderStudents() {
  const S = [...STUDENTS].sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (x == null) return 1; if (y == null) return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * sortDir;
  });
  const head = COLS.map(([k, t, num]) => `<th class="${num ? 'num' : ''}" aria-sort="${sortKey === k ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-sort="${k}">${t}${sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`).join('');
  const rows = S.map(s => `<tr class="clickable" data-key="${esc(s.key)}" tabindex="0">
    <td class="pick"><input type="checkbox" data-pick="${esc(s.key)}" aria-label="${esc(s.name)} 선택"${SEL.has(s.key) ? ' checked' : ''}></td><td>${esc(s.major)}</td><td>${esc(s.sid)}</td><td>${esc(s.name)}${s.same.length ? ' <span class="tag red" title="다른 학생과 같은 파일">같은 파일</span>' : ''}${s.flags ? ' <span class="tag amber">신호 ' + s.flags + '</span>' : ''}</td>
    <td class="num">${s.n}</td><td class="num">${s.firstErr}</td><td class="num">${s.lastErr}</td><td class="num">${pct(s.drop)}</td>
    <td class="num">${r1(s.firstScore)}</td><td class="num"><b>${r1(s.lastScore)}</b></td>
    <td>${s.lastMust ? '<span class="tag red">보완 필요</span>' : '<span class="tag green">요건 충족</span>'}</td>
    <td class="num">${s.reviews || ''}</td><td class="num">${r1(s.hours)}</td><td>${when(s.lastTime)}</td></tr>`).join('');
  $('panel-students').innerHTML = S.length
    ? `<p class="note">줄을 누르면 점검 이력과 항목별 판정을 볼 수 있습니다. 점수는 확인 필요 칸을 감점하지 않은 값이며, 교수님 판정을 넣으면 바로 다시 계산됩니다.</p><div class="delbar"><span id="sel-count"></span><button class="ghost danger" id="del-selected" type="button">선택한 학생 기록 삭제</button></div><div class="tablewrap"><table><thead><tr><th class="pick"><input type="checkbox" id="pick-all" aria-label="모두 선택"></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
    : '<p>아직 점검한 학생이 없습니다. 학생 화면 주소를 안내하면 이곳에 기록이 쌓입니다.</p>';
  $('panel-students').querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.sort; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = -1; }
    renderStudents();
  }));
  const P = $('panel-students');
  const syncSel = () => {
    const n = SEL.size, m = STUDENTS.filter(s => SEL.has(s.key)).reduce((a, s) => a + s.n, 0);
    const cnt = $('sel-count'), del = $('del-selected'), all = $('pick-all');
    if (!cnt) return;
    cnt.textContent = n ? `${n}명 선택 · 점검 ${m}건` : '지울 학생을 고르세요. 시험 기록 정리용입니다.';
    del.disabled = !n;
    all.checked = n > 0 && n === STUDENTS.length; all.indeterminate = n > 0 && n < STUDENTS.length;
  };
  P.querySelectorAll('[data-pick]').forEach(cb => {
    cb.addEventListener('click', e => e.stopPropagation());
    cb.addEventListener('keydown', e => e.stopPropagation());
    cb.addEventListener('change', () => { cb.checked ? SEL.add(cb.dataset.pick) : SEL.delete(cb.dataset.pick); syncSel(); });
  });
  const all = $('pick-all');
  if (all) all.addEventListener('change', () => {
    SEL.clear(); if (all.checked) STUDENTS.forEach(s => SEL.add(s.key));
    P.querySelectorAll('[data-pick]').forEach(cb => { cb.checked = all.checked; }); syncSel();
  });
  const del = $('del-selected');
  if (del) twoStep(del, '한 번 더 누르면 삭제됩니다', () => removeChecks(STUDENTS.filter(s => SEL.has(s.key)).flatMap(s => s.checks.map(c => c.id))));
  syncSel();
  P.querySelectorAll('tr[data-key]').forEach(tr => {
    tr.addEventListener('click', () => openDetail(tr.dataset.key));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') openDetail(tr.dataset.key); });
  });
}

function judgeButtons(c, it) {
  const v = (J.get(c.id) || {})[it.id];
  return `<span class="judge" data-check="${esc(c.id)}" data-item="${esc(it.id)}">
    <button type="button" class="ghost ${v === 'ok' ? 'on-ok' : ''}" data-v="ok">통과</button>
    <button type="button" class="ghost ${v === 'error' ? 'on-error' : ''}" data-v="error">오류</button>
    ${v ? '<button type="button" class="ghost" data-v="clear">취소</button>' : ''}</span>`;
}

function bindJudge(root, after) {
  root.querySelectorAll('.judge button').forEach(b => b.addEventListener('click', async ev => {
    ev.stopPropagation();
    const box = b.closest('.judge');
    const body = { action: 'judge', pw: PW, checkId: box.dataset.check, itemId: box.dataset.item, verdict: b.dataset.v };
    box.querySelectorAll('button').forEach(x => x.disabled = true);
    try {
      await api(body);
      DATA.judgments.push({ time: new Date().toISOString(), checkId: body.checkId, itemId: body.itemId, verdict: body.verdict });
      buildJudgments(); compute(); renderKpis(); renderStudents(); renderTypes(); renderMajors();
      after();
    } catch (err) { alert('판정을 저장하지 못했습니다: ' + err.message); box.querySelectorAll('button').forEach(x => x.disabled = false); }
  }));
}

function renderReview() {
  const rows = [];
  for (const s of STUDENTS) {
    const c = s.checks[s.checks.length - 1];
    for (const it of c.items || []) if (it.status === 'review') rows.push({ s, c, it });
  }
  const pending = rows.filter(x => !(J.get(x.c.id) || {})[x.it.id]);
  const done = rows.length - pending.length;
  $('panel-review').innerHTML = rows.length ? `<p class="note">학생마다 가장 최근 점검에서 자동 판정이 어려웠던 칸입니다. 제출된 보고서 원본을 보고 통과·오류를 골라 주세요. 남은 ${pending.length}칸 · 판정한 ${done}칸</p>
    <div class="tablewrap"><table><thead><tr><th>학생</th><th>쪽</th><th>항목</th><th>사유</th><th>판정</th></tr></thead><tbody>
    ${rows.map(({ s, c, it }) => `<tr><td>${esc(s.name)} ${esc(s.sid)}</td><td class="num">${it.page || ''}</td><td>${esc(it.title)}</td><td style="white-space:normal;min-width:16rem">${esc(it.detail)}</td><td>${judgeButtons(c, it)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p>확인할 칸이 없습니다.</p>';
  bindJudge($('panel-review'), renderReview);
}

function renderTypes() {
  const kinds = new Map();
  const S = STUDENTS;
  for (const s of S) {
    const f = s.checks[0], l = s.checks[s.checks.length - 1];
    const fk = new Set((f.items || []).filter(it => eff(f, it) === 'error').map(it => KIND(it.id)));
    const lk = new Set((l.items || []).filter(it => eff(l, it) === 'error').map(it => KIND(it.id)));
    for (const k of new Set([...fk, ...lk])) {
      if (!kinds.has(k)) kinds.set(k, { first: 0, last: 0 });
      if (fk.has(k)) kinds.get(k).first++;
      if (lk.has(k)) kinds.get(k).last++;
    }
  }
  const list = [...kinds.entries()].sort((a, b) => b[1].first - a[1].first);
  const n = S.length || 1;
  $('panel-types').innerHTML = list.length ? `<p class="note">그 오류가 있었던 학생 비율. 첫 점검과 가장 최근 점검을 비교합니다.</p>
    <div class="legend"><span><i style="background:var(--rule-strong)"></i>첫 점검</span><span><i style="background:var(--pen)"></i>최종 점검</span></div>
    ${list.map(([k, v]) => `<div class="barrow"><span>${esc(k)}</span>
      <div class="b first" title="첫 점검 ${v.first}명"><i style="width:${v.first / n * 100}%"></i></div>
      <div class="b last" title="최종 점검 ${v.last}명"><i style="width:${v.last / n * 100}%"></i></div></div>
      <div class="note" style="margin:-2px 0 6px">${v.first}명(${pct(v.first / n)}) → ${v.last}명(${pct(v.last / n)})</div>`).join('')}` : '<p>아직 기록이 없습니다.</p>';
}

function renderMajors() {
  const g = new Map();
  for (const s of STUDENTS) { if (!g.has(s.major)) g.set(s.major, []); g.get(s.major).push(s); }
  const rows = [...g.entries()].map(([m, S]) => `<tr><td>${esc(m)}</td><td class="num">${S.length}</td><td class="num">${r1(avg(S.map(s => s.n)))}</td>
    <td class="num">${r1(avg(S.map(s => s.firstErr)))} → ${r1(avg(S.map(s => s.lastErr)))}</td>
    <td class="num">${pct(avg(S.map(s => s.firstMust ? 0 : 1)))} → ${pct(avg(S.map(s => s.lastMust ? 0 : 1)))}</td>
    <td class="num">${r1(avg(S.map(s => s.lastScore)))}</td></tr>`).join('');
  $('panel-majors').innerHTML = rows ? `<div class="tablewrap"><table><thead><tr><th>전공</th><th class="num">학생</th><th class="num">평균 점검</th><th class="num">평균 오류(첫→최종)</th><th class="num">필수 충족(첫→최종)</th><th class="num">최종 점수 평균</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p>아직 기록이 없습니다.</p>';
}

function renderSignals() {
  const parts = [];
  // 같은 파일
  const owners = new Map();
  for (const c of DATA.checks) if (c.hash) { if (!owners.has(c.hash)) owners.set(c.hash, new Map()); owners.get(c.hash).set(c.key, c); }
  const dup = [...owners.values()].filter(m => m.size > 1);
  parts.push(`<h3>같은 파일로 점검한 학생</h3>` + (dup.length ? `<div class="tablewrap"><table><thead><tr><th>학생</th><th>점검 시각</th></tr></thead><tbody>${dup.map(m => [...m.values()].map(c => `<tr><td>${esc(c.name)} ${esc(c.sid)} (${esc(c.major)})</td><td>${when(c.time)}</td></tr>`).join('') + '<tr><td colspan="2" style="background:var(--field)"></td></tr>').join('')}</tbody></table></div>` : '<p class="note">없습니다.</p>'));
  // 기관 날인 의심 신호
  const fl = [];
  for (const s of STUDENTS) { const c = s.checks[s.checks.length - 1]; for (const f of c.flags || []) fl.push({ s, f }); }
  parts.push(`<h3 style="margin-top:24px">기관 서명·날인 확인 신호</h3><p class="note">자동으로 찾은 의심 신호입니다. 위조 판정이 아니며, 원본을 보고 판단해 주세요.</p>` + (fl.length ? `<div class="tablewrap"><table><thead><tr><th>학생</th><th>쪽</th><th>신호</th><th>내용</th></tr></thead><tbody>${fl.map(({ s, f }) => `<tr><td>${esc(s.name)} ${esc(s.sid)}</td><td class="num">${f.page}</td><td>${esc(f.kind)}</td><td style="white-space:normal">${esc(f.detail)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="note">없습니다.</p>'));
  // 1365 발급번호
  const iss = [];
  for (const s of STUDENTS) { const c = s.checks[s.checks.length - 1]; for (const i of c.issues || []) iss.push({ s, i, c }); }
  parts.push(`<h3 style="margin-top:24px">1365 확인서 발급번호</h3><p class="note">1365 자원봉사포털(www.1365.go.kr)의 확인서 조회에서 진위를 확인할 수 있습니다. 문서 확인은 발급일로부터 90일 안에만 됩니다.</p>` + (iss.length ? `<div class="tablewrap"><table><thead><tr><th>학생</th><th>발급번호(자동 판독)</th><th>쪽</th><th>점검 시각</th></tr></thead><tbody>${iss.map(({ s, i, c }) => `<tr><td>${esc(s.name)} ${esc(s.sid)}</td><td>${esc(i.no)}</td><td class="num">${i.page}</td><td>${when(c.time)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="note">읽은 발급번호가 없습니다.</p>'));
  $('panel-signals').innerHTML = parts.join('');
}

function openDetail(key) {
  const s = STUDENTS.find(x => x.key === key); if (!s) return;
  const draw = () => {
    const st = STUDENTS.find(x => x.key === key) || s;
    const c = st.checks[st.checks.length - 1];
    $('detail-h').textContent = `${st.name} · ${st.major} ${st.sid}`;
    const hist = `<div class="tablewrap"><table><thead><tr><th>차례</th><th>시각</th><th class="num">오류</th><th class="num">확인 필요</th><th class="num">환산 점수</th><th class="num">인정 시간</th><th class="num">쪽수</th><th></th></tr></thead><tbody>${st.checks.map(x => `<tr><td>${x.no}</td><td>${when(x.time)}</td><td class="num">${x.sum.errors}</td><td class="num">${x.sum.reviews}</td><td class="num">${r1(x.sum.score)}</td><td class="num">${r1(x.hours)}</td><td class="num">${x.pages}</td><td><button class="ghost danger small" type="button" data-del="${esc(x.id)}">삭제</button></td></tr>`).join('')}</tbody></table></div>
      <div class="delbar"><span class="note">시험 기록이면 지울 수 있습니다. 지운 기록은 되돌릴 수 없습니다.</span><button class="ghost danger" type="button" id="del-student">이 학생 기록 모두 삭제</button></div>`;
    const byCat = Object.entries(CATS).map(([k, v]) => `${v.name} ${r1(c.sum.byCat[k])}/${v.max}`).join(' · ');
    const items = `<div class="tablewrap"><table><thead><tr><th>판정</th><th>항목</th><th>내용</th><th class="num">감점</th><th>교수 판정</th></tr></thead><tbody>${(c.items || []).filter(it => it.pts > 0 || it.status !== 'ok').map(it => {
      const e = eff(c, it);
      return `<tr><td><span class="tag ${e === 'ok' ? 'green' : e === 'error' ? 'red' : 'amber'}">${e === 'ok' ? '통과' : e === 'error' ? '오류' : '확인 필요'}</span></td><td>${esc(it.title)}</td><td style="white-space:normal;min-width:14rem">${esc(it.detail)}</td><td class="num">${e === 'error' ? it.pts : ''}</td><td>${judgeButtons(c, it)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
    $('detail-body').innerHTML = `<h3 style="margin-top:0">점검 이력</h3>${hist}
      <h3>가장 최근 점검 (${st.checks.length}번째) — 환산 ${r1(c.sum.score)}점</h3><p class="note">${byCat}</p>
      ${st.same.length ? `<p class="notice">다른 학생과 같은 파일: ${st.same.map(esc).join(', ')}</p>` : ''}
      ${(c.flags || []).map(f => `<p class="notice">${f.page}쪽 · ${esc(f.kind)}: ${esc(f.detail)}</p>`).join('')}
      ${items}`;
    bindJudge($('detail-body'), draw);
    $('detail-body').querySelectorAll('[data-del]').forEach(b => twoStep(b, '삭제 확인', async () => {
      await removeChecks([b.dataset.del]);
      if (STUDENTS.some(x => x.key === key)) draw(); else $('detail').close();
    }));
    twoStep($('del-student'), '한 번 더 누르면 모두 삭제됩니다', async () => {
      await removeChecks(st.checks.map(x => x.id)); $('detail').close();
    });
  };
  draw();
  $('detail').showModal();
}
$('detail-close').addEventListener('click', () => $('detail').close());

/* 탭 */
document.querySelectorAll('[role="tab"]').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('[role="tab"]').forEach(x => x.setAttribute('aria-selected', String(x === t)));
  for (const p of ['students', 'review', 'types', 'majors', 'signals']) $('panel-' + p).hidden = p !== t.dataset.tab;
}));

/* 내려받기 */
function csv(rows) {
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const today = () => new Date().toISOString().slice(0, 10);
$('csv-students').addEventListener('click', () => {
  const rows = [['전공', '학번', '이름', '점검 횟수', '첫 오류', '최종 오류', '오류 감소율', '첫 점수', '최종 점수', '첫 점검 상태', '최종 상태', '확인 필요 남음', '인정 시간', '같은 파일 학생', '참고 신호', '최근 점검']];
  for (const s of STUDENTS) rows.push([s.major, s.sid, s.name, s.n, s.firstErr, s.lastErr, s.drop == null ? '' : Math.round(s.drop * 100) + '%', s.firstScore, s.lastScore, s.firstMust ? '보완 필요' : '요건 충족', s.lastMust ? '보완 필요' : '요건 충족', s.reviews, s.hours, s.same.join(' / '), s.flags, s.lastTime]);
  download(`봉사보고서점검_학생별_${today()}.csv`, csv(rows));
});
$('csv-checks').addEventListener('click', () => {
  const rows = [['시각', '전공', '학번', '이름', '점검 차례', '오류', '확인 필요', '환산 점수', '상태', '인정 시간', '쪽수', '규칙판', '오류 항목']];
  for (const c of [...DATA.checks].sort((a, b) => a.time.localeCompare(b.time))) {
    rows.push([c.time, c.major, c.sid, c.name, c.no, c.sum.errors, c.sum.reviews, c.sum.score, c.sum.mustFix ? '보완 필요' : '요건 충족', c.hours, c.pages, c.rules, (c.items || []).filter(it => eff(c, it) === 'error').map(it => it.title).join(' / ')]);
  }
  download(`봉사보고서점검_전체기록_${today()}.csv`, csv(rows));
});
