// 점검 규칙과 100점 환산. 판독 결과(engine)를 받아 항목별 판정을 만든다.
// 판정: ok(통과) / error(보완 필요) / review(자동 판정 어려움 → 교수님 확인)
export const RULES_VERSION = 'v1.0';

export const CATS = {
  hours: { name: '봉사시간 증빙', max: 40 },
  seal: { name: '기관 날인', max: 20 },
  blank: { name: '빈칸 없음', max: 25 },
  doc: { name: '구성·일치', max: 10 },
  form: { name: '작성 형식', max: 5 },
};

const sq = s => (s || '').replace(/\s+/g, '');
const TYPE_NAME = { cover: '표지', plan: '계획서', apply: '활동 신청서', log: '활동 일지', result: '결과 보고서', c1365: '1365 자원봉사활동 확인서', cvms: 'VMS 실적 인증서', cuniv: '대학 사회봉사센터 확인서', blood: '헌혈증서' };

const HEADER = ['학생이름', '연락처', '학과(부)', '학번', '지도자', '봉사기관명', '일자 및 시간'];
const EXPECT = {
  cover: ['봉사기관명', '교과명(분반)', '학과(부)', '학번', '이름', '담당교수'],
  plan: HEADER, log: [...HEADER, '느낀 점', '개선사항', '봉사소감'], result: HEADER,
  apply: ['학생이름', '연락처', '학과(부)', '학번', '일자 및 시간', '기관명', '대표자', '전화', 'FAX', '주소', '담당자', '담당자 메일', '주요 활동 내용'],
};

export const T = { blank: 0.008, unsure: 0.016, signOk: 0.012, signNone: 0.004, redOk: 150, redNone: 50, contentBlank: 0.01, blurSharp: 150, blurConf: 45 };

/* ---------- 시간 증빙 읽기 ---------- */
function hm(h, m) { return (+h || 0) + (+m || 0) / 60; }

export function readHours(pages) {
  const groups = { c1365: {}, cvms: {}, cuniv: {}, blood: 0 };
  const rows = []; const issues = [];
  for (const p of pages) {
    const st = sq(p.text);
    if (p.types.includes('c1365')) {
      const no = (st.match(/발급번호[:：]?(\d{8,})/) || [])[1] || 'p' + p.n;
      issues.push({ kind: '1365', no: (st.match(/발급번호[:：]?([0-9_]{8,})/) || [])[1] || '', page: p.n });
      const tot = st.match(/활동시간[:：]?총(\d{1,3})시간(\d{1,2})?분?/);
      const g = groups.c1365[no] || (groups.c1365[no] = { total: 0, rowSum: 0 });
      if (tot) g.total = Math.max(g.total, hm(tot[1], tot[2]));
      let sum = 0;
      for (const m of st.matchAll(/(20\d\d)년(\d{1,2})월(\d{1,2})일(\d{1,2})시간(\d{1,2})분/g)) {
        const hrs = hm(m[4], m[5]); sum += hrs;
        rows.push({ src: '1365', date: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, hours: hrs, page: p.n });
      }
      g.rowSum = Math.max(g.rowSum, sum);
    }
    if (p.types.includes('cvms')) {
      const key = (st.match(/발급일시[:：]?(20\d\d-\d\d-\d\d\d\d:\d\d)/) || [])[1] || 'p' + p.n;
      const g = groups.cvms[key] || (groups.cvms[key] = { total: 0, rowSum: 0 });
      const t1 = st.match(/[총종]계.{0,30}?(\d{1,3})시간(\d{1,2})분/);
      const t2 = st.match(/시간및횟수[:：]?(\d{1,3})시간(\d{1,2})?분?/);
      if (t1) g.total = Math.max(g.total, hm(t1[1], t1[2]));
      if (t2) g.total = Math.max(g.total, hm(t2[1], t2[2]));
      const dates = [...st.matchAll(/(20\d\d)-(\d\d)-(\d\d)(?!\d)/g)].map(m => `${m[1]}-${m[2]}-${m[3]}`).filter(d => !st.includes('발급일시:' + d) && !st.includes('발급일시' + d));
      const hrs = [...st.matchAll(/\[(\d{1,2})시간(\d{1,2})분\]/g)].map(m => hm(m[1], m[2]));
      let sum = 0;
      hrs.forEach((x, i) => { sum += x; rows.push({ src: 'VMS', date: dates[i] || '', hours: x, page: p.n }); });
      g.rowSum = Math.max(g.rowSum, sum);
    }
    if (p.types.includes('cuniv')) {
      const key = (st.match(/발급번호[:：]?([^\s]{4,30}?)(?:성명|$)/) || [])[1] || 'p' + p.n;
      const g = groups.cuniv[key] || (groups.cuniv[key] = { total: 0, rowSum: 0 });
      let sum = 0;
      for (const m of st.matchAll(/~\d{1,2}:\d\d\((\d{1,2})시간\)/g)) sum += +m[1];
      g.total = Math.max(g.total, sum);
    }
    if (p.types.includes('blood')) groups.blood++;
  }
  // 1365·VMS 확인서는 한 사람의 실적을 모아 보여 주므로, 같은 종류는 가장 큰 값 하나만 센다
  const pick = g => Object.values(g).reduce((a, x) => Math.max(a, x.total > 0 ? x.total : x.rowSum), 0);
  const parts = { c1365: pick(groups.c1365), cvms: pick(groups.cvms), cuniv: pick(groups.cuniv), blood: groups.blood ? 4 : 0 };
  const total = parts.c1365 + parts.cvms + parts.cuniv + parts.blood;
  return { parts, total, rows, issues: issues.filter(i => i.no), bloodCount: groups.blood };
}

/* ---------- 항목 판정 ---------- */
export function evaluate(analysis) {
  const pages = analysis.pages;
  const items = [];
  const add = (it) => items.push(it);
  const has = t => pages.some(p => p.types.includes(t));
  const pagesOf = t => pages.filter(p => p.types.includes(t));

  /* 1. 봉사시간 증빙 */
  const H = readHours(pages);
  add({ id: 'h1365', cat: 'hours', title: '1365 자원봉사활동 확인서 첨부', status: has('c1365') ? 'ok' : 'error', pts: 15,
    detail: has('c1365') ? `${pagesOf('c1365').map(p => p.n).join(', ')}쪽에서 확인했습니다.` : '1365 자원봉사 포털에서 발급한 「자원봉사활동 확인서」를 보고서 끝에 붙여 주세요.' });
  const certCount = ['c1365', 'cvms', 'cuniv', 'blood'].filter(has).length;
  const fmt = x => (Math.round(x * 10) / 10).toString();
  const partTxt = [['1365', H.parts.c1365], ['VMS', H.parts.cvms], ['대학 확인서', H.parts.cuniv], ['헌혈', H.parts.blood]].filter(x => x[1] > 0).map(x => `${x[0]} ${fmt(x[1])}시간`).join(' + ');
  if (!certCount) {
    add({ id: 'h20', cat: 'hours', title: '봉사시간 총 20시간 이상', status: 'error', pts: 20, detail: '시간을 증명하는 서류(1365 확인서 등)를 찾지 못했습니다.' });
  } else if (H.total >= 20) {
    add({ id: 'h20', cat: 'hours', title: '봉사시간 총 20시간 이상', status: 'ok', pts: 20, detail: `인정 시간 ${fmt(H.total)}시간 (${partTxt}).`, hours: H.total });
  } else if (H.total > 0) {
    add({ id: 'h20', cat: 'hours', title: '봉사시간 총 20시간 이상', status: 'error', pts: Math.min(20, Math.round((20 - H.total) * 10) / 10), detail: `증빙에서 읽은 시간은 ${fmt(H.total)}시간입니다 (${partTxt}). 20시간이 되도록 증빙을 더 붙여 주세요. 헌혈은 장수와 관계없이 4시간까지만 인정합니다.`, hours: H.total });
  } else {
    add({ id: 'h20', cat: 'hours', title: '봉사시간 총 20시간 이상', status: 'review', pts: 20, detail: '증빙 서류는 있으나 시간을 읽지 못했습니다. 스캔이 흐리면 다시 스캔해 주세요.' });
  }
  // 하루 8시간 넘김: 12시간을 넘는 값은 글자를 잘못 읽은 것으로 보고 교수님 확인으로 돌린다
  const over = H.rows.filter(r => r.hours > 8 && r.hours <= 12);
  const odd = H.rows.filter(r => r.hours > 12);
  if (odd.length && !over.length) add({ id: 'h8', cat: 'hours', title: '하루 8시간 이하', status: 'review', pts: 5, detail: `날짜별 시간을 확실히 읽지 못했습니다(${odd.map(r => r.date || r.page + '쪽').join(', ')}).` });
  else add({ id: 'h8', cat: 'hours', title: '하루 8시간 이하', status: over.length ? 'error' : 'ok', pts: 5,
    detail: over.length ? `하루 8시간을 넘긴 기록: ${over.map(r => `${r.date} ${fmt(r.hours)}시간`).join(', ')}` : (H.rows.length ? '하루 8시간을 넘긴 기록이 없습니다.' : '날짜별 시간 기록을 찾지 못해 넘김 여부는 표시만 하지 않습니다.') });

  /* 2. 기관 날인 (신청서마다 대표자·담당자) */
  const applies = pagesOf('apply');
  if (!applies.length) {
    add({ id: 'seal-none', cat: 'seal', title: '활동 신청서의 기관 날인', status: 'error', pts: 20, detail: '활동 신청서를 찾지 못해 날인을 확인할 수 없습니다.' });
  }
  for (const p of applies) {
    for (const who of ['대표자', '담당자']) {
      const f = p.fields.find(x => x.label === who && x.inkSign != null);
      const id = `seal-${p.n}-${who}`;
      if (!f) { add({ id, cat: 'seal', title: `${p.n}쪽 신청서 ${who} 날인`, status: 'review', pts: 5, page: p.n, detail: `${who} 칸을 찾지 못했습니다. 교수님 확인 항목으로 넘깁니다.` }); continue; }
      const ok = f.inkSign >= T.signOk || f.red >= T.redOk;
      const none = f.inkSign < T.signNone && f.red < T.redNone;
      add({ id, cat: 'seal', title: `${p.n}쪽 신청서 ${who} 날인`, status: ok ? 'ok' : none ? 'error' : 'review', pts: 5, page: p.n,
        detail: ok ? '서명 또는 도장이 있습니다.' : none ? `${who} 칸이 「(인)」만 있고 비어 있습니다. 기관 ${who}의 서명과 도장을 받아 주세요.` : `${who} 칸 표시가 희미해 확실하지 않습니다.` });
    }
  }

  /* 3. 빈칸 */
  for (const [type, labels] of Object.entries(EXPECT)) {
    for (const p of pagesOf(type)) {
      for (const lab of labels) {
        if (type === 'apply' && (lab === '대표자' || lab === '담당자')) continue; // 날인에서 따로 본다
        if (type === 'cover' && lab === '담당교수') continue; // 담당교수는 구성·일치에서 본다
        const f = p.fields.find(x => x.label === lab);
        if (!f) continue; // 이름표를 못 읽은 칸은 판정하지 않는다
        const where = `${p.n}쪽 ${TYPE_NAME[type]} 「${lab}」`;
        if (lab === '일자 및 시간') {
          const t = sq(f.text);
          if (/총\)?일|총\(\)일|총일\)/.test(t) && !/총\d+일/.test(t)) {
            add({ id: `blank-${p.n}-${lab}-days`, cat: 'blank', title: `${where} 총 일수`, status: 'error', pts: 2, page: p.n, detail: '「(총 ○일)」의 일수가 비어 있습니다.' });
          }
        }
        if (f.ink < T.blank && !(f.text && f.conf > 70 && sq(f.text).length >= 2)) {
          add({ id: `blank-${p.n}-${lab}`, cat: 'blank', title: where, status: 'error', pts: 2, page: p.n, detail: '빈칸입니다. 빠짐없이 채워 주세요.' });
        } else if (f.ink < T.unsure && !(f.text && f.conf > 70)) {
          add({ id: `blank-${p.n}-${lab}`, cat: 'blank', title: where, status: 'review', pts: 2, page: p.n, detail: '글씨가 아주 적거나 흐려 채워졌는지 확실하지 않습니다.' });
        }
      }
    }
  }
  for (const p of pages) for (const c of p.contents || []) {
    if (c.ink < T.contentBlank) add({ id: `blank-${p.n}-${c.label}`, cat: 'blank', title: `${p.n}쪽 「${c.label}」`, status: 'error', pts: 2, page: p.n, detail: '내용이 비어 있습니다.' });
  }
  const blankErrors = items.filter(i => i.cat === 'blank' && i.status === 'error').length;
  if (!blankErrors) add({ id: 'blank-ok', cat: 'blank', title: '빈칸', status: 'ok', pts: 0, detail: '읽어 낸 칸에서는 빈칸을 찾지 못했습니다.' });

  /* 4. 구성·일치 */
  for (const t of ['cover', 'plan', 'apply', 'log', 'result']) {
    add({ id: `doc-${t}`, cat: 'doc', title: `${TYPE_NAME[t]} 포함`, status: has(t) ? 'ok' : 'error', pts: 1.5,
      detail: has(t) ? `${pagesOf(t).map(p => p.n).join(', ')}쪽` : `${TYPE_NAME[t]}를 찾지 못했습니다. 빠졌거나 스캔이 흐린지 확인해 주세요.` });
  }
  const cover = pagesOf('cover')[0];
  const prof = cover && cover.fields.find(x => x.label === '담당교수');
  if (!cover) {
    add({ id: 'prof', cat: 'doc', title: '표지 담당교수 「최현석」', status: 'error', pts: 2.5, detail: '표지를 찾지 못했습니다.' });
  } else if (!prof) {
    add({ id: 'prof', cat: 'doc', title: '표지 담당교수 「최현석」', status: 'review', pts: 2.5, page: cover.n, detail: '담당교수 칸을 읽지 못했습니다.' });
  } else {
    const t = sq(prof.text);
    if (/최현석|최현|현석/.test(t)) add({ id: 'prof', cat: 'doc', title: '표지 담당교수 「최현석」', status: 'ok', pts: 2.5, page: cover.n, detail: '담당교수 이름이 맞습니다.' });
    else if (prof.ink < T.blank) add({ id: 'prof', cat: 'doc', title: '표지 담당교수 「최현석」', status: 'error', pts: 2.5, page: cover.n, detail: '담당교수 칸이 비어 있습니다. 「최현석 교수님」으로 적어 주세요.' });
    else if (/^[가-힣]{2,4}(교수님?|교수)?$/.test(t) && prof.conf >= 60 && !/^교수님?$/.test(t)) add({ id: 'prof', cat: 'doc', title: '표지 담당교수 「최현석」', status: 'error', pts: 2.5, page: cover.n, detail: `담당교수가 「${prof.text}」로 읽힙니다. 담당교수는 최현석 교수님입니다.` });
    else if (/^교수님?$/.test(t)) add({ id: 'prof', cat: 'doc', title: '표지 담당교수 「최현석」', status: 'error', pts: 2.5, page: cover.n, detail: '담당교수 이름이 없습니다. 「최현석 교수님」으로 적어 주세요.' });
    else add({ id: 'prof', cat: 'doc', title: '표지 담당교수 「최현석」', status: 'review', pts: 2.5, page: cover.n, detail: '손글씨라 이름을 확실히 읽지 못했습니다.' });
  }

  /* 5. 작성 형식 */
  const guide = pages.filter(p => /구체적으로작성/.test(sq(p.text)));
  add({ id: 'form-guide', cat: 'form', title: '양식 안내 문구 지우기', status: guide.length ? 'error' : 'ok', pts: 3,
    detail: guide.length ? `${guide.map(p => p.n).join(', ')}쪽에 「(구체적으로 작성)」 안내 문구가 남아 있습니다.` : '안내 문구가 남아 있지 않습니다.' });
  const nums = pagesOf('log').map(p => { const m = sq(p.text).match(/\((\d{1,2})차\)/); return m ? +m[1] : null; }).filter(x => x != null);
  const dup = nums.filter((x, i) => nums.indexOf(x) !== i);
  add({ id: 'form-order', cat: 'form', title: '활동 일지 차수 번호', status: dup.length ? 'error' : 'ok', pts: 2,
    detail: dup.length ? `일지 차수가 겹칩니다(${[...new Set(dup)].map(x => x + '차').join(', ')}). 1차, 2차, 3차 순서로 고쳐 주세요.` : (nums.length ? '차수 번호가 겹치지 않습니다.' : '차수 번호를 읽지 못했습니다.') });

  /* 교수님만 보는 참고 신호 */
  const flags = [];
  const certText = sq(pages.filter(p => ['c1365', 'cvms', 'cuniv', 'blood'].some(t => p.types.includes(t))).map(p => p.text).join(''));
  for (const p of applies) {
    const org = p.fields.find(x => x.label === '기관명');
    const name = org && sq(org.text).replace(/[^가-힣A-Za-z0-9]/g, '');
    if (name && name.length >= 3 && org.conf >= 70 && certText && !certText.includes(name.slice(0, 4))) {
      flags.push({ page: p.n, kind: '증빙에 없는 기관', detail: `신청서 기관명 「${org.text}」이 1365·VMS 등 공식 증빙에서 보이지 않습니다.` });
    }
    for (const who of ['대표자', '담당자']) {
      const f = p.fields.find(x => x.label === who && x.inkSign != null);
      if (f && f.inkSign >= T.signOk && f.red < T.redNone && p.colorFrac > 0.004) flags.push({ page: p.n, kind: '도장 없이 서명만', detail: `컬러 스캔인데 ${who} 칸에 붉은 도장이 없고 서명만 있습니다.` });
    }
  }
  const blurry = pages.filter(p => p.sharp < T.blurSharp || (!p.layer && p.conf < T.blurConf)).map(p => p.n);

  return { items, flags, hours: H, blurry, ...summarize(items) };
}

// 교수님 판정(judgments: {itemId: 'ok'|'error'})을 반영해 점수·오류 수를 계산
export function summarize(items, judgments = {}) {
  const lost = {};
  let errors = 0, reviews = 0;
  for (const it of items) {
    const st = judgments[it.id] || it.status;
    if (st === 'error') { errors++; lost[it.cat] = (lost[it.cat] || 0) + it.pts; }
    if (st === 'review') reviews++;
  }
  let score = 0;
  const byCat = {};
  for (const [k, c] of Object.entries(CATS)) { byCat[k] = Math.max(0, c.max - Math.min(c.max, lost[k] || 0)); score += byCat[k]; }
  const req = ['h1365', 'h20'];
  const mustFix = items.some(it => {
    const st = judgments[it.id] || it.status;
    return st === 'error' && (req.includes(it.id) || it.cat === 'seal' || it.cat === 'blank');
  });
  return { score: Math.round(score * 10) / 10, byCat, errors, reviews, mustFix };
}

export { TYPE_NAME };
