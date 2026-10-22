import { API_URL, APP_VERSION } from './config.js';
import { checkPdf, getWorker } from './checker.js';
import { CATS } from './rules.js';

const $ = id => document.getElementById(id);
const MAJORS = ['사회복지학과', '원전제어시스템공학과', '전기공학전공', '전력시스템공학과', '특수교육'];
const MAJOR_VI = {
  '사회복지학과': 'Khoa Phúc lợi xã hội',
  '원전제어시스템공학과': 'Kỹ thuật hệ thống điều khiển nhà máy điện hạt nhân',
  '전기공학전공': 'Chuyên ngành Kỹ thuật điện',
  '전력시스템공학과': 'Kỹ thuật hệ thống điện lực',
  '특수교육': 'Giáo dục đặc biệt',
};
let student = null;
let busy = false;
let last = null; // 마지막 결과(언어를 바꾸면 다시 그린다)

/* ---------- 언어 ---------- */
const TXT = {
  ko: {
    title: '봉사 보고서 점검',
    h1: '지역사회봉사 최종보고서 점검',
    lede: '제출하기 전에 빈칸, 기관 날인, 20시간 증빙을 확인합니다.',
    term: '위덕대학교 · 지역사회봉사',
    skip: '본문으로 건너뛰기',
    major: '전공', majorPick: '전공을 고르세요', sid: '학번', sname: '이름', sidPh: '예: 26B3006', namePh: '이름',
    start: '점검 시작하기',
    enterHint: '점검 횟수와 고칠 곳의 수만 기록됩니다. 보고서 파일은 이 기기 안에서만 읽고 어디에도 올리지 않습니다.',
    changeWho: '입장 정보 바꾸기',
    upH: '최종보고서 PDF를 올려 주세요',
    upHint: '표지부터 1365 확인서까지 한 파일로 묶은 PDF만 점검할 수 있습니다.',
    dropMain: 'PDF 파일 고르기', dropSub: '여기로 끌어다 놓아도 됩니다',
    preparing: '준비하고 있습니다',
    slowHint: '처음 한 번은 글자 읽기 도구를 내려받느라 조금 더 걸립니다. 쪽마다 몇 초씩 걸리니 창을 닫지 말아 주세요.',
    againTop: '다른 파일 점검', again: '고친 파일로 다시 점검', print: '점검 결과 인쇄',
    footer: '자동 점검은 스캔 상태에 따라 틀릴 수 있습니다. 「확인 중」으로 표시된 칸은 교수님이 직접 확인합니다. 헌혈은 장수와 관계없이 4시간까지만 봉사시간으로 인정합니다.',
    errMajor: '전공을 골라 주세요.',
    errSid: '학번은 숫자와 영문으로 4~15자입니다. 예: 26B3006',
    errName: '이름을 한글 또는 영문으로 2~20자 안에서 적어 주세요.',
    errPdf: 'PDF 파일만 점검할 수 있습니다. 한글·워드 파일은 PDF로 저장한 뒤 올려 주세요.',
    errBig: '파일이 60MB를 넘습니다. 스캔 해상도를 낮춰 다시 저장해 주세요.',
    errOpen: 'PDF 파일을 열 수 없습니다. 암호가 걸렸거나 손상된 파일인지 확인해 주세요.',
    errAny: '점검 중 문제가 생겼습니다. 새로 고침한 뒤 다시 올려 주세요.',
    loadingTool: '글자 읽기 도구를 준비하고 있습니다',
    reading: (n, total) => `${total}쪽 중 ${n}쪽을 읽고 있습니다`,
    summing: '점검 결과를 정리하고 있습니다',
    resFix: '제출 전에 고칠 곳이 있습니다', stampFix: '보완',
    resAlmost: '필수 요건은 갖췄고, 다듬을 곳이 남았습니다', stampAlmost: '거의 완료',
    resDone: '필수 요건을 모두 갖췄습니다', stampDone: '점검 완료',
    sub: (e, r, h, p) => `고칠 곳 ${e}곳${r ? `, 교수님 확인 ${r}곳` : ''} · 증빙에서 읽은 봉사시간 ${h}시간 · 전체 ${p}쪽`,
    nth: (no, prev, fixed, now) => `${no}번째 점검입니다. 지난번 고칠 곳 ${prev}곳 가운데 ${fixed}곳을 고쳤고, 지금 남은 곳은 ${now}곳입니다.`,
    first: '첫 번째 점검입니다. 고친 뒤 다시 점검하면 무엇이 나아졌는지 알려 드립니다.',
    notSaved: '점검 기록을 저장하지 못했습니다. 결과는 그대로 볼 수 있으니, 인터넷 연결을 확인한 뒤 다시 점검해 주세요.',
    blurry: ps => `${ps}쪽은 스캔이 흐려 글자를 제대로 읽지 못했습니다. 밝은 곳에서 다시 스캔하거나, 스캔 앱의 「문서」 모드로 다시 찍어 주세요.`,
    truncated: '쪽수가 많아 앞 40쪽까지만 점검했습니다.',
    grpFix: n => `고칠 곳 ${n}`, grpRev: n => `확인 중 ${n}`, grpAllOk: '모두 통과',
    showOk: n => `통과한 항목 ${n}개 보기`,
    mark: { ok: '통과', error: '보완', review: '확인 중' },
    reviewTail: ' 교수님이 직접 확인합니다.',
  },
  vi: {
    title: 'Kiểm tra báo cáo tình nguyện',
    h1: 'Kiểm tra báo cáo cuối kỳ hoạt động tình nguyện cộng đồng',
    lede: 'Trước khi nộp, hãy kiểm tra ô trống, dấu của cơ quan và giấy chứng nhận 20 giờ.',
    term: 'Đại học Uiduk · Tình nguyện cộng đồng',
    skip: 'Chuyển đến nội dung chính',
    major: 'Ngành', majorPick: 'Chọn ngành của bạn', sid: 'Mã số SV', sname: 'Họ tên', sidPh: 'Ví dụ: 26B3006', namePh: 'Họ tên',
    start: 'Bắt đầu kiểm tra',
    enterHint: 'Hệ thống chỉ lưu số lần kiểm tra và số chỗ cần sửa. File báo cáo chỉ được đọc trên thiết bị này và không được tải lên bất kỳ đâu.',
    changeWho: 'Đổi thông tin',
    upH: 'Hãy tải lên file PDF báo cáo cuối kỳ',
    upHint: 'Chỉ kiểm tra được một file PDF gộp tất cả, từ trang bìa đến giấy xác nhận 1365.',
    dropMain: 'Chọn file PDF', dropSub: 'Bạn cũng có thể kéo thả file vào đây',
    preparing: 'Đang chuẩn bị',
    slowHint: 'Lần đầu sẽ mất thêm chút thời gian để tải công cụ đọc chữ. Mỗi trang mất vài giây, xin đừng đóng cửa sổ.',
    againTop: 'Kiểm tra file khác', again: 'Kiểm tra lại file đã sửa', print: 'In kết quả',
    footer: 'Kiểm tra tự động có thể sai tùy chất lượng bản scan. Các mục 「Đang xác minh」 sẽ do giảng viên trực tiếp kiểm tra. Hiến máu chỉ được công nhận tối đa 4 giờ tình nguyện, dù có bao nhiêu giấy. Báo cáo vẫn phải viết bằng tiếng Hàn theo mẫu.',
    errMajor: 'Hãy chọn ngành.',
    errSid: 'Mã số sinh viên gồm 4–15 chữ số và chữ cái. Ví dụ: 26B3006',
    errName: 'Hãy nhập họ tên bằng chữ Hàn hoặc chữ Latinh (2–20 ký tự, có thể viết tắt tên đệm). Dấu tiếng Việt sẽ được tự động bỏ.',
    errPdf: 'Chỉ kiểm tra được file PDF. File Hangul hoặc Word hãy lưu sang PDF rồi tải lên.',
    errBig: 'File lớn hơn 60MB. Hãy giảm độ phân giải scan rồi lưu lại.',
    errOpen: 'Không mở được file PDF. Hãy kiểm tra xem file có mật khẩu hoặc bị hỏng không.',
    errAny: 'Có lỗi trong khi kiểm tra. Hãy tải lại trang rồi tải file lên lần nữa.',
    loadingTool: 'Đang chuẩn bị công cụ đọc chữ',
    reading: (n, total) => `Đang đọc trang ${n} / ${total}`,
    summing: 'Đang tổng hợp kết quả',
    resFix: 'Có chỗ cần sửa trước khi nộp', stampFix: 'Cần sửa',
    resAlmost: 'Đã đủ yêu cầu bắt buộc, còn vài chỗ cần chỉnh', stampAlmost: 'Gần xong',
    resDone: 'Đã đủ tất cả yêu cầu bắt buộc', stampDone: 'Đạt',
    sub: (e, r, h, p) => `Cần sửa ${e} chỗ${r ? `, giảng viên xác minh ${r} chỗ` : ''} · Số giờ đọc được: ${h} giờ · Tổng ${p} trang`,
    nth: (no, prev, fixed, now) => `Đây là lần kiểm tra thứ ${no}. Lần trước có ${prev} chỗ cần sửa, bạn đã sửa ${fixed} chỗ, hiện còn ${now} chỗ.`,
    first: 'Đây là lần kiểm tra đầu tiên. Sau khi sửa và kiểm tra lại, hệ thống sẽ cho biết bạn đã tiến bộ ở đâu.',
    notSaved: 'Không lưu được lịch sử kiểm tra. Bạn vẫn xem được kết quả; hãy kiểm tra kết nối mạng rồi kiểm tra lại.',
    blurry: ps => `Trang ${ps} bị scan mờ nên không đọc rõ chữ. Hãy scan lại ở nơi đủ sáng hoặc chụp lại bằng chế độ 「Tài liệu」 của ứng dụng scan.`,
    truncated: 'Do file có nhiều trang, chỉ 40 trang đầu được kiểm tra.',
    grpFix: n => `Cần sửa ${n}`, grpRev: n => `Đang xác minh ${n}`, grpAllOk: 'Tất cả đạt',
    showOk: n => `Xem ${n} mục đã đạt`,
    mark: { ok: 'Đạt', error: 'Cần sửa', review: 'Đang xác minh' },
    reviewTail: ' Giảng viên sẽ trực tiếp kiểm tra.',
  },
};

const pref = {
  get() { try { return localStorage.getItem('svc-lang'); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem('svc-lang', v); } catch (e) { /* 저장이 안 되는 환경 */ } },
};
const urlLang = new URLSearchParams(location.search).get('lang');
let lang = (urlLang === 'vi' || urlLang === 'ko') ? urlLang : (pref.get() === 'vi' ? 'vi' : 'ko');
const L = () => TXT[lang];

function applyLang() {
  const t = L();
  document.documentElement.lang = lang;
  document.title = t.title;
  document.querySelectorAll('[data-t]').forEach(el => { const v = t[el.dataset.t]; if (typeof v === 'string') el.textContent = v; });
  document.querySelectorAll('[data-ph]').forEach(el => { el.placeholder = t[el.dataset.ph]; });
  const sel = $('major');
  for (const o of sel.options) {
    if (!o.value) o.textContent = t.majorPick;
    else o.textContent = lang === 'vi' ? `${o.value} (${MAJOR_VI[o.value]})` : o.value;
  }
  document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  for (const id of ['enter-err', 'up-err']) $(id).textContent = '';
  if (student) fillWho();
  if (last && !$('step-result').hidden) render(last.file, last.r, last.server, true);
}
document.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => {
  lang = b.dataset.lang; pref.set(lang); applyLang();
}));

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
  // 베트남어 성조 부호는 떼고 기록한다(학적부 영문 표기와 맞추고 학생 구분을 흔들지 않기 위해)
  const name = $('sname').value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').replace(/đ/g, 'd').replace(/Đ/g, 'D').trim().replace(/\s+/g, ' ');
  const err = $('enter-err');
  if (!MAJORS.includes(major)) { err.textContent = L().errMajor; $('major').focus(); return; }
  if (!/^[0-9A-Z]{4,15}$/.test(sid)) { err.textContent = L().errSid; $('sid').focus(); return; }
  if (!/^[가-힣A-Za-z ]{2,20}$/.test(name)) { err.textContent = L().errName; $('sname').focus(); return; }
  err.textContent = '';
  student = { major, sid, name };
  store.set(student);
  enterUpload();
});

function fillWho() {
  const m = lang === 'vi' ? `${student.major} (${MAJOR_VI[student.major]})` : student.major;
  $('who-name').textContent = student.name;
  $('who-meta').textContent = `${m} ${student.sid}`;
}

function enterUpload() {
  fillWho();
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
  if (!(await isPdf(file))) { err.textContent = L().errPdf; return; }
  if (file.size > 60 * 1024 * 1024) { err.textContent = L().errBig; return; }
  busy = true;
  drop.setAttribute('aria-disabled', 'true');
  $('progress').hidden = false;
  setProgress(0, L().loadingTool);
  try {
    const result = await checkPdf(file, p => {
      if (p.stage === 'page') setProgress(p.done / p.total, L().reading(p.done + 1, p.total));
      if (p.stage === 'rules') setProgress(1, L().summing);
    });
    const server = await record(result);
    render(file, result, server);
  } catch (e) {
    console.error(e);
    const msg = e && e.message || '';
    err.textContent = /PDF 파일을 열 수 없습니다/.test(msg) ? L().errOpen : (lang === 'ko' && msg) || L().errAny;
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

/* ---------- 기록(점수는 학생 화면에 보이지 않는다, 기록은 한국어로만 남긴다) ---------- */
async function record(r) {
  if (!API_URL) return { ok: false, offline: true };
  const items = r.items.map(it => ({ id: it.id, cat: it.cat, title: it.title, status: it.status, pts: it.pts, detail: it.detail, page: it.page || null }));
  const body = {
    action: 'log', student,
    result: {
      items, errors: r.errors, reviews: r.reviews, score: r.score, mustFix: r.mustFix,
      hours: Math.round((r.hours.total || 0) * 10) / 10, pageCount: r.pageCount, hash: r.hash,
      rules: r.versions.rules + '/' + APP_VERSION + (lang === 'vi' ? '/vi' : ''), blurry: r.blurry, flags: r.flags, issues: r.hours.issues,
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
const titleOf = it => (lang === 'vi' && it.vi && it.vi.title) || it.title;
const detailOf = it => (lang === 'vi' && it.vi && it.vi.detail) || it.detail;

function render(file, r, server, redraw = false) {
  last = { file, r, server };
  const t = L();
  $('who-name2').textContent = student.name;
  $('file-name').textContent = file.name;
  const errs = r.items.filter(i => i.status === 'error');
  const revs = r.items.filter(i => i.status === 'review');
  const stamp = $('stamp');
  stamp.classList.remove('land', 'fix', 'good');
  if (r.mustFix) {
    $('res-h').textContent = t.resFix; stamp.textContent = t.stampFix; stamp.classList.add('fix');
  } else if (errs.length) {
    $('res-h').textContent = t.resAlmost; stamp.textContent = t.stampAlmost; stamp.classList.add('good');
  } else {
    $('res-h').textContent = t.resDone; stamp.textContent = t.stampDone; stamp.classList.add('good');
  }
  stamp.classList.toggle('long', lang === 'vi');
  if (!redraw) { void stamp.offsetWidth; stamp.classList.add('land'); }
  const hrs = Math.round((r.hours.total || 0) * 10) / 10;
  $('res-sub').textContent = t.sub(errs.length, revs.length, hrs, r.pageCount);

  // 지난 점검과 비교
  const fb = $('feedback');
  fb.innerHTML = '';
  const note = (cls, text) => { const p = document.createElement('p'); p.className = cls; p.textContent = text; fb.appendChild(p); };
  if (server && server.ok && server.prevErrors != null) {
    const nowIds = new Set(errs.map(i => i.id));
    const fixed = (server.prevErrorIds || []).filter(id => !nowIds.has(id)).length;
    note('feedback', t.nth(server.checkNo, server.prevErrors, fixed, errs.length));
  } else if (server && server.ok) {
    note('feedback', t.first);
  } else {
    note('notice', t.notSaved);
  }
  if (r.blurry && r.blurry.length) note('notice', t.blurry(r.blurry.join(', ')));
  if (r.truncated) note('notice', t.truncated);

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
    h.firstChild.textContent = lang === 'vi' ? `${c.vi} · ${c.name}` : c.name;
    const nErr = bad.filter(i => i.status === 'error').length, nRev = bad.filter(i => i.status === 'review').length;
    h.lastChild.textContent = bad.length ? [nErr ? t.grpFix(nErr) : '', nRev ? t.grpRev(nRev) : ''].filter(Boolean).join(' · ') : t.grpAllOk;
    sec.appendChild(h);
    if (bad.length) sec.appendChild(rowList(bad));
    if (good.length) {
      const d = document.createElement('details');
      d.className = 'oks';
      const s = document.createElement('summary');
      s.textContent = t.showOk(good.length);
      d.append(s, rowList(good));
      sec.appendChild(d);
    }
    g.appendChild(sec);
  }
  if (!redraw) show('result');
}

function rowList(items) {
  const t = L();
  const ul = document.createElement('ul');
  ul.className = 'rows';
  for (const it of items) {
    const li = document.createElement('li');
    const m = document.createElement('div');
    m.className = 'mark ' + it.status;
    m.textContent = t.mark[it.status];
    const tx = document.createElement('div');
    tx.className = 'txt';
    const b = document.createElement('b'); b.textContent = titleOf(it);
    const s = document.createElement('span'); s.textContent = it.status === 'review' ? detailOf(it) + t.reviewTail : detailOf(it);
    tx.append(b, s);
    li.append(m, tx);
    ul.appendChild(li);
  }
  return ul;
}

for (const id of ['again', 'again-top']) $(id).addEventListener('click', () => enterUpload());
$('print').addEventListener('click', () => window.print());

/* ---------- 시작 ---------- */
applyLang();
const saved = store.get();
if (saved && MAJORS.includes(saved.major)) { student = saved; enterUpload(); }
console.info('봉사 보고서 점검', APP_VERSION);
