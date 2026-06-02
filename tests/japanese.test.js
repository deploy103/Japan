const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'japan-japanese-test-'));
process.env.DATABASE_PATH = path.join(tempDir, 'app.sqlite');
process.env.OPENAI_API_KEY = '';

const {
  analyzeJapanese,
  extractKanji,
  getKanjiDetail,
  convertKana,
  translateKoreanToJapanese,
  generateExamples
} = require('../src/services/japanese');
const {
  saveTranslationCache,
  saveWordMeaning,
  saveKanjiMeaning
} = require('../src/services/learningCache');

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('extractKanji returns unique kanji from Japanese text', () => {
  assert.deepEqual(extractKanji('私は図書館で日本語を勉強します。'), ['私', '図', '書', '館', '日', '本', '語', '勉', '強']);
});

test('kanji details include readings and metadata', () => {
  const detail = getKanjiDetail('学');
  assert.equal(detail.char, '学');
  assert.equal(detail.onReadings.includes('ガク'), true);
  assert.equal(detail.strokeCount > 0, true);
});

test('analysis returns translation, furigana, words, and kanji', async () => {
  const result = await analyzeJapanese('私は昨日、図書館で日本語の本を読みました。');
  assert.equal(result.translation.text, '나는 어제 도서관에서 일본어 책을 읽었습니다.');
  assert.equal(result.words.some((word) => word.surface === '図書館'), true);
  assert.equal(result.words.find((word) => word.surface === '図書館').meaning, '도서관');
  assert.match(result.words.find((word) => word.surface === '図書館').jlpt, /^N[1-5]$/);
  assert.equal(result.furigana.some((item) => item.text === '図書館' && item.reading === 'としょかん'), true);
  assert.equal(result.kanji.some((item) => item.char === '語'), true);
});

test('kanji and kana helpers return Korean-first learning data', async () => {
  const face = getKanjiDetail('顔');
  assert.equal(face.meaningsKo.includes('얼굴'), true);
  const converted = convertKana('こんにちは コンピューター');
  assert.equal(converted.katakana.includes('コンピューター'), true);
});

test('Korean to Japanese translation has local fallback without OpenAI', async () => {
  const result = await translateKoreanToJapanese('나는 일본어를 공부하고 있습니다.');
  assert.equal(result.translation.text, '私は日本語を勉強しています。');
  assert.equal(result.translation.provider, 'local-exact');
});

test('analysis reuses cached translation and meanings before OpenAI', async () => {
  saveTranslationCache('ja-ko', '橋を渡る。', {
    text: '다리를 건넙니다.',
    provider: 'openai'
  });
  saveKanjiMeaning('橋', ['다리'], 'openai');
  saveWordMeaning({
    surface: '渡る',
    base: '渡る',
    reading: 'わたる',
    pos: '動詞',
    posKo: '동사'
  }, ['건너다'], 'openai');

  const result = await analyzeJapanese('橋を渡る。');
  assert.equal(result.translation.text, '다리를 건넙니다.');
  assert.equal(result.translation.provider, 'cache');
  assert.equal(result.words.find((word) => word.surface === '橋').meaning, '다리');
  assert.equal(result.words.find((word) => word.surface === '渡る').meaning, '건너다');
  assert.equal(result.kanji.find((item) => item.char === '橋').meaningsKo.includes('다리'), true);
});

test('complete local analysis is cached as a full result', async () => {
  const first = await analyzeJapanese('こんにちは。');
  assert.notEqual(first.translation.provider, 'cache');

  const second = await analyzeJapanese('こんにちは。');
  assert.equal(second.translation.provider, 'cache');
  assert.equal(second.words.find((word) => word.surface === 'こんにちは').meaning, '안녕하세요');
});

test('example generation is cached after first local result', async () => {
  const first = await generateExamples('図書館');
  assert.equal(first.provider, 'local-template');
  assert.equal(first.examples.length, 3);

  const second = await generateExamples('図書館');
  assert.equal(second.provider, 'cache');
  assert.equal(second.examples[0].japanese, first.examples[0].japanese);
});
