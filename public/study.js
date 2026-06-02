const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

const PAGE_SIZE = 10;
const FAVORITE_TYPE_KO = {
  word: '단어',
  kanji: '한자',
  sentence: '문장'
};
const PROVIDER_LABELS = {
  cache: '서버 저장값',
  openai: 'AI 사용',
  'local-template': '로컬 예문'
};

const statsOutput = document.querySelector('#stats-output');
const quizStartButton = document.querySelector('#quiz-start-button');
const quizBox = document.querySelector('#quiz-box');
const favoriteSentenceButton = document.querySelector('#favorite-sentence-button');
const exampleTerm = document.querySelector('#example-term');
const exampleButton = document.querySelector('#example-button');
const exampleOutput = document.querySelector('#example-output');

const listConfig = {
  vocabulary: {
    element: document.querySelector('#vocabulary-list'),
    empty: '저장된 단어가 없습니다.'
  },
  favorites: {
    element: document.querySelector('#favorite-list'),
    empty: '즐겨찾기가 없습니다.'
  },
  history: {
    element: document.querySelector('#history-list'),
    empty: '아직 검색 기록이 없습니다.'
  },
  wrongNotes: {
    element: document.querySelector('#wrong-note-list'),
    empty: '아직 오답이 없습니다.'
  }
};

const pageState = {
  vocabulary: 1,
  favorites: 1,
  history: 1,
  wrongNotes: 1
};

let dashboard = {
  vocabulary: [],
  favorites: [],
  history: [],
  wrongNotes: [],
  stats: {}
};
let currentQuiz = null;

function emptyText(message) {
  const text = document.createElement('p');
  text.className = 'empty-text';
  text.textContent = message;
  return text;
}

function setStatus(element, message) {
  element.replaceChildren(emptyText(message));
}

async function apiPost(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '요청을 처리하지 못했습니다.');
  }
  return {
    data,
    cacheHeader: response.headers.get('x-learning-cache') || ''
  };
}

async function apiDelete(url) {
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'x-csrf-token': csrfToken
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '요청을 처리하지 못했습니다.');
  }
  return data;
}

function renderStats(stats) {
  statsOutput.replaceChildren();
  for (const item of [
    ['오늘 분석', stats.today_history || 0],
    ['단어장', stats.vocabulary_count || 0],
    ['즐겨찾기', stats.favorite_count || 0],
    ['오답', stats.wrong_count || 0],
    ['퀴즈 정답률', `${stats.quiz_accuracy || 0}%`]
  ]) {
    const chip = document.createElement('span');
    chip.append(document.createTextNode(`${item[0]} `));
    const value = document.createElement('strong');
    value.textContent = item[1];
    chip.append(value);
    statsOutput.append(chip);
  }
}

function createMiniItem(...children) {
  const row = document.createElement('div');
  row.className = 'mini-item';
  row.append(...children);
  return row;
}

function createText(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function renderVocabularyItem(item) {
  const term = createText('strong', item.term);
  const reading = createText('span', item.reading || '-');
  const meaning = createText('small', item.meaning || '-');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'small-button';
  remove.textContent = '삭제';
  remove.addEventListener('click', async () => {
    await apiDelete(`/api/vocabulary/${item.id}`);
    await refreshDashboard();
  });
  return createMiniItem(term, reading, meaning, remove);
}

function renderFavoriteItem(item) {
  const text = createText('strong', item.item_text);
  const type = createText('span', FAVORITE_TYPE_KO[item.item_type] || item.item_type);
  const note = createText('small', item.note || '');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'small-button';
  remove.textContent = '삭제';
  remove.addEventListener('click', async () => {
    await apiDelete(`/api/favorites/${item.id}`);
    await refreshDashboard();
  });
  return createMiniItem(text, type, note, remove);
}

function renderHistoryItem(item) {
  const source = createText('strong', item.source_text);
  const translation = createText('span', item.translation_text || '');
  const open = document.createElement('a');
  open.className = 'small-button';
  open.href = `/app?text=${encodeURIComponent(item.source_text)}`;
  open.textContent = '분석';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'small-button';
  remove.textContent = '삭제';
  remove.addEventListener('click', async () => {
    await apiDelete(`/api/history/${item.id}`);
    await refreshDashboard();
  });
  return createMiniItem(source, translation, open, remove);
}

function renderWrongNoteItem(item) {
  const term = createText('strong', item.term);
  const correct = createText('span', `정답: ${item.correct_answer || '-'}`);
  const submitted = createText('small', `입력: ${item.submitted_answer || '-'}`);
  return createMiniItem(term, correct, submitted);
}

function renderItem(key, item) {
  if (key === 'vocabulary') {
    return renderVocabularyItem(item);
  }
  if (key === 'favorites') {
    return renderFavoriteItem(item);
  }
  if (key === 'history') {
    return renderHistoryItem(item);
  }
  return renderWrongNoteItem(item);
}

function clampPage(key, pageCount) {
  pageState[key] = Math.min(Math.max(pageState[key], 1), pageCount || 1);
}

function renderPagedList(key) {
  const config = listConfig[key];
  const items = dashboard[key] || [];
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  clampPage(key, pageCount);
  const currentPage = pageState[key];
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = items.slice(start, start + PAGE_SIZE);

  config.element.replaceChildren();
  if (!visible.length) {
    config.element.append(emptyText(config.empty));
  } else {
    visible.forEach((item) => config.element.append(renderItem(key, item)));
  }

  const label = document.querySelector(`[data-page-label="${key}"]`);
  const count = document.querySelector(`[data-count-for="${key}"]`);
  const prev = document.querySelector(`[data-page-prev="${key}"]`);
  const next = document.querySelector(`[data-page-next="${key}"]`);
  label.textContent = `${currentPage} / ${pageCount}`;
  count.textContent = `${items.length}개`;
  prev.disabled = currentPage <= 1;
  next.disabled = currentPage >= pageCount;
}

function renderDashboard() {
  renderStats(dashboard.stats || {});
  Object.keys(listConfig).forEach(renderPagedList);
}

async function refreshDashboard() {
  const response = await fetch('/api/dashboard');
  if (!response.ok) {
    return;
  }
  dashboard = await response.json();
  renderDashboard();
}

async function startQuickQuiz() {
  try {
    const response = await fetch('/api/quiz');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || '퀴즈를 만들 수 없습니다.');
    }
    currentQuiz = data;
    quizBox.replaceChildren();
    const prompt = createText('p', data.prompt);
    const row = document.createElement('div');
    row.className = 'quiz-row';
    const input = document.createElement('input');
    input.id = 'quiz-answer';
    input.placeholder = '정답 입력';
    const submit = document.createElement('button');
    submit.className = 'small-button';
    submit.type = 'button';
    submit.textContent = '채점';
    const result = document.createElement('div');
    result.id = 'quiz-result';
    result.className = 'muted';
    row.append(input, submit);
    quizBox.append(prompt, row, result);
    submit.addEventListener('click', submitQuickQuiz);
  } catch (error) {
    setStatus(quizBox, error.message);
  }
}

async function submitQuickQuiz() {
  const answer = document.querySelector('#quiz-answer')?.value || '';
  const { data } = await apiPost('/api/quiz', {
    vocabularyId: currentQuiz.vocabularyId,
    answer
  });
  const target = document.querySelector('#quiz-result');
  target.textContent = data.isCorrect ? '정답입니다.' : `오답입니다. 정답: ${data.correctAnswer}`;
  await refreshDashboard();
}

async function favoriteLatestSentence() {
  const latest = dashboard.history[0];
  if (!latest) {
    setStatus(quizBox, '즐겨찾기할 최근 분석 문장이 없습니다.');
    return;
  }
  await apiPost('/api/favorites', {
    itemType: 'sentence',
    itemText: latest.source_text,
    note: latest.translation_text || ''
  });
  await refreshDashboard();
}

function providerClass(provider, cacheHeader = '') {
  if (cacheHeader || provider === 'cache') {
    return 'provider-cache';
  }
  if (provider === 'openai') {
    return 'provider-ai';
  }
  return 'provider-local';
}

async function generateExample() {
  const term = exampleTerm.value.trim() || dashboard.vocabulary.find((item) => item.meaning)?.term || '';
  if (!term) {
    setStatus(exampleOutput, '예문을 만들 단어를 입력해 주세요.');
    return;
  }
  setStatus(exampleOutput, '예문 생성 중');
  try {
    const { data, cacheHeader } = await apiPost('/api/examples', { term });
    exampleOutput.replaceChildren();
    const status = document.createElement('div');
    status.className = `mini-status ${providerClass(data.provider, cacheHeader)}`;
    status.textContent = PROVIDER_LABELS[cacheHeader ? 'cache' : data.provider] || data.note || '예문';
    exampleOutput.append(status);
    for (const example of data.examples) {
      exampleOutput.append(createMiniItem(
        createText('strong', example.japanese || String(example)),
        createText('span', example.korean || '')
      ));
    }
  } catch (error) {
    setStatus(exampleOutput, error.message);
  }
}

Object.keys(listConfig).forEach((key) => {
  document.querySelector(`[data-page-prev="${key}"]`).addEventListener('click', () => {
    pageState[key] -= 1;
    renderPagedList(key);
  });
  document.querySelector(`[data-page-next="${key}"]`).addEventListener('click', () => {
    pageState[key] += 1;
    renderPagedList(key);
  });
});

favoriteSentenceButton.addEventListener('click', favoriteLatestSentence);
quizStartButton.addEventListener('click', startQuickQuiz);
exampleButton.addEventListener('click', generateExample);
exampleTerm.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    generateExample();
  }
});

renderDashboard();
refreshDashboard();
