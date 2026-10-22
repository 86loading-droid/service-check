import { API_URL, APP_VERSION } from './config.js';
import { checkPdf, getWorker } from './checker.js';
import { CATS } from './rules.js';

const $ = id => document.getElementById(id);
const MAJORS = ['사회복지학과', '원전제어시스템공학과', '전기공학전공', '전력시스템공학과', '특수교육'];
let student = null;
let busy = false;

const store = {
  get() { try { return JSON.parse(sessionStorage.getItem('svc-student') || 'null'); } catch (e) { return null; } },
  set(v) { try { sessionStorage.setItem('svc-student', JSON.stringify(v)); } catch (e) { /* 저장이 안 되는 환경 */ } },
};

function show(step) {
  for (const s of ['enter', 'upload', 'result']) $('step-' + s).hidden = s !== step;
  window.scrollTo({ top: 0 });
}

/* ---------- 입장 ---------- */
$('sid').addEventListener('input', e => {
  const pos = e.target.selectionStart;
  e.target.value = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
  try { e.target.setSelectionRange(pos, pos); } catch (er) { /* 무시 */ }
});

$('enter-form').addEventListener('submit', e => {
  e.preventDefault();
  const major = $('major').value;
  const sid = $('sid').value.trim().toUpperCase();
  const name = $('sname').value.trim().replace(/\s+/g, ' ');
  const err = $('enter-err');
  if (!MAJORS.includes(major)) { err.textContent = '전공을 골라 주세요.'; $('major').focus(); return; }
  if (!/^[0-9A-Z]{4,15}$/.test(sid)) { err.textContent = '학번은 숫자와 영문으로 4~15자입니다. 예: 26B3006'; $('sid').focus(); return; }
  if (!/^[가-힣A-Za-z ]{2,20}$/.test(name)) { err.textContent = '이름을 한글 또는 영문으로 적어 주세요.'; $('sname').focus(); return; }
  err.textContent = '';
  student = { major, sid, name };
  store.set(student);
  enterUpload();
});

function enterUpload() {
  $('who-name').textContent = student.name;
  $('who-meta').textContent = `${student.major} ${student.sid}`;
  $('up-err').textContent = '';
  $('progress').hidden = true;
  $('file').value = '';
  show('upload');
  getWorker().catch(() => {}); // 글자 읽기 도구를 미리 불러 둔다
}

$('change-who').addEventListener('click', () => {
  $('major').value = student.major; $('sid').value = student.sid; $('sname').value = student.name;
  show('enter');
});

/* ---------- 올리기 ---------- */
const drop = $('drop');
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => {
  e.preventDefault(); drop.classList.remove('over');
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) start(f);
});
$('file').addEventListener('change', e => { const f = e.target.files[0]; if (f) start(f); });

async function isPdf(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return false;
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const s = String.fromCharCode(...head);
  return s.includes('%PDF');
}

async function start(file) {
  if (busy) return;
  const err = $('up-err');
  err.textContent = '';
  if (!(await isPdf(file))) { err.textContent = 'PDF 파일만 점검할 수 있습니다. 한글·워드 파일은 PDF로 저장한 뒤 올려 주세요.'; return; }
  if (file.size > 60 * 1024 * 1024) { err.textContent = '파일이 60MB를 넘습니다. 스캔 해상도를 낮춰 다시 저장해 주세요.'; return; }
  busy = true;
  drop.setAttribute('aria-disabled', 'true');
  $('progress').hidden = false;
  setProgress(0, '글자 읽기 도구를 준비하고 있습니다');
  try {
    const result = await checkPdf(file, p => {
      if (p.stage === 'page') setProgress(p.done / p.total, `${p.total}쪽 중 ${p.done + 1}쪽을 읽고 있습니다`);
      if (p.stage === 'rules') setProgress(1, '점검 결과를 정리하고 있습니다');
    });
    const server = await record(result);
    render(file, result, server);
  } catch (e) {
    console.error(e);
    err.textContent = e.message || '점검 중 문제가 생겼습니다. 새로 고침한 뒤 다시 올려 주세요.';
    $('progress').hidden = true;
  } finally {
    busy = false;
    drop.removeAttribute('aria-disabled');
  }
}

function setProgress(f, text) {
  $('bar').style.width = Math.round(f * 100) + '%';
  $('progress-text').textContent = text;
}

/* ---------- 기록(점수는 학생 화면에 보이지 않는다) ---------- */
async function record(r) {
  if (!API_URL) return { ok: false, offline: true };
  const items = r.items.map(it => ({ id: it.id, cat: it.cat, title: it.title, status: it.status, pts: it.pts, detail: it.detail, page: it.page || null }));
  const body = {
    action: 'log', student,
    result: {
      items, errors: r.errors, reviews: r.reviews, score: r.score, mustFix: r.mustFix,
      hours: Math.round((r.hours.total || 0) * 10) / 10, pageCount: r.pageCount, hash: r.hash,
      rules: r.versions.rules + '/' + APP_VERSION, blurry: r.blurry, flags: r.flags, issues: r.hours.issues,
    },
  };
  try {
    const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    return await res.json();
  } catch (e) {
    return { ok: false };
  }
}

/* ---------- 결과 ---------- */
const MARK = { ok: '통과', error: '보완', review: '확인 중' };

function render(file, r, server) {
  $('who-name2').textContent = student.name;
  $('file-name').textContent = file.name;
  const errs = r.items.filter(i => i.status === 'error');
  const revs = r.items.filter(i => i.status === 'review');
  const stamp = $('stamp');
  stamp.classList.remove('land', 'fix', 'good');
  if (r.mustFix) {
    $('res-h').textContent = '제출 전에 고칠 곳이 있습니다';
    stamp.textContent = '보완';
    stamp.classList.add('fix');
  } else if (errs.length) {
    $('res-h').textContent = '필수 요건은 갖췄고, 다듬을 곳이 남았습니다';
    stamp.textContent = '거의 완료';
    stamp.classList.add('good');
  } else {
    $('res-h').textContent = '필수 요건을 모두 갖췄습니다';
    stamp.textContent = '점검 완료';
    stamp.classList.add('good');
  }
  void stamp.offsetWidth; stamp.classList.add('land');
  const hrs = Math.round((r.hours.total || 0) * 10) / 10;
  $('res-sub').textContent = `고칠 곳 ${errs.length}곳${revs.length ? `, 교수님 확인 ${revs.length}곳` : ''} · 증빙에서 읽은 봉사시간 ${hrs}시간 · 전체 ${r.pageCount}쪽`;

  // 지난 점검과 비교
  const fb = $('feedback');
  fb.innerHTML = '';
  if (server && server.ok && server.prevErrors != null) {
    const nowIds = new Set(errs.map(i => i.id));
    const fixed = (server.prevErrorIds || []).filter(id => !nowIds.has(id)).length;
    const p = document.createElement('p');
    p.className = 'feedback';
    p.textContent = `${server.checkNo}번째 점검입니다. 지난번 고칠 곳 ${server.prevErrors}곳 가운데 ${fixed}곳을 고쳤고, 지금 남은 곳은 ${errs.length}곳입니다.`;
    fb.appendChild(p);
  } else if (server && server.ok) {
    const p = document.createElement('p'); p.className = 'feedback';
    p.textContent = '첫 번째 점검입니다. 고친 뒤 다시 점검하면 무엇이 나아졌는지 알려 드립니다.';
    fb.appendChild(p);
  } else {
    const p = document.createElement('p'); p.className = 'notice';
    p.textContent = '점검 기록을 저장하지 못했습니다. 결과는 그대로 볼 수 있으니, 인터넷 연결을 확인한 뒤 다시 점검해 주세요.';
    fb.appendChild(p);
  }
  if (r.blurry && r.blurry.length) {
    const p = document.createElement('p'); p.className = 'notice';
    p.textContent = `${r.blurry.join(', ')}쪽은 스캔이 흐려 글자를 제대로 읽지 못했습니다. 밝은 곳에서 다시 스캔하거나, 스캔 앱의 「문서」 모드로 다시 찍어 주세요.`;
    fb.appendChild(p);
  }
  if (r.truncated) {
    const p = document.createElement('p'); p.className = 'notice';
    p.textContent = '쪽수가 많아 앞 40쪽까지만 점검했습니다.';
    fb.appendChild(p);
  }

  // 항목: 고칠 곳 먼저, 영역별로
  const g = $('groups');
  g.innerHTML = '';
  for (const [cat, c] of Object.entries(CATS)) {
    const all = r.items.filter(i => i.cat === cat);
    if (!all.length) continue;
    const bad = all.filter(i => i.status !== 'ok');
    const good = all.filter(i => i.status === 'ok');
    const sec = document.createElement('section');
    sec.className = 'group';
    const h = document.createElement('h3');
    h.innerHTML = `<span></span><small></small>`;
    h.firstChild.textContent = c.name;
    h.lastChild.textContent = bad.length ? `고칠 곳 ${bad.filter(i => i.status === 'error').length}` + (bad.some(i => i.status === 'review') ? ` · 확인 중 ${bad.filter(i => i.status === 'review').length}` : '') : '모두 통과';
    sec.appendChild(h);
    if (bad.length) sec.appendChild(rowList(bad));
    if (good.length) {
      const d = document.createElement('details');
      d.className = 'oks';
      const s = document.createElement('summary');
      s.textContent = `통과한 항목 ${good.length}개 보기`;
      d.append(s, rowList(good));
      sec.appendChild(d);
    }
    g.appendChild(sec);
  }
  show('result');
}

function rowList(items) {
  const ul = document.createElement('ul');
  ul.className = 'rows';
  for (const it of items) {
    const li = document.createElement('li');
    const m = document.createElement('div');
    m.className = 'mark ' + it.status;
    m.textContent = MARK[it.status];
    const t = document.createElement('div');
    t.className = 'txt';
    const b = document.createElement('b'); b.textContent = it.title;
    const s = document.createElement('span'); s.textContent = it.status === 'review' ? it.detail + ' 교수님이 직접 확인합니다.' : it.detail;
    t.append(b, s);
    li.append(m, t);
    ul.appendChild(li);
  }
  return ul;
}

for (const id of ['again', 'again-top']) $(id).addEventListener('click', () => enterUpload());
$('print').addEventListener('click', () => window.print());

/* ---------- 시작 ---------- */
const saved = store.get();
if (saved && MAJORS.includes(saved.major)) { student = saved; enterUpload(); }
console.info('봉사 보고서 점검', APP_VERSION);
