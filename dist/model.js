export const STATES = {
  squad: {label:'Juego + voz',color:'#789b32',short:'En equipo'},
  solo: {label:'Juego sin voz',color:'#b4ce62',short:'Por su cuenta'},
  chat: {label:'Solo charla',color:'#e58c53',short:'De sobremesa'},
  ghost: {label:'Sin juego ni charla',color:'#a79bc5',short:'Modo fantasma'},
  quiet: {label:'Voz sin dato de habla',color:'#b5bab3',short:'Sin confirmar'},
  lobby: {label:'Conectado sin voz',color:'#d9d9cd',short:'En el lobby'}
};
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const hours=m=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:1}).format(m/60);
export function category(r){return r.game?(r.inVoice?'squad':'solo'):r.inVoice?(r.spoke==='yes'?'chat':r.spoke==='no'?'ghost':'quiet'):'lobby'}
export function validateRecord(r){
 if(!r || typeof r!=='object')throw Error('Registro inválido.');
 const string=(key,max,required=false)=>{if(typeof r[key]!=='string'||r[key].length>max||(required&&!r[key].trim()))throw Error('Campo inválido: '+key);return r[key].trim()};
 const out={id:string('id',120,true),userId:string('userId',100,true),name:string('name',60,true),start:string('start',40,true),end:string('end',40,true)};
 if(!Number.isFinite(Date.parse(out.start))||!Number.isFinite(Date.parse(out.end))||Date.parse(out.end)-Date.parse(out.start)<1000||Date.parse(out.end)-Date.parse(out.start)>7*86400000)throw Error('Cada tramo debe durar entre 1 segundo y 7 días.');
 if(Date.parse(out.start)>Date.now()+60000||Date.parse(out.end)>Date.now()+60000)throw Error('No se pueden registrar sesiones futuras.');
 out.start=new Date(out.start).toISOString();out.end=new Date(out.end).toISOString();
 for(const k of ['inVoice','muted','deafened','streaming','camera']){if(typeof r[k]!=='boolean')throw Error('Campo inválido: '+k);out[k]=r[k]}
 if(!['yes','no','unknown'].includes(r.spoke))throw Error('Indicá si habló o si el dato es desconocido.');
 if(!['online','idle','dnd','offline'].includes(r.status))throw Error('Estado de presencia inválido.');
 if(!['manual','bot','demo'].includes(r.source))throw Error('Origen inválido.');
 out.game=r.game===null?null:string('game',100)||null;
 out.channel=typeof r.channel==='string'?r.channel.trim().slice(0,100):'';
 out.note=typeof r.note==='string'?r.note.trim().slice(0,500):'';
 out.sessionId=typeof r.sessionId==='string'?r.sessionId.slice(0,120):out.id;
 out.spoke=r.inVoice?r.spoke:'unknown';out.status=r.status;out.source=r.source;
 if(!out.inVoice){out.muted=false;out.deafened=false;out.streaming=false;out.camera=false;out.channel=''}
 return out;
}
export function validateImport(payload){
 if(payload.version!==1||!Array.isArray(payload.records)||payload.records.length>100000)throw Error('Se necesita un respaldo VICIO versión 1 (máximo 100.000 tramos).');
 const records=payload.records.map(validateRecord),ids=new Set();
 for(const r of records){if(ids.has(r.id))throw Error('El archivo contiene identificadores repetidos.');ids.add(r.id)}
 assertNoOverlap(records);return records;
}
export function assertNoOverlap(records){
 const users=new Map();for(const r of records){if(!users.has(r.userId))users.set(r.userId,[]);users.get(r.userId).push(r)}
 for(const rs of users.values()){rs.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));for(let i=1;i<rs.length;i++)if(Date.parse(rs[i].start)<Date.parse(rs[i-1].end))throw Error('Hay tramos superpuestos para '+rs[i].name+'. Revisá los horarios.');}
}
export function bounds(period,now=new Date(),custom={}){
 const end=new Date(now),start=new Date(now);
 if(period==='custom'){return [new Date(custom.start+'T00:00:00'),new Date(custom.end+'T23:59:59.999')]}
 if(period==='today')start.setHours(0,0,0,0);
 else if(period==='year'||period==='6m'||period==='3m'||period==='month'){
  const targetDay=start.getDate(),months={year:12,'6m':6,'3m':3,month:1}[period];
  start.setDate(1);start.setMonth(start.getMonth()-months);const last=new Date(start.getFullYear(),start.getMonth()+1,0).getDate();start.setDate(Math.min(targetDay,last));
 }else start.setDate(start.getDate()-Number(period||30));
 return [start,end];
}
export function selectRecords(records,{start,end,user='',game='',state='',search='',extras={}}={}){
 const lo=+start,hi=+end;
 return records.filter(r=>Object.entries(extras).every(([k,v])=>v===''||String(r[k])===v)&&(!user||r.userId===user)&&(!game||r.game===game)&&(!state||category(r)===state)&&(!search||[r.name,r.game,r.channel,r.note].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase())))
 .map(r=>({...r,minutes:Math.max(0,Math.min(Date.parse(r.end),hi)-Math.max(Date.parse(r.start),lo))/60000,clippedStart:new Date(Math.max(Date.parse(r.start),lo)),clippedEnd:new Date(Math.min(Date.parse(r.end),hi))})).filter(r=>r.minutes>0);
}
export function summarize(records){
 const groups={},players=new Map(),games=new Map(),sessions=new Set();let total=0,voice=0,play=0;
 for(const key in STATES)groups[key]=0;
 for(const r of records){const m=r.minutes??((Date.parse(r.end)-Date.parse(r.start))/60000),key=category(r);total+=m;groups[key]+=m;if(r.game)play+=m;if(r.inVoice)voice+=m;sessions.add(r.userId+':'+r.sessionId);
  if(!players.has(r.userId))players.set(r.userId,{id:r.userId,name:r.name,total:0,play:0,voice:0,groups:Object.fromEntries(Object.keys(STATES).map(k=>[k,0])),sessions:new Set(),last:r.end});
  const p=players.get(r.userId);p.total+=m;p.play+=r.game?m:0;p.voice+=r.inVoice?m:0;p.groups[key]+=m;p.sessions.add(r.sessionId);if(r.end>p.last){p.last=r.end;p.name=r.name}
  if(r.game){if(!games.has(r.game))games.set(r.game,{name:r.game,total:0,players:new Map(),sessions:new Set()});const g=games.get(r.game);g.total+=m;g.players.set(r.userId,r.name);g.sessions.add(r.userId+':'+r.sessionId)}
 }
 return {total,voice,play,groups,sessions:sessions.size,players:[...players.values()].sort((a,b)=>b.total-a.total),games:[...games.values()].sort((a,b)=>b.total-a.total)};
}
export function dailyMinutes(records,day){const start=new Date(day);start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);return records.reduce((s,r)=>s+Math.max(0,Math.min(+(r.clippedEnd??new Date(r.end)),+end)-Math.max(+(r.clippedStart??new Date(r.start)),+start))/60000,0)}
export function makeDemo(now=new Date()){
 const people=[['sebas','Sebas'],['benja','Benja'],['nacho','Nacho'],['fede','Fede'],['gago','Gago'],['mati','Mati'],['nico','Nico'],['lucas','Lucas']];
 const games=['Satisfactory','Counter-Strike 2','7 Days to Die','Rocket League','Warzone','Project Zomboid'];let seed=9417;
 const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};const records=[];
 for(let days=364;days>=0;days--){for(let i=0;i<people.length;i++){if(rnd()>(i===1?.45:.52))continue;
  const start=new Date(now);start.setDate(start.getDate()-days);start.setHours(19+Math.floor(rnd()*4),Math.floor(rnd()*50),0,0);const duration=45+Math.floor(rnd()*200),end=new Date(+start+duration*60000);if(+end>+now)continue;
  const roll=rnd(),game=roll<(i===4?.22:.69)?games[Math.floor(rnd()*games.length)]:null,inVoice=rnd()>.23,spoke=inVoice?(game?'yes':rnd()<.45?'no':rnd()<.8?'yes':'unknown'):'unknown';
  records.push({id:'demo-'+days+'-'+i,userId:people[i][0],name:people[i][1],start:start.toISOString(),end:end.toISOString(),game,inVoice,spoke,muted:inVoice&&spoke==='no',deafened:false,streaming:!!game&&inVoice&&rnd()<.12,camera:false,status:rnd()<.12?'idle':'online',channel:inVoice?'El after':'',note:'Registro ficticio para explorar el tablero.',source:'demo',sessionId:'demo-'+days+'-'+i});
 }}return records;
}
