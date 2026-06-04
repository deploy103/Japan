# 일본어 문장 분석 기반 학습 보조 웹 플랫폼

로그인 기반 일본어 학습 보조 웹앱입니다. 분석 화면은 번역·한자·후리가나·품사에 집중하고, 학습 관리와 단어 테스트는 별도 화면으로 분리했습니다.

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

## 보안 설계

- 비밀번호는 `scrypt` 해시로 저장하고 원문은 저장하지 않습니다.
- 세션 쿠키는 `HttpOnly`, `SameSite=Lax`, HTTPS 환경에서 `Secure`로 동작합니다.
- 세션 토큰은 DB에 원문이 아니라 `SESSION_SECRET` 기반 HMAC-SHA-256 해시만 저장합니다.
- 로그인 이후 변경 요청은 CSRF 토큰과 Origin 검사를 통과해야 합니다.
- 로그인 실패 응답은 아이디 존재 여부를 구분하지 않도록 통일했습니다.
- 운영 환경은 HTTPS `APP_ORIGIN`과 `COOKIE_SECURE=true`가 아니면 시작되지 않습니다.
- 운영 환경은 첫 가입자 자동 관리자 승격을 기본 비활성화하고, 관리자 계정은 `npm run seed:admin`으로 생성합니다.
- Helmet CSP, frame 차단, object 차단, no-store 캐시 정책을 적용했습니다.
- 로그인/회원가입, 전체 요청, OpenAI 비용 발생 API에 별도 rate limit을 적용했습니다.
- 반복 로그인 실패는 계정+IP 단위로 짧게 잠가 무차별 대입을 더 빨리 차단합니다.
- 일반 JSON API 본문은 256KB로 제한하고, OCR 업로드만 별도 8MB 한도를 사용합니다.
- 외부 번역 서버 URL은 자격정보 없는 `http://` 또는 `https://`만 허용합니다.
- 느린 요청 기반 DoS를 줄이기 위해 HTTP request/header/keep-alive timeout을 명시합니다.
- 배포 재시작과 종료 신호에서는 HTTP 서버와 SQLite 연결을 순서대로 닫습니다.
- 로그인, 계정 생성, 관리자 접근 거부, 계정 상태/권한 변경은 관리자 페이지의 보안 이벤트 로그에 남깁니다.
- API 오류는 HTML 리다이렉트 대신 JSON 오류로 반환해 화면에서 원인을 표시합니다.
- `.env`, SQLite DB, 백업 파일, 로컬 운영 메모는 `.gitignore`로 제외합니다.
- 검색 기록, 단어장, 즐겨찾기, 오답, 퀴즈 기록과 학습 캐시는 `user_id`로 분리합니다.

실제 API 키와 운영 값은 `.env`에만 넣고 코드나 문서에는 적지 않습니다.

## 로컬 실행

```bash
npm install
cp .env.example .env
npm run dev
```

Node.js `22.22.2` 이상에서 실행합니다. 브라우저에서 `http://localhost:3000`으로 접속합니다. 개발 기본값에서는 첫 번째 가입자가 자동으로 관리자 권한을 받습니다.

운영에서는 `.env`에 `FIRST_USER_ADMIN=false`를 두고 아래 값으로 관리자 계정을 생성하세요.

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
ADMIN_USERNAME=admin ADMIN_RECOVERY_EMAIL=admin@example.com ADMIN_PASSWORD='StrongPassword123!' npm run seed:admin
```

첫 번째 명령으로 생성한 값을 `.env`의 `SESSION_SECRET`에 넣으세요.

## AI 사용량 절감 캐시

분석은 저장된 데이터를 먼저 보고, 부족한 항목만 OpenAI를 호출합니다.

- `analysis_cache`: 같은 일본어 문장 전체 분석 결과를 재사용
- `translation_cache`: 일본어 → 한국어, 한국어 → 일본어 문장 번역 재사용
- `example_cache`: 예문 생성 결과 재사용
- `meaning_cache`: 단어 뜻, 한자 뜻, 한자 예시 단어 뜻 재사용
- 캐시는 모두 사용자별로 분리해 다른 계정에 재사용하지 않음
- 캐시 히트 응답은 `X-Learning-Cache` 헤더를 포함하고 AI rate limit을 우회
- 관리자 페이지에서 캐시 저장 항목 수, 재사용 횟수, 최근 사용 시각과 OpenAI 작업별 토큰 합계를 확인 가능

캐시는 SQLite에 저장되며 서버 시작 시와 6시간마다 오래된 항목을 정리합니다.

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

테스트는 `OPENAI_API_KEY=`를 비워 실행되므로 네트워크와 API 비용에 의존하지 않습니다. 실제 OpenAI 연동 확인은 `.env`에 키를 넣은 개발 서버에서 진행합니다.

## 파일 구조

- `src/server.js`: 라우팅, 인증, 세션, 관리자, 학습 API
- `src/db.js`: SQLite 스키마와 PRAGMA
- `src/security.js`: 비밀번호 해시, 검증, 토큰 유틸
- `src/services/japanese.js`: 번역, 형태소 분석, 한자, OpenAI, OCR
- `src/services/koDictionary.js`: 한국어 뜻 사전, 조사 설명, 가타카나 뜻
- `views/`: EJS 화면
- `public/app.js`: 메인 학습 화면 동작
- `public/styles.css`: 반응형/다크모드 스타일
- `scripts/ensure-admin.js`: 관리자 계정 생성/갱신
- `scripts/backup-db.js`: SQLite 백업
- `tests/`: 서비스/보안/서버 통합 테스트

## 남은 운영 TODO

- 실제 일본어 이미지로 OCR 품질 확인
- 운영 도메인 HTTPS 적용 후 `COOKIE_SECURE=true` 확인
- OpenAI 키 교체 및 사용량 한도 설정
- 서버에서 주기적 `npm audit`와 Node LTS 보안 업데이트 적용
