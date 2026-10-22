// PDF 한 개를 받아 쪽마다 판독하고 규칙으로 판정한다. 파일은 기기 밖으로 나가지 않는다.
import * as pdfjs from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
import { analyzePage, renderPage, sha256, ENGINE_VERSION } from './engine.js';
import { evaluate, RULES_VERSION } from './rules.js';

pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

let workerPromise = null;
export function getWorker() {
  if (!workerPromise) {
    // 글자 읽기 도구와 한국어·영어 학습 자료는 jsDelivr에서 받는다(브라우저가 저장해 두므로 두 번째부터 빠르다)
    workerPromise = window.Tesseract.createWorker(['kor', 'eng'], 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/',
    });
  }
  return workerPromise;
}

export const MAX_PAGES = 40;

export async function checkPdf(file, onProgress = () => {}) {
  const buf = await file.arrayBuffer();
  const hash = await sha256(buf);
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  } catch (e) {
    throw new Error('PDF 파일을 열 수 없습니다. 암호가 걸렸거나 손상된 파일인지 확인해 주세요.');
  }
  const n = Math.min(pdf.numPages, MAX_PAGES);
  onProgress({ stage: 'load', done: 0, total: n });
  const worker = await getWorker();
  const pages = [];
  for (let i = 1; i <= n; i++) {
    onProgress({ stage: 'page', done: i - 1, total: n });
    const { canvas, items } = await renderPage(pdf, i, pdfjs.Util);
    const a = await analyzePage(canvas, worker, items);
    a.n = i;
    pages.push(a);
    canvas.width = canvas.height = 1; // 메모리 정리
  }
  onProgress({ stage: 'rules', done: n, total: n });
  const result = evaluate({ pages });
  result.pageCount = pdf.numPages;
  result.truncated = pdf.numPages > MAX_PAGES;
  result.hash = hash;
  result.versions = { engine: ENGINE_VERSION, rules: RULES_VERSION };
  result.pageTypes = pages.map(p => p.types);
  await pdf.destroy();
  return result;
}
