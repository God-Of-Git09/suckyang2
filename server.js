// 황야의 무법자 - 1v1 서버 (HTTP로 index.html 제공 + WebSocket 방/전투 판정)
const http=require('http'),fs=require('fs'),path=require('path'),{WebSocketServer}=require('ws');
const PORT=process.env.PORT||3000,PAGE=path.join(__dirname,'public','index.html');
const server=http.createServer((q,r)=>{
  if(q.url==='/health'){r.end('ok');return}
  fs.readFile(PAGE,(e,d)=>{if(e){r.writeHead(500);r.end('index.html missing');return}
    r.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});r.end(d)})});
const wss=new WebSocketServer({server}),rooms=new Map();let nid=1;
const now=()=>Date.now(),snd=(ws,o)=>ws.readyState===1&&ws.send(JSON.stringify(o)),tx=(p,o)=>snd(p.ws,o),both=(r,o)=>r.ps.forEach(p=>tx(p,o));
const num=v=>Number.isFinite(v),v3=a=>Array.isArray(a)&&a.length===3&&a.every(num)?a:null,cl=(v,a,b)=>Math.max(a,Math.min(b,v));
const WIN=7;
function fresh(p){Object.assign(p,{hp:200,ammo:6,relAt:0,lastFire:0,rollUntil:0,rollAt:0,stunUntil:0,flashAt:0,throwAt:0,x:0,z:0})}
function startRound(r){if(r.ps.length<2)return;r.ps.forEach(fresh);r.locked=false;r.phase='play';r.ps.forEach((p,i)=>tx(p,{t:'start',you:i,scores:r.scores}))}
function score(r,by){r.locked=true;r.scores[by]++;both(r,{t:'round',winner:by,scores:r.scores});
  if(r.scores[by]>=WIN){r.phase='end';both(r,{t:'over',winner:by});setTimeout(()=>{r.ps.forEach(p=>p.ws.room=null);rooms.delete(r.id)},3000)}
  else setTimeout(()=>{if(rooms.has(r.id))startRound(r)},2000)}
function leave(ws){const r=ws.room;if(!r)return;ws.room=null;const i=r.ps.findIndex(p=>p.ws===ws);if(i>=0)r.ps.splice(i,1);
  r.ps.forEach(p=>{p.ws.room=null;if(r.phase!=='end')tx(p,{t:'left'})});rooms.delete(r.id)}
function openRooms(){return[...rooms.values()].filter(x=>x.phase==='wait'&&x.ps.length===1).map(x=>({id:x.id,name:x.name,n:x.ps.length}))}
function handle(ws,m){
  if(m.t==='list'){snd(ws,{t:'rooms',rooms:openRooms()});return}
  if(m.t==='create'){leave(ws);const r={id:nid++,name:String(m.name||'무명 결투장').slice(0,16),ps:[{ws}],phase:'wait',scores:[0,0],locked:false};
    ws.room=r;rooms.set(r.id,r);snd(ws,{t:'joined',you:0,name:r.name});return}
  if(m.t==='join'){leave(ws);const r=rooms.get(m.id);if(!r||r.phase!=='wait'||r.ps.length!==1){snd(ws,{t:'rooms',rooms:openRooms()});return}
    r.ps.push({ws});ws.room=r;r.phase='chars';snd(ws,{t:'joined',you:1,name:r.name});both(r,{t:'chars'});return}
  if(m.t==='leave'){leave(ws);return}
  const r=ws.room;if(!r)return;const i=r.ps.findIndex(p=>p.ws===ws),p=r.ps[i],o=r.ps[1-i];if(!p)return;
  if(m.t==='ready'){if(r.phase!=='chars')return;p.ready=true;if(r.ps.length===2&&r.ps.every(x=>x.ready))startRound(r);return}
  if(r.phase!=='play'||r.locked||!o)return;const t=now();
  switch(m.t){
    case 's':if(num(m.x)&&num(m.z)){p.x=cl(m.x,-30,30);p.z=cl(m.z,-30,30);snd(o.ws,{t:'opp',x:p.x,z:p.z,yaw:+m.yaw||0,pitch:+m.pitch||0})}break;
    case 'fire':{if(p.stunUntil>t)return;if(p.relAt&&t>=p.relAt){p.ammo=6;p.relAt=0}
      if(p.relAt||p.ammo<=0||t-p.lastFire<350)return;p.lastFire=t;p.ammo--;
      const a=v3(m.a),b=v3(m.b);if(a&&b)snd(o.ws,{t:'ofire',a,b});
      if(m.part==='head'||m.part==='body'){if(o.rollUntil>t||o.hp<=0)return;const d=m.part==='head'?100:50;o.hp=Math.max(0,o.hp-d);
        both(r,{t:'hp',hp:[r.ps[0].hp,r.ps[1].hp],by:i,part:m.part,dmg:d});if(o.hp<=0)score(r,i)}
      break}
    case 'reload':if(p.ammo<6&&!p.relAt)p.relAt=t+1850;break;
    case 'roll':if(t<p.rollAt||p.stunUntil>t)return;p.rollAt=t+2900;p.rollUntil=t+350;p.ammo=Math.min(6,p.ammo+3);p.relAt=0;snd(o.ws,{t:'oroll'});break;
    case 'flash':{if(t<p.flashAt||p.stunUntil>t)return;const a=v3(m.p),v=v3(m.v);if(!a||!v)return;p.flashAt=t+5900;p.throwAt=t;snd(o.ws,{t:'oflash',p:a,v});break}
    case 'boom':{if(!p.throwAt||t-p.throwAt<450||t-p.throwAt>1500||!num(m.x)||!num(m.z))return;p.throwAt=0;
      if(o.hp>0&&Math.hypot(o.x-m.x,o.z-m.z)<4.5){o.stunUntil=t+700;both(r,{t:'stun',who:1-i})}break}
  }}
wss.on('connection',ws=>{ws.alive=true;ws.on('pong',()=>ws.alive=true);
  ws.on('message',d=>{let m;try{m=JSON.parse(d)}catch{return}if(m&&typeof m==='object')handle(ws,m)});
  ws.on('close',()=>leave(ws));ws.on('error',()=>{})});
setInterval(()=>wss.clients.forEach(ws=>{if(!ws.alive)return ws.terminate();ws.alive=false;ws.ping()}),25000);
server.listen(PORT,()=>console.log('listening on '+PORT));
