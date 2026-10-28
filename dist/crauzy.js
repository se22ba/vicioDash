import {selectRecords} from './model.js';

const visibleGame=r=>r.source==='bot'&&typeof r.game==='string'&&r.game.trim()&&['online','idle','dnd'].includes(r.status);

// Extend only observed, currently visible gaming outside this guild's voice channels.
export function withLiveGaming(records,live=[],now=new Date(),lastSeen=null){
 const limit=lastSeen?Math.min(+now,Date.parse(lastSeen)+60000):0;
 if(!Number.isFinite(limit)||limit<=0)return records;
 const ends=new Map();for(const r of records)ends.set(r.userId,Math.max(ends.get(r.userId)||0,Date.parse(r.end)));
 const tails=live.filter(r=>r.inVoice===false&&visibleGame({...r,source:'bot'})).flatMap(r=>{
  const start=Math.max(Date.parse(r.start),ends.get(r.userId)||0),{mic,...state}=r;
  return start<limit?[{...state,start:new Date(start).toISOString(),end:new Date(limit).toISOString(),source:'bot'}]:[];
 });
 return [...records,...tails];
}

export function crauzyRanking(records,members,start,end,now=new Date()){
 const cutoff=new Date(Math.min(+end,+now));
 const players=new Map(members.filter(m=>m.active&&Date.parse(m.since)<+cutoff).map(m=>[m.id,{id:m.id,name:m.name,since:m.since,playingSeconds:0,awaySeconds:0,voiceGamingSeconds:0,games:new Map()}]));
 for(const r of selectRecords(records,{start,end:cutoff})){
  const player=players.get(r.userId);if(!player||!visibleGame(r)||typeof r.inVoice!=='boolean')continue;
  const seconds=Math.max(0,(+r.clippedEnd-Math.max(+r.clippedStart,Date.parse(player.since)))/1000);
  if(!seconds)continue;
  player.playingSeconds+=seconds;
  if(r.inVoice)player.voiceGamingSeconds+=seconds;
  else {player.awaySeconds+=seconds;const game=r.game.trim();player.games.set(game,(player.games.get(game)||0)+seconds)}
 }
 const rows=[...players.values()].filter(m=>m.playingSeconds>0).map(m=>({...m,awayMinutes:Math.floor((m.awaySeconds+1e-6)/60),playingMinutes:Math.floor((m.playingSeconds+1e-6)/60),share:m.awaySeconds/m.playingSeconds,
  games:[...m.games].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([name,seconds])=>({name,minutes:seconds/60}))}));
 rows.sort((a,b)=>b.awayMinutes-a.awayMinutes||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 let previous=null,rank=0;rows.forEach((m,i)=>{if(previous===null||m.awayMinutes!==previous)rank=i+1;m.rank=rank;m.qualified=m.awayMinutes>=30;m.winner=m.qualified&&rank===1;previous=m.awayMinutes});
 return rows;
}
