const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

const form = document.querySelector('#analysis-form');
const sourceText = document.querySelector('#source-text');
const charCount = document.querySelector('#char-count');
const clearButton = document.querySelector('#clear-button');
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
const difficultyOutput = document.querySelector('#difficulty-output');
const structureOutput = document.querySelector('#structure-output');
const particleOutput = document.querySelector('#particle-output');
const katakanaOutput = document.querySelector('#katakana-output');
const favoriteSentenceButton = document.querySelector('#favorite-sentence-button');
const quizStartButton = document.querySelector('#quiz-start-button');
const quizBox = document.querySelector('#quiz-box');
const statsOutput = document.querySelector('#stats-output');
const vocabularyList = document.querySelector('#vocabulary-list');
const favoriteList = document.querySelector('#favorite-list');
const historyList = document.querySelector('#history-list');
const wrongNoteList = document.querySelector('#wrong-note-list');
const darkModeButton = document.querySelector('#dark-mode-button');
const exampleTerm = document.querySelector('#example-term');
const exampleButton = document.querySelector('#example-button');
const exampleOutput = document.querySelector('#example-output');

let lastKanji = [];
let lastResult = null;
let lastKoJaTranslation = '';
let currentQuiz = null;
const FAVORITE_TYPE_KO = {
  word: '단어',
  kanji: '한자',
  sentence: '문장'
};

function setText(element, text) {
  element.textContent = text;
}

function setLoading(isLoading) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = isLoading;
  button.textContent = isLoading ? '분석 중' : '분석하기';
}

function updateCount() {
  setText(charCount, `${sourceText.value.length} / ${sourceText.maxLength}`);
}

function resetResults() {
  translationOutput.classList.add('placeholder');
  setText(translationOutput, '분석 결과가 여기에 표시됩니다.');
  setText(providerNote, '대기 중');
  furiganaOutput.replaceChildren();
  wordOutput.replaceChildren(emptyRow('아직 분석된 단어가 없습니다.'));
  kanjiList.replaceChildren(emptyChip('한자가 추출되면 여기에 표시됩니다.'));
  kanjiDetail.replaceChildren(emptyText('한자를 선택하면 뜻, 음독, 훈독, 예시 단어를 볼 수 있습니다.'));
  difficultyOutput.replaceChildren();
  structureOutput.replaceChildren();
  particleOutput.replaceChildren(emptyChip('조사 설명이 여기에 표시됩니다.'));
  katakanaOutput.replaceChildren();
  lastResult = null;
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
    return;
  }

  for (const word of words) {
    const row = document.createElement('tr');
    for (const value of [word.surface, word.reading || '-', word.meaning || '뜻 보강 필요', word.jlpt || '-', word.posKo, word.base || '-']) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const actionCell = document.createElement('td');
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'small-button';
    saveButton.textContent = '저장';
    saveButton.addEventListener('click', () => saveVocabulary(word));
    actionCell.append(saveButton);
    row.append(actionCell);
    wordOutput.append(row);
  }
}

function renderKanjiList(kanji) {
  lastKanji = kanji;
  kanjiList.replaceChildren();
  if (!kanji.length) {
    kanjiList.append(emptyChip('이 문장에는 추출된 한자가 없습니다.'));
    kanjiDetail.replaceChildren(emptyText('한자를 선택하면 뜻, 음독, 훈독, 예시 단어를 볼 수 있습니다.'));
    return;
  }

  kanji.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kanji-chip';
    button.textContent = item.char;
    button.dataset.index = String(index);
    button.addEventListener('click', () => {
      document.querySelectorAll('.kanji-chip').forEach((chip) => chip.classList.remove('active'));
      button.classList.add('active');
      renderKanjiDetail(item);
    });
    kanjiList.append(button);
  });

  const first = kanjiList.querySelector('.kanji-chip');
  first.classList.add('active');
  renderKanjiDetail(kanji[0]);
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
  addDetailLine(lines, '음독', item.onReadings.join(', '));
  addDetailLine(lines, '훈독', item.kunReadings.join(', '));
  kanjiDetail.append(lines);

  const exampleTitle = document.createElement('h3');
  exampleTitle.textContent = '예시 단어';
  kanjiDetail.append(exampleTitle);

  const favoriteButton = document.createElement('button');
  favoriteButton.type = 'button';
  favoriteButton.className = 'small-button';
  favoriteButton.textContent = '한자 즐겨찾기';
  favoriteButton.addEventListener('click', async () => {
    await apiPost('/api/favorites', {
      itemType: 'kanji',
      itemText: item.char,
      note: item.meaningsKo?.join(', ') || ''
    });
    await refreshDashboard();
  });
  kanjiDetail.append(favoriteButton);

  const list = document.createElement('div');
  list.className = 'example-list';
  if (!item.examples.length) {
    list.append(emptyText('예시 단어가 없습니다.'));
  } else {
    for (const example of item.examples) {
      const row = document.createElement('div');
      row.className = 'example-item';
      const written = document.createElement('strong');
      written.textContent = example.written;
      const reading = document.createElement('span');
      reading.textContent = example.pronounced || '-';
      const meanings = document.createElement('small');
      meanings.textContent = example.meanings.join(', ');
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

function renderResult(data) {
  lastResult = data;
  translationOutput.classList.remove('placeholder');
  setText(translationOutput, data.translation.text);
  setText(providerNote, data.translation.note);
  renderFurigana(data.furigana);
  renderWords(data.words);
  renderKanjiList(data.kanji);
  renderGrammar(data);
  refreshDashboard();
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
  return data;
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
    koJaButton.textContent = '일본어로 번역';
  }
}

async function saveVocabulary(word) {
  await apiPost('/api/vocabulary', {
    term: word.surface,
    reading: word.reading,
    meaning: word.meaning,
    sourceText: lastResult?.source || sourceText.value
  });
  await refreshDashboard();
}

async function refreshDashboard() {
  const response = await fetch('/api/dashboard');
  if (!response.ok) {
    return;
  }
  const data = await response.json();
  renderDashboard(data);
}

function renderDashboard(data) {
  statsOutput.replaceChildren();
  for (const item of [
    ['오늘 분석', data.stats.today_history],
    ['단어장', data.stats.vocabulary_count],
    ['즐겨찾기', data.stats.favorite_count],
    ['퀴즈 정답률', `${data.stats.quiz_accuracy}%`]
  ]) {
    const chip = document.createElement('span');
    chip.append(document.createTextNode(`${item[0]} `));
    const value = document.createElement('strong');
    value.textContent = item[1];
    chip.append(value);
    statsOutput.append(chip);
  }

  vocabularyList.replaceChildren();
  if (!data.vocabulary.length) {
    vocabularyList.append(emptyText('저장된 단어가 없습니다.'));
  } else {
  for (const item of data.vocabulary.slice(0, 12)) {
      const row = document.createElement('div');
      row.className = 'mini-item';
      const term = document.createElement('strong');
      const reading = document.createElement('span');
      const meaning = document.createElement('small');
      term.textContent = item.term;
      reading.textContent = item.reading || '-';
      meaning.textContent = item.meaning || '-';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'small-button';
      remove.textContent = '삭제';
      remove.addEventListener('click', async () => {
        await apiDelete(`/api/vocabulary/${item.id}`);
        await refreshDashboard();
      });
      row.append(term, reading, meaning, remove);
      vocabularyList.append(row);
    }
  }

  favoriteList.replaceChildren();
  if (!data.favorites.length) {
    favoriteList.append(emptyText('즐겨찾기가 없습니다.'));
  } else {
    for (const item of data.favorites.slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'mini-item';
      const text = document.createElement('strong');
      const type = document.createElement('span');
      const note = document.createElement('small');
      text.textContent = item.item_text;
      type.textContent = FAVORITE_TYPE_KO[item.item_type] || item.item_type;
      note.textContent = item.note || '';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'small-button';
      remove.textContent = '삭제';
      remove.addEventListener('click', async () => {
        await apiDelete(`/api/favorites/${item.id}`);
        await refreshDashboard();
      });
      row.append(text, type, note, remove);
      favoriteList.append(row);
    }
  }

  historyList.replaceChildren();
  if (!data.history.length) {
    historyList.append(emptyText('아직 검색 기록이 없습니다.'));
  } else {
    for (const item of data.history.slice(0, 8)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-item';
      const source = document.createElement('strong');
      const translation = document.createElement('span');
      source.textContent = item.source_text;
      translation.textContent = item.translation_text || '';
      button.append(source, translation);
      button.addEventListener('click', () => {
        sourceText.value = item.source_text;
        updateCount();
        analyze(false);
      });
      const wrap = document.createElement('div');
      wrap.className = 'mini-item';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'small-button';
      remove.textContent = '삭제';
      remove.addEventListener('click', async () => {
        await apiDelete(`/api/history/${item.id}`);
        await refreshDashboard();
      });
      wrap.append(button, remove);
      historyList.append(wrap);
    }
  }

  wrongNoteList.replaceChildren();
  if (!data.wrongNotes.length) {
    wrongNoteList.append(emptyText('아직 오답이 없습니다.'));
  } else {
    for (const item of data.wrongNotes.slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'mini-item';
      const term = document.createElement('strong');
      const answer = document.createElement('span');
      term.textContent = item.term;
      answer.textContent = `입력: ${item.submitted_answer || '-'}`;
      row.append(term, answer);
      wrongNoteList.append(row);
    }
  }
}

async function analyze(saveHistory = true) {
  const text = sourceText.value.trim();
  if (!text) {
    resetResults();
    return;
  }

  setLoading(true);
  setText(providerNote, '분석 중');
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
    renderResult(data);
  } catch (error) {
    translationOutput.classList.add('placeholder');
    setText(translationOutput, error.message);
    setText(providerNote, '오류');
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

clearButton.addEventListener('click', () => {
  sourceText.value = '';
  updateCount();
  resetResults();
  sourceText.focus();
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
  const response = await fetch(`/api/kanji/${encodeURIComponent(char)}`);
  const detail = await response.json();
  renderKanjiDetail(detail);
  kanjiList.replaceChildren();
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

favoriteSentenceButton.addEventListener('click', async () => {
  const itemText = sourceText.value.trim();
  if (!itemText) {
    return;
  }
  await apiPost('/api/favorites', {
    itemType: 'sentence',
    itemText,
    note: lastResult?.translation?.text || ''
  });
  await refreshDashboard();
});

quizStartButton.addEventListener('click', async () => {
  try {
    const response = await fetch('/api/quiz');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || '퀴즈를 만들 수 없습니다.');
    }
    currentQuiz = data;
    quizBox.replaceChildren();
    const prompt = document.createElement('p');
    prompt.textContent = data.prompt;
    const row = document.createElement('div');
    row.className = 'quiz-row';
    const input = document.createElement('input');
    input.id = 'quiz-answer';
    input.placeholder = '정답 입력';
    const submit = document.createElement('button');
    submit.id = 'quiz-submit';
    submit.className = 'small-button';
    submit.type = 'button';
    submit.textContent = '채점';
    const result = document.createElement('div');
    result.id = 'quiz-result';
    result.className = 'muted';
    row.append(input, submit);
    quizBox.append(prompt, row, result);
    submit.addEventListener('click', submitQuiz);
  } catch (error) {
    quizBox.textContent = error.message;
  }
});

async function submitQuiz() {
  const answer = document.querySelector('#quiz-answer')?.value || '';
  const result = await apiPost('/api/quiz', {
    vocabularyId: currentQuiz.vocabularyId,
    answer
  });
  const target = document.querySelector('#quiz-result');
  target.textContent = result.isCorrect ? '정답입니다.' : `오답입니다. 정답: ${result.correctAnswer}`;
  await refreshDashboard();
}

exampleButton.addEventListener('click', async () => {
  const term = exampleTerm.value.trim() || lastResult?.words?.find((word) => word.meaning)?.surface || '';
  if (!term) {
    return;
  }
  exampleOutput.replaceChildren(emptyText('예문 생성 중'));
  try {
    const data = await apiPost('/api/examples', { term });
    exampleOutput.replaceChildren();
    for (const example of data.examples) {
      const row = document.createElement('div');
      row.className = 'mini-item';
      const japanese = document.createElement('strong');
      const korean = document.createElement('span');
      japanese.textContent = example.japanese || String(example);
      korean.textContent = example.korean || '';
      row.append(japanese, korean);
      exampleOutput.append(row);
    }
  } catch (error) {
    exampleOutput.replaceChildren(emptyText(error.message));
  }
});

darkModeButton.addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
  localStorage.setItem('dark-mode', document.body.classList.contains('dark-mode') ? '1' : '0');
});

if (localStorage.getItem('dark-mode') === '1') {
  document.body.classList.add('dark-mode');
}

document.querySelectorAll('.history-item').forEach((item) => {
  item.addEventListener('click', () => {
    sourceText.value = item.dataset.text || '';
    updateCount();
    analyze(false);
  });
});

updateCount();
