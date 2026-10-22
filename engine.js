// 지역사회봉사 보고서 판독 엔진 — 모든 처리는 브라우저 안에서만 한다.
// 쪽 그림을 그려 글자 읽기(Tesseract), 표 칸 찾기, 칸 채움 정도, 붉은 도장, 흐림 정도를 잰다.

export const ENGINE_VERSION = '2026.10.22-1';
const RENDER_WIDTH = 1400;

/* ---------- 기본 영상 처리 ---------- */
function toGray(img) {
  const { data, width, height } = img;
  const g = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = (data[j] * 299 + data[j + 1] * 587 + data[j + 2] * 114) / 1000;
  }
  return g;
}

function otsu(g) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < g.length; i += 3) hist[g[i]]++;
  let total = 0, sum = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
  let sumB = 0, wB = 0, best = 0, th = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; th = i; }
  }
  return Math.max(95, Math.min(190, th));
}

// 흐림 정도: 라플라시안 분산(값이 작을수록 흐림)
function sharpness(g, w, h) {
  let n = 0, s = 0, s2 = 0;
  for (let y = 2; y < h - 2; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      const i = y * w + x;
      const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      s += v; s2 += v * v; n++;
    }
  }
  const m = s / n;
  return s2 / n - m * m;
}

function colorStats(img) {
  const d = img.data; let colored = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 7) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    if (mx - mn > 40) colored++;
    n++;
  }
  return colored / n;
}

function isRed(d, j) {
  const r = d[j], g = d[j + 1], b = d[j + 2];
  return r > 120 && r - g > 50 && r - b > 35;
}

/* ---------- 표 선 찾기 ---------- */
function findHLines(dark, w, h) {
  const segs = [];
  const minLen = Math.round(w * 0.05), gapTol = 14;
  const frac = (y, x1, x2) => {
    if (y < 0 || y >= h) return 0;
    let n = 0; const row = y * w;
    for (let x = x1; x <= x2; x++) if (dark[row + x]) n++;
    return n / (x2 - x1 + 1);
  };
  // 선다운 줄: 그 줄은 진하고(점선 허용), 위아래 6px은 비어 있어야 한다(글자 줄과 구별)
  const push = (y, x1, x2) => {
    if (x2 - x1 < minLen) return;
    if (frac(y, x1, x2) < 0.55) return;
    if (frac(y - 6, x1, x2) > 0.3 || frac(y + 6, x1, x2) > 0.3) return;
    segs.push({ y, x1, x2 });
  };
  for (let y = 0; y < h; y++) {
    let start = -1, last = -10;
    const row = y * w;
    for (let x = 0; x <= w; x++) {
      const on = x < w && dark[row + x];
      if (on) {
        if (start < 0 || x - last > gapTol) {
          if (start >= 0) push(y, start, last);
          start = x;
        }
        last = x;
      }
    }
    if (start >= 0) push(y, start, last);
  }
  return mergeSegs(segs);
}

function mergeSegs(segs) {
  // 같은 가로선(두께 몇 픽셀)을 하나로 합친다
  const lines = [];
  segs.sort((a, b) => a.y - b.y || a.x1 - b.x1);
  for (const s of segs) {
    let hit = null;
    for (let k = lines.length - 1; k >= 0; k--) {
      const L = lines[k];
      if (s.y - L.yb > 3) { if (s.y - L.yb > 30) break; continue; }
      const ov = Math.min(L.x2, s.x2) - Math.max(L.x1, s.x1);
      if (ov > 0.5 * Math.min(L.x2 - L.x1, s.x2 - s.x1)) { hit = L; break; }
    }
    if (hit) { hit.yb = s.y; hit.x1 = Math.min(hit.x1, s.x1); hit.x2 = Math.max(hit.x2, s.x2); }
    else lines.push({ ya: s.y, yb: s.y, x1: s.x1, x2: s.x2 });
  }
  return lines.filter(L => L.yb - L.ya <= 9).map(L => ({ y: (L.ya + L.yb) / 2, x1: L.x1, x2: L.x2 }));
}

/* ---------- 글자 정리 ---------- */
export const squash = s => (s || '').replace(/\s+/g, '');
const clean = s => squash(s).replace(/[|\[\]{}()'"`.,:;_~\-—‘’“”·]/g, '');

// 양식의 이름표(인쇄 글자). 순서가 중요하다(긴 것 먼저).
const LABELS = [
  ['담당자 메일', /^담당자메일$|^당자메일$|^메일$/],
  ['주요 활동 내용', /^주요활동내용$|^주요활동$|^요활동내용$/],
  ['일자 및 시간', /^일[자지]및시간$|^일[자지]및$|^및시간$/],
  ['교과명(분반)', /^교과명분반$|^교과명$/],
  ['봉사기관명', /^봉사기관명?$/],
  ['학생이름', /^학생이름$|^생이름$|^학생이$/],
  ['담당교수', /^담당교수$/],
  ['개선사항', /^개선사항$|^개선사$/],
  ['봉사소감', /^봉사소감$/],
  ['느낀 점', /^느낀점$|^느낀$/],
  ['학과(부)', /^학과부?$/],
  ['연락처', /^연.{0,2}처$|^락처$|^연락$/],
  ['지도자', /^지도자$|^도자$/],
  ['기관명', /^기관명$/],
  ['대표자', /^대표자$|^표자$/],
  ['담당자', /^담당자$/],
  ['학번', /^학.?번$|^번번$/],
  ['전화', /^전화$/],
  ['FAX', /^FAX$|^FAX$/i],
  ['주소', /^주소$/],
  ['이름', /^이름$/],
];
const SIGN_LABELS = new Set(['대표자', '담당자']);

function labelMatch(t) {
  for (const [name, re] of LABELS) if (re.test(t)) return name;
  return null;
}

// OCR 줄마다 이어진 낱말 1~4개를 붙여 이름표를 찾는다(띄어 쓴 「연 락 처」 같은 이름표 대응)
function findLabels(lines) {
  const found = [];
  for (const ln of lines) {
    const ws = ln.words;
    let i = 0;
    while (i < ws.length) {
      let hit = null;
      for (let len = Math.min(4, ws.length - i); len >= 1; len--) {
        const part = ws.slice(i, i + len);
        const name = labelMatch(clean(part.map(x => x.text).join('')));
        if (name) {
          const bb = { x0: Math.min(...part.map(x => x.bbox.x0)), y0: Math.min(...part.map(x => x.bbox.y0)),
            x1: Math.max(...part.map(x => x.bbox.x1)), y1: Math.max(...part.map(x => x.bbox.y1)) };
          // 낱말 사이가 너무 벌어지면 이름표가 아니다
          if (bb.x1 - bb.x0 < 260) { hit = { name, bb, len }; break; }
        }
      }
      if (hit && /[,，]$/.test(ws[i + hit.len - 1].text)) hit = null; // 「느낀점, 개선사항, …」 같은 안내 문장
      if (hit) { found.push(hit); i += hit.len; } else i++;
    }
  }
  return found;
}

// 이름표 가운데에서 위아래로 가며 가로선(가로로 반 이상 진한 줄)을 찾는다
function rowBounds(lineDark, w, h, xa, xb, cy, rh) {
  xa = Math.max(0, Math.round(xa)); xb = Math.min(w, Math.round(xb));
  const cov = y => { let n = 0; for (let x = xa; x < xb; x++) if (lineDark[y * w + x]) n++; return n / (xb - xa); };
  let ya = null, yb = null;
  for (let y = Math.round(cy) - 8; y > cy - 45 && y > 0; y--) if (cov(y) >= 0.5) { ya = y; break; }
  for (let y = Math.round(cy) + 8; y < cy + 45 && y < h; y++) if (cov(y) >= 0.5) { yb = y; break; }
  if (ya == null || yb == null || yb - ya < 22) return [cy - rh, cy + rh];
  return [ya, yb];
}

// 줄 높이 안에서 세로로 거의 이어진 열(표의 세로선) 위치
function bandVerticals(lineDark, w, xa, xb, ya, yb) {
  ya = Math.round(ya); yb = Math.round(yb);
  const hh = yb - ya; if (hh < 10) return [];
  const xs = []; let run = -1;
  for (let x = Math.max(1, Math.round(xa)); x < Math.min(w - 1, Math.round(xb)); x++) {
    let n = 0;
    for (let y = ya; y < yb; y++) { const i = y * w + x; if (lineDark[i] || lineDark[i - 1] || lineDark[i + 1]) n++; }
    const on = n / hh >= 0.65;
    if (on && run < 0) run = x;
    if (!on && run >= 0) { if (x - run <= 12) xs.push((run + x - 1) / 2); run = -1; }
  }
  return xs;
}

function regionInk(dark, w, h, r, masks = []) {
  const x1 = Math.max(0, Math.round(r.x0)), x2 = Math.min(w, Math.round(r.x1));
  const y1 = Math.max(0, Math.round(r.y0)), y2 = Math.min(h, Math.round(r.y1));
  const W = x2 - x1, H = y2 - y1;
  if (W < 8 || H < 8) return 0;
  const colN = new Uint16Array(W), rowN = new Uint16Array(H);
  for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) if (dark[y * w + x]) { colN[x - x1]++; rowN[y - y1]++; }
  // 표의 세로선·가로선(칸을 거의 가로지르는 줄)은 빼고 센다
  const badCol = new Uint8Array(W), badRow = new Uint8Array(H);
  for (let i = 0; i < W; i++) if (colN[i] > 0.6 * H) { badCol[i] = 1; if (i > 0) badCol[i - 1] = 1; if (i < W - 1) badCol[i + 1] = 1; }
  for (let i = 0; i < H; i++) if (rowN[i] > 0.6 * W) { badRow[i] = 1; if (i > 0) badRow[i - 1] = 1; if (i < H - 1) badRow[i + 1] = 1; }
  let n = 0;
  for (let y = y1; y < y2; y++) {
    if (badRow[y - y1]) continue;
    for (let x = x1; x < x2; x++) {
      if (badCol[x - x1] || !dark[y * w + x]) continue;
      let masked = false;
      for (const m of masks) if (x >= m.x0 - 2 && x <= m.x1 + 2 && y >= m.y0 - 2 && y <= m.y1 + 2) { masked = true; break; }
      if (!masked) n++;
    }
  }
  return n / (W * H);
}

function regionRed(img, r, pad = 0) {
  const { data, width, height } = img;
  const x1 = Math.max(0, Math.round(r.x0 - pad)), x2 = Math.min(width, Math.round(r.x1 + pad));
  const y1 = Math.max(0, Math.round(r.y0 - pad)), y2 = Math.min(height, Math.round(r.y1 + pad));
  let n = 0;
  for (let y = y1; y < y2; y += 2) for (let x = x1; x < x2; x += 2) if (isRed(data, (y * width + x) * 4)) n++;
  return n * 4;
}

const TEMPLATE_TOKEN = /^\(?(인|민|언|01|21|Q1|ol|0l)\)?$|우편번호|^\(+$|^\)+$/i;

/* ---------- 쪽 종류 ---------- */
export function pageTypes(text) {
  const t = squash(text);
  const types = [];
  if (/포트폴|폴리오|포트포|교과명|담당교수/.test(t)) types.push('cover');
  if (/계획서|봉사활동계획/.test(t)) types.push('plan');
  if (/신청서|봉사활동신청자|기관정보/.test(t)) types.push('apply');
  if (/활동일지|동일지|봉사일지|\(\d{1,2}차\)|차\)지역사회봉사|활동사진/.test(t)) types.push('log');
  if (/결과보고서|과보고서|총평/.test(t)) types.push('result');
  if (/자원봉사활동확인서|봉사활동확인서|한국중앙자원봉사|1365\.go|자원봉사포[탈털]|중앙자원봉사센터/.test(t)) types.push('c1365');
  if (/실적인증서|봉사자실적내역|실적내역정보|사회복지자원봉사|vms\.or/i.test(t)) types.push('cvms');
  if (/실적확인서|교내봉사활동실적|사회봉사센터장/.test(t)) types.push('cuniv');
  if (/헌혈증서|헌혈종류|혈액원|헌혈일자/.test(t)) types.push('blood');
  // 계획서·일지·보고서 안의 「지역사회봉사」 글자와 증명서를 구별: 증명서 쪽에는 양식 쪽 종류를 붙이지 않는다
  if (types.some(x => ['c1365', 'cvms', 'cuniv'].includes(x))) return types.filter(x => !['cover', 'plan', 'apply', 'log', 'result'].includes(x) || /활동일지|계획서|신청서/.test(t) && !/실적|확인서/.test(t));
  if (types.includes('cover') && types.length > 1) return types.filter(x => x !== 'cover');
  return types;
}

/* ---------- 한 쪽 판독 ---------- */
export async function analyzePage(canvas, worker, items = []) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const g = toGray(img);
  const th = otsu(g);
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) dark[i] = g[i] < th ? 1 : 0;
  const lth = Math.min(th + 50, 225);
  const lineDark = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) lineDark[i] = g[i] < lth ? 1 : 0;

  const sharp = sharpness(g, w, h);
  const colorFrac = colorStats(img);
  const hl = findHLines(lineDark, w, h).filter(L => L.x2 - L.x1 > w * 0.3);

  const textChars = items.reduce((a, it) => a + it.text.length, 0);
  const useLayer = textChars >= 40;
  let lines, ocrConf = 99;
  if (useLayer) {
    lines = itemsToLines(items);
  } else {
    // 글자 읽기는 대비를 높인 흑백 그림으로 한다(회색 바탕 칸의 인쇄 글자도 읽히게)
    const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
    const octx = oc.getContext('2d');
    const oimg = octx.createImageData(w, h);
    const lo = Math.max(0, th - 70), hi = Math.min(255, th + 25);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
      let v = (g[i] - lo) * 255 / (hi - lo);
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      oimg.data[j] = oimg.data[j + 1] = oimg.data[j + 2] = v; oimg.data[j + 3] = 255;
    }
    // 표 선을 지워 글자 덩이로만 읽히게 한다
    const od = oimg.data;
    for (let y = 0; y < h; y++) {
      let run = 0;
      for (let x = 0; x <= w; x++) {
        const on = x < w && lineDark[y * w + x];
        if (on) run++;
        else { if (run > 60) for (let k = x - run; k < x; k++) { const j = (y * w + k) * 4; od[j] = od[j + 1] = od[j + 2] = 255; } run = 0; }
      }
    }
    for (let x = 0; x < w; x++) {
      let run = 0;
      for (let y = 0; y <= h; y++) {
        const on = y < h && lineDark[y * w + x];
        if (on) run++;
        else { if (run > 45) for (let k = y - run; k < y; k++) { const j = (k * w + x) * 4; od[j] = od[j + 1] = od[j + 2] = 255; } run = 0; }
      }
    }
    octx.putImageData(oimg, 0, 0);
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    const res = await worker.recognize(oc, {}, { blocks: true, text: true });
    lines = [];
    for (const b of res.data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) lines.push({ text: l.text, bbox: l.bbox, words: l.words });
    ocrConf = res.data.confidence;
  }
  const words = lines.flatMap(l => l.words);
  const text = lines.map(l => l.text).join('\n');
  const types = pageTypes(text);

  // 이름표 → 오른쪽 값 영역
  const labels = findLabels(lines);
  const fields = [];
  for (const L of labels) {
    const cy = (L.bb.y0 + L.bb.y1) / 2;
    const lh = Math.max(L.bb.y1 - L.bb.y0, 18);
    const rh = Math.min(Math.max(lh * 1.05, 15), 26);
    const same = labels.filter(o => o !== L && o.bb.x0 > L.bb.x1 && Math.abs((o.bb.y0 + o.bb.y1) / 2 - cy) < lh * 0.9)
      .sort((a, b) => a.bb.x0 - b.bb.x0);
    const near = hl.filter(H => Math.abs(H.y - cy) < 90 && H.x1 < L.bb.x0 + 40);
    const tableRight = near.length ? Math.max(...near.map(H => H.x2)) : w * 0.9;
    let xEnd = same.length ? same[0].bb.x0 - 12 : tableRight - 8;
    let x0 = L.bb.x1 + 14;
    // 이름표 위아래의 가로선으로 줄 높이를 잡는다(못 찾으면 글자 높이 기준)
    const [ya, yb] = rowBounds(lineDark, w, h, L.bb.x1 + 10, Math.min(w - 2, L.bb.x1 + 260), cy, rh);
    // 같은 줄 높이에서 세로선을 찾아 「이름표 칸 | 값 칸 | 다음 칸」 경계를 잡는다
    const vs = bandVerticals(lineDark, w, L.bb.x1 + 2, Math.min(w - 2, tableRight + 12), ya + 4, yb - 4);
    if (vs.length) {
      x0 = vs[0] + 7;
      if (vs.length > 1) xEnd = Math.min(xEnd + 12, vs[1]) - 7;
    }
    const r = { x0, x1: xEnd, y0: ya + 4, y1: yb - 4 };
    if (r.x1 - r.x0 < 30) continue;
    const inR = words.filter(wd => {
      const x = (wd.bbox.x0 + wd.bbox.x1) / 2, y = (wd.bbox.y0 + wd.bbox.y1) / 2;
      return x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
    });
    const masks = inR.filter(wd => TEMPLATE_TOKEN.test(clean(wd.text))).map(wd => wd.bbox);
    const valueWords = inR.filter(wd => !TEMPLATE_TOKEN.test(clean(wd.text)));
    const f = {
      label: L.name, box: r,
      ink: regionInk(dark, w, h, r, masks),
      text: valueWords.map(x => x.text).join(' '),
      conf: valueWords.length ? valueWords.reduce((a, x) => a + x.confidence, 0) / valueWords.length : 0,
    };
    if (SIGN_LABELS.has(L.name)) {
      // 「(인)」은 칸 오른쪽 끝에 인쇄되어 있으므로 그 부분을 빼고 서명을 찾는다
      const rs = { ...r, x1: Math.max(r.x0 + 20, r.x1 - 75) };
      f.inkSign = regionInk(dark, w, h, rs, masks);
      f.red = regionRed(img, r, 25);
    }
    fields.push(f);
  }

  // 긴 글 칸(활동 내용, 총평)
  const contents = [];
  const findWord = re => lines.find(l => re.test(clean(l.text)));
  const addContent = (name, titleRe, stopRe, maxH) => {
    const T = findWord(titleRe);
    if (!T) return;
    const S = stopRe ? lines.find(l => l.bbox.y0 > T.bbox.y1 + 40 && stopRe.test(clean(l.text))) : null;
    const r = { x0: w * 0.17, x1: w * 0.83, y0: T.bbox.y1 + 14, y1: S ? S.bbox.y0 - 14 : Math.min(h - 10, T.bbox.y1 + maxH) };
    contents.push({ label: name, box: r, ink: regionInk(dark, w, h, r) });
  };
  if (types.includes('log')) addContent('세부 봉사활동 내용', /세부봉사활동내용|봉사활동내용$/, /활동사진|동사진/, 300);
  if (types.includes('result')) addContent('총평', /^총평$|^총$|총평/, null, 220);

  return { w, h, text, conf: ocrConf, layer: useLayer, sharp, colorFrac, types, fields, contents, hl: hl.length };
}

/* ---------- PDF 전체 ---------- */
// 쪽을 그림으로 그리고, 글자 층(한글 파일에서 바로 만든 PDF 등)이 있으면 그 글자와 위치도 가져온다
export async function renderPage(pdf, n, Util) {
  const page = await pdf.getPage(n);
  const v = page.getViewport({ scale: 1 });
  const scale = RENDER_WIDTH / v.width;
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  let items = [];
  try {
    const tc = await page.getTextContent();
    items = tc.items.filter(it => it.str && it.str.trim()).map(it => {
      const t = Util.transform(vp.transform, it.transform);
      const fh = Math.hypot(t[2], t[3]) || 12;
      const x = t[4], y = t[5];
      return { text: it.str.trim(), confidence: 99, bbox: { x0: x, y0: y - fh, x1: x + it.width * scale, y1: y + fh * 0.15 } };
    });
  } catch (e) { items = []; }
  return { canvas: c, items };
}

// 글자 층 낱말을 줄로 묶는다
function itemsToLines(items) {
  const sorted = [...items].sort((a, b) => (a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2);
  const lines = [];
  for (const it of sorted) {
    const cy = (it.bbox.y0 + it.bbox.y1) / 2, hh = it.bbox.y1 - it.bbox.y0;
    let L = lines.find(l => Math.abs(l.cy - cy) < Math.max(6, hh * 0.45));
    if (!L) { L = { cy, words: [] }; lines.push(L); }
    L.words.push(it);
  }
  for (const L of lines) {
    L.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    // 「연 락 처」처럼 한 글자씩 떨어진 글자 층도 낱말 단위로 다룬다
    const split = [];
    for (const wd of L.words) {
      if (/\s/.test(wd.text) && wd.text.length <= 12) {
        const parts = wd.text.split(/\s+/); const step = (wd.bbox.x1 - wd.bbox.x0) / wd.text.length;
        let off = 0;
        for (const ptxt of parts) { const i = wd.text.indexOf(ptxt, off); split.push({ ...wd, text: ptxt, bbox: { ...wd.bbox, x0: wd.bbox.x0 + i * step, x1: wd.bbox.x0 + (i + ptxt.length) * step } }); off = i + ptxt.length; }
      } else split.push(wd);
    }
    L.words = split;
    L.text = split.map(x => x.text).join(' ');
    L.bbox = { x0: Math.min(...split.map(x => x.bbox.x0)), y0: Math.min(...split.map(x => x.bbox.y0)), x1: Math.max(...split.map(x => x.bbox.x1)), y1: Math.max(...split.map(x => x.bbox.y1)) };
  }
  return lines;
}

export async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
