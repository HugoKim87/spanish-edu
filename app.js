/* =========================================================
   ¡Vamos! · 학습 앱 로직
   ---------------------------------------------------------
   이 파일은 data.js의 TOPICS 변수를 읽어 화면을 구성합니다.
   - 데이터 수정은 data.js만 편집하세요.
   - UI 동작/로직 변경은 이 파일을 편집하세요.

   모듈 구성:
   0. CONFIG       (튜닝 상수 모음)
   1. STATE & UTILS
   2. INIT & RENDERERS  (홈 화면)
   3. TTS               (Web Speech API)
   4. VIEWER            (모달 공통)
   4-b. ALL WORDS       (전체 단어 보기)
   5. MODE: FLASHCARDS
   6. MODE: LEARN
   7. MODE: TEST
   8. MODE: MATCH
   ========================================================= */

/* ===================== 0. CONFIG ===================== */
/* 동작 튜닝용 상수 — 매직넘버를 한곳에서 관리 */
const CONFIG = {
  SETS_PREVIEW: 8,        // 홈 '인기 단어장'에 보여줄 미리보기 카드 수
  CHOICE_DISTRACTORS: 3,  // 객관식 오답 보기 개수 (정답 1 + 오답 3 = 4지선다)
  FILL_RATIO: 0.25,       // 학습하기 모드에서 단답형이 나올 확률
  MATCH_PAIRS: 6,         // 카드 맞추기 쌍 개수
  TTS_RATE: 0.92,         // 발음 속도 (1.0이 기본)
  MATCH_TICK_MS: 100,     // 카드 맞추기 타이머 갱신 주기
  MATCH_ANIM_MS: 380,     // 매치 성공/실패 애니메이션 시간
  VOICE_RETRY_MS: [250, 1000], // 음성 목록 지연 로드 재시도 시점
  // 테스트 구성: [선택형, 진위형, 단답형(ko→es), 매칭형(ko→es)] 문제 수
  TEST_SECTIONS: { choice: 3, tf: 2, fill: 2, match: 2 },
};

/* ===================== 1. STATE & UTILS ===================== */
const state = {
  topicId: TOPICS.length ? TOPICS[TOPICS.length - 1].id : undefined, // 기본 선택: 최신 Day
  sortOrder: 'desc', // 주제 정렬: 'desc'(최신순) | 'asc'(오래된순)
  learned: new Set(),
  marks: {},      // cardKey -> 'hard' | 'know' | null
  matchBest: {},  // topicId -> seconds
};

/* ---- DOM 헬퍼 ---- */
/** getElementById 단축 */
const $ = (id) => document.getElementById(id);

/** Day 번호 추출 (id의 숫자 부분) — 정렬·범위 계산 기준 */
function dayNumOf(t) {
  const n = parseInt(String(t.id).replace(/\D/g, ''), 10);
  return isNaN(n) ? -Infinity : n;
}

/** 현재 정렬 순서가 적용된 주제 목록 반환 */
function sortedTopics() {
  const arr = [...TOPICS].sort((a, b) => dayNumOf(a) - dayNumOf(b)); // 오름차순 기본
  return state.sortOrder === 'desc' ? arr.reverse() : arr;
}

/** 현재 선택된 주제 객체 */
function getTopic() {
  return TOPICS.find(t => t.id === state.topicId);
}

/** 카드 고유 키 (학습 기록·표시 상태 추적용) */
function cardKey(t, c) {
  return t.id + '::' + c.es;
}

/** 배열을 무작위로 섞은 새 배열 반환 */
function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

/** 전체 카드 수 합산 */
function totalCardCount() {
  return TOPICS.reduce((s, t) => s + t.cards.length, 0);
}

/** 채점용 정규화: 악센트/대소문자/구두점/앞뒤공백 무시 */
function normalize(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[¿?¡!.,]/g, '');
}

/** 두 답이 (정규화 후) 일치하는지 */
function isCorrect(a, b) {
  return normalize(a) === normalize(b);
}

/** HTML 속성에 안전하게 넣기 위한 이스케이프 */
function escapeAttr(s) {
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

/** 스페인어 발음 버튼 HTML 생성 (이모지 🔊 스타일) */
function speakBtnHTML(es, cls = 'fc-speak', stop = true) {
  const handler = (stop ? "event.stopPropagation(); " : '') + `speak('${escapeAttr(es)}', 'es-ES')`;
  return `<button class="${cls}" onclick="${handler}" title="발음 듣기">🔊</button>`;
}

/** 학습한 카드 수를 화면 두 곳(상단 배지 + 통계)에 일관되게 반영 */
function updateLearnedCount() {
  const n = state.learned.size;
  if ($('streakNum')) $('streakNum').textContent = n;
  if ($('statLearned')) $('statLearned').textContent = n;
}

/* ===================== 2. INIT & HOME RENDERERS ===================== */
function init() {
  // 선택된 Day가 데이터에 없으면, 현재 정렬 기준의 첫 번째(기본=최신)로 보장
  if (TOPICS.length && !TOPICS.some(t => t.id === state.topicId)) {
    state.topicId = sortedTopics()[0].id;
  }

  const total = totalCardCount();
  $('totalWords').textContent = total + '+';
  $('statTotal').textContent = total;
  $('statTopics').textContent = TOPICS.length;

  renderDayRange();
  wireSortToggle();
  renderTopics();
  renderSetsGrid();
}

/**
 * Day 범위(최소~최대)를 데이터에서 자동 계산해 히어로/푸터 문구에 반영.
 * → data.js에 Day를 추가/삭제하면 화면 문구가 자동으로 갱신됨.
 */
function renderDayRange() {
  const dayNums = TOPICS.map(dayNumOf).filter(n => n !== -Infinity);
  if (!dayNums.length) return;
  const min = Math.min(...dayNums);
  const max = Math.max(...dayNums);
  const range = min === max ? `Day ${min}` : `Day ${min} ~ Day ${max}`;
  if ($('heroEyebrow')) $('heroEyebrow').textContent = `실비아 Voca LAB · ${range}`;
  if ($('footerText')) {
    $('footerText').textContent =
      `¡Vamos! 스페인어 학습 · ${range.replace(' ~ ', ' → ')} 통합 단어장 · 실비아 Voca LAB 기반`;
  }
}

/** 정렬 토글 버튼(최신순/오래된순) 이벤트 연결 */
function wireSortToggle() {
  const toggle = $('sortToggle');
  if (!toggle) return;
  toggle.querySelectorAll('.sort-btn').forEach(btn => {
    btn.onclick = () => {
      state.sortOrder = btn.dataset.sort;
      toggle.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderTopics(); // 칩 재정렬 (선택된 Day는 그대로 유지)
    };
  });
}

/** 주제 선택 칩 렌더링 (현재 정렬 순서 반영) */
function renderTopics() {
  const bar = $('topicBar');
  bar.innerHTML = '';
  sortedTopics().forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'topic-chip' + (t.id === state.topicId ? ' active' : '');
    btn.innerHTML = `
      <span class="emoji">${t.emoji}</span>
      <span>${t.title}</span>
      <span class="count">${t.cards.length}</span>
    `;
    btn.onclick = () => {
      state.topicId = t.id;
      renderTopics();
      renderSetsGrid();
      updateModeSub();
    };
    bar.appendChild(btn);
  });
  updateModeSub();
}

/** '학습 모드' 섹션의 부제(현재 주제 정보) 갱신 */
function updateModeSub() {
  const t = getTopic();
  $('modeSub').textContent = `${t.title} · ${t.cards.length}개 카드 · ${t.subtitle}`;
}

/** 홈 '인기 단어장' 미리보기 그리드 렌더링 */
function renderSetsGrid() {
  const grid = $('setsGrid');
  grid.innerHTML = '';
  const t = getTopic();
  t.cards.slice(0, CONFIG.SETS_PREVIEW).forEach(c => {
    const el = document.createElement('div');
    el.className = 'set-card';
    el.innerHTML = `
      <div class="set-top">
        <div class="set-icon">${t.emoji}</div>
        <button class="set-speak" title="발음 듣기" aria-label="발음 듣기">
          <span class="material-symbols-outlined">volume_up</span>
        </button>
      </div>
      <h4>${c.es}</h4>
      <div class="set-meta">${c.ko}</div>
    `;
    el.querySelector('.set-speak').onclick = (e) => {
      e.stopPropagation();
      speak(c.es, 'es-ES');
    };
    grid.appendChild(el);
  });
}

/* ===================== 3. TTS ===================== */
/*
  Web Speech API 기반 발음 재생.
  - 음성 목록(voices)을 캐싱해 첫 클릭부터 스페인어 음성을 보장
  - 스페인어 음성 우선순위: es-ES(스페인) > 기타 es-* > 없으면 기본 음성
  - 스페인어 음성 존재 여부를 ttsState.hasSpanish 로 노출 (🔊 버튼 표시에 사용)
*/
const ttsState = {
  supported: 'speechSynthesis' in window,
  voices: [],
  spanishVoice: null,
  hasSpanish: false,
  ready: false,
};

/** 음성 목록에서 가장 적절한 스페인어 음성 선택 */
function pickSpanishVoice(voices) {
  if (!voices || !voices.length) return null;
  return (
    voices.find(v => v.lang && v.lang.toLowerCase() === 'es-es') ||      // 스페인 스페인어 우선
    voices.find(v => v.lang && v.lang.toLowerCase().startsWith('es')) || // 기타 es-* (멕시코/미국 등)
    null
  );
}

/** 브라우저 음성 목록을 로드·캐싱하고 🔊 버튼 상태를 갱신 */
function loadVoices() {
  if (!ttsState.supported) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices && voices.length) {
    ttsState.voices = voices;
    ttsState.spanishVoice = pickSpanishVoice(voices);
    ttsState.hasSpanish = !!ttsState.spanishVoice;
    ttsState.ready = true;
    refreshSpeakButtons(); // 음성이 늦게 로드된 경우 버튼 상태 갱신
  }
}

if (ttsState.supported) {
  // 일부 브라우저(크롬)는 getVoices()가 처음엔 빈 배열 → 이벤트 + 지연 재시도로 보강
  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices(); // 즉시 시도 (사파리/파이어폭스는 바로 채워짐)
  CONFIG.VOICE_RETRY_MS.forEach(ms => setTimeout(loadVoices, ms));
}

/** 텍스트를 스페인어 음성으로 읽기 */
function speak(text, lang = 'es-ES') {
  if (!ttsState.supported || !text) return;
  if (!ttsState.ready) loadVoices(); // 아직 목록이 없으면 한 번 더 시도
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = CONFIG.TTS_RATE;
  if (ttsState.spanishVoice) u.voice = ttsState.spanishVoice;
  window.speechSynthesis.speak(u);
}

/** 화면의 🔊 버튼들에 음성 가용 여부를 안내(흐림 처리/툴팁) */
function refreshSpeakButtons() {
  if (ttsState.supported && ttsState.hasSpanish) return; // 정상이면 변경 불필요
  document.querySelectorAll('.fc-speak, .speak-mini').forEach(btn => {
    if (!ttsState.supported) {
      btn.title = '이 브라우저는 음성 재생을 지원하지 않습니다';
    } else if (!ttsState.hasSpanish) {
      btn.title = '스페인어 음성이 없어 기본 음성으로 재생됩니다 (기기에 스페인어 음성 설치 권장)';
      btn.style.opacity = '0.55';
    }
  });
}

/* ===================== 4. VIEWER (modal) ===================== */
const viewer = $('viewer');
const body = $('viewerBody');
const titleEl = $('viewerTitle');
const progressBar = $('progressBar');

let activeMode = null; // 'flashcards' | 'learn' | 'test' | 'match' | 'allwords' | null

/** 진행 막대 너비 설정 (0~100) */
function setProgress(pct) {
  progressBar.style.width = pct + '%';
}

/** 모달 헤더 제목 설정 (메인 + 부제) */
function setViewerTitle(main, sub) {
  titleEl.innerHTML = sub ? `${main} <span class="small">${sub}</span>` : main;
}

/**
 * 결과/안내 화면 HTML 생성기 (학습 완료·시험 결과·매치 결과 공통).
 * @param {object} o
 * @param {string} [o.emojiBig] 큰 이모지
 * @param {string} [o.heading] 제목
 * @param {string} [o.message] 본문 문구
 * @param {string} [o.extra] 추가 HTML (점수 원/리뷰 등)
 * @param {Array}  o.buttons [{label, onclick, primary}]
 */
function resultScreen({ emojiBig, heading, message, extra, buttons }) {
  const btns = buttons.map(b =>
    `<button class="${b.primary ? 'btn-primary' : 'btn-outline btn-inline'}" onclick="${b.onclick}">${b.label}</button>`
  ).join('');
  return `
    <div class="result-screen">
      ${emojiBig ? `<div class="result-emoji">${emojiBig}</div>` : ''}
      ${heading ? `<h2 class="result-heading">${heading}</h2>` : ''}
      ${message ? `<p class="result-message">${message}</p>` : ''}
      ${extra || ''}
      <div class="result-actions">${btns}</div>
    </div>
  `;
}

function closeViewer() {
  viewer.classList.remove('open');
  body.innerHTML = '';
  activeMode = null;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (matchTimerId) { clearInterval(matchTimerId); matchTimerId = null; }
  updateLearnedCount();
}

viewer.addEventListener('click', e => {
  if (e.target === viewer) closeViewer();
});

// 키보드 핸들러는 모듈 전역에 단 한 번만 등록 (리스너 누수 방지)
document.addEventListener('keydown', e => {
  if (!viewer.classList.contains('open')) return;
  if (e.key === 'Escape') { closeViewer(); return; }
  // 낱말카드 모드 전용 단축키 (Space: 뒤집기, ←/→: 이동)
  if (activeMode === 'flashcards') {
    if (e.key === ' ') {
      e.preventDefault();
      $('fc')?.classList.toggle('flipped');
    } else if (e.key === 'ArrowRight') {
      $('nextBtn')?.click();
    } else if (e.key === 'ArrowLeft') {
      $('prevBtn')?.click();
    }
  }
});

/** 학습 모드 모달 열기 */
function openMode(mode) {
  const t = getTopic();
  activeMode = mode;
  viewer.classList.add('open');
  setViewerTitle(t.title, t.subtitle);
  setProgress(0);
  if (mode === 'flashcards') runFlashcards(t);
  else if (mode === 'learn') runLearn(t);
  else if (mode === 'test')  runTest(t);
  else if (mode === 'match') runMatch(t);
}

/* ===================== 4-b. ALL WORDS (전체 단어 보기) ===================== */
/** 모든 주제의 단어를 Day별로 묶어 보여주고 실시간 검색 제공 */
function openAllWords() {
  activeMode = 'allwords';
  viewer.classList.add('open');
  setViewerTitle('모든 단어', `${TOPICS.length}개 주제 · ${totalCardCount()}개`);
  setProgress(100);

  body.innerHTML = `
    <div class="allwords-search">
      <input id="allWordsSearch" type="text" placeholder="🔍 스페인어 또는 한국어로 검색..." autocomplete="off" />
    </div>
    <div id="allWordsResult"></div>
  `;

  const input = $('allWordsSearch');
  const result = $('allWordsResult');
  const topics = sortedTopics(); // 현재 정렬 순서 유지

  /** 검색어로 필터링해 결과 목록을 다시 그림 */
  function render(query) {
    const q = (query || '').trim().toLowerCase();
    let html = '';
    let shown = 0;

    topics.forEach(t => {
      const matched = q
        ? t.cards.filter(c => c.es.toLowerCase().includes(q) || c.ko.toLowerCase().includes(q))
        : t.cards;
      if (!matched.length) return;
      shown += matched.length;

      const rows = matched.map(c => `
        <div class="allwords-row">
          <div class="aw-es">${c.es}</div>
          <div class="aw-ko">${c.ko}</div>
          <button class="aw-speak" data-es="${escapeAttr(c.es)}" title="발음 듣기" aria-label="발음 듣기">
            <span class="material-symbols-outlined">volume_up</span>
          </button>
        </div>
      `).join('');

      html += `
        <div class="allwords-day-group">
          <div class="allwords-day-head">
            <span class="emoji">${t.emoji}</span>
            <span>${t.title}</span>
            <span class="day-count">${matched.length}</span>
          </div>
          ${rows}
        </div>
      `;
    });

    if (!shown) {
      result.innerHTML = `<div class="allwords-empty">"${query}"에 해당하는 단어가 없어요.</div>`;
      return;
    }
    result.innerHTML = `<div class="allwords-count">${shown}개 단어</div>` + html;

    result.querySelectorAll('.aw-speak').forEach(btn => {
      btn.onclick = () => speak(btn.dataset.es, 'es-ES');
    });
    refreshSpeakButtons();
  }

  input.oninput = () => render(input.value);
  render('');
  input.focus();
}

/* ===================== 5. MODE: FLASHCARDS ===================== */
/** 낱말카드: 앞(스페인어) ↔ 뒤(한국어) 뒤집기, 어려움/안다 분류 */
function runFlashcards(t) {
  let i = 0;
  const cards = shuffle(t.cards); // 랜덤 순서로 출제

  function render() {
    setProgress((i + 1) / cards.length * 100);
    const c = cards[i];
    const key = cardKey(t, c);
    const markedHard = state.marks[key] === 'hard';
    const markedKnow = state.marks[key] === 'know';

    body.innerHTML = `
      <div class="flashcard-stage">
        <div class="flashcard" id="fc">
          <div class="flashcard-inner">
            <div class="flashcard-face front">
              <span class="fc-flag">Español 🇪🇸</span>
              ${speakBtnHTML(c.es, 'fc-speak', true)}
              <div class="fc-text">${c.es}</div>
              <div class="fc-hint">카드를 클릭하면 뜻을 볼 수 있어요</div>
            </div>
            <div class="flashcard-face back">
              <span class="fc-flag">한국어 🇰🇷</span>
              <div class="fc-text">${c.ko}</div>
              <div class="fc-sub">${c.es}</div>
            </div>
          </div>
        </div>
        <div class="flashcard-controls">
          <button class="fc-nav" id="prevBtn" ${i === 0 ? 'disabled' : ''}>←</button>
          <div class="fc-counter">${i + 1} / ${cards.length}</div>
          <div class="fc-mark">
            <button class="hard ${markedHard ? 'active' : ''}" id="hardBtn">😵 어려움</button>
            <button class="know ${markedKnow ? 'active' : ''}" id="knowBtn">✅ 안다</button>
          </div>
          <button class="fc-nav" id="nextBtn" ${i === cards.length - 1 ? 'disabled' : ''}>→</button>
        </div>
      </div>
    `;

    const fc = $('fc');
    fc.onclick = () => fc.classList.toggle('flipped');
    $('prevBtn').onclick = () => { if (i > 0) { i--; render(); } };
    $('nextBtn').onclick = () => {
      if (i < cards.length - 1) { i++; state.learned.add(key); render(); }
    };
    $('hardBtn').onclick = () => {
      state.marks[key] = markedHard ? null : 'hard';
      render();
    };
    $('knowBtn').onclick = () => {
      state.marks[key] = markedKnow ? null : 'know';
      state.learned.add(key);
      render();
    };
    state.learned.add(key);
    refreshSpeakButtons();
  }

  render();
}

/* ===================== 6. MODE: LEARN ===================== */
/**
 * 학습하기: 객관식/단답형을 섞어 출제. 오답은 큐 뒤로 보내 자동 반복.
 * (간단한 spaced-repetition 효과)
 */
function runLearn(t) {
  // 카드를 섞고, 약 FILL_RATIO 비율로 단답형을 무작위 배치
  const queue = shuffle(t.cards).map(c => ({
    card: c,
    type: Math.random() < CONFIG.FILL_RATIO ? 'fill' : 'choice',
    tries: 0,
  }));
  let completed = 0;
  const total = queue.length;

  /** 정답/오답 피드백 표시 + 다음 버튼 활성화 (choice/fill 공통) */
  function finishQuestion(ok, answerText) {
    const fb = $('fb');
    fb.className = 'learn-feedback ' + (ok ? 'ok' : 'bad') + ' show';
    fb.textContent = ok ? '정답!' : `정답: ${answerText} · 나중에 다시 출제됩니다`;
    const next = $('nextBtn');
    next.classList.add('show');
    next.onclick = nextQ;
  }

  function nextQ() {
    if (queue.length === 0) {
      body.innerHTML = resultScreen({
        emojiBig: '🎉',
        heading: '완료!',
        message: `${t.title}의 모든 단어를 학습했어요.`,
        buttons: [{ label: '홈으로', onclick: 'closeViewer()', primary: true }],
      });
      setProgress(100);
      return;
    }
    const q = queue.shift();
    setProgress(completed / total * 100);
    if (q.type === 'choice') renderChoice(q);
    else                     renderFill(q);
  }

  function renderChoice(q) {
    const others = t.cards.filter(c => c.es !== q.card.es);
    const distractors = shuffle(others).slice(0, CONFIG.CHOICE_DISTRACTORS);
    const options = shuffle([...distractors.map(c => c.ko), q.card.ko]);

    body.innerHTML = `
      <div class="learn-stage">
        <div class="learn-question">객관식 · ${completed + 1} / ${total}</div>
        <div class="learn-prompt">
          ${q.card.es}
          ${speakBtnHTML(q.card.es, 'speak-mini', false)}
        </div>
        <div class="learn-instr">알맞은 한국어 뜻을 고르세요</div>
        <div class="learn-options" id="optsBox">
          ${options.map((opt, i) => `
            <button class="learn-option" data-correct="${opt === q.card.ko}">
              <span class="key">${'ABCD'[i]}</span>
              <span>${opt}</span>
            </button>
          `).join('')}
        </div>
        <div class="learn-feedback" id="fb"></div>
        <button class="learn-next" id="nextBtn">다음 →</button>
      </div>
    `;

    body.querySelectorAll('.learn-option').forEach(b => {
      b.onclick = () => {
        if (b.classList.contains('correct') || b.classList.contains('wrong')) return;
        const ok = b.dataset.correct === 'true';
        body.querySelectorAll('.learn-option').forEach(x => {
          x.style.pointerEvents = 'none';
          if (x.dataset.correct === 'true') x.classList.add('correct');
        });
        if (ok) {
          completed++;
          state.learned.add(cardKey(t, q.card));
        } else {
          b.classList.add('wrong');
          queue.push({ ...q, tries: q.tries + 1 });
        }
        finishQuestion(ok, q.card.ko);
      };
    });
    refreshSpeakButtons();
  }

  function renderFill(q) {
    body.innerHTML = `
      <div class="learn-stage">
        <div class="learn-question">단답형 · ${completed + 1} / ${total}</div>
        <div class="learn-prompt">${q.card.ko}</div>
        <div class="learn-instr">스페인어로 입력하세요 (대소문자/악센트는 채점에서 무시됩니다)</div>
        <input class="learn-input" id="ansInput" placeholder="스페인어로 입력..." autocomplete="off" />
        <div class="learn-feedback" id="fb"></div>
        <button class="learn-next" id="nextBtn">다음 →</button>
      </div>
    `;
    const input = $('ansInput');
    input.focus();

    function submit() {
      if (!input.value.trim()) return;
      const ok = isCorrect(input.value, q.card.es);
      input.disabled = true;
      input.classList.add(ok ? 'correct' : 'wrong');
      if (ok) {
        completed++;
        state.learned.add(cardKey(t, q.card));
      } else {
        queue.push({ ...q, tries: q.tries + 1 });
      }
      finishQuestion(ok, q.card.es);
    }
    input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  }

  nextQ();
}

/* ===================== 7. MODE: TEST ===================== */
/** 종합 시험: 선택형·진위형·단답형·매칭형을 한 번에 출제하고 채점 */
function runTest(t) {
  const cards = shuffle(t.cards);
  const S = CONFIG.TEST_SECTIONS;
  // 섹션별로 카드를 겹치지 않게 분배
  let p = 0;
  const slice = (n) => cards.slice(p, p += n);
  const cChoice = slice(S.choice);
  const cTf     = slice(S.tf);
  const cFill   = slice(S.fill);
  const cMatch  = slice(S.match);

  /** 정답 1개 + 무작위 오답들로 보기 배열 생성 */
  function makeOptions(correct, pool, key) {
    const distractors = shuffle(pool).slice(0, CONFIG.CHOICE_DISTRACTORS).map(x => x[key]);
    return shuffle([correct, ...distractors]);
  }

  const questions = [
    // 선택형 (es → ko)
    ...cChoice.map(c => ({
      type: 'choice', tag: '선택형',
      q: c.es, a: c.ko,
      options: makeOptions(c.ko, cards.filter(x => x.es !== c.es), 'ko'),
    })),
    // 진위형 (O/X) — 가짜 뜻은 정답 뜻과 달라야 함
    ...cTf.map(c => {
      const flip = Math.random() > 0.5;
      const pool = cards.filter(x => x.es !== c.es && x.ko !== c.ko);
      const fakeKo = (pool.length ? shuffle(pool)[0] : shuffle(cards.filter(x => x.es !== c.es))[0]).ko;
      return {
        type: 'tf', tag: '진위형',
        q: `"${c.es}" = "${flip ? c.ko : fakeKo}"`,
        a: flip ? 'O' : 'X',
      };
    }),
    // 단답형 (ko → es)
    ...cFill.map(c => ({
      type: 'fill', tag: '단답형',
      q: c.ko, a: c.es, hint: '(스페인어로)',
    })),
    // 매칭형 (ko → es)
    ...cMatch.map(c => ({
      type: 'choice', tag: '매칭형',
      q: c.ko, a: c.es,
      options: makeOptions(c.es, cards.filter(x => x.es !== c.es), 'es'),
    })),
  ];

  const answers = {};

  // 방어: 카드가 비정상적으로 적어 문제가 하나도 없으면 안내 후 종료
  if (questions.length === 0) {
    body.innerHTML = resultScreen({
      message: '이 주제는 시험을 만들기에 카드가 부족합니다.',
      buttons: [{ label: '닫기', onclick: 'closeViewer()', primary: true }],
    });
    return;
  }

  function render() {
    setProgress(0);
    body.innerHTML = `
      <div class="test-stage">
        ${questions.map((q, i) => `
          <div class="test-q-block" data-i="${i}">
            <span class="test-q-tag">${q.tag} · ${i + 1}</span>
            <div class="test-q-text">${q.q}${q.hint ? ` <span class="test-q-hint">${q.hint}</span>` : ''}</div>
            ${q.type === 'choice' ? `
              <div class="test-opt-grid">
                ${q.options.map(o => `<button class="test-opt" data-val="${escapeAttr(o)}">${o}</button>`).join('')}
              </div>` : ''}
            ${q.type === 'tf' ? `
              <div class="test-tf">
                <button class="test-opt" data-val="O">⭕ 맞다</button>
                <button class="test-opt" data-val="X">❌ 틀리다</button>
              </div>` : ''}
            ${q.type === 'fill' ? `
              <input class="test-input" data-i="${i}" placeholder="여기에 입력..." autocomplete="off" />` : ''}
          </div>
        `).join('')}
        <button class="test-submit" id="submitBtn">제출하고 채점하기</button>
      </div>
    `;

    body.querySelectorAll('.test-q-block').forEach((block, i) => {
      const q = questions[i];
      if (q.type === 'choice' || q.type === 'tf') {
        block.querySelectorAll('.test-opt').forEach(opt => {
          opt.onclick = () => {
            block.querySelectorAll('.test-opt').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            answers[i] = opt.dataset.val;
          };
        });
      } else {
        const inp = block.querySelector('.test-input');
        inp.oninput = () => { answers[i] = inp.value; };
      }
    });

    $('submitBtn').onclick = grade;
  }

  function grade() {
    let correct = 0;
    const review = questions.map((q, i) => {
      const my = answers[i] || '';
      const ok = isCorrect(my, q.a);
      if (ok) correct++;
      return { q, my, ok };
    });
    const score = Math.round(correct / questions.length * 100);
    setProgress(100);

    const reviewHTML = `
      <div class="test-score-circle" style="--p: ${score * 3.6}deg;">
        <div class="num">${score}%</div>
      </div>
      <div class="test-score-label">${correct} / ${questions.length} 정답</div>
      <div class="test-review">
        ${review.map(r => `
          <div class="test-review-item ${r.ok ? '' : 'wrong'}">
            <div class="label">${r.ok ? '✅ 정답' : '❌ 오답'} · ${r.q.tag}</div>
            <div><strong>Q:</strong> ${r.q.q}</div>
            <div><strong>내 답:</strong> ${r.my || '<i class="test-noanswer">(미응답)</i>'} · <strong>정답:</strong> ${r.q.a}</div>
          </div>
        `).join('')}
      </div>
    `;

    body.innerHTML = `<div class="test-result">${
      resultScreen({
        extra: reviewHTML,
        buttons: [
          { label: '다시 풀기', onclick: "openMode('test')", primary: true },
          { label: '닫기', onclick: 'closeViewer()', primary: false },
        ],
      })
    }</div>`;

    // 정답 카드는 학습 완료로 기록
    review.forEach(r => {
      if (!r.ok) return;
      const card = t.cards.find(c =>
        c.es === r.q.a || c.ko === r.q.a || c.es === r.q.q || c.ko === r.q.q
      );
      if (card) state.learned.add(cardKey(t, card));
    });
  }

  render();
}

/* ===================== 8. MODE: MATCH ===================== */
let matchTimerId = null;

/** 카드 맞추기: 스페인어 ↔ 한국어 짝을 시간 안에 맞추는 타임어택 */
function runMatch(t) {
  const N = Math.min(CONFIG.MATCH_PAIRS, t.cards.length);
  const picked = shuffle(t.cards).slice(0, N);

  // 각 카드를 es/ko 타일 2개로 분리한 뒤 섞기
  let tiles = [];
  picked.forEach((c, idx) => {
    tiles.push({ id: 'es' + idx, pair: idx, lang: 'es', text: c.es });
    tiles.push({ id: 'ko' + idx, pair: idx, lang: 'ko', text: c.ko });
  });
  tiles = shuffle(tiles);

  let selected = null;
  let matched = 0;
  const startTime = Date.now();
  let elapsed = 0;

  if (matchTimerId) clearInterval(matchTimerId);
  matchTimerId = setInterval(() => {
    elapsed = (Date.now() - startTime) / 1000;
    const el = $('matchTimer');
    if (el) el.textContent = elapsed.toFixed(1) + 's';
  }, CONFIG.MATCH_TICK_MS);

  function render() {
    const best = state.matchBest[t.id];
    body.innerHTML = `
      <div class="match-stage">
        <div class="match-bar">
          <div class="match-info">${N}쌍 · 빠르게 맞춰보세요</div>
          <div class="match-timer" id="matchTimer">0.0s</div>
          <div class="match-info">최고 기록 ${best ? best.toFixed(1) + 's' : '-'}</div>
        </div>
        <div class="match-grid" id="matchGrid">
          ${tiles.map(tile => `
            <button class="match-tile" data-id="${tile.id}" data-pair="${tile.pair}" data-lang="${tile.lang}">
              ${tile.text}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    body.querySelectorAll('.match-tile').forEach(tile => {
      tile.onclick = () => onTileClick(tile);
    });
  }

  /** 타일 클릭 처리: 선택 → 짝 비교 → 성공/실패 애니메이션 */
  function onTileClick(tile) {
    if (tile.classList.contains('matched') || tile.classList.contains('gone')) return;
    if (selected === tile) return;

    if (!selected) {
      selected = tile;
      tile.classList.add('selected');
      if (tile.dataset.lang === 'es') speak(tile.textContent.trim(), 'es-ES');
      return;
    }

    const isPair = selected.dataset.pair === tile.dataset.pair
                && selected.dataset.lang !== tile.dataset.lang;

    if (isPair) {
      // 매치 성공
      selected.classList.add('matched');
      tile.classList.add('matched');
      const a = selected, b = tile;
      setTimeout(() => { a.classList.add('gone'); b.classList.add('gone'); }, CONFIG.MATCH_ANIM_MS);
      matched++;
      selected = null;
      if (matched === N) finish();
    } else {
      // 매치 실패
      tile.classList.add('wrong');
      const prev = selected;
      setTimeout(() => {
        tile.classList.remove('wrong');
        prev.classList.remove('selected');
      }, CONFIG.MATCH_ANIM_MS);
      selected = null;
    }
  }

  function finish() {
    clearInterval(matchTimerId);
    matchTimerId = null;
    const time = elapsed;
    const best = state.matchBest[t.id];
    const isNewBest = !best || time < best;
    if (isNewBest) state.matchBest[t.id] = time;
    picked.forEach(c => state.learned.add(cardKey(t, c)));

    body.innerHTML = `<div class="match-result">${
      resultScreen({
        heading: isNewBest ? '🏆 신기록!' : '🎉 완료!',
        extra: `
          <div class="match-time-big">${time.toFixed(1)}s</div>
          <div class="match-best">${isNewBest ? '최고 기록 갱신!' : '최고 기록 · ' + best.toFixed(1) + 's'}</div>
        `,
        buttons: [
          { label: '한 번 더', onclick: "openMode('match')", primary: true },
          { label: '닫기', onclick: 'closeViewer()', primary: false },
        ],
      })
    }</div>`;
    setProgress(100);
  }

  render();
}

/* ===================== START ===================== */
init();
