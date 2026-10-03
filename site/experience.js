const cards = [...document.querySelectorAll('.experience-card')];
const startButton = document.querySelector('#start-experience');
const resetButton = document.querySelector('#reset-experience');
const restartButton = document.querySelector('#restart-bottom');
const feedState = document.querySelector('#feed-state');
const seenCount = document.querySelector('#seen-count');
const maskCount = document.querySelector('#mask-count');
const recordTitle = document.querySelector('#record-title');
const recordOcr = document.querySelector('#record-ocr');
const recordInput = document.querySelector('#record-input');
const recordResult = document.querySelector('#record-result');
const panel = document.querySelector('.experience-panel');
const timers = new Set();
let running = false;
let completed = 0;
let masked = 0;

function showRecord(card, focus = false) {
  recordTitle.textContent = card.dataset.title;
  recordOcr.textContent = card.dataset.ocr;
  recordInput.textContent = `标题：${card.dataset.title}\n封面文字：${card.dataset.ocr}`;
  recordResult.textContent = `${card.dataset.result}。${card.dataset.reason}`;
  if (focus && matchMedia('(max-width: 860px)').matches) {
    panel.classList.add('record-open');
    panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
}

function finishCard(card) {
  if (!running || card.dataset.state !== 'scanning') return;
  card.dataset.state = 'complete';
  completed += 1;
  seenCount.textContent = String(completed);
  const inspect = card.querySelector('.inspect-button');
  inspect.disabled = false;
  inspect.textContent = '查看记录 ↗';
  if (card.dataset.result === '弱化') {
    masked += 1;
    maskCount.textContent = String(masked);
    const mask = card.querySelector('.experience-mask');
    mask.hidden = false;
    const title = document.createElement('strong');
    title.textContent = '内容已弱化';
    const note = document.createElement('span');
    note.textContent = '随时可以查看原图';
    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.textContent = '查看原图';
    reveal.addEventListener('click', () => {
      const revealed = card.classList.toggle('is-revealed');
      reveal.textContent = revealed ? '重新显示遮罩' : '查看原图';
      reveal.setAttribute('aria-pressed', String(revealed));
    });
    mask.append(title, note, reveal);
  }
  showRecord(card);
  feedState.textContent = `已识别 ${completed} / ${cards.length} 篇`;
}

function queueCard(card) {
  if (!running || card.dataset.state) return;
  card.dataset.state = 'scanning';
  card.querySelector('.inspect-button').textContent = '识别中…';
  const timer = window.setTimeout(() => {
    timers.delete(timer);
    finishCard(card);
  }, 380 + (cards.indexOf(card) % 3) * 170);
  timers.add(timer);
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) queueCard(entry.target);
  });
}, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
cards.forEach((card) => observer.observe(card));

function startExperience() {
  running = true;
  startButton.textContent = '体验进行中 ✓';
  startButton.disabled = true;
  feedState.textContent = '向下滚动，继续识别';
  document.querySelector('#feed').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  cards.forEach((card) => {
    const rect = card.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < innerHeight) queueCard(card);
  });
}

function resetExperience(scrollTop = false) {
  timers.forEach((timer) => window.clearTimeout(timer));
  timers.clear();
  running = false;
  completed = 0;
  masked = 0;
  seenCount.textContent = '0';
  maskCount.textContent = '0';
  feedState.textContent = '等待开始';
  startButton.disabled = false;
  startButton.innerHTML = '开始体验 <span aria-hidden="true">↘</span>';
  recordTitle.textContent = '还没有开始';
  recordOcr.textContent = '滚动后显示';
  recordInput.textContent = '—';
  recordResult.textContent = '—';
  panel.classList.remove('record-open');
  cards.forEach((card) => {
    delete card.dataset.state;
    card.classList.remove('is-revealed');
    const mask = card.querySelector('.experience-mask');
    mask.replaceChildren();
    mask.hidden = true;
    const inspect = card.querySelector('.inspect-button');
    inspect.disabled = true;
    inspect.textContent = '尚未识别';
  });
  if (scrollTop) window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

startButton.addEventListener('click', startExperience);
resetButton.addEventListener('click', () => resetExperience());
restartButton.addEventListener('click', () => resetExperience(true));
cards.forEach((card) => card.querySelector('.inspect-button').addEventListener('click', () => showRecord(card, true)));
