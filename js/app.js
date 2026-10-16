// Replace js/app.js with the following content
import { supabase } from './supabase.js';

// Utils
const $ = (s) => document.querySelector(s);
const create = (tag, props = {}) => {
  const el = document.createElement(tag);
  Object.assign(el, props);
  return el;
};

// Local identity for anonymous players (keeps host controls working without auth)
const CLIENT_PLAYER_KEY = 'lastorder_player_id';
let clientPlayerId = localStorage.getItem(CLIENT_PLAYER_KEY);
if (!clientPlayerId) {
  clientPlayerId = crypto.randomUUID();
  localStorage.setItem(CLIENT_PLAYER_KEY, clientPlayerId);
}

// App state
let myName = null;
let isHost = false;
let currentGame = null;
let currentRound = null;
let currentQuestions = []; // loaded from DB for current round
let currentQuestionIndex = 0;
let channels = [];

// Rotation types for non-estimation questions
const ROTATION = ['multiple_choice', 'true_false', 'ranking', 'comparison'];

// --- Helpers for DB-backed flow ---

async function createGame(name) {
  const code = generateCode();
  await supabase.from('games').insert([{ code, host_name: name, status: 'open' }]);
  // insert host as player; include client id so we can identify locally
  await supabase.from('players').insert([{ game: code, name, is_host: true, client_id: clientPlayerId }]);
  return code;
}

async function joinGame(code, name) {
  // check game exists and is open
  const { data: game } = await supabase.from('games').select('*').eq('code', code).single();
  if (!game) throw new Error('Game not found');
  if (game.status === 'started') throw new Error('Game already started');
  await supabase.from('players').insert([{ game: code, name, is_host: false, client_id: clientPlayerId }]);
  return game;
}

async function startGameFlow(code) {
  // update games.status
  await supabase.from('games').update({ status: 'started' }).eq('code', code);
  // create round 1
  await createRound(code, 1);
}

async function createRound(gameCode, roundNumber) {
  // insert round record
  const { error: rErr } = await supabase.from('rounds').insert([{ game: gameCode, round_number: roundNumber, status: 'open' }]);
  if (rErr) console.error('create round error', rErr);

  // generate questions for this round and insert them
  const questions = generateQuestionsForRound(gameCode, roundNumber);
  // questions need fields: game, round_number, type, text, options (JSON)
  const { error: qErr } = await supabase.from('questions').insert(questions);
  if (qErr) console.error('insert questions error', qErr);

  // set currentRound locally if this client is viewing same game
  if (currentGame === gameCode) {
    currentRound = roundNumber;
    currentQuestionIndex = 0;
    await loadQuestionsForCurrentRound();
  }
  return true;
}

function generateQuestionsForRound(gameCode, roundNumber) {
  // exactly 3 questions per round
  // 1 estimation + 2 rotating types (rotation based on roundNumber to keep variety)
  const types = [];
  types.push('estimation');

  // choose two rotating types based on roundNumber
  const start = (roundNumber - 1) % ROTATION.length;
  types.push(ROTATION[start]);
  types.push(ROTATION[(start + 1) % ROTATION.length]);

  // create simple placeholder text & options — you can replace with OpenAI generation later
  return types.map((type, idx) => {
    const base = {
      game: gameCode,
      round_number: roundNumber,
      type,
      text: '',
      options: null
    };
    if (type === 'estimation') {
      base.text = `Estimate how many ${pickRandom(['sips', 'shots', 'people'])} will be needed for this round.`;
      base.options = null;
    } else if (type === 'multiple_choice') {
      const opts = [
        'Option A',
        'Option B',
        'Option C',
        'Option D'
      ].map((t,i)=> ({ id: i+1, text: t }));
      base.text = `Which of the following is true?`;
      base.options = opts;
    } else if (type === 'true_false') {
      base.text = `Is the following statement true or false: "${sampleStatement()}"`;
      base.options = [{ id: 1, text: 'True' }, { id: 2, text: 'False' }];
    } else if (type === 'ranking') {
      base.text = `Rank these items from most to least likely:`;
      base.options = ['Red', 'Blue', 'Green', 'Yellow'];
    } else if (type === 'comparison') {
      base.text = `Which would you rather: A or B?`;
      base.options = ['A', 'B'];
    }
    return base;
  });
}

// --- Realtime subscriptions & loaders ---

function clearChannels() {
  channels.forEach(ch => ch.unsubscribe?.());
  channels = [];
}

function subscribeToGame(gameCode) {
  clearChannels();
  // subscribe players
  const chPlayers = supabase.channel(`public:players:game=eq.${gameCode}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `game=eq.${gameCode}` }, payload => refreshPlayersList())
    .subscribe();
  channels.push(chPlayers);

  // subscribe games (to track status)
  const chGames = supabase.channel(`public:games:code=eq.${gameCode}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `code=eq.${gameCode}` }, payload => {
      const newStatus = payload.new?.status ?? payload.old?.status;
      if (newStatus === 'started') {
        showGameView();
        // load current round (choose the latest open round)
        loadLatestRoundForGame(gameCode);
      }
    })
    .subscribe();
  channels.push(chGames);

  // subscribe rounds for this game
  const chRounds = supabase.channel(`public:rounds:game=eq.${gameCode}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `game=eq.${gameCode}` }, payload => {
      loadLatestRoundForGame(gameCode);
    })
    .subscribe();
  channels.push(chRounds);

  // subscribe questions (we'll load questions for a round separately and react to db changes)
  const chQuestions = supabase.channel(`public:questions:game=eq.${gameCode}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `game=eq.${gameCode}` }, payload => {
      // if payload pertains to our current round, reload questions
      loadQuestionsForCurrentRound();
    })
    .subscribe();
  channels.push(chQuestions);

  // subscribe answers (for live updates / scoreboard extension)
  const chAnswers = supabase.channel(`public:answers:game=eq.${gameCode}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'answers', filter: `game=eq.${gameCode}` }, payload => {
      // you may use answers to show live tally — left as extension
      // console.log('answer change', payload);
    })
    .subscribe();
  channels.push(chAnswers);
}

async function loadLatestRoundForGame(gameCode) {
  // pick latest round_number for this game that has status 'open' or the highest number
  const { data: rounds } = await supabase.from('rounds').select('*').eq('game', gameCode).order('round_number', { ascending: false }).limit(1);
  if (rounds && rounds.length) {
    currentRound = rounds[0].round_number;
    await loadQuestionsForCurrentRound();
  }
}

async function loadQuestionsForCurrentRound() {
  if (!currentGame || !currentRound) return;
  const { data } = await supabase.from('questions').select('*').eq('game', currentGame).eq('round_number', currentRound).order('id', { ascending: true });
  currentQuestions = data || [];
  currentQuestionIndex = 0;
  renderCurrentQuestion();
}

// --- UI rendering ---

function showLobbyView() {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('#lobby-view').classList.remove('hidden');
}

function showHomeView() {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('#home-view').classList.remove('hidden');
}

function showGameView() {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('#game-view').classList.remove('hidden');
}

async function refreshPlayersList() {
  if (!currentGame) return;
  const { data } = await supabase.from('players').select('*').eq('game', currentGame).order('created_at', { ascending: true });
  const ul = $('#players-list');
  ul.innerHTML = '';
  (data || []).forEach(p => {
    const li = create('li');
    li.className = 'player-row';
    li.textContent = p.name || 'Anonymous';
    if (p.is_host) {
      const tag = create('span'); tag.className = 'muted'; tag.textContent = ' Host'; li.appendChild(tag);
    }
    // mark local player
    if (p.client_id === clientPlayerId) {
      const me = create('strong'); me.textContent = ' (You)'; li.appendChild(me);
    }
    ul.appendChild(li);
  });
  $('#player-count').textContent = (data || []).length;
}

function renderCurrentQuestion() {
  const container = document.querySelector('#game-view .game-box') || $('#game-view .card');
  // ensure a question area exists
  let qArea = container.querySelector('#question-area');
  if (!qArea) {
    qArea = create('div', { id: 'question-area' });
    container.appendChild(qArea);
  }
  qArea.innerHTML = '';

  if (!currentQuestions.length) {
    qArea.appendChild(create('p', { textContent: 'No questions yet for this round.' }));
    return;
  }
  const q = currentQuestions[currentQuestionIndex];
  const qTitle = create('h3', { textContent: `Q${currentQuestionIndex + 1}: ${q.type.replace('_', ' ')}` });
  qArea.appendChild(qTitle);
  qArea.appendChild(create('p', { textContent: q.text }));

  // answer UI per type
  if (q.type === 'estimation') {
    const input = create('input'); input.type = 'number'; input.id = 'answer-input'; input.placeholder = 'Enter your estimate';
    qArea.appendChild(input);
    const btn = create('button', { textContent: 'Submit', id: 'answer-submit', className: 'primary-btn' });
    btn.addEventListener('click', () => submitAnswer(q, input.value));
    qArea.appendChild(btn);
  } else if (q.type === 'multiple_choice') {
    const opts = q.options || [];
    opts.forEach(opt => {
      const btn = create('button', { textContent: opt.text, className: 'option-btn' });
      btn.addEventListener('click', () => submitAnswer(q, opt));
      qArea.appendChild(btn);
    });
  } else if (q.type === 'true_false') {
    const tbtn = create('button', { textContent: 'True', className: 'option-btn' });
    const fbtn = create('button', { textContent: 'False', className: 'option-btn' });
    tbtn.addEventListener('click', () => submitAnswer(q, 'True'));
    fbtn.addEventListener('click', () => submitAnswer(q, 'False'));
    qArea.appendChild(tbtn);
    qArea.appendChild(fbtn);
  } else if (q.type === 'ranking' || q.type === 'comparison') {
    const opts = q.options || [];
    // simple representation: pick one or send order as JSON (full ranking UI is a future improvement)
    opts.forEach((o, idx) => {
      const btn = create('button', { textContent: (typeof o === 'string' ? o : o.text), className: 'option-btn' });
      btn.addEventListener('click', () => submitAnswer(q, { selected: idx, value: o }));
      qArea.appendChild(btn);
    });
  }

  // navigation for questions (host and players)
  const nav = create('div');
  nav.style.marginTop = '12px';
  if (currentQuestionIndex > 0) {
    const prev = create('button', { textContent: 'Previous', className: 'secondary-btn' });
    prev.addEventListener('click', () => { currentQuestionIndex--; renderCurrentQuestion(); });
    nav.appendChild(prev);
  }
  if (currentQuestionIndex < currentQuestions.length - 1) {
    const next = create('button', { textContent: 'Next', className: 'secondary-btn' });
    next.addEventListener('click', () => { currentQuestionIndex++; renderCurrentQuestion(); });
    nav.appendChild(next);
  }
  qArea.appendChild(nav);
}

// Submit answer record to DB
async function submitAnswer(question, answerValue) {
  if (!currentGame || !currentRound || !question) return;
  // store answer as flexible JSON; columns: game, round_number, question_id, player_name, client_id, answer
  const payload = {
    game: currentGame,
    round_number: currentRound,
    question_id: question.id,
    player_name: myName,
    client_id: clientPlayerId,
    answer: typeof answerValue === 'object' ? answerValue : String(answerValue)
  };
  const { error } = await supabase.from('answers').insert([payload]);
  if (error) {
    console.error('submit answer error', error);
    alert('Failed to submit answer');
  } else {
    // optional: show local confirmation
    const msg = $('#game-message'); if (msg) msg.textContent = 'Answer submitted';
  }
}

// Utility randoms
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function sampleStatement() {
  const S = [
    'The sky is green.',
    'Coffee contains caffeine.',
    'The game was invented in 2020.',
    'Cats can fly.'
  ];
  return pickRandom(S);
}

function generateCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// --- Event wiring for UI (create/join/start/next round) ---

// Create game button
$('#create-game').addEventListener('click', async () => {
  const nameVal = ($('#host-name').value || 'Host').trim().slice(0, 24);
  myName = nameVal;
  isHost = true;
  $('#create-game').disabled = true;
  try {
    const code = await createGame(myName);
    currentGame = code;
    $('#game-code').textContent = code;
    $('#created-info').classList.remove('hidden');
    $('#qr').src = `https://chart.googleapis.com/chart?cht=qr&chs=240x240&chl=${encodeURIComponent(location.origin + location.pathname + '?code=' + code)}`;

    // show lobby view & subscribe
    showLobbyView();
    subscribeToGame(code);
    await refreshPlayersList();
  } catch (err) {
    console.error(err);
    alert('Create game failed');
  } finally {
    $('#create-game').disabled = false;
  }
});

// Join game button
$('#join-game').addEventListener('click', async () => {
  const nameVal = ($('#join-name').value || 'Player').trim().slice(0, 24);
  const code = ($('#join-code').value || '').trim().toUpperCase();
  if (!code || code.length !== 6) { $('#join-error').textContent = 'Enter a valid 6-character code'; return; }
  myName = nameVal;
  isHost = false;
  $('#join-game').disabled = true;
  try {
    await joinGame(code, myName);
    currentGame = code;
    // update UI
    $('#join-error').textContent = '';
    showLobbyView();
    subscribeToGame(code);
    await refreshPlayersList();
  } catch (err) {
    $('#join-error').textContent = err.message || 'Failed to join';
  } finally {
    $('#join-game').disabled = false;
  }
});

// Start game (host)
$('#start-game').addEventListener('click', async () => {
  if (!currentGame) return;
  if (!isHost) return alert('Only host can start');
  $('#start-game').disabled = true;
  try {
    await startGameFlow(currentGame);
    // show game view
    showGameView();
  } catch (err) {
    console.error(err);
    alert('Failed to start game');
  } finally {
    $('#start-game').disabled = false;
  }
});

// Next Round (host)
$('#next-round').addEventListener('click', async () => {
  if (!currentGame || !isHost) return;
  $('#next-round').disabled = true;
  try {
    // mark current round as finished (optional)
    if (currentRound != null) {
      await supabase.from('rounds').update({ status: 'finished' }).eq('game', currentGame).eq('round_number', currentRound);
    }
    const next = (currentRound || 0) + 1;
    await createRound(currentGame, next);
    // auto-set currentRound locally when DB notifies
  } catch (err) {
    console.error(err);
    alert('Failed to create next round');
  } finally {
    $('#next-round').disabled = false;
  }
});

// Auto-fill join-code if query param exists
window.addEventListener('load', () => {
  const params = new URLSearchParams(location.search);
  const code = (params.get('code') || '').toUpperCase();
  if (code && code.length === 6) {
    $('#join-code').value = code;
  }

  // initial home view
  showHomeView();
});
