import {attendance} from './attendance.js';
import {microphoneSummary,selectRecords} from './model.js';

const mergedSeconds=intervals=>{
 const sorted=intervals.sort((a,b)=>a[0]-b[0]);let total=0,lo=0,hi=0;
 for(const [a,b] of sorted){if(a>hi){total+=hi-lo;lo=a;hi=b}else hi=Math.max(hi,b)}
 return (total+hi-lo)/1000;
};
// Use conservative bounds: aggregated counters cannot locate audio within a partial overlap.
// Unknown/solo time can never become evidence of shared silence.
function sharedCounters(masks){
 let voiceSeconds=0,observedSeconds=0,observedUpper=0,activeSeconds=0,activeLower=0;
 for(const [r,intervals] of masks){
  const duration=(Date.parse(r.end)-Date.parse(r.start))/1000,shared=mergedSeconds(intervals),outside=Math.max(0,duration-shared);
  voiceSeconds+=shared;if(!r.mic)continue;
  observedSeconds+=Math.max(0,r.mic.observedSeconds-outside);
  observedUpper+=Math.min(r.mic.observedSeconds,shared);
  activeSeconds+=Math.min(r.mic.activeSeconds,shared);
  activeLower+=Math.max(0,r.mic.activeSeconds-outside);
 }
 return {voiceSeconds,observedSeconds,activeSeconds,coverage:voiceSeconds?observedSeconds/voiceSeconds:0,
  ratio:observedSeconds?Math.min(1,activeSeconds/observedSeconds):null,
  lowerRatio:observedUpper?activeLower/observedUpper:null};
}
export function ioPasoRanking(records,members,start,end,now=new Date()){
 const cutoff=new Date(Math.min(+end,+now)),roster=new Map(members.map(m=>[m.id,m]));
 const active=members.filter(m=>m.active&&Date.parse(m.since)<+cutoff),masks=new Map(active.map(m=>[m.id,{own:new Map(),peers:new Map()}]));
 const channels=new Map();
 for(const r of records){
  if(!r.inVoice||!r.channelId)continue;
  const lo=Math.max(+start,Date.parse(r.start),Date.parse(roster.get(r.userId)?.since||r.start)),hi=Math.min(+cutoff,Date.parse(r.end));
  if(lo>=hi)continue;
  if(!channels.has(r.channelId))channels.set(r.channelId,[]);
  channels.get(r.channelId).push({r,lo,hi});
 }
 const add=(map,r,lo,hi)=>{if(!map.has(r))map.set(r,[]);map.get(r).push([lo,hi])};
 for(const channel of channels.values()){
  channel.sort((a,b)=>a.lo-b.lo);
  for(let i=0;i<channel.length;i++)for(let j=i+1;j<channel.length&&channel[j].lo<channel[i].hi;j++){
   const a=channel[i],b=channel[j],lo=Math.max(a.lo,b.lo),hi=Math.min(a.hi,b.hi);
   if(a.r.userId===b.r.userId||lo>=hi)continue;
   for(const [self,peer] of [[a,b],[b,a]]){const target=masks.get(self.r.userId);if(target){add(target.own,self.r,lo,hi);add(target.peers,peer.r,lo,hi)}}
  }
 }
 return active.map(m=>{
  const own=sharedCounters(masks.get(m.id).own),peers=sharedCounters(masks.get(m.id).peers);
  const eligible=own.observedSeconds>=1800&&own.coverage>=.8&&peers.observedSeconds>=1800&&peers.coverage>=.8;
  const peerRatio=peers.lowerRatio;
  return {...own,id:m.id,name:m.name,peerRatio,eligible,
   awarded:eligible&&own.ratio<=.5&&peerRatio>0&&own.ratio<=peerRatio*.5};
 }).sort((a,b)=>(a.ratio??Infinity)-(b.ratio??Infinity)||a.name.localeCompare(b.name));
}

export const TUTS_MEDALS={
 gold:{label:'Tuts de oro',icon:'🥇',slogan:'Si aparece, se suspende la búsqueda.'},
 silver:{label:'Tuts de plata',icon:'🥈',slogan:'Tiene más coartadas que horas en voz.'},
 bronze:{label:'Tuts de bronce',icon:'🥉',slogan:'Figura en la lista. Hasta ahí la evidencia.'}
};

const callsigns={
 absent:['Coartada en PDF','Desaparecido con Wi-Fi','Testigo que no comparece','Presunto integrante','Se busca, sin apuro','Cadáver administrativo'],
 brief:['Entró a dejar el cadáver','Asistencia por delivery','Saludó y pidió asilo','Turista de 15 minutos'],
 longest:['Le embargaron el canal','Inquilino sin contrato','El canal le cobra expensas','Le llegó el ABL de Discord'],
 frequent:['Fichó hasta en feriado','Empleado del mes, ad honorem','Marcó tarjeta en su propio velorio'],
 quiet:['Cómplice por omisión','La defensa pide silencio','Se llevó el mic al cajón'],
 streaming:['Transmitió hasta el velorio','Director del desastre','Lo filmó por las dudas'],
 manyGames:['Probó todo y no terminó nada','Infiel al launcher','Catador de fracasos','La biblioteca pide ayuda','Reincidente de Steam'],
 muted:['Abogado del mute','Micrófono bajo custodia','Cerrado por duelo'],
 chatting:['Entró a ventilar el quilombo','Panelista sin sueldo','El chisme era presencial','Vino a declarar'],
 regular:['Reincidente del canal','Volvió a la escena del crimen','Tiene la pulsera de visitante'],
 gaming:['Juega y después vemos','El vicio tiene su horario','Vino por el botín','Operativo: una más']
};

export function playerTitles(rows,records,start,end){
 const maxMinutes=Math.max(0,...rows.map(m=>m.voiceMinutes)),maxDays=Math.max(0,...rows.map(m=>m.voiceDays));
 const activity=new Map(rows.map(m=>[m.id,{since:Date.parse(m.since),games:new Set(),played:0,streamed:0,muted:0}]));
 for(const r of selectRecords(records,{start,end})){
  const player=activity.get(r.userId);
  if(!r.inVoice||!player||+r.clippedEnd<=player.since)continue;
  const minutes=(+r.clippedEnd-Math.max(+r.clippedStart,player.since))/60000;
  if(r.game){player.games.add(r.game);player.played+=minutes}
  if(r.streaming)player.streamed+=minutes;
  if(r.muted)player.muted+=minutes;
 }
 return new Map(rows.map(m=>{
  const {games,played,streamed,muted}=activity.get(m.id);
  let kind,description;
  if(!m.voiceMinutes){kind='absent';description='Cero minutos en voz en las fechas elegidas.'}
  else if(m.ioPaso?.awarded){kind='quiet';description='Se llevó el sello Io paso por baja actividad de micrófono en compañía.'}
  else if(m.voiceMinutes===maxMinutes){kind='longest';description='Mayor tiempo acumulado en voz.'}
  else if(m.voiceDays>=2&&m.voiceDays===maxDays){kind='frequent';description=`Mayor cantidad de días en voz (${m.voiceDays}).`}
  else if(m.voiceMinutes<15){kind='brief';description='Menos de 15 minutos totales en voz.'}
  else if(streamed>=15){kind='streaming';description='Transmitió al menos 15 minutos en voz.'}
  else if(muted>=15&&muted>=m.voiceMinutes*.75){kind='muted';description='Estuvo muteado al menos tres cuartos de su tiempo en voz.'}
  else if(games.size>=3){kind='manyGames';description=`Jugó ${games.size} juegos distintos en voz.`}
  else if(played>=m.voiceMinutes*.75){kind='gaming';description='Pasó al menos tres cuartos de su tiempo en voz con un juego visible.'}
  else if(m.voiceMinutes-played>=30&&played<=m.voiceMinutes*.25){kind='chatting';description='Al menos 30 minutos en voz sin juego visible y hasta un cuarto del tiempo jugando.'}
  else{kind='regular';description='Tuvo actividad en voz durante las fechas elegidas.'}
  // Choose a stable variant per player, including when several share the same achievement.
  const variants=callsigns[kind];
  let hash=0;for(const char of m.id)hash=(Math.imul(hash,31)+char.charCodeAt(0))>>>0;
  return [m.id,{kind,label:variants[hash%variants.length],description}];
 }));
}

// Extend only the unpersisted tail of a live voice session; never double count it.
export function withLiveVoice(records,live=[],now=new Date(),lastSeen=null){
 const limit=lastSeen?Math.min(+now,Date.parse(lastSeen)+60000):0;
 if(!Number.isFinite(limit)||limit<=0)return records;
 const ends=new Map();for(const r of records)ends.set(r.userId,Math.max(ends.get(r.userId)||0,Date.parse(r.end)));
 const tails=live.filter(r=>r.inVoice).flatMap(r=>{const {mic,...state}=r,start=Math.max(Date.parse(r.start),ends.get(r.userId)||0);return start<limit?[{...state,start:new Date(start).toISOString(),end:new Date(limit).toISOString(),source:'bot'}]:[]});
 return [...records,...tails];
}
const day=d=>Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000;
export function tutsRanking(records,members,start,end,now=new Date()){
 const cutoff=new Date(Math.min(+end,+now)),rows=attendance(records,members,start,cutoff).filter(m=>!['paused','not_started'].includes(m.state)).map(m=>{
  const from=new Date(Math.max(+start,Date.parse(m.since))),last=new Date(+cutoff-1);
  const eligibleDays=Math.max(1,day(last)-day(from)+1);
  return {...m,eligibleDays,frequency:m.voiceDays/eligibleDays,duration:m.voiceMinutes/eligibleDays,provisional:eligibleDays<7};
 });
 const frequency=Math.max(0,...rows.map(m=>m.frequency)),duration=Math.max(0,...rows.map(m=>m.duration));
 rows.forEach(m=>{m.score=frequency&&duration?Math.round(Math.max(0,Math.min(100,100*(1-.6*m.frequency/frequency-.4*m.duration/duration)))*10)/10:null});
 rows.sort((a,b)=>(b.score??0)-(a.score??0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 let previous=null,rank=0,tier=0;rows.forEach((m,i)=>{if(previous===null||m.score!==previous){rank=i+1;tier++}m.rank=rank;m.winner=m.score!==null&&rank===1;m.medal=m.score===null?null:['gold','silver','bronze'][tier-1]||null;previous=m.score});
 return rows;
}
export function historyStart(records,members,end=new Date()){
 return new Date(records.reduce((lo,r)=>Math.min(lo,Date.parse(r.start)),members.reduce((lo,m)=>Math.min(lo,Date.parse(m.since)),+end)));
}
// Completed calendar weeks only, anchored to the selected historical cutoff.
export function weeklyTuts(records,members,start,end,now=new Date()){
 const cutoff=new Date(Math.min(+end,+now)),anchor=new Date(cutoff);anchor.setHours(0,0,0,0);anchor.setDate(anchor.getDate()-(anchor.getDay()+6)%7);
 const weeks=[];
 for(let i=0;i<6;i++){
  const to=new Date(anchor),from=new Date(anchor);from.setDate(from.getDate()-7);
  if(+to<=+start)break;
  const lo=new Date(Math.max(+from,+start));
  const ranked=tutsRanking(records,members,lo,to,now),winners=ranked.filter(m=>m.winner);
  weeks.push({start:lo,end:to,winners,ioPaso:ioPasoRanking(records,members,lo,to,now).filter(m=>m.awarded)});anchor.setDate(anchor.getDate()-7);
 }
 return weeks;
}
