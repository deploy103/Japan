const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

const darkModeButton = document.querySelector('#dark-mode-button');
const modeButtons = document.querySelectorAll('[data-mode]');
const startButton = document.querySelector('#test-start-button');
const submitButton = document.querySelector('#test-submit-button');
const answerInput = document.querySelector('#test-answer');
const promptOutput = document.querySelector('#test-prompt');
const feedbackOutput = document.querySelector('#test-feedback');
const reviewOutput = document.querySelector('#test-review');
const progressOutput = document.querySelector('#test-progress');
const scoreOutput = document.querySelector('#test-score');
const statsOutput = document.querySelector('#test-stats');

const TEST_SIZE = 10;
let vocabulary = [];
let mode = 'term';
let questions = [];
let currentIndex = 0;
let score = 0;
let awaitingNext = false;
let review = [];

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function createText(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function createMiniItem(...children) {
  const row = document.createElement('div');
  row.className = 'mini-item';
  row.append(...children);
  return row;
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function currentQuestion() {
  return questions[currentIndex];
}

function questionPrompt(item) {
  if (mode === 'term') {
    return `뜻: ${item.meaning || item.reading || '-'}`;
  }
  return `${item.term}${item.reading ? ` (${item.reading})` : ''}`;
}

function expectedAnswer(item) {
  return mode === 'term' ? item.term : item.meaning;
}

function localCheck(item, answer) {
  if (mode === 'term') {
    return normalize(answer) === normalize(item.term);
  }
  return String(item.meaning || '')
    .split(/[,;/、]/)
    .map(normalize)
    .filter(Boolean)
    .some((meaning) => meaning === normalize(answer));
}

function renderStats() {
  const usable = vocabulary.filter((item) => item.term && item.meaning);
  statsOutput.replaceChildren();
  for (const item of [
    ['단어장', vocabulary.length],
    ['문항', Math.min(TEST_SIZE, usable.length)]
  ]) {
    const chip = document.createElement('span');
    chip.append(document.createTextNode(`${item[0]} `));
    const value = document.createElement('strong');
    value.textContent = item[1];
    chip.append(value);
    statsOutput.append(chip);
  }
}

function renderProgress() {
  const total = questions.length;
  progressOutput.textContent = total ? `${Math.min(currentIndex + 1, total)} / ${total}` : '대기 중';
  scoreOutput.textContent = `${score} / ${total}`;
}

async function loadVocabulary() {
  const response = await fetch('/api/dashboard');
  if (!response.ok) {
    promptOutput.textContent = '단어장을 불러오지 못했습니다.';
    return;
  }
  const data = await response.json();
  vocabulary = data.vocabulary || [];
  renderStats();
}

function startTest() {
  const usable = vocabulary.filter((item) => item.term && item.meaning);
  questions = shuffle(usable).slice(0, TEST_SIZE);
  currentIndex = 0;
  score = 0;
  awaitingNext = false;
  review = [];
  reviewOutput.replaceChildren();
  answerInput.value = '';
  answerInput.disabled = !questions.length;
  submitButton.disabled = !questions.length;
  submitButton.textContent = '채점';
  if (!questions.length) {
    promptOutput.textContent = '테스트할 단어가 없습니다.';
    feedbackOutput.replaceChildren(createText('p', '학습 관리에서 단어를 먼저 저장해 주세요.'));
    renderProgress();
    return;
  }
  renderQuestion();
}

function renderQuestion() {
  const item = currentQuestion();
  promptOutput.textContent = questionPrompt(item);
  feedbackOutput.replaceChildren();
  answerInput.value = '';
  answerInput.focus();
  awaitingNext = false;
  submitButton.textContent = '채점';
  renderProgress();
}

async function postAttempt(item, answer) {
  const response = await fetch('/api/word-test/attempt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken
    },
    body: JSON.stringify({
      vocabularyId: item.id,
      mode,
      answer
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '채점하지 못했습니다.');
  }
  return data;
}

function renderReview() {
  reviewOutput.replaceChildren();
  for (const item of review) {
    const status = createText('strong', item.isCorrect ? '정답' : '오답');
    status.className = item.isCorrect ? 'result-correct' : 'result-wrong';
    reviewOutput.append(createMiniItem(
      status,
      createText('span', item.prompt),
      createText('small', `입력: ${item.answer || '-'} / 정답: ${item.correctAnswer}`)
    ));
  }
}

async function submitAnswer() {
  if (!questions.length) {
    return;
  }
  if (awaitingNext) {
    currentIndex += 1;
    if (currentIndex >= questions.length) {
      promptOutput.textContent = '테스트 완료';
      feedbackOutput.replaceChildren(createText('p', `점수: ${score} / ${questions.length}`));
      answerInput.disabled = true;
      submitButton.disabled = true;
      renderProgress();
      return;
    }
    renderQuestion();
    return;
  }

  const item = currentQuestion();
  const answer = answerInput.value.trim();
  if (!answer) {
    feedbackOutput.replaceChildren(createText('p', '정답을 입력해 주세요.'));
    return;
  }

  submitButton.disabled = true;
  try {
    const result = await postAttempt(item, answer);
    const isCorrect = result.isCorrect || localCheck(item, answer);
    if (isCorrect) {
      score += 1;
    }
    const correctAnswer = result.correctAnswer || expectedAnswer(item);
    feedbackOutput.replaceChildren(createText('p', isCorrect ? '정답입니다.' : `오답입니다. 정답: ${correctAnswer}`));
    review.unshift({
      isCorrect,
      prompt: questionPrompt(item),
      answer,
      correctAnswer
    });
    renderReview();
    awaitingNext = true;
    submitButton.textContent = currentIndex + 1 >= questions.length ? '완료' : '다음';
    renderProgress();
  } catch (error) {
    feedbackOutput.replaceChildren(createText('p', error.message));
  } finally {
    submitButton.disabled = false;
  }
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    modeButtons.forEach((item) => item.classList.toggle('active', item === button));
    startTest();
  });
});

startButton.addEventListener('click', startTest);
submitButton.addEventListener('click', submitAnswer);
answerInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitAnswer();
  }
});

darkModeButton.addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
  localStorage.setItem('dark-mode', document.body.classList.contains('dark-mode') ? '1' : '0');
});

if (localStorage.getItem('dark-mode') === '1') {
  document.body.classList.add('dark-mode');
}

answerInput.disabled = true;
submitButton.disabled = true;
loadVocabulary();
