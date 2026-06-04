const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

const form = document.querySelector('#analysis-form');
const sourceText = document.querySelector('#source-text');
const charCount = document.querySelector('#char-count');
const clearButton = document.querySelector('#clear-button');
const pasteButton = document.querySelector('#paste-button');
const translationOutput = document.querySelector('#translation-output');
const providerNote = document.querySelector('#provider-note');
const furiganaOutput = document.querySelector('#furigana-output');
const wordOutput = document.querySelector('#word-output');
const kanjiList = document.querySelector('#kanji-list');
const kanjiDetail = document.querySelector('#kanji-detail');
const voiceButton = document.querySelector('#voice-button');
const speakButton = document.querySelector('#speak-button');
const ocrFile = document.querySelector('#ocr-file');
const cameraFile = document.querySelector('#camera-file');
const ocrStatus = document.querySelector('#ocr-status');
const kanaInput = document.querySelector('#kana-input');
const kanaButton = document.querySelector('#kana-button');
const kanaOutput = document.querySelector('#kana-output');
const kanjiSearchInput = document.querySelector('#kanji-search-input');
const kanjiSearchButton = document.querySelector('#kanji-search-button');
const koJaInput = document.querySelector('#ko-ja-input');
const koJaButton = document.querySelector('#ko-ja-button');
const koJaUseButton = document.querySelector('#ko-ja-use-button');
const koJaOutput = document.querySelector('#ko-ja-output');
const quickHistoryList = document.querySelector('#quick-history-list');
const quickHistoryCount = document.querySelector('#quick-history-count');
const difficultyOutput = document.querySelector('#difficulty-output');
const structureOutput = document.querySelector('#structure-output');
const particleOutput = document.querySelector('#particle-output');
const katakanaOutput = document.querySelector('#katakana-output');
const WORD_PAGE_SIZE = 20;
const KANJI_PAGE_SIZE = 24;

let lastKanji = [];
let lastResult = null;
let lastKoJaTranslation = '';
let wordPage = 1;
let kanjiPage = 1;
const PROVIDER_LABELS = {
  cache: '서버 저장값',
  'local-exact': '로컬 예문',
  'local-gloss': '로컬 단어',
  openai: 'AI 사용',
  libretranslate: '외부 번역',
  'local-unavailable': '번역 불가',
  idle: '대기 중',
  loading: '분석 중',
  error: '오류'
};

function setText(element, text) {
  element.textContent = text;
}

function providerClass(provider, cacheHeader = '') {
  if (cacheHeader || provider === 'cache') {
    return 'provider-cache';
  }
  if (provider === 'openai') {
    return 'provider-ai';
  }
  if (provider === 'libretranslate') {
    return 'provider-external';
  }
  if (provider === 'error' || provider === 'local-unavailable') {
    return 'provider-error';
  }
  if (provider === 'loading') {
    return 'provider-loading';
  }
  if (provider?.startsWith('local-')) {
    return 'provider-local';
  }
  return 'provider-idle';
}

function setProviderStatus(note, provider = 'idle', cacheHeader = '') {
  providerNote.className = `provider-badge ${providerClass(provider, cacheHeader)}`;
  providerNote.textContent = PROVIDER_LABELS[cacheHeader ? 'cache' : provider] || note || '대기 중';
  providerNote.title = note || '';
}

function setLoading(isLoading) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = isLoading;
  button.textContent = isLoading ? '분석 중' : '번역·분석';
}

function updateCount() {
  setText(charCount, `${sourceText.value.length} / ${sourceText.maxLength}`);
}

function resetResults() {
  translationOutput.classList.add('placeholder');
  setText(translationOutput, '분석 결과가 여기에 표시됩니다.');
  setProviderStatus('대기 중', 'idle');
  furiganaOutput.replaceChildren();
  wordOutput.replaceChildren(emptyRow('아직 분석된 단어가 없습니다.'));
  kanjiList.replaceChildren(emptyChip('한자가 추출되면 여기에 표시됩니다.'));
  kanjiDetail.replaceChildren(emptyText('한자를 선택하면 뜻, 음독, 훈독, 예시 단어를 볼 수 있습니다.'));
  difficultyOutput.replaceChildren();
  structureOutput.replaceChildren();
  particleOutput.replaceChildren(emptyChip('조사 설명이 여기에 표시됩니다.'));
  katakanaOutput.replaceChildren();
  lastKanji = [];
  lastResult = null;
  wordPage = 1;
  kanjiPage = 1;
  document.querySelector('#word-pagination')?.replaceChildren();
  document.querySelector('#kanji-pagination')?.replaceChildren();
}

function emptyRow(message) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 7;
  cell.className = 'empty-cell';
  cell.textContent = message;
  row.append(cell);
  return row;
}

function emptyChip(message) {
  const chip = document.createElement('span');
  chip.className = 'empty-chip';
  chip.textContent = message;
  return chip;
}

function emptyText(message) {
  const text = document.createElement('p');
  text.className = 'empty-text';
  text.textContent = message;
  return text;
}

function createText(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function getSectionFooter(anchor, id) {
  const section = anchor.closest('.analysis-section');
  if (!section) {
    return null;
  }
  let footer = section.querySelector(`#${id}`);
  if (!footer) {
    footer = document.createElement('div');
    footer.id = id;
    footer.className = 'result-footer';
    section.append(footer);
  }
  return footer;
}

function renderPager({ anchor, id, total, page, pageSize, onChange }) {
  const footer = getSectionFooter(anchor, id);
  if (!footer) {
    return;
  }

  footer.replaceChildren();
  if (total <= pageSize) {
    return;
  }

  const pageCount = Math.ceil(total / pageSize);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const count = document.createElement('span');
  count.className = 'result-count';
  count.textContent = `${from}-${to} / ${total}개`;

  const previousButton = document.createElement('button');
  previousButton.type = 'button';
  previousButton.className = 'small-button';
  previousButton.textContent = '이전';
  previousButton.disabled = page <= 1;
  previousButton.addEventListener('click', () => onChange(page - 1));

  const label = document.createElement('span');
  label.className = 'page-label';
  label.textContent = `${page} / ${pageCount}`;

  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'small-button';
  nextButton.textContent = '다음';
  nextButton.disabled = page >= pageCount;
  nextButton.addEventListener('click', () => onChange(page + 1));

  footer.append(count, previousButton, label, nextButton);
}

function renderFurigana(items) {
  furiganaOutput.replaceChildren();
  for (const item of items) {
    if (item.reading) {
      const ruby = document.createElement('ruby');
      ruby.textContent = item.text;
      const rt = document.createElement('rt');
      rt.textContent = item.reading;
      ruby.append(rt);
      furiganaOutput.append(ruby);
    } else {
      furiganaOutput.append(document.createTextNode(item.text));
    }
  }
}

function renderWords(words) {
  wordOutput.replaceChildren();
  if (!words.length) {
    wordOutput.append(emptyRow('분리된 단어가 없습니다.'));
    renderPager({
      anchor: wordOutput,
      id: 'word-pagination',
      total: 0,
      page: 1,
      pageSize: WORD_PAGE_SIZE,
      onChange: () => {}
    });
    return;
  }

  const pageCount = Math.ceil(words.length / WORD_PAGE_SIZE);
  wordPage = Math.min(Math.max(wordPage, 1), pageCount);
  const start = (wordPage - 1) * WORD_PAGE_SIZE;
  const visibleWords = words.slice(start, start + WORD_PAGE_SIZE);

  for (const word of visibleWords) {
    const row = document.createElement('tr');
    const isSymbol = word.pos === '記号' || word.posKo === '기호';
    const values = [
      word.surface,
      word.reading || '-',
      word.meaning || (isSymbol ? '-' : '뜻 보강 필요'),
      word.jlpt || '-',
      word.posKo,
      word.base || '-'
    ];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 2 && !word.meaning && !isSymbol) {
        cell.className = 'meaning-missing';
      }
      row.append(cell);
    });
    const actionCell = document.createElement('td');
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'small-button';
    saveButton.textContent = '저장';
    saveButton.addEventListener('click', () => saveVocabulary(word, saveButton));
    actionCell.append(saveButton);
    row.append(actionCell);
    wordOutput.append(row);
  }

  renderPager({
    anchor: wordOutput,
    id: 'word-pagination',
    total: words.length,
    page: wordPage,
    pageSize: WORD_PAGE_SIZE,
    onChange: (nextPage) => {
      wordPage = nextPage;
      renderWords(words);
    }
  });
}

function renderKanjiList(kanji) {
  lastKanji = kanji;
  kanjiList.replaceChildren();
  if (!kanji.length) {
    kanjiList.append(emptyChip('이 문장에는 추출된 한자가 없습니다.'));
    kanjiDetail.replaceChildren(emptyText('한자를 선택하면 뜻, 음독, 훈독, 예시 단어를 볼 수 있습니다.'));
    renderPager({
      anchor: kanjiList,
      id: 'kanji-pagination',
      total: 0,
      page: 1,
      pageSize: KANJI_PAGE_SIZE,
      onChange: () => {}
    });
    return;
  }

  const pageCount = Math.ceil(kanji.length / KANJI_PAGE_SIZE);
  kanjiPage = Math.min(Math.max(kanjiPage, 1), pageCount);
  const start = (kanjiPage - 1) * KANJI_PAGE_SIZE;
  const visibleKanji = kanji.slice(start, start + KANJI_PAGE_SIZE);

  visibleKanji.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kanji-chip';
    button.textContent = item.char;
    button.dataset.index = String(start + index);
    button.addEventListener('click', () => {
      kanjiList.querySelectorAll('.kanji-chip').forEach((chip) => chip.classList.remove('active'));
      button.classList.add('active');
      renderKanjiDetail(item);
    });
    kanjiList.append(button);
  });

  const first = kanjiList.querySelector('.kanji-chip');
  first.classList.add('active');
  renderKanjiDetail(visibleKanji[0]);

  renderPager({
    anchor: kanjiList,
    id: 'kanji-pagination',
    total: kanji.length,
    page: kanjiPage,
    pageSize: KANJI_PAGE_SIZE,
    onChange: (nextPage) => {
      kanjiPage = nextPage;
      renderKanjiList(lastKanji);
    }
  });
}

function addDetailLine(parent, label, value) {
  const row = document.createElement('div');
  row.className = 'detail-line';
  const key = document.createElement('span');
  key.textContent = label;
  const text = document.createElement('strong');
  text.textContent = value || '-';
  row.append(key, text);
  parent.append(row);
}

function renderKanjiDetail(item) {
  kanjiDetail.replaceChildren();

  const header = document.createElement('div');
  header.className = 'kanji-detail-header';
  const char = document.createElement('span');
  char.className = 'kanji-large';
  char.textContent = item.char;
  const meta = document.createElement('div');
  meta.className = 'kanji-meta';
  meta.textContent = [item.jlpt, item.strokeCount ? `${item.strokeCount}획` : '', item.grade ? `학년 ${item.grade}` : '']
    .filter(Boolean)
    .join(' · ') || '상세 정보';
  header.append(char, meta);
  kanjiDetail.append(header);

  const lines = document.createElement('div');
  lines.className = 'detail-lines';
  const meaning = item.meaningsKo?.length ? item.meaningsKo.join(', ') : '뜻 보강 필요';
  addDetailLine(lines, '뜻', meaning);
  addDetailLine(lines, '음독', (item.onReadings || []).join(', '));
  addDetailLine(lines, '훈독', (item.kunReadings || []).join(', '));
  kanjiDetail.append(lines);

  const exampleTitle = document.createElement('h3');
  exampleTitle.textContent = '예시 단어';
  kanjiDetail.append(exampleTitle);

  const favoriteButton = document.createElement('button');
  favoriteButton.type = 'button';
  favoriteButton.className = 'small-button';
  favoriteButton.textContent = '한자 즐겨찾기';
  favoriteButton.addEventListener('click', async () => {
    favoriteButton.disabled = true;
    favoriteButton.textContent = '저장 중';
    await apiPost('/api/favorites', {
      itemType: 'kanji',
      itemText: item.char,
      note: item.meaningsKo?.join(', ') || ''
    });
    favoriteButton.textContent = '저장됨';
  });
  kanjiDetail.append(favoriteButton);

  const list = document.createElement('div');
  list.className = 'example-list';
  if (!item.examples?.length) {
    list.append(emptyText('예시 단어가 없습니다.'));
  } else {
    for (const example of item.examples) {
      const meaningList = Array.isArray(example.meanings) ? example.meanings.filter(Boolean) : [];
      const row = document.createElement('div');
      row.className = 'example-item';
      const written = document.createElement('strong');
      written.textContent = example.written || '-';
      const reading = document.createElement('span');
      reading.textContent = example.pronounced || '-';
      const meanings = document.createElement('small');
      meanings.textContent = meaningList.length ? meaningList.join(', ') : '-';
      row.append(written, reading, meanings);
      list.append(row);
    }
  }
  kanjiDetail.append(list);
}

function renderGrammar(data) {
  difficultyOutput.replaceChildren();
  const difficulty = data.difficulty;
  for (const item of [
    ['난이도', `${difficulty.level} (${difficulty.jlpt})`],
    ['한자 비율', `${difficulty.kanjiRatio}%`],
    ['단어 수', `${difficulty.tokenCount}`]
  ]) {
    const chip = document.createElement('span');
    chip.append(document.createTextNode(`${item[0]} `));
    const value = document.createElement('strong');
    value.textContent = item[1];
    chip.append(value);
    difficultyOutput.append(chip);
  }

  structureOutput.replaceChildren();
  const structure = document.createElement('div');
  structure.className = 'mini-item';
  const structureTitle = document.createElement('strong');
  const structureText = document.createElement('span');
  const structureNote = document.createElement('small');
  structureTitle.textContent = '문장 구조';
  structureText.textContent = `주어: ${data.structure.subject || '-'} / 목적어: ${data.structure.object || '-'} / 서술어: ${data.structure.predicate || '-'}`;
  structureNote.textContent = data.structure.note;
  structure.append(structureTitle, structureText, structureNote);
  structureOutput.append(structure);

  particleOutput.replaceChildren();
  if (!data.particles.length) {
    particleOutput.append(emptyChip('감지된 조사가 없습니다.'));
  } else {
    for (const particle of data.particles) {
      const chip = document.createElement('span');
      chip.className = 'info-chip';
      chip.textContent = `${particle.particle}: ${particle.description}`;
      particleOutput.append(chip);
    }
  }

  katakanaOutput.replaceChildren();
  if (!data.katakana.length) {
    katakanaOutput.append(emptyText('가타카나 단어가 없습니다.'));
  } else {
    for (const item of data.katakana) {
      const row = document.createElement('div');
      row.className = 'mini-item';
      const word = document.createElement('strong');
      const reading = document.createElement('span');
      const meaning = document.createElement('small');
      word.textContent = item.word;
      reading.textContent = item.reading;
      meaning.textContent = item.meaning;
      row.append(word, reading, meaning);
      katakanaOutput.append(row);
    }
  }
}

function renderResult(data, cacheHeader = '') {
  lastResult = data;
  wordPage = 1;
  kanjiPage = 1;
  translationOutput.classList.remove('placeholder');
  setText(translationOutput, data.translation.text);
  setProviderStatus(data.translation.note, data.translation.provider, cacheHeader);
  renderFurigana(data.furigana);
  renderWords(data.words);
  renderKanjiList(data.kanji);
  renderGrammar(data);
}

function renderQuickHistory(items) {
  const history = Array.isArray(items) ? items.slice(0, 5) : [];
  quickHistoryList.replaceChildren();
  quickHistoryCount.textContent = `${items?.length || 0}개`;
  if (!history.length) {
    quickHistoryList.append(emptyText('아직 내 기록이 없습니다.'));
    return;
  }

  for (const item of history) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    button.append(
      createText('strong', item.source_text || ''),
      createText('span', item.translation_text || ''),
      createText('small', item.created_at || '')
    );
    button.addEventListener('click', () => {
      sourceText.value = item.source_text || '';
      updateCount();
      analyze(false);
    });
    quickHistoryList.append(button);
  }
}

async function refreshQuickHistory() {
  try {
    const response = await fetch('/api/dashboard');
    if (!response.ok) {
      return;
    }
    const dashboard = await response.json();
    renderQuickHistory(dashboard.history || []);
  } catch (error) {
    renderQuickHistory([]);
  }
}

async function apiPostWithMeta(url, body) {
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

async function apiPost(url, body) {
  return (await apiPostWithMeta(url, body)).data;
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

async function translateKoreanToJapanese() {
  const text = koJaInput.value.trim();
  if (!text) {
    koJaOutput.classList.add('placeholder');
    setText(koJaOutput, '번역할 한국어 문장을 입력해 주세요.');
    return;
  }

  koJaButton.disabled = true;
  koJaButton.textContent = '번역 중';
  koJaOutput.classList.add('placeholder');
  setText(koJaOutput, '번역 중');
  try {
    const result = await apiPost('/api/translate-ko-ja', { text, saveHistory: false });
    lastKoJaTranslation = result.translation.text || '';
    koJaOutput.classList.remove('placeholder');
    setText(koJaOutput, lastKoJaTranslation || result.translation.note);
  } catch (error) {
    koJaOutput.classList.add('placeholder');
    setText(koJaOutput, error.message);
  } finally {
    koJaButton.disabled = false;
    koJaButton.textContent = '번역';
  }
}

async function saveVocabulary(word, button) {
  if (button) {
    button.disabled = true;
    button.textContent = '저장 중';
  }
  await apiPost('/api/vocabulary', {
    term: word.surface,
    reading: word.reading,
    meaning: word.meaning,
    sourceText: lastResult?.source || sourceText.value
  });
  if (button) {
    button.textContent = '저장됨';
  }
}

async function analyze(saveHistory = true) {
  const text = sourceText.value.trim();
  if (!text) {
    resetResults();
    return;
  }

  setLoading(true);
  setProviderStatus('분석 중', 'loading');
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify({ text, saveHistory })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || '분석에 실패했습니다.');
    }
    renderResult(data, response.headers.get('x-learning-cache') || '');
    if (saveHistory) {
      refreshQuickHistory();
    }
  } catch (error) {
    translationOutput.classList.add('placeholder');
    setText(translationOutput, error.message);
    setProviderStatus('오류', 'error');
  } finally {
    setLoading(false);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

async function runOcr(file) {
  if (!file) {
    return;
  }
  if (file.size > 6 * 1024 * 1024) {
    setText(ocrStatus, '이미지는 6MB 이하로 업로드해 주세요.');
    return;
  }
  setText(ocrStatus, 'OCR 처리 중');
  try {
    const image = await readFileAsDataUrl(file);
    const result = await apiPost('/api/ocr', { image });
    if (!result.text) {
      throw new Error('이미지에서 텍스트를 찾지 못했습니다.');
    }
    sourceText.value = result.text;
    updateCount();
    setText(ocrStatus, 'OCR 완료');
    analyze(true);
  } catch (error) {
    setText(ocrStatus, error.message);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  analyze(true);
});

sourceText.addEventListener('input', updateCount);
sourceText.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    analyze(true);
  }
});

clearButton.addEventListener('click', () => {
  sourceText.value = '';
  updateCount();
  resetResults();
  sourceText.focus();
});

pasteButton.addEventListener('click', async () => {
  if (!navigator.clipboard?.readText) {
    sourceText.focus();
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      sourceText.focus();
      return;
    }
    sourceText.value = text.slice(0, sourceText.maxLength);
    updateCount();
    analyze(true);
  } catch (error) {
    sourceText.focus();
  }
});

voiceButton.addEventListener('click', () => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    alert('이 브라우저는 음성 인식을 지원하지 않습니다.');
    return;
  }
  const recognition = new Recognition();
  recognition.lang = 'ja-JP';
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    sourceText.value = event.results[0][0].transcript;
    updateCount();
    analyze(true);
  };
  recognition.start();
});

speakButton.addEventListener('click', () => {
  const text = sourceText.value.trim();
  if (!text || !window.speechSynthesis) {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
});

ocrFile.addEventListener('change', () => runOcr(ocrFile.files[0]));
cameraFile.addEventListener('change', () => runOcr(cameraFile.files[0]));

kanaButton.addEventListener('click', async () => {
  const value = kanaInput.value.trim() || sourceText.value.trim();
  if (!value) {
    return;
  }
  const data = await apiPost('/api/convert-kana', { text: value });
  kanaOutput.replaceChildren();
  for (const item of [['히라가나', data.hiragana], ['가타카나', data.katakana], ['로마자', data.romaji]]) {
    const row = document.createElement('div');
    row.className = 'mini-item';
    const label = document.createElement('strong');
    const text = document.createElement('span');
    label.textContent = item[0];
    text.textContent = item[1];
    row.append(label, text);
    kanaOutput.append(row);
  }
});

kanjiSearchButton.addEventListener('click', async () => {
  const char = [...kanjiSearchInput.value.trim()][0];
  if (!char) {
    return;
  }
  const response = await fetch(`/api/kanji/${encodeURIComponent(char)}`, {
    headers: {
      'x-csrf-token': csrfToken
    }
  });
  const detail = await response.json();
  if (!response.ok) {
    kanjiDetail.replaceChildren(emptyText(detail.error || '한자 상세 정보를 불러오지 못했습니다.'));
    return;
  }
  lastKanji = [detail];
  kanjiPage = 1;
  renderKanjiDetail(detail);
  kanjiList.replaceChildren();
  document.querySelector('#kanji-pagination')?.replaceChildren();
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'kanji-chip active';
  chip.textContent = detail.char;
  chip.addEventListener('click', () => renderKanjiDetail(detail));
  kanjiList.append(chip);
});

koJaButton.addEventListener('click', translateKoreanToJapanese);
koJaInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    translateKoreanToJapanese();
  }
});
koJaUseButton.addEventListener('click', () => {
  if (!lastKoJaTranslation) {
    return;
  }
  sourceText.value = lastKoJaTranslation;
  updateCount();
  analyze(true);
});

updateCount();
refreshQuickHistory();
if (sourceText.value.trim()) {
  analyze(false);
}
