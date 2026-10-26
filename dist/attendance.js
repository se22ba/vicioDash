// Membership exists independently of activity: zero records must still have a row.
export function validateMembers(value){
 if(!Array.isArray(value)||value.length>2000)throw Error('La lista admite hasta 2.000 integrantes.');
 const ids=new Set();return value.map(m=>{if(!m||typeof m.id!=='string'||!m.id.trim()||m.id.length>100||ids.has(m.id)||typeof m.name!=='string'||!m.name.trim()||m.name.length>60||!Number.isFinite(Date.parse(m.since))||typeof m.active!=='boolean')throw Error('Lista de integrantes inválida.');ids.add(m.id);return {id:m.id,name:m.name.trim(),since:new Date(m.since).toISOString(),active:m.active}});
}
export function mergeMembers(members,records){
 const map=new Map(members.map(m=>[m.id,{...m}]));
 for(const r of [...records].sort((a,b)=>a.start.localeCompare(b.start))){if(!map.has(r.userId))map.set(r.userId,{id:r.userId,name:r.name,since:r.start,active:true})}
 return [...map.values()];
}
const ordinal=d=>Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000;
function daysIn(start,end,set){let t=new Date(start);t.setHours(0,0,0,0);while(+t<end){set.add(ordinal(t));t.setDate(t.getDate()+1)}}
export function attendance(records,members,start,end,threshold=7){
 const cutoff=Math.min(+end,Date.now()),lo=+start;
 const index=new Map();for(const r of records){if(!index.has(r.userId))index.set(r.userId,[]);index.get(r.userId).push(r)}
 return members.map(m=>{
  const since=Date.parse(m.since),from=Math.max(lo,since),all=(index.get(m.id)||[]).filter(r=>Date.parse(r.start)<cutoff);
  // Discord presence is context; attendance is earned only inside a voice channel.
  const last=all.filter(r=>r.inVoice).reduce((n,r)=>Math.max(n,Math.min(cutoff,Date.parse(r.end))),0),connected=new Set(),voice=new Set(),playVoice=new Set();let minutes=0,play=0,voiceMinutes=0;
  for(const r of all){const a=Math.max(from,Date.parse(r.start)),b=Math.min(cutoff,Date.parse(r.end));if(a>=b)continue;const n=(b-a)/60000;minutes+=n;play+=r.game?n:0;voiceMinutes+=r.inVoice?n:0;daysIn(a,b,connected);if(r.inVoice)daysIn(a,b,voice);if(r.inVoice&&r.game)daysIn(a,b,playVoice)}
  const gap=last?Math.max(0,ordinal(new Date(cutoff))-ordinal(new Date(last))):null;
  const observedDays=Math.max(0,ordinal(new Date(cutoff))-ordinal(new Date(since)));
  let state=!m.active?'paused':since>=cutoff?'not_started':!last?'never':!voice.size?'missing':gap>=threshold?'away':'present';
  return {...m,state,last:last?new Date(last):null,gap,observedDays,days:connected.size,voiceDays:voice.size,playVoiceDays:playVoice.size,minutes,play,voiceMinutes};
 }).sort((a,b)=>({never:0,missing:1,away:2,lurker:3,present:4,not_started:5,paused:6}[a.state]-{never:0,missing:1,away:2,lurker:3,present:4,not_started:5,paused:6}[b.state])||((b.gap??b.observedDays)-(a.gap??a.observedDays))||a.name.localeCompare(b.name));
}
