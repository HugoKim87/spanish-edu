/* =========================================================
   ¡Vamos! · 학습 앱 로직
   ---------------------------------------------------------
   이 파일은 data.js의 TOPICS 변수를 읽어 화면을 구성합니다.
   - 데이터 수정은 data.js만 편집하세요.
   - UI 동작/로직 변경은 이 파일을 편집하세요.

   모듈 구성:
   1. STATE & UTILS
   2. INIT & RENDERERS  (홈 화면)
   3. TTS               (Web Speech API)
   4. VIEWER            (모달 공통)
   5. MODE: FLASHCARDS
   6. MODE: LEARN
   7. MODE: TEST
   8. MODE: MATCH
   ========================================================= */

/* ===================== 1. STATE & UTILS ===================== */
const state = {
  topicId: TOPICS.length ? TOPICS[TOPICS.length - 1].id : undefined, // 기본 선택: 최신 Day
  sortOrder: 'desc', // 주제 정렬: 'desc'(최신순) | 'asc'(오래된순)
  learned: new Set(),
  marks: {},      // cardKey -> 'hard' | 'know' | null
  matchBest: {},  // topicId -> seconds
};

// Day 번호 추출 (id에서 숫자만) — 정렬 기준
function dayNumOf(t) {
  const n = parseInt(String(t.id).replace(/\D/g, ''), 10);
  return isNaN(n) ? -Infinity : n;
}
// 현재 정렬 순서가 적용된 주제 목록 반환
function sortedTopics() {
  const arr = [...TOPICS].sort((a, b) => dayNumOf(a) - dayNumOf(b)); // 오름차순 기본
  return state.sortOrder === 'desc' ? arr.reverse() : arr;
}

function getTopic() {
  return TOPICS.find(t => t.id === state.topicId);
}
function cardKey(t, c) {
  return t.id + '::' + c.es;
}
function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}
function normalize(s) {
  // 악센트/대소문자/구두점 무시 채점용
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[¿?¡!.,]/g, '');
}
function escapeAttr(s) {
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
// 학습한 카드 수를 화면 두 곳(상단 배지 + 통계)에 일관되게 반영
function updateLearnedCount() {
  const n = state.learned.size;
  const badge = document.getElementById('streakNum');
  const stat = document.getElementById('statLearned');
  if (badge) badge.textContent = n;
  if (stat) stat.textContent = n;
}

/* ===================== 2. INIT & HOME RENDERERS ===================== */
function init() {
  // 선택된 Day가 데이터에 없으면, 현재 정렬 기준의 첫 번째(기본=최신)로 보장
  if (TOPICS.length && !TOPICS.some(t => t.id === state.topicId)) {
    state.topicId = sortedTopics()[0].id;
  }
  const totalCards = TOPICS.reduce((s, t) => s + t.cards.length, 0);
  document.getElementById('totalWords').textContent = totalCards + '+';
  document.getElementById('statTotal').textContent = totalCards;
  document.getElementById('statTopics').textContent = TOPICS.length;

  // Day 범위(최소~최대)를 데이터에서 자동 계산해 문구에 반영
  // → data.js에 Day를 추가/삭제하면 화면 문구가 자동으로 갱신됨
  const dayNums = TOPICS
    .map(t => parseInt(String(t.id).replace(/\D/g, ''), 10))
    .filter(n => !isNaN(n));
  if (dayNums.length) {
    const min = Math.min(...dayNums);
    const max = Math.max(...dayNums);
    const range = min === max ? `Day ${min}` : `Day ${min} ~ Day ${max}`;
    const eyebrow = document.getElementById('heroEyebrow');
    const footer = document.getElementById('footerText');
    if (eyebrow) eyebrow.textContent = `실비아 Voca LAB · ${range}`;
    if (footer) {
      footer.textContent = `¡Vamos! 스페인어 학습 · ${range.replace(' ~ ', ' → ')} 통합 단어장 · 실비아 Voca LAB 기반`;
    }
  }

  // 정렬 토글 버튼 연결 (최신순/오래된순)
  const sortToggle = document.getElementById('sortToggle');
  if (sortToggle) {
    sortToggle.querySelectorAll('.sort-btn').forEach(btn => {
      btn.onclick = () => {
        state.sortOrder = btn.dataset.sort;
        sortToggle.querySelectorAll('.sort-btn').forEach(b =>
          b.classList.toggle('active', b === btn)
        );
        renderTopics(); // 칩 재정렬 (선택된 Day는 그대로 유지)
      };
    });
  }

  renderTopics();
  renderSetsGrid();
}

function renderTopics() {
  const bar = document.getElementById('topicBar');
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

function updateModeSub() {
  const t = getTopic();
  document.getElementById('modeSub').textContent =
    `${t.title} · ${t.cards.length}개 카드 · ${t.subtitle}`;
}

function renderSetsGrid() {
  const grid = document.getElementById('setsGrid');
  grid.innerHTML = '';
  const t = getTopic();
  t.cards.slice(0, 8).forEach(c => {
    const el = document.createElement('div');
    el.className = 'set-card';
    el.innerHTML = `
      <div class="set-emoji">${t.emoji}</div>
      <h4>${c.es}</h4>
      <div class="set-meta">${c.ko}</div>
    `;
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

function pickSpanishVoice(voices) {
  if (!voices || !voices.length) return null;
  // es-ES 우선, 그다음 아무 스페인어 변종(es-MX, es-US 등)
  return (
    voices.find(v => v.lang && v.lang.toLowerCase() === 'es-es') ||
    voices.find(v => v.lang && v.lang.toLowerCase().startsWith('es')) ||
    null
  );
}

function loadVoices() {
  if (!ttsState.supported) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices && voices.length) {
    ttsState.voices = voices;
    ttsState.spanishVoice = pickSpanishVoice(voices);
    ttsState.hasSpanish = !!ttsState.spanishVoice;
    ttsState.ready = true;
    // 음성 목록이 늦게 로드된 경우, 화면의 🔊 버튼 상태를 갱신
    refreshSpeakButtons();
  }
}

if (ttsState.supported) {
  // 일부 브라우저(크롬)는 getVoices()가 처음엔 빈 배열 → 이벤트로 다시 로드
  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices(); // 즉시 시도 (사파리/파이어폭스는 바로 채워짐)
  // 안전망: 이벤트가 안 올 때를 대비해 약간 지연 후 재시도
  setTimeout(loadVoices, 250);
  setTimeout(loadVoices, 1000);
}

function speak(text, lang = 'es-ES') {
  if (!ttsState.supported || !text) return;
  // 아직 음성 목록이 없으면 한 번 더 로드 시도
  if (!ttsState.ready) loadVoices();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 0.92;
  if (ttsState.spanishVoice) u.voice = ttsState.spanishVoice;
  window.speechSynthesis.speak(u);
}

// 화면에 떠 있는 🔊 버튼들의 사용 가능 여부를 갱신
function refreshSpeakButtons() {
  if (ttsState.supported && ttsState.hasSpanish) return; // 정상이면 표시 변경 불필요
  document.querySelectorAll('.fc-speak, .speak-mini').forEach(btn => {
    if (!ttsState.supported) {
      btn.title = '이 브라우저는 음성 재생을 지원하지 않습니다';
    } else if (!ttsState.hasSpanish) {
      // 스페인어 음성이 없으면 기본 음성으로 읽히므로 발음이 부정확할 수 있음을 안내
      btn.title = '스페인어 음성이 없어 기본 음성으로 재생됩니다 (기기에 스페인어 음성 설치 권장)';
      btn.style.opacity = '0.55';
    }
  });
}


/* ===================== 4. VIEWER (modal) ===================== */
const viewer = document.getElementById('viewer');
const body = document.getElementById('viewerBody');
const titleEl = document.getElementById('viewerTitle');
const progressBar = document.getElementById('progressBar');

let activeMode = null; // 현재 열려 있는 학습 모드 ('flashcards' | 'learn' | 'test' | 'match' | null)

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
      document.getElementById('fc')?.classList.toggle('flipped');
    } else if (e.key === 'ArrowRight') {
      document.getElementById('nextBtn')?.click();
    } else if (e.key === 'ArrowLeft') {
      document.getElementById('prevBtn')?.click();
    }
  }
});

function openMode(mode) {
  const t = getTopic();
  activeMode = mode;
  viewer.classList.add('open');
  titleEl.innerHTML = `${t.title} <span class="small">${t.subtitle}</span>`;
  progressBar.style.width = '0%';
  if (mode === 'flashcards') runFlashcards(t);
  if (mode === 'learn')      runLearn(t);
  if (mode === 'test')       runTest(t);
  if (mode === 'match')      runMatch(t);
}

/* ===================== 5. MODE: FLASHCARDS ===================== */
function runFlashcards(t) {
  let i = 0;
  const cards = shuffle(t.cards); // 랜덤 순서로 출제

  function render() {
    progressBar.style.width = ((i + 1) / cards.length * 100) + '%';
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
              <button class="fc-speak" onclick="event.stopPropagation(); speak('${escapeAttr(c.es)}', 'es-ES')" title="발음 듣기">🔊</button>
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

    const fc = document.getElementById('fc');
    fc.onclick = () => fc.classList.toggle('flipped');
    document.getElementById('prevBtn').onclick = () => { if (i > 0) { i--; render(); } };
    document.getElementById('nextBtn').onclick = () => {
      if (i < cards.length - 1) { i++; state.learned.add(key); render(); }
    };
    document.getElementById('hardBtn').onclick = () => {
      state.marks[key] = markedHard ? null : 'hard';
      render();
    };
    document.getElementById('knowBtn').onclick = () => {
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
function runLearn(t) {
  // 객관식 / 단답형 섞어서 출제, 오답은 큐 뒤로 보내서 재출제
  // 카드 순서를 랜덤으로 섞은 뒤, 약 1/4 비율로 단답형을 무작위 배치
  let queue = shuffle(t.cards).map((c) => ({
    card: c,
    type: Math.random() < 0.25 ? 'fill' : 'choice',
    tries: 0,
  }));
  let completed = 0;
  const total = queue.length;

  function nextQ() {
    if (queue.length === 0) {
      body.innerHTML = `
        <div style="text-align:center; padding: 40px 12px;">
          <div style="font-size:60px; margin-bottom:8px;">🎉</div>
          <h2 style="font-size:28px; font-weight:900; margin-bottom:8px; letter-spacing:-.02em;">완료!</h2>
          <p style="color:var(--text-soft); margin-bottom:18px;">${t.title}의 모든 단어를 학습했어요.</p>
          <button class="btn-primary" onclick="closeViewer()">홈으로</button>
        </div>
      `;
      progressBar.style.width = '100%';
      return;
    }
    const q = queue.shift();
    progressBar.style.width = (completed / total * 100) + '%';
    if (q.type === 'choice') renderChoice(q);
    else                     renderFill(q);
  }

  function renderChoice(q) {
    const others = t.cards.filter(c => c.es !== q.card.es);
    const distractors = shuffle(others).slice(0, 3);
    const options = shuffle([...distractors.map(c => c.ko), q.card.ko]);

    body.innerHTML = `
      <div class="learn-stage">
        <div class="learn-question">객관식 · ${completed + 1} / ${total}</div>
        <div class="learn-prompt">
          ${q.card.es}
          <button class="speak-mini" onclick="speak('${escapeAttr(q.card.es)}','es-ES')">🔊</button>
        </div>
        <div class="learn-instr">알맞은 한국어 뜻을 고르세요</div>
        <div class="learn-options" id="optsBox">
          ${options.map((opt, i) => `
            <button class="learn-option" data-correct="${opt === q.card.ko}" data-opt="${i}">
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
        const correct = b.dataset.correct === 'true';
        body.querySelectorAll('.learn-option').forEach(x => {
          x.style.pointerEvents = 'none';
          if (x.dataset.correct === 'true') x.classList.add('correct');
        });
        if (!correct) {
          b.classList.add('wrong');
          queue.push({ ...q, tries: q.tries + 1 });
          const fb = document.getElementById('fb');
          fb.className = 'learn-feedback bad show';
          fb.textContent = `정답: ${q.card.ko} · 나중에 다시 출제됩니다`;
        } else {
          const fb = document.getElementById('fb');
          fb.className = 'learn-feedback ok show';
          fb.textContent = '정답!';
          completed++;
          state.learned.add(cardKey(t, q.card));
        }
        const next = document.getElementById('nextBtn');
        next.classList.add('show');
        next.onclick = nextQ;
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
    const input = document.getElementById('ansInput');
    input.focus();
    function submit() {
      const val = input.value;
      if (!val.trim()) return;
      const ok = normalize(val) === normalize(q.card.es);
      input.disabled = true;
      input.classList.add(ok ? 'correct' : 'wrong');
      const fb = document.getElementById('fb');
      if (ok) {
        fb.className = 'learn-feedback ok show';
        fb.textContent = '정답!';
        completed++;
        state.learned.add(cardKey(t, q.card));
      } else {
        fb.className = 'learn-feedback bad show';
        fb.textContent = `정답: ${q.card.es} · 나중에 다시 출제됩니다`;
        queue.push({ ...q, tries: q.tries + 1 });
      }
      const next = document.getElementById('nextBtn');
      next.classList.add('show');
      next.onclick = nextQ;
    }
    input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  }

  nextQ();
}

/* ===================== 7. MODE: TEST ===================== */
function runTest(t) {
  // 종합 시험: 선택형 3 + 진위형 2 + 단답형 2 + 매칭형 2 = 9문제
  const cards = shuffle(t.cards);
  const c1 = cards.slice(0, 3);
  const c2 = cards.slice(3, 5);
  const c3 = cards.slice(5, 7);
  const c4 = cards.slice(7, 9);

  const questions = [
    ...c1.map(c => ({
      type: 'choice', tag: '선택형',
      q: c.es, a: c.ko,
      options: shuffle([c.ko, ...shuffle(cards.filter(x => x.es !== c.es)).slice(0, 3).map(x => x.ko)]),
    })),
    ...c2.map(c => {
      const flip = Math.random() > 0.5;
      // 가짜 뜻은 정답 뜻과 달라야 함 (우연히 같으면 진위 판정이 깨짐)
      const pool = cards.filter(x => x.es !== c.es && x.ko !== c.ko);
      const fakeKo = (pool.length ? shuffle(pool)[0] : shuffle(cards.filter(x => x.es !== c.es))[0]).ko;
      return {
        type: 'tf', tag: '진위형',
        q: `"${c.es}" = "${flip ? c.ko : fakeKo}"`,
        a: flip ? 'O' : 'X',
      };
    }),
    ...c3.map(c => ({
      type: 'fill', tag: '단답형',
      q: c.ko, a: c.es, hint: '(스페인어로)',
    })),
    ...c4.map(c => ({
      type: 'choice', tag: '매칭형',
      q: c.ko, a: c.es,
      options: shuffle([c.es, ...shuffle(cards.filter(x => x.es !== c.es)).slice(0, 3).map(x => x.es)]),
    })),
  ];

  const answers = {};

  // 방어: 카드가 비정상적으로 적어 문제가 하나도 안 만들어지면 안내 후 종료
  if (questions.length === 0) {
    body.innerHTML = `
      <div style="text-align:center; padding: 40px 12px;">
        <p style="color:var(--text-soft); margin-bottom:18px;">이 주제는 시험을 만들기에 카드가 부족합니다.</p>
        <button class="btn-primary" onclick="closeViewer()">닫기</button>
      </div>
    `;
    return;
  }

  function render() {
    progressBar.style.width = '0%';
    body.innerHTML = `
      <div class="test-stage">
        ${questions.map((q, i) => `
          <div class="test-q-block" data-i="${i}">
            <span class="test-q-tag">${q.tag} · ${i + 1}</span>
            <div class="test-q-text">${q.q}${q.hint ? ' <span style="color:var(--text-mute); font-size:14px; font-weight:500;">' + q.hint + '</span>' : ''}</div>
            ${q.type === 'choice' ? `
              <div class="test-opt-grid">
                ${q.options.map(o => `<button class="test-opt" data-val="${escapeAttr(o)}">${o}</button>`).join('')}
              </div>
            ` : ''}
            ${q.type === 'tf' ? `
              <div class="test-tf">
                <button class="test-opt" data-val="O">⭕ 맞다</button>
                <button class="test-opt" data-val="X">❌ 틀리다</button>
              </div>
            ` : ''}
            ${q.type === 'fill' ? `
              <input class="test-input" data-i="${i}" placeholder="여기에 입력..." autocomplete="off" />
            ` : ''}
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

    document.getElementById('submitBtn').onclick = grade;
  }

  function grade() {
    let correct = 0;
    const review = questions.map((q, i) => {
      const my = answers[i] || '';
      const ok = normalize(my) === normalize(q.a);
      if (ok) correct++;
      return { q, my, ok };
    });
    const score = Math.round(correct / questions.length * 100);
    progressBar.style.width = '100%';

    body.innerHTML = `
      <div class="test-result">
        <div class="test-score-circle" style="--p: ${score * 3.6}deg;">
          <div class="num">${score}%</div>
        </div>
        <div class="test-score-label">${correct} / ${questions.length} 정답</div>
        <button class="btn-primary" onclick="openMode('test')">다시 풀기</button>
        <button class="btn-outline" style="margin-left:8px;" onclick="closeViewer()">닫기</button>
        <div class="test-review">
          ${review.map(r => `
            <div class="test-review-item ${r.ok ? '' : 'wrong'}">
              <div class="label">${r.ok ? '✅ 정답' : '❌ 오답'} · ${r.q.tag}</div>
              <div><strong>Q:</strong> ${r.q.q}</div>
              <div><strong>내 답:</strong> ${r.my || '<i style="color:var(--text-mute)">(미응답)</i>'} · <strong>정답:</strong> ${r.q.a}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // 정답 카드는 학습 완료로 기록
    review.forEach(r => {
      if (r.ok) {
        const card = t.cards.find(c =>
          c.es === r.q.a || c.ko === r.q.a || c.es === r.q.q || c.ko === r.q.q
        );
        if (card) state.learned.add(cardKey(t, card));
      }
    });
  }

  render();
}

/* ===================== 8. MODE: MATCH ===================== */
let matchTimerId = null;

function runMatch(t) {
  const N = Math.min(6, t.cards.length); // 6쌍
  const picked = shuffle(t.cards).slice(0, N);
  let tiles = [];
  picked.forEach((c, idx) => {
    tiles.push({ id: 'es' + idx, pair: idx, lang: 'es', text: c.es });
    tiles.push({ id: 'ko' + idx, pair: idx, lang: 'ko', text: c.ko });
  });
  tiles = shuffle(tiles);

  let selected = null;
  let matched = 0;
  let startTime = Date.now();
  let elapsed = 0;
  if (matchTimerId) clearInterval(matchTimerId);
  matchTimerId = setInterval(() => {
    elapsed = (Date.now() - startTime) / 1000;
    const el = document.getElementById('matchTimer');
    if (el) el.textContent = elapsed.toFixed(1) + 's';
  }, 100);

  function render() {
    body.innerHTML = `
      <div class="match-stage">
        <div class="match-bar">
          <div class="match-info">${N}쌍 · 빠르게 맞춰보세요</div>
          <div class="match-timer" id="matchTimer">0.0s</div>
          <div class="match-info">최고 기록 ${state.matchBest[t.id] ? state.matchBest[t.id].toFixed(1) + 's' : '-'}</div>
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
      tile.onclick = () => {
        if (tile.classList.contains('matched') || tile.classList.contains('gone')) return;
        if (selected === tile) return;
        if (!selected) {
          selected = tile;
          tile.classList.add('selected');
          if (tile.dataset.lang === 'es') speak(tile.textContent.trim(), 'es-ES');
        } else {
          if (selected.dataset.pair === tile.dataset.pair && selected.dataset.lang !== tile.dataset.lang) {
            // 매치 성공
            selected.classList.add('matched');
            tile.classList.add('matched');
            const a = selected, b = tile;
            setTimeout(() => { a.classList.add('gone'); b.classList.add('gone'); }, 380);
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
            }, 380);
            selected = null;
          }
        }
      };
    });
  }

  function finish() {
    clearInterval(matchTimerId);
    matchTimerId = null;
    const time = elapsed;
    const best = state.matchBest[t.id];
    const isNewBest = !best || time < best;
    if (isNewBest) state.matchBest[t.id] = time;
    picked.forEach(c => state.learned.add(cardKey(t, c)));

    body.innerHTML = `
      <div class="match-result">
        <h2>${isNewBest ? '🏆 신기록!' : '🎉 완료!'}</h2>
        <div class="match-time-big">${time.toFixed(1)}s</div>
        <div class="match-best">${isNewBest ? '최고 기록 갱신!' : '최고 기록 · ' + best.toFixed(1) + 's'}</div>
        <button class="btn-primary" onclick="openMode('match')">한 번 더</button>
        <button class="btn-outline" style="margin-left:8px;" onclick="closeViewer()">닫기</button>
      </div>
    `;
    progressBar.style.width = '100%';
  }

  render();
}

/* ===================== START ===================== */
init();
