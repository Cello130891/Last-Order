import { supabase } from './supabase.js';

// Utilities
const $ = (sel) => document.querySelector(sel);
const qs = (sel) => document.querySelectorAll(sel);

const generateCode = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
};

let currentGame = null;
let playersChannel = null;

async function createGameUI(name){
  const code = generateCode();
  // create game row
  await supabase.from('games').insert([{code, host_name: name, status:'open'}]);
  // insert host as player
  await supabase.from('players').insert([{game:code, name, is_host:true}]);
  return code;
}

function updateQRCode(url){
  const qr = encodeURIComponent(url);
  const src = `https://chart.googleapis.com/chart?cht=qr&chs=240x240&chl=${qr}`;
  $('#qr').src = src;
}

async function openLobby(code, myName, amHost){
  currentGame = code;
  $('#lobby-code').textContent = code;
  $('#game-code').textContent = code;
  $('#create-section').classList.add('hidden');
  $('#join-section').classList.add('hidden');
  $('#lobby').classList.remove('hidden');
  if (amHost) $('#host-controls').classList.remove('hidden');
  else $('#host-controls').classList.add('hidden');

  // initial load of players
  await refreshPlayers();

  // subscribe to player changes for this game
  if (playersChannel) await playersChannel.unsubscribe();
  playersChannel = supabase.channel(`players:${code}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `game=eq.${code}` }, async (payload) => {
      await refreshPlayers();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `code=eq.${code}` }, (payload)=>{
      const newStatus = payload.new?.status ?? payload.old?.status;
      if (newStatus === 'started'){
        $('#status').textContent = 'Game started';
        // TODO: navigate to game screen
      }
    })
    .subscribe();
}

async function refreshPlayers(){
  if(!currentGame) return;
  const { data, error } = await supabase.from('players').select('*').eq('game', currentGame).order('created_at', {ascending:true});
  if (error) return console.error(error);
  const list = $('#players-list');
  list.innerHTML = '';
  (data||[]).forEach(p=>{
    const li = document.createElement('li');
    li.textContent = p.name || 'Anonymous';
    if (p.is_host) {
      const span = document.createElement('span'); span.textContent = 'Host'; span.className='muted'; li.appendChild(span);
    }
    list.appendChild(li);
  });
  $('#player-count').textContent = (data||[]).length;
}

// Event handlers
$('#create-game').addEventListener('click', async ()=>{
  const name = ($('#host-name').value || 'Host').trim().slice(0,24);
  $('#create-game').disabled = true;
  const code = await createGameUI(name);
  updateQRCode(location.origin + location.pathname + `?code=${code}`);
  $('#created-info').classList.remove('hidden');
  await openLobby(code,name,true);
  $('#create-game').disabled = false;
});

$('#join-game').addEventListener('click', async ()=>{
  const name = ($('#join-name').value || 'Player').trim().slice(0,24);
  const code = ($('#join-code').value || '').trim().toUpperCase();
  if (!code || code.length !== 6){ $('#join-error').textContent = 'Enter a valid 6-character code'; return; }
  $('#join-game').disabled = true;
  // check game exists and is open
  const { data:game } = await supabase.from('games').select('*').eq('code', code).single();
  if (!game){ $('#join-error').textContent = 'Game not found'; $('#join-game').disabled = false; return; }
  if (game.status === 'started'){ $('#join-error').textContent = 'Game already started'; $('#join-game').disabled = false; return; }
  // insert player
  await supabase.from('players').insert([{game:code, name, is_host:false}]);
  $('#join-error').textContent = '';
  await openLobby(code,name,false);
  $('#join-game').disabled = false;
});

$('#start-game').addEventListener('click', async ()=>{
  if (!currentGame) return;
  // update game status to started
  await supabase.from('games').update({status:'started'}).eq('code', currentGame);
});

// Auto-join if code in query
window.addEventListener('load', ()=>{
  const params = new URLSearchParams(location.search);
  const code = (params.get('code')||'').toUpperCase();
  if (code && code.length===6){
    $('#join-code').value = code;
  }
});

