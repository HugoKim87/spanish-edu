# ¡Vamos! 스페인어 학습 사이트

Quizlet 스타일의 스페인어 학습 단일 페이지 앱입니다.

## 📁 파일 구조

```
spanish-learning/
├── index.html    화면 구조 (HTML)
├── styles.css    스타일 (CSS, 디자인 토큰 포함)
├── data.js       학습 데이터 (단어/표현) ⭐ 자주 편집
└── app.js        학습 로직 (4개 모드, TTS, 상태)
```

## 🚀 실행 방법

`index.html`을 더블클릭해서 브라우저에서 열면 끝. 별도 서버 불필요.

## ✏️ 단어/표현 추가하기

`data.js`만 편집하면 됩니다.

### 기존 Day에 카드 추가
해당 Day의 `cards` 배열에 한 줄 추가:
```js
{ es: 'la palabra nueva', ko: '새로운 단어' },
```

### 새 Day 주제 추가
`TOPICS` 배열에 객체 하나 통째로 추가:
```js
{
  id: 'day33', emoji: '🎉',
  title: 'Day 33 · 새 주제',
  subtitle: '¿Qué hago ...?',
  cards: [
    { es: '...', ko: '...' },
  ],
},
```

저장 후 브라우저 새로고침(F5)만 하면 즉시 반영됩니다.

## 🎨 디자인 수정

- 색상 변경: `styles.css` 상단의 `:root` CSS 변수
- 폰트, 여백 등: 해당 컴포넌트 CSS 블록

## ⚙️ 학습 로직 수정

`app.js`는 섹션별로 나뉘어 있습니다:
0. CONFIG (튜닝 상수 — 카드 수, 발음 속도, 애니메이션 시간 등을 한곳에서 관리)
1. STATE & UTILS (상태 + DOM·채점 헬퍼)
2. INIT & HOME RENDERERS
3. TTS (발음 듣기)
4. VIEWER (모달 공통 + 결과화면 빌더)
4-b. ALL WORDS (전체 단어 보기 + 검색)
5. MODE: FLASHCARDS
6. MODE: LEARN
7. MODE: TEST
8. MODE: MATCH

> 동작 수치(예: 객관식 보기 수, 매치 쌍 개수, 발음 속도)를 바꾸려면 맨 위 `CONFIG` 객체만 수정하면 됩니다.

## 🌍 기능

- 🃏 **낱말카드**: 클릭/스페이스로 뒤집기, 발음 듣기 (Web Speech API)
- 🧠 **학습하기**: 객관식 + 단답형, 오답 자동 반복
- 📝 **테스트**: 9문제 종합 시험, 도넛 점수 + 오답 리뷰
- ⚡ **카드 맞추기**: 6쌍 타임어택, 최고 기록 저장
