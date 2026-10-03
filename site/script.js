const graphic = document.querySelector('#story-graphic');
const kicker = document.querySelector('#graphic-kicker');
const mainText = document.querySelector('#graphic-main');
const detail = document.querySelector('#graphic-detail');
const count = document.querySelector('#step-count');
const steps = [...document.querySelectorAll('.story-step')];

const maskedCards = [...document.querySelectorAll('.unified-feed .experience-card-filtered')];

function showMask(card) {
  if (!card.classList.contains('experience-card-filtered') || card.classList.contains('is-mask-visible')) return;
  const overlay = card.querySelector('.rnb-overlay');
  if (!overlay) return;
  overlay.inert = false;
  overlay.setAttribute('aria-hidden', 'false');
  card.classList.add('is-mask-visible');
}

maskedCards.forEach((card) => {
  const overlay = card.querySelector('.rnb-overlay');
  if (overlay) {
    overlay.inert = true;
    overlay.setAttribute('aria-hidden', 'true');
  }
});

if ('IntersectionObserver' in window) {
  const maskObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const card = entry.target.closest('.experience-card-filtered');
      if (!card) continue;
      showMask(card);
      maskObserver.unobserve(entry.target);
    }
  }, { rootMargin: '-35% 0px -35% 0px', threshold: 0 });
  maskedCards.forEach((card) => maskObserver.observe(card.querySelector('.experience-cover') ?? card));
} else {
  maskedCards.forEach(showMask);
}

document.querySelectorAll('.unified-feed .rnb-reveal').forEach((button) => {
  button.addEventListener('click', () => {
    const card = button.closest('.experience-card-filtered');
    if (!card) return;
    card.querySelector('.rnb-overlay')?.remove();
    card.classList.remove('experience-card-filtered', 'is-mask-visible');
  });
});
const phases = [
  { phase: 'cover', kicker: '封面文字 / OCR', main: '封面上真正写着什么？', detail: '只识别封面，图片留在本地处理。' },
  { phase: 'body', kicker: '标题 + 可用正文', main: '短于 20 字，才补正文。', detail: '标题与封面文字合计不超过 20 字时才尝试补取。' },
  { phase: 'jev', kicker: '一次 Jev 判断', main: '推广、情绪 × 信息价值', detail: '文字发往 Jev；原始输入输出可在面板查看。' },
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
const chapterIds = ['top', 'demo', 'why', 'how', 'features', 'privacy', 'install'];

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
