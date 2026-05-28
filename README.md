# 일본어 문장 분석 기반 학습 보조 웹 플랫폼

`계획.md`의 1순위 학습 기능을 로그인 기반 웹앱으로 구현한 Express + EJS + SQLite 프로젝트입니다. UI는 DeepL 번역기처럼 입력과 결과를 나란히 두고, 로그인 후 번역·한자·후리가나·품사·학습 관리 기능을 한 화면에서 사용하도록 구성했습니다.

## 주요 기능

- 회원가입/로그인: 아이디, 비밀번호, 복구용 이메일만 사용
- 관리자 페이지: 회원 목록, 계정 활성/비활성, 관리자 권한 변경
- 일본어 → 한국어 번역, 한국어 → 일본어 번역
- 단어 분리, 품사, 한국어 뜻, JLPT 추정, 후리가나
- 한자 자동 추출, 한자 상세 검색, 음독/훈독/예시 단어
- 조사 설명, 가타카나 단어 분석, 카나 변환, 문장 구조/난이도
- 음성 입력, 일본어 음성 출력, 이미지 OCR, 모바일 카메라 입력
- 검색 기록, 단어장, 즐겨찾기, 복습 퀴즈, 오답노트, 학습 통계
- 다크모드와 PC/모바일 반응형 화면

## 보안 설계

- 비밀번호는 `scrypt` 해시로 저장하고 원문은 저장하지 않습니다.
- 세션 쿠키는 `HttpOnly`, `SameSite=Lax`, HTTPS 환경에서 `Secure`로 동작합니다.
- 세션 토큰은 DB에 원문이 아니라 `SESSION_SECRET`으로 섞은 SHA-256 해시만 저장합니다.
- 로그인 이후 변경 요청은 CSRF 토큰과 Origin 검사를 통과해야 합니다.
- 로그인 실패 응답은 아이디 존재 여부를 구분하지 않도록 통일했습니다.
- 운영 환경은 HTTPS `APP_ORIGIN`과 `COOKIE_SECURE=true`가 아니면 시작되지 않습니다.
- Helmet CSP, frame 차단, object 차단, no-store 캐시 정책을 적용했습니다.
- 로그인/회원가입, 전체 요청, OpenAI 비용 발생 API에 별도 rate limit을 적용했습니다.
- API 오류는 HTML 리다이렉트 대신 JSON 오류로 반환해 화면에서 원인을 표시합니다.
- `.env`, SQLite DB, 백업 파일은 `.gitignore`로 제외합니다.

채팅에 노출된 OpenAI 키는 운영 전에 반드시 폐기하고 새 키로 교체하세요. 실제 키는 `.env`의 `OPENAI_API_KEY`에만 넣고 코드, README, 개발일지에는 적지 않습니다.

## 로컬 실행

```bash
npm install
cp .env.example .env
npm run dev
```

브라우저에서 `http://localhost:3000`으로 접속합니다. 첫 번째 가입자는 자동으로 관리자 권한을 받습니다.

관리자 계정을 직접 생성/갱신하려면 환경변수로만 값을 넘깁니다.

```bash
ADMIN_USERNAME=admin \
ADMIN_PASSWORD='change-me-123!' \
ADMIN_RECOVERY_EMAIL=admin@example.com \
npm run seed:admin
```

## 환경 변수

```bash
NODE_ENV=production
PORT=3000
APP_ORIGIN=https://example.com
SESSION_SECRET=replace-with-at-least-32-random-characters
DATABASE_PATH=/var/lib/japanese-learning/app.sqlite
COOKIE_SECURE=true
OPENAI_API_KEY=replace-with-your-openai-key
OPENAI_MODEL=gpt-5.2
```

선택 값:

- `LIBRETRANSLATE_URL`: 별도 LibreTranslate 서버를 먼저 사용하고 실패 시 로컬 fallback으로 전환
- `LIBRETRANSLATE_API_KEY`: LibreTranslate 서버가 키를 요구할 때 사용

OpenAI 키가 있으면 번역, 한국어 → 일본어 번역, 예문 생성, OCR이 OpenAI Responses API를 사용합니다. 키가 없으면 일본어 분석은 로컬 사전 기반 학습용 직역으로 계속 동작하고, OCR은 키 설정 안내 오류를 반환합니다.

개발 환경에서 `SESSION_SECRET`을 생략하면 프로세스 시작마다 랜덤 값이 생성되어 재시작 시 기존 세션은 무효화됩니다. 운영 환경에서는 반드시 고정된 긴 값을 설정해야 하며, 누락되거나 32자 미만이면 서버가 시작되지 않습니다.

## Ubuntu 26.04 LTS 배포

Node.js `22.13.0` 이상이 필요합니다. 운영 서버는 Node 24 LTS 최신 패치 버전을 권장합니다.

```bash
sudo apt update
sudo apt install -y nodejs npm nginx
node -v
sudo mkdir -p /opt/japanese-learning /var/lib/japanese-learning
sudo chown -R $USER:$USER /opt/japanese-learning /var/lib/japanese-learning
```

프로젝트를 `/opt/japanese-learning`에 배치한 뒤:

```bash
npm ci --omit=dev
cp .env.example .env
openssl rand -base64 48
npm start
```

운영 `.env`에서 반드시 바꿀 값:

- `NODE_ENV=production`
- `APP_ORIGIN=https://실제도메인`
- `SESSION_SECRET=openssl rand -base64 48` 결과값
- `DATABASE_PATH=/var/lib/japanese-learning/app.sqlite`
- `COOKIE_SECURE=true`

Nginx HTTPS 리버스 프록시는 `deploy/nginx.conf.example`, systemd 서비스는 `deploy/japanese-learning.service`를 참고하세요. 예시 서비스는 `NoNewPrivileges`, `PrivateTmp`, 제한된 쓰기 경로를 포함합니다. 서비스 계정이 `DATABASE_PATH` 디렉터리에 쓰기 권한을 가져야 합니다.

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
- `deploy/`: Ubuntu 운영 배포 예시
- `tests/`: 서비스/보안/서버 통합 테스트
- `개발일지.md`: 구현 로그, TODO, 남은 위험요소

## 남은 운영 TODO

- 실제 일본어 이미지로 OCR 품질 확인
- 운영 도메인 HTTPS 적용 후 `COOKIE_SECURE=true` 확인
- OpenAI 키 교체 및 사용량 한도 설정
- 서버에서 주기적 `npm audit`와 Node LTS 보안 업데이트 적용
