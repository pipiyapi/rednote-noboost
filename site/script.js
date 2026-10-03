const card = document.querySelector('#demo-card');
const revealButton = document.querySelector('#reveal-demo');

revealButton?.addEventListener('click', () => {
  const revealed = card.classList.toggle('is-revealed');
  revealButton.textContent = revealed ? '重新显示遮罩' : '查看原内容';
  revealButton.setAttribute('aria-pressed', String(revealed));
});

const graphic = document.querySelector('#story-graphic');
const kicker = document.querySelector('#graphic-kicker');
const mainText = document.querySelector('#graphic-main');
const detail = document.querySelector('#graphic-detail');
const count = document.querySelector('#step-count');
const steps = [...document.querySelectorAll('.story-step')];
const phases = [
  { phase: 'cover', kicker: '封面文字 / OCR', main: '封面上真正写着什么？', detail: '只识别封面，图片留在本地处理。' },
  { phase: 'body', kicker: '标题 + 可用正文', main: '材料能拿到多少，就记录多少。', detail: '正文缺失会标明，不会伪装成空白内容。' },
  { phase: 'jev', kicker: '一次 Jev 判断', main: '商业意图 × 信息价值', detail: '文字发往 Jev；原始输入输出可在面板查看。' },
  { phase: 'decision', kicker: '保守且可逆', main: '明确命中，才会模糊。', detail: '依据不足、失败或用户主动查看时，内容保持可见。' },
];

function setPhase(index) {
  const phase = phases[index];
  if (!phase) return;
  graphic.dataset.phase = phase.phase;
  kicker.textContent = phase.kicker;
  mainText.textContent = phase.main;
  detail.textContent = phase.detail;
  count.textContent = `${String(index + 1).padStart(2, '0')} / 04`;
  steps.forEach((step, stepIndex) => step.classList.toggle('active', stepIndex === index));
}

if ('IntersectionObserver' in window) {
  const stepObserver = new IntersectionObserver((entries) => {
    const candidate = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (candidate) setPhase(Number(candidate.target.dataset.step));
  }, { rootMargin: '-38% 0px -38% 0px', threshold: [0, .1, .3, .6] });
  steps.forEach((step) => stepObserver.observe(step));
}

const modeButton = document.querySelector('#present-toggle');
const modeHint = document.querySelector('#presentation-hint');
const chapterIds = ['top', 'why', 'how', 'features', 'privacy', 'install'];

function setPresentationMode(enabled) {
  document.documentElement.classList.toggle('presentation', enabled);
  modeButton.setAttribute('aria-pressed', String(enabled));
  modeButton.innerHTML = enabled ? '退出展示模式 <span aria-hidden="true">↗</span>' : '展示模式 <span aria-hidden="true">↗</span>';
  modeHint.hidden = !enabled;
  const url = new URL(location.href);
  if (enabled) url.searchParams.set('present', '1');
  else url.searchParams.delete('present');
  history.replaceState(null, '', url);
}

setPresentationMode(new URLSearchParams(location.search).get('present') === '1');
modeButton?.addEventListener('click', () => setPresentationMode(!document.documentElement.classList.contains('presentation')));

document.addEventListener('keydown', (event) => {
  if (!document.documentElement.classList.contains('presentation')) return;
  if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) return;
  if (event.target instanceof HTMLElement && event.target.closest('button, a, input, textarea, select')) return;
  const chapters = chapterIds.map((id) => document.getElementById(id));
  const current = chapters.reduce((closest, chapter, index) => Math.abs(chapter.getBoundingClientRect().top - 68) < Math.abs(chapters[closest].getBoundingClientRect().top - 68) ? index : closest, 0);
  const next = Math.max(0, Math.min(chapters.length - 1, current + (event.key.endsWith('Down') ? 1 : -1)));
  if (next === current) return;
  event.preventDefault();
  chapters[next].scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
});
