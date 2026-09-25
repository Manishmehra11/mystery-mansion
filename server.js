const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(__dirname));
app.get('/health', (_, res) => res.json({ ok: true }));

const scenarios = [
  { incident: 'A priceless diamond vanished from the mansion vault at midnight.', normal: ['You heard a clock chime twelve times.', 'You noticed muddy footprints near the conservatory.', 'A window was found slightly open.', 'The butler was polishing silver in the dining room.', 'A candle was burning in the library.', 'The garden gate was locked.'], suspect: 'You were near the vault shortly before midnight and saw something you cannot explain.' },
  { incident: 'The mansion lights suddenly went out, and a painting disappeared.', normal: ['You heard footsteps on the staircase.', 'Someone dropped a metal object in the hall.', 'The generator room smelled of smoke.', 'You saw a shadow near the gallery.', 'A security camera stopped recording.', 'Rain was hitting the east windows.'], suspect: 'You were inside the gallery when the lights failed and had a clear chance to take the painting.' },
  { incident: 'A secret letter was stolen from the locked study.', normal: ['The study clock was five minutes slow.', 'A cup of tea was still warm.', 'The corridor window was open.', 'A book lay face-down on the floor.', 'You heard a door close upstairs.', 'The fireplace was still warm.'], suspect: 'You knew exactly where the secret letter was kept before anyone else did.' },
  { incident: 'Someone sabotaged the mansion’s grand dinner before the guests arrived.', normal: ['A tray was left in the kitchen.', 'The dining room candles were freshly lit.', 'A servant heard a cupboard slam.', 'The pantry door was unlocked.', 'A glass was found on the floor.', 'The chef was checking the oven.'], suspect: 'You entered the kitchen alone shortly before the dinner was ruined.' }
];

function code() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function cleanName(name) { return String(name || 'Player').trim().slice(0, 18) || 'Player'; }
function publicRoom(room) {
  return { code: room.code, phase: room.phase, round: room.round, totalRounds: room.totalRounds, players: [...room.players.values()].map(p => ({ id:p.id, name:p.name, score:p.score, connected:p.connected, host:p.id===room.hostId, voted: !!room.votes[p.id] })) };
}
function sendState(room) { io.to(room.code).emit('state', publicRoom(room)); }
function uniqueCode() { let c; do c=code(); while(rooms.has(c)); return c; }
function clearTimer(room) { if (room.timer) clearTimeout(room.timer); room.timer=null; }
function startDiscussion(room) {
  room.phase='discussion'; room.timeLeft=30; sendRound(room);
  const tick=()=>{ room.timeLeft--; io.to(room.code).emit('timer', room.timeLeft); if(room.timeLeft<=0) startVoting(room); else room.timer=setTimeout(tick,1000); };
  room.timer=setTimeout(tick,1000);
}
function startVoting(room) {
  clearTimer(room); room.phase='voting'; room.timeLeft=20; room.votes={}; room.voteTimes={}; sendState(room); io.to(room.code).emit('votingStart', { timeLeft: room.timeLeft });
  const tick=()=>{ room.timeLeft--; io.to(room.code).emit('timer', room.timeLeft); if(room.timeLeft<=0) reveal(room); else room.timer=setTimeout(tick,1000); };
  room.timer=setTimeout(tick,1000);
}
function sendRound(room) {
  sendState(room);
  for (const p of room.players.values()) {
    io.to(p.socketId).emit('round', { incident: room.incident, clue: room.clues[p.id], suspect: false, round: room.round, totalRounds: room.totalRounds });
  }
}
function beginRound(room) {
  clearTimer(room); room.votes={}; room.voteTimes={}; room.phase='loading';
  const s=scenarios[(room.round-1)%scenarios.length]; room.incident=s.incident;
  const players=[...room.players.values()]; room.suspectId=players[Math.floor(Math.random()*players.length)].id; room.clues={};
  const normals=[...s.normal].sort(()=>Math.random()-0.5);
  players.forEach((p,i)=>{ room.clues[p.id] = p.id===room.suspectId ? s.suspect : normals[i%normals.length]; });
  setTimeout(()=>startDiscussion(room),700);
}
function startGame(room) { room.round=1; room.totalRounds=5; room.finished=false; beginRound(room); }
function reveal(room) {
  clearTimer(room); if(room.phase!=='voting') return; room.phase='reveal';
  const counts={}; for(const id of Object.values(room.votes)) counts[id]=(counts[id]||0)+1;
  const max=Math.max(0,...Object.values(counts));
  for(const p of room.players.values()) {
    if(room.votes[p.id]===room.suspectId) p.score+=2;
  }
  if((counts[room.suspectId]||0)===0) room.players.get(room.suspectId).score+=3;
  for(const p of room.players.values()) if(p.id!==room.suspectId && max>0 && (counts[p.id]||0)===max) p.score-=1;
  sendState(room); io.to(room.code).emit('reveal', { suspectId: room.suspectId, suspectName: room.players.get(room.suspectId)?.name, votes: counts, incident: room.incident });
  room.timer=setTimeout(()=>{ if(room.round<room.totalRounds){ room.round++; beginRound(room); } else finishGame(room); },7000);
}
function finishGame(room){ clearTimer(room); room.phase='finished'; room.finished=true; const standings=[...room.players.values()].sort((a,b)=>b.score-a.score); io.to(room.code).emit('gameOver',{ standings:standings.map(p=>({id:p.id,name:p.name,score:p.score})) }); sendState(room); }

io.on('connection', socket=>{
  socket.on('createRoom', ({name, playerId})=>{
    const room={code:uniqueCode(),hostId:playerId,players:new Map(),phase:'lobby',round:0,totalRounds:5,votes:{},voteTimes:{},timer:null,finished:false};
    room.players.set(playerId,{id:playerId,name:cleanName(name),score:0,socketId:socket.id,connected:true}); rooms.set(room.code,room); socket.join(room.code); socket.data={room:room.code,playerId}; socket.emit('joined',{code:room.code,playerId}); sendState(room);
  });
  socket.on('joinRoom', ({name,code,playerId})=>{
    const room=rooms.get(String(code||'').toUpperCase()); if(!room) return socket.emit('errorMsg','Room not found. Check the code.');
    if(room.phase!=='lobby' && !room.players.has(playerId)) return socket.emit('errorMsg','That game has already started.');
    if(room.players.size>=8 && !room.players.has(playerId)) return socket.emit('errorMsg','Room is full.');
    const existing=room.players.get(playerId); if(existing){ existing.socketId=socket.id; existing.connected=true; } else room.players.set(playerId,{id:playerId,name:cleanName(name),score:0,socketId:socket.id,connected:true});
    socket.join(room.code); socket.data={room:room.code,playerId}; socket.emit('joined',{code:room.code,playerId}); sendState(room);
    if(room.phase==='discussion'||room.phase==='voting'||room.phase==='reveal') socket.emit('round',{incident:room.incident,clue:room.clues[playerId],round:room.round,totalRounds:room.totalRounds});
  });
  socket.on('startGame',()=>{ const room=rooms.get(socket.data?.room); if(!room||room.hostId!==socket.data.playerId||room.players.size<2||room.phase!=='lobby') return; startGame(room); });
  socket.on('vote',targetId=>{ const room=rooms.get(socket.data?.room); const voter=socket.data?.playerId; if(!room||room.phase!=='voting'||room.votes[voter]||targetId===voter||!room.players.has(targetId)) return; room.votes[voter]=targetId; room.voteTimes[voter]=Date.now(); io.to(socket.id).emit('voteLocked',targetId); sendState(room); if(Object.keys(room.votes).length===room.players.size) reveal(room); });
  socket.on('disconnect',()=>{ const room=rooms.get(socket.data?.room); const p=room?.players.get(socket.data?.playerId); if(p){p.connected=false; sendState(room);} });
});

server.listen(PORT,'0.0.0.0',()=>console.log(`Mystery Mansion running on http://localhost:${PORT}`));
