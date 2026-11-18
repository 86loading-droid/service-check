// 학생 화면과 교수 화면이 함께 쓰는 머리말·입장 구분·언어 단추·판 번호
import { APP_VERSION } from './config.js';

const SHELL = {
  ko: {
    h1: '지역사회봉사 최종보고서 점검',
    lede: '제출하기 전에 빈칸, 기관 날인, 20시간 증빙을 확인합니다.',
    term: '위덕대학교 · 지역사회봉사',
    skip: '본문으로 건너뛰기',
    roles: '입장 구분', roleStudent: '학생 점검', roleProf: '교수 현황',
    ver: v => `점검 프로그램 v${v}`,
  },
  vi: {
    h1: 'Kiểm tra báo cáo cuối kỳ hoạt động tình nguyện cộng đồng',
    lede: 'Trước khi nộp, hãy kiểm tra ô trống, dấu của cơ quan và giấy chứng nhận 20 giờ.',
    term: 'Đại học Uiduk · Tình nguyện cộng đồng',
    skip: 'Chuyển đến nội dung chính',
    roles: 'Chọn người dùng', roleStudent: 'Sinh viên tự kiểm tra', roleProf: 'Giảng viên',
    ver: v => `Chương trình kiểm tra v${v}`,
  },
};

const pref = {
  get() { try { return localStorage.getItem('svc-lang'); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem('svc-lang', v); } catch (e) { /* 저장이 안 되는 환경 */ } },
};
const urlLang = new URLSearchParams(location.search).get('lang');
let lang = (urlLang === 'vi' || urlLang === 'ko') ? urlLang : (pref.get() === 'vi' ? 'vi' : 'ko');
const subs = [];

export const getLang = () => lang;
export function onLang(fn) { subs.push(fn); }

function applyShell() {
  const t = SHELL[lang];
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-s]').forEach(el => { const v = t[el.dataset.s]; if (typeof v === 'string') el.textContent = v; });
  document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  const nav = document.querySelector('.roles');
  if (nav) nav.setAttribute('aria-label', t.roles);
  // 입장 구분 링크는 고른 언어를 그대로 가져간다
  document.querySelectorAll('.roles a').forEach(a => {
    const base = a.dataset.href;
    a.href = lang === 'vi' ? `${base}?lang=vi` : base;
  });
  const ver = document.getElementById('app-ver');
  if (ver) ver.textContent = t.ver(APP_VERSION);
}

export function setLang(v) {
  lang = v; pref.set(v); applyShell();
  for (const fn of subs) fn(lang);
}

document.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
applyShell();
