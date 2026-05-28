const test = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeJapanese,
  extractKanji,
  getKanjiDetail,
  convertKana,
  translateKoreanToJapanese
} = require('../src/services/japanese');

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
