const path = require('node:path');
const kuromoji = require('kuromoji');
const wanakana = require('wanakana');
const kanjiData = require('kanji-data');
const config = require('../config');
const {
  PARTICLE_DESCRIPTIONS,
  translateGlosses,
  wordMeaningKo,
  katakanaMeaningKo
} = require('./koDictionary');

const MAX_TEXT_LENGTH = 3000;
let tokenizerPromise;

const POS_KO = {
  名詞: '명사',
  動詞: '동사',
  形容詞: '형용사',
  副詞: '부사',
  助詞: '조사',
  助動詞: '조동사',
  連体詞: '연체사',
  接続詞: '접속사',
  感動詞: '감탄사',
  記号: '기호',
  接頭詞: '접두사',
  フィラー: '필러',
  その他: '기타'
};

const EXACT_TRANSLATIONS = {
  '私は昨日、図書館で日本語の本を読みました。': '나는 어제 도서관에서 일본어 책을 읽었습니다.',
  '私は図書館で日本語を勉強します。': '나는 도서관에서 일본어를 공부합니다.',
  '私はりんごを食べます。': '나는 사과를 먹습니다.',
  'こんにちは、私は学生です。': '안녕하세요, 저는 학생입니다.',
  '私は学校で勉強します。': '나는 학교에서 공부합니다.'
};

const KO_JA_EXACT_TRANSLATIONS = {
  '나는 일본어를 공부하고 있습니다.': '私は日本語を勉強しています。',
  '나는 도서관에서 일본어를 공부합니다.': '私は図書館で日本語を勉強します。',
  '나는 어제 도서관에서 일본어 책을 읽었습니다.': '私は昨日、図書館で日本語の本を読みました。',
  '나는 사과를 먹습니다.': '私はりんごを食べます。',
  '안녕하세요, 저는 학생입니다.': 'こんにちは、私は学生です。'
};

const MAX_IMAGE_DATA_URL_LENGTH = 8 * 1024 * 1024;

function getTokenizer() {
  if (!tokenizerPromise) {
    const dicPath = path.dirname(require.resolve('kuromoji/dict/base.dat.gz'));
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath }).build((err, tokenizer) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(tokenizer);
      });
    });
  }
  return tokenizerPromise;
}

function hasKanji(value) {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
}

function extractKanji(text) {
  if (typeof kanjiData.extractKanji === 'function') {
    return kanjiData.extractKanji(text);
  }
  return Array.from(new Set(String(text).match(/[\u3400-\u9fff\uf900-\ufaff]/gu) || []));
}

function toHiragana(reading) {
  if (!reading || reading === '*') {
    return '';
  }
  return wanakana.toHiragana(reading);
}

function estimateTokenJlpt(surface) {
  const levels = extractKanji(surface)
    .map((char) => kanjiData.get(char)?.jlpt)
    .filter(Boolean);
  if (!levels.length) {
    return '';
  }
  return `N${Math.min(...levels)}`;
}

function simplifyToken(token) {
  const surface = token.surface_form || '';
  const base = token.basic_form && token.basic_form !== '*' ? token.basic_form : surface;
  const reading = toHiragana(token.reading || token.pronunciation);
  const meaning = wordMeaningKo(surface, base);
  return {
    surface,
    base,
    reading,
    meaning,
    jlpt: estimateTokenJlpt(surface),
    pos: token.pos || 'その他',
    posKo: POS_KO[token.pos] || token.pos || '기타',
    detail: [token.pos_detail_1, token.pos_detail_2, token.pos_detail_3]
      .filter((item) => item && item !== '*')
      .join(' / ')
  };
}

function buildFurigana(tokens) {
  return tokens.map((token) => {
    const reading = hasKanji(token.surface) ? token.reading : '';
    return {
      text: token.surface,
      reading: reading && reading !== token.surface ? reading : ''
    };
  });
}

function meaningKo(meanings) {
  return translateGlosses(meanings);
}

function getKanjiDetail(char) {
  const info = kanjiData.get(char);
  if (!info) {
    return {
      char,
      meanings: [],
      meaningsKo: [],
      onReadings: [],
      kunReadings: [],
      examples: [],
      jlpt: null,
      grade: null,
      strokeCount: null
    };
  }

  const meaningsKo = meaningKo(info.meanings || []);
  const words = typeof kanjiData.getWords === 'function' ? kanjiData.getWords(char) : [];
  const examples = words.slice(0, 6).map((word) => {
    const variant = word.variants && word.variants[0] ? word.variants[0] : {};
    const glosses = (word.meanings || []).flatMap((meaning) => meaning.glosses || []).slice(0, 6);
    const meaningsKo = translateGlosses(glosses).slice(0, 3);
    return {
      written: variant.written || '',
      pronounced: variant.pronounced || '',
      meanings: meaningsKo.length ? meaningsKo : ['뜻 보강 필요']
    };
  }).filter((word) => word.written);

  return {
    char,
    meanings: meaningsKo.length ? meaningsKo : ['뜻 보강 필요'],
    meaningsKo,
    onReadings: info.on_readings || [],
    kunReadings: info.kun_readings || [],
    examples,
    jlpt: info.jlpt ? `N${info.jlpt}` : null,
    grade: info.grade,
    strokeCount: info.stroke_count
  };
}

function localTranslate(text, tokens) {
  const exact = EXACT_TRANSLATIONS[text.trim()];
  if (exact) {
    return {
      text: exact,
      provider: 'local-exact',
      note: '내장 예문 사전으로 번역했습니다.'
    };
  }

  const chunks = tokens.map((token) => {
    if (/^[。、,.!?！？\s]+$/.test(token.surface)) {
      return token.surface;
    }
    return token.meaning || token.surface;
  });

  const output = chunks.join(' ')
    .replace(/\s+([。、,.!?！？])/g, '$1')
    .replace(/([「『])\s+/g, '$1')
    .replace(/\s+([」』])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    text: output || text,
    provider: 'local-gloss',
    note: '외부 번역 서버가 없어 단어 단위 학습용 직역을 표시합니다.'
  };
}

function extractOutputText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

function parseJsonArrayText(text) {
  const raw = String(text || '').trim();
  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function stripWrappingQuotes(text) {
  return String(text || '').trim().replace(/^["'「『]+|["'」』]+$/g, '').trim();
}

// OpenAI 호출은 한 곳으로 모아 timeout, store:false, 키 은닉 처리를 일관되게 유지한다.
async function callOpenAI({ instructions, input, maxOutputTokens = 900 }) {
  if (!config.openaiApiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.openaiApiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: config.openaiModel,
        instructions,
        input,
        max_output_tokens: maxOutputTokens,
        store: false
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`OpenAI responded with ${response.status}`);
    }
    return extractOutputText(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

async function openAITranslate(text) {
  const translated = await callOpenAI({
    instructions: [
      '너는 일본어를 한국어로 번역하는 학습 보조 엔진이다.',
      '원문의 의미를 자연스러운 한국어로 번역하되, 설명이나 따옴표 없이 번역문만 출력한다.',
      '고유명사와 숫자는 보존하고, 일본어 학습자가 이해하기 쉬운 표현을 사용한다.'
    ].join('\n'),
    input: text,
    maxOutputTokens: 500
  });
  if (!translated) {
    return null;
  }
  return {
    text: translated,
    provider: 'openai',
    note: 'OpenAI 번역을 사용했습니다.'
  };
}

async function translateKoreanToJapanese(text) {
  const input = String(text || '').trim();
  if (!input) {
    throw new Error('번역할 한국어 문장을 입력해 주세요.');
  }
  if (input.length > MAX_TEXT_LENGTH) {
    throw new Error(`문장은 ${MAX_TEXT_LENGTH}자 이하로 입력해 주세요.`);
  }

  const translated = await callOpenAI({
    instructions: [
      '너는 한국어를 자연스러운 일본어로 번역하는 학습 보조 엔진이다.',
      '설명, 따옴표, 마크다운 없이 일본어 번역문만 출력한다.',
      '학습자가 문장 구조를 비교할 수 있도록 지나친 의역은 피하고 자연스러운 표준 일본어를 사용한다.'
    ].join('\n'),
    input,
    maxOutputTokens: 500
  });

  if (translated) {
    return {
      source: input,
      translation: {
        text: stripWrappingQuotes(translated),
        provider: 'openai',
        note: 'OpenAI 번역을 사용했습니다.'
      }
    };
  }

  const exact = KO_JA_EXACT_TRANSLATIONS[input];
  if (exact) {
    return {
      source: input,
      translation: {
        text: exact,
        provider: 'local-exact',
        note: '내장 예문 사전으로 번역했습니다.'
      }
    };
  }

  return {
    source: input,
    translation: {
      text: '',
      provider: 'local-unavailable',
      note: 'OPENAI_API_KEY가 없어 로컬 예문 사전에 없는 문장은 번역할 수 없습니다.'
    }
  };
}

async function externalTranslate(text) {
  const openai = await openAITranslate(text);
  if (openai) {
    return openai;
  }

  if (!config.libreTranslateUrl) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const body = {
      q: text,
      source: 'ja',
      target: 'ko',
      format: 'text'
    };
    if (config.libreTranslateApiKey) {
      body.api_key = config.libreTranslateApiKey;
    }

    const response = await fetch(`${config.libreTranslateUrl.replace(/\/$/, '')}/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`LibreTranslate responded with ${response.status}`);
    }
    const data = await response.json();
    if (!data || typeof data.translatedText !== 'string') {
      throw new Error('Invalid LibreTranslate response.');
    }
    return {
      text: data.translatedText,
      provider: 'libretranslate',
      note: '연결된 LibreTranslate 서버로 번역했습니다.'
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractKatakana(text) {
  const matches = String(text).match(/[ァ-ヴー]{2,}/gu) || [];
  return Array.from(new Set(matches)).map((word) => ({
    word,
    reading: wanakana.toHiragana(word),
    meaning: katakanaMeaningKo(word)
  }));
}

function analyzeParticles(tokens) {
  return tokens
    .filter((token) => token.pos === '助詞' || PARTICLE_DESCRIPTIONS[token.surface])
    .map((token) => ({
      particle: token.surface,
      description: PARTICLE_DESCRIPTIONS[token.surface] || '문장 안에서 앞뒤 단어의 관계를 나타내는 조사입니다.'
    }));
}

function analyzeSentenceStructure(tokens) {
  const subject = tokens.find((token, index) => tokens[index + 1]?.surface === 'は' || tokens[index + 1]?.surface === 'が');
  const object = tokens.find((token, index) => tokens[index + 1]?.surface === 'を');
  const predicate = [...tokens].reverse().find((token) => token.pos === '動詞' || token.pos === '形容詞' || token.pos === '助動詞');
  return {
    subject: subject ? subject.surface : '',
    object: object ? object.surface : '',
    predicate: predicate ? predicate.base || predicate.surface : '',
    note: '형태소와 조사를 기준으로 추정한 구조입니다.'
  };
}

function estimateDifficulty(input, tokens, kanjiDetails) {
  const kanjiRatio = input.length ? extractKanji(input).length / input.length : 0;
  const jlptScores = kanjiDetails
    .map((item) => item.jlpt ? Number(String(item.jlpt).replace('N', '')) : 0)
    .filter(Boolean);
  const hardest = jlptScores.length ? Math.min(...jlptScores) : 5;
  let level = '초급';
  let jlpt = 'N5';
  let score = 1;

  if (input.length > 80 || kanjiRatio > 0.25 || hardest <= 2) {
    level = '상급';
    jlpt = hardest <= 1 ? 'N1' : 'N2';
    score = 4;
  } else if (input.length > 40 || kanjiRatio > 0.16 || hardest <= 3) {
    level = '중급';
    jlpt = 'N3';
    score = 3;
  } else if (hardest <= 4) {
    level = '초중급';
    jlpt = 'N4';
    score = 2;
  }

  return {
    level,
    jlpt,
    score,
    kanjiRatio: Number((kanjiRatio * 100).toFixed(1)),
    tokenCount: tokens.length
  };
}

function convertKana(text) {
  const value = String(text || '');
  return {
    hiragana: wanakana.toHiragana(value),
    katakana: wanakana.toKatakana(value),
    romaji: wanakana.toRomaji(value)
  };
}

async function generateExamples(term) {
  const value = String(term || '').trim().slice(0, 80);
  if (!value) {
    throw new Error('예문을 만들 단어를 입력해 주세요.');
  }

  const openai = await callOpenAI({
    instructions: '일본어 학습자를 위해 입력 단어를 사용한 짧은 일본어 예문 3개와 한국어 번역을 JSON 배열로만 출력한다. 각 항목은 japanese, korean 키를 가진다.',
    input: value,
    maxOutputTokens: 700
  });

  if (openai) {
    try {
      const parsed = parseJsonArrayText(openai);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, 3);
      }
    } catch (error) {
      return openai.split('\n').filter(Boolean).slice(0, 3).map((line) => ({ japanese: line, korean: '' }));
    }
  }

  return [
    { japanese: `${value}を勉強します。`, korean: `${value}을/를 공부합니다.` },
    { japanese: `${value}は大切です。`, korean: `${value}은/는 중요합니다.` },
    { japanese: `今日は${value}を使います。`, korean: `오늘은 ${value}을/를 사용합니다.` }
  ];
}

async function ocrImage(dataUrl) {
  if (!config.openaiApiKey) {
    throw new Error('OCR을 사용하려면 OPENAI_API_KEY를 .env에 설정해야 합니다.');
  }
  const image = String(dataUrl || '');
  if (image.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error('이미지는 6MB 이하로 업로드해 주세요.');
  }
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(image)) {
    throw new Error('PNG, JPG, WEBP 이미지만 OCR에 사용할 수 있습니다.');
  }

  const text = await callOpenAI({
    instructions: '이미지에서 일본어 텍스트만 추출한다. 설명 없이 추출된 일본어 문장만 출력한다.',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: '이 이미지의 일본어 텍스트를 OCR로 추출해 주세요.' },
          { type: 'input_image', image_url: image, detail: 'high' }
        ]
      }
    ],
    maxOutputTokens: 700
  });

  return {
    text: text || ''
  };
}

async function analyzeJapanese(text) {
  const input = String(text || '').trim();
  if (!input) {
    throw new Error('분석할 일본어 문장을 입력해 주세요.');
  }
  if (input.length > MAX_TEXT_LENGTH) {
    throw new Error(`문장은 ${MAX_TEXT_LENGTH}자 이하로 입력해 주세요.`);
  }

  const tokenizer = await getTokenizer();
  const tokens = tokenizer.tokenize(input).map(simplifyToken);
  const kanji = extractKanji(input).slice(0, 80);
  const kanjiDetails = kanji.map(getKanjiDetail);
  const particles = analyzeParticles(tokens);
  const katakana = extractKatakana(input);
  const structure = analyzeSentenceStructure(tokens);
  const difficulty = estimateDifficulty(input, tokens, kanjiDetails);

  let translation = null;
  try {
    translation = await externalTranslate(input);
  } catch (error) {
    translation = null;
  }

  if (!translation) {
    translation = localTranslate(input, tokens);
  }

  return {
    source: input,
    translation,
    furigana: buildFurigana(tokens),
    words: tokens,
    kanji: kanjiDetails,
    particles,
    katakana,
    structure,
    difficulty,
    kana: convertKana(input)
  };
}

module.exports = {
  analyzeJapanese,
  extractKanji,
  getKanjiDetail,
  hasKanji,
  localTranslate,
  translateKoreanToJapanese,
  convertKana,
  generateExamples,
  ocrImage,
  validateTextLength: MAX_TEXT_LENGTH
};
