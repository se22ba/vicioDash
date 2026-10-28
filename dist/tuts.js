import {attendance} from './attendance.js';
import {microphoneSummary,selectRecords} from './model.js';

// An independent microphone distinction; it never changes the attendance order.
export function ioPasoRanking(records,members,start,end,now=new Date()){
 const cutoff=new Date(Math.min(+end,+now));
 const active=members.filter(m=>m.active&&Date.parse(m.since)<+cutoff);
 const byUser=new Map();for(const r of records){if(!byUser.has(r.userId))byUser.set(r.userId,[]);byUser.get(r.userId).push(r)}
 const rows=active.map(m=>{
  const from=new Date(Math.max(+start,Date.parse(m.since)));
  const [measured]=microphoneSummary(selectRecords(byUser.get(m.id)||[],{start:from,end:cutoff}));
  const stats=measured||{voiceSeconds:0,observedSeconds:0,activeSeconds:0,coverage:0};
  const ratio=stats.observedSeconds?stats.activeSeconds/stats.observedSeconds:null;
  return {...stats,id:m.id,name:m.name,ratio,eligible:stats.observedSeconds>=1800&&stats.coverage>=.8};
 });
 // Half or more of the observed time without microphone activity earns the seal.
 // Eligibility is personal: another member's activity cannot block the award.
 rows.forEach(m=>{m.awarded=m.eligible&&m.ratio<=.5});
 return rows.sort((a,b)=>(a.ratio??Infinity)-(b.ratio??Infinity)||a.name.localeCompare(b.name));
}

// Extend only the unpersisted tail of a live voice session; never double count it.
export function withLiveVoice(records,live=[],now=new Date(),lastSeen=null){
 const limit=lastSeen?Math.min(+now,Date.parse(lastSeen)+60000):0;
 if(!Number.isFinite(limit)||limit<=0)return records;
 const ends=new Map();for(const r of records)ends.set(r.userId,Math.max(ends.get(r.userId)||0,Date.parse(r.end)));
 const tails=live.filter(r=>r.inVoice).flatMap(r=>{const start=Math.max(Date.parse(r.start),ends.get(r.userId)||0);return start<limit?[{...r,start:new Date(start).toISOString(),end:new Date(limit).toISOString(),source:'bot'}]:[]});
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
 rows.forEach(m=>{m.score=frequency&&duration?Math.max(0,Math.min(100,100*(1-.6*m.frequency/frequency-.4*m.duration/duration))):null});
 rows.sort((a,b)=>(b.score??0)-(a.score??0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 let previous=null,rank=0;rows.forEach((m,i)=>{if(previous===null||Math.abs(m.score-previous)>1e-8)rank=i+1;m.rank=rank;m.winner=m.score!==null&&rank===1;previous=m.score});
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
