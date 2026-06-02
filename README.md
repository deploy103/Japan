# 일본어 문장 분석 기반 학습 보조 웹 플랫폼

`PRIVATE_PLAN.md`의 1순위 학습 기능을 로그인 기반 웹앱으로 구현한 Express + EJS + SQLite 프로젝트입니다. 분석 화면은 번역·한자·후리가나·품사에 집중하고, 학습 관리와 단어 테스트는 별도 화면으로 분리했습니다.

## 주요 기능

- 회원가입/로그인: 아이디, 비밀번호, 복구용 이메일만 사용
- 관리자 페이지: 회원 목록, 계정 활성/비활성, 관리자 권한 변경
- 일본어 → 한국어 번역, 한국어 → 일본어 번역
- 단어 분리, 품사, 한국어 뜻, JLPT 추정, 후리가나
- 한자 자동 추출, 한자 상세 검색, 음독/훈독/예시 단어
- 조사 설명, 가타카나 단어 분석, 카나 변환, 문장 구조/난이도
- 음성 입력, 일본어 음성 출력, 이미지 OCR, 모바일 카메라 입력
- 검색 기록, 단어장, 즐겨찾기, 복습 퀴즈, 오답노트, 학습 통계
- 학습 관리 목록 10개 단위 페이지네이션, 저장 단어 기반 단어 테스트
- 다크모드와 PC/모바일 반응형 화면

## 로컬 실행

```bash
npm install
cp .env.example .env
npm run dev
```

브라우저에서 `http://localhost:3000`으로 접속합니다. 첫 번째 가입자는 자동으로 관리자 권한을 받습니다.

## AI 사용량 절감 캐시

분석은 저장된 데이터를 먼저 보고, 부족한 항목만 OpenAI를 호출합니다.

- `analysis_cache`: 같은 일본어 문장 전체 분석 결과를 재사용
- `translation_cache`: 일본어 → 한국어, 한국어 → 일본어 문장 번역 재사용
- `example_cache`: 예문 생성 결과 재사용
- `meaning_cache`: 단어 뜻, 한자 뜻, 한자 예시 단어 뜻 재사용
- 기존 `search_history`, `vocabulary`에 저장된 번역과 뜻은 서버 시작 시 캐시로 편입
- 캐시 히트 응답은 `X-Learning-Cache` 헤더를 포함하고 AI rate limit을 우회
- 관리자 페이지에서 캐시 저장 항목 수, 재사용 횟수, 최근 사용 시각과 OpenAI 작업별 토큰 합계를 확인 가능

캐시는 SQLite에 저장되며 서버 시작 시와 6시간마다 오래된 항목을 정리합니다.


배포 후 확인:

```bash
curl http://127.0.0.1:3000/healthz
npm run seed:admin
```

## 백업

SQLite DB 백업:

```bash
npm run backup:db
```

백업 파일은 `backups/`에 생성되고 git에는 포함되지 않습니다. 운영에서는 이 디렉터리를 별도 저장소나 스냅샷 대상으로 잡으세요.

## 검증

```bash
npm run check
npm test
npm run audit:security
npm run audit:signatures
```
