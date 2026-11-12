import {validateMembers,attendance} from './attendance.js';
import {tutsRanking,ioPasoRanking,weeklyTuts,historyStart,withLiveVoice,TUTS_MEDALS,playerTitles} from './tuts.js?v=ux-2';
import {crauzyRanking,withLiveGaming} from './crauzy.js?v=crauzy-1';
import {STATES,esc,hours,category,validateImport,assertNoOverlap,bounds,selectRecords,summarize,dailyMinutes,voiceRecords,microphoneSummary} from './model.js';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const KEY='vicio.records.v1';
let tutsMode='period',refreshing=false;
let members=[],local=[],remote=false,remoteState=null,view='resumen',period='month',page=1,recentPage=1,search='',selected=[],summary,range,toastTimer,localBackup=null;
function resetPages(){page=1;recentPage=1}
try{const raw=localStorage.getItem(KEY);if(raw){const payload=JSON.parse(raw);localBackup={version:1,dataset:'legacy',records:validateImport(payload),members:validateMembers(payload.members||[])}}}catch{}
const titles={resumen:'Resumen',banda:'La banda',juegos:'Los juegos',historial:'Historial',ajustes:'Configuración'};
const colors=['#533039','#393d45','#4b3539','#453842','#563f36','#354348','#483a3f','#3d424b'];
const weekdays=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const periodFormat=new Intl.DateTimeFormat('es',{day:'numeric',month:'short',year:'numeric'});
function initials(s){return s.trim().split(/\s+/).map(x=>Array.from(x)[0]).slice(0,2).join('').toUpperCase()}
function avatar(name,id=''){const hash=[...id+name].reduce((s,c)=>s+c.charCodeAt(0),0);return `<span class="avatar" style="background:${colors[hash%colors.length]}">${esc(initials(name))}</span>`}
function date(d,opts={}){return new Date(d).toLocaleDateString('es-AR',{day:'2-digit',month:'short',...opts})}
function time(d){return new Date(d).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}
function currentMembers(){return members}
function radarRows(){return attendance(current(),currentMembers(),range[0],range[1]).filter(m=>!$('#player-filter').value||m.id===$('#player-filter').value)}
function current(){return local}
function toast(s){clearTimeout(toastTimer);$('#toast').textContent=s;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,5500)}
function stateBadge(r){const key=category(r);return `<span class="state-badge" style="--badge:${STATES[key].color}">${STATES[key].label}</span>`}
function plural(n,one,many){return n+' '+(n===1?one:many)}
function percent(n,d){return d?Math.round(n/d*100):0}
function microbar(groups,total){return `<div class="microbar">${Object.entries(groups).filter(([,m])=>m>0).map(([k,m])=>`<span style="width:${m/total*100}%;background:${STATES[k].color}" title="${STATES[k].label}: ${hours(m)} h"></span>`).join('')}</div>`}
function periodRange(){const a=$('#range-start').value,b=$('#range-end').value;return bounds(period==='custom'&&(!a||!b||a>b)?'month':period,new Date(),{start:a,end:b})}
function populateFilters(){
 const data=current(),members=new Map(currentMembers().map(m=>[m.id,m.name])),games=new Set();data.forEach(r=>{if(r.game)games.add(r.game)});
 const opts=(s,items,first)=>{const el=$(s),value=el.value;el.innerHTML=`<option value="">${first}</option>`+items.map(([v,n])=>`<option value="${esc(v)}">${esc(n)}</option>`).join('');if(items.some(([v])=>v===value))el.value=value};
 opts('#player-filter',[...members].sort((a,b)=>a[1].localeCompare(b[1])),'Toda la banda');opts('#game-filter',[...games].sort().map(g=>[g,g]),'Todos los juegos');opts('#state-filter',Object.entries(STATES).map(([k,v])=>[k,v.label]),'Todas las actividades');
}
function render(){
 $('#state-filter').querySelectorAll('option').forEach(o=>o.disabled=view!=='historial'&&['solo','lobby'].includes(o.value));
 const user=$('#player-filter').value,game=$('#game-filter').value,state=$('#state-filter').value;
 const extras=Object.fromEntries($$('[data-extra]').map(el=>[el.dataset.extra,el.value]));
 range=periodRange();selected=selectRecords(current(),{start:range[0],end:range[1],user,game,state,search,extras});
 if(view!=='historial'&&view!=='ajustes')selected=voiceRecords(selected);
 summary=summarize(selected);
 $('#date-line').textContent=periodFormat.formatRange(range[0],range[1]);
 const filters=[user,game,state,...Object.values(extras)].filter(Boolean).length;
 $('#record-count').textContent=filters?plural(filters,'filtro activo','filtros activos'):'';
 const voiceLost=!!(remoteState?.bot?.connected&&remoteState?.voice?.channelId&&!remoteState.voice.connected);
 const status=$('#data-label'),label=remoteState?.bot?.connected?(voiceLost?'Discord conectado · detector sin voz':'Bot conectado'):(remote?'Bot desconectado':'Esperando datos de Discord');
 if(status.textContent!==label)status.textContent=label;
 status.classList.toggle('real',!!remoteState?.bot?.connected);status.classList.toggle('voice-warning',voiceLost);
 const content=$('#content'),detailsState=new Map($$('#content details').map(d=>[d.className,d.open]));
 const controls=()=>$$('#content summary, #content [data-focus-key]');
 const focusKey=el=>el.dataset.focusKey||el.parentElement.className;
 const focused=controls().find(el=>el===document.activeElement);
 content.innerHTML=({resumen:overview,banda:playersView,juegos:gamesView,historial:historyView,ajustes:settingsView}[view])();
 for(const d of $$('#content details'))if(detailsState.has(d.className))d.open=detailsState.get(d.className);
 if(focused)controls().find(el=>focusKey(el)===focusKey(focused))?.focus({preventScroll:true});
}
const attendanceLabels={never:'Sin entradas a voz',missing:'No entró a voz',away:'7+ días sin entrar',present:'Entró a voz',paused:'En pausa',not_started:'Aún no estaba en la lista'};
function attendancePanel(full=false){
 const all=radarRows(),eligible=all.filter(m=>!['paused','not_started'].includes(m.state)),missing=eligible.filter(m=>['never','missing','away'].includes(m.state)),present=eligible.filter(m=>m.voiceDays>0),rows=full?all:all.slice(0,6);
 return `<section class="attendance-section wide-section"><div class="section-heading"><div><div class="eyebrow">EN EL PERÍODO ELEGIDO</div><h2 class="section-title" style="margin-top:9px">Asistencia</h2></div><div class="button-row">${remote?'<button class="secondary" id="refresh-server">Actualizar desde Discord ↻</button>':''}</div></div><div class="attendance-stats"><div><strong>${missing.length}</strong><span>SIN ENTRAR A VOZ O 7+ DÍAS SIN VOLVER</span></div><div><strong>${present.length}</strong><span>ENTRARON A VOZ EN EL PERÍODO</span></div><div><strong>${eligible.filter(m=>m.playVoiceDays>0).length}</strong><span>CON JUEGO Y VOZ REGISTRADOS</span></div><div><strong>${all.length}</strong><span>INTEGRANTES EN LA LISTA</span></div></div><div class="panel">${rows.length?`<div class="history-wrap"><table class="attendance-table"><thead><tr><th>INTEGRANTE</th><th>ÚLTIMA VEZ EN VOZ</th><th>DÍAS EN VOZ</th><th>HORAS EN VOZ</th><th>JUEGO + VOZ</th><th>ESTADO</th></tr></thead><tbody>${rows.map(m=>`<tr><td><button class="member-link" data-member="${esc(m.id)}">${avatar(m.name,m.id)}<strong>${esc(m.name)}</strong><span>↗</span></button></td><td><strong class="absence-gap">${m.gap===null?'Sin entradas a voz':m.gap===0?'Hoy':m.gap===1?'Hace 1 día':'Hace '+m.gap+' días'}</strong><small class="absence-date">${m.last?date(m.last,{year:'numeric'}):'En lista desde '+date(m.since,{year:'numeric'})}</small></td><td class="attendance-number">${m.voiceDays}</td><td class="attendance-number">${hours(m.voiceMinutes)} h</td><td class="attendance-number">${m.playVoiceDays}</td><td><span class="attendance-badge state-${m.state}">${attendanceLabels[m.state]}</span></td></tr>`).join('')}</tbody></table></div>`:empty(remote?'Esperando la lista de Discord':'Todavía no hay integrantes',remote?'Cuando el bot esté conectado, aparecerán automáticamente. Revisá su estado en Datos e integración.':'Usá Agregar integrante para crear tu lista o conectá el bot de Discord.')}${!full&&all.length>6?'<div class="panel-bottom"><button class="link-button" data-view="banda">Ver toda la banda ↗</button></div>':''}</div></section>`;
}
function showMemberAuth(show){$('#member-token-row').hidden=!show;$('#member-token').required=show}
function openMember(id){
 const member=members.find(m=>m.id===id);if(!member)return;
 const f=$('#member-form');f.reset();f.elements.id.value=id;f.elements.active.checked=member.active;$('#member-name').textContent=member.name;$('#member-error').textContent='';showMemberAuth(!adminToken());$('#member-dialog').showModal();
}
$('#member-form').addEventListener('submit',async e=>{
 e.preventDefault();const f=e.currentTarget,button=f.querySelector('[type=submit]');button.disabled=true;
 const key=$('#member-token').value||adminToken();
 try{const result=await request('./api/members/'+encodeURIComponent(f.elements.id.value),'PATCH',{active:f.elements.active.checked},key);members=members.map(m=>m.id===result.member.id?result.member:m);try{sessionStorage.setItem('vicio.admin',key)}catch{}$('#member-dialog').close();populateFilters();render();toast(result.member.active?'Integrante reactivado.':'Integrante en pausa.')}catch(error){$('#member-error').textContent=error.message;if(error.status===401){try{sessionStorage.removeItem('vicio.admin')}catch{}showMemberAuth(true);$('#member-token').focus()}}finally{button.disabled=false}
});
function stats(){return `<div class="stat-grid"><div class="stat accent"><div class="stat-label">JUEGO + VOZ <span>↗</span></div><div class="stat-value">${hours(summary.play)}<small>h</small></div><div class="stat-note">${percent(summary.play,summary.total)}% del tiempo con juego registrado</div></div><div class="stat"><div class="stat-label">TIEMPO EN VOZ <span>◷</span></div><div class="stat-value">${hours(summary.total)}<small>h</small></div><div class="stat-note">${plural(summary.sessions,'sesión','sesiones')} en el período</div></div><div class="stat"><div class="stat-label">ENTRARON A VOZ <span>♧</span></div><div class="stat-value">${summary.players.length}<small>${summary.players.length===1?'jugador':'jugadores'}</small></div><div class="stat-note">${plural(summary.games.length,'juego','juegos')} registrados</div></div><div class="stat"><div class="stat-label">EN VOZ SIN JUGAR <span>≋</span></div><div class="stat-value">${hours(summary.voice-summary.play)}<small>h</small></div></div></div>`}
function activityChart(){
 const buckets=Array.from({length:7},()=>Object.fromEntries(Object.keys(STATES).map(k=>[k,0])));
 for(const r of selected){let t=+r.clippedStart;while(t<+r.clippedEnd){const d=new Date(t),next=new Date(d);next.setHours(24,0,0,0);const end=Math.min(+next,+r.clippedEnd);buckets[(d.getDay()+6)%7][category(r)]+=(end-t)/60000;t=end}}
 const totals=buckets.map(b=>Object.values(b).reduce((a,b)=>a+b,0)),max=Math.max(...totals,1),peak=totals.indexOf(Math.max(...totals));
 return `<section class="panel"><div class="panel-head"><div><h2 class="section-title">Actividad por día</h2></div><span class="mini-label">H / PERSONA</span></div><div class="chart-legend"><span><i class="swatch" style="background:#ef3340"></i>Juego + voz</span><span><i class="swatch" style="background:#9a8f9d"></i>Sin juego ni charla</span><span><i class="swatch" style="background:#e4c4a5"></i>Charla</span><span><i class="swatch" style="background:#6c727d"></i>Habla desconocida</span></div><div class="panel-body"><div class="chart" role="img" aria-label="Horas por día: ${totals.map((n,i)=>['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'][i]+': '+hours(n)).join('; ')}">${buckets.map((b,i)=>`<div class="bar-col"><span class="bar-value">${hours(totals[i])}</span><div class="bar-stack" style="height:${totals[i]/max*118}px" title="${hours(totals[i])} horas">${Object.entries(b).map(([k,m])=>`<span style="height:${totals[i]?m/totals[i]*100:0}%;background:${STATES[k].color}"></span>`).join('')}</div></div>`).join('')}</div><div class="bar-labels">${['LUN','MAR','MIÉ','JUE','VIE','SÁB','DOM'].map(d=>`<span>${d}</span>`).join('')}</div><div class="chart-foot"><span><i class="dot"></i> ${summary.total?'Día con más actividad':'Sin actividad'}</span><strong>${summary.total?['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'][peak]+' · '+hours(totals[peak])+' h':'Todavía sin registros'}</strong></div></div></section>`;
}
function distribution(){let offset=0;const gradient=Object.entries(summary.groups).map(([k,m])=>{const start=offset;offset+=summary.total?m/summary.total*100:0;return `${STATES[k].color} ${start}% ${offset}%`}).join(',');return `<section class="panel"><div class="panel-head"><div><h2 class="section-title">Actividad en voz</h2></div><span class="mini-label">%</span></div><div class="distribution"><div class="donut" style="background:${summary.total?'conic-gradient('+gradient+')':'#383139'}" role="img" aria-label="Distribución de actividades"><div class="donut-center">${percent(summary.play,summary.total)}%<small>JUGANDO</small></div></div><div class="distribution-legend">${Object.entries(STATES).filter(([k])=>!['solo','lobby'].includes(k)).map(([k,s])=>`<button data-state="${k}" title="Filtrar: ${s.label}"><i class="swatch" style="background:${s.color}"></i>${s.label}<b>${percent(summary.groups[k],summary.total)}%</b></button>`).join('')}</div></div></section>`}
function playerCard(p){const sorted=Object.entries(p.groups).sort((a,b)=>b[1]-a[1]);return `<button class="player-card" data-player-detail="${esc(p.id)}"><div class="player-top">${avatar(p.name,p.id)}<div><div class="player-name">${esc(p.name)}</div><div class="player-sub">${plural(p.sessions.size,'SESIÓN','SESIONES')}</div></div><span class="player-arrow">↗</span></div><div class="player-hours">${hours(p.total)}<small>h en voz</small></div>${microbar(p.groups,p.total)}<div class="player-foot"><span>${STATES[sorted[0][0]].short}</span><span>${percent(p.play,p.total)}% juego</span></div></button>`}
function gamesList(limit=4){return summary.games.length?`<div class="game-list">${summary.games.slice(0,limit).map((g,i)=>`<div class="game-row"><span class="game-rank">${String(i+1).padStart(2,'0')}</span><div class="game-icon">${esc(initials(g.name))}</div><div class="game-info"><strong>${esc(g.name)}</strong><small>${plural(g.players.size,'jugador','jugadores')} · ${plural(g.sessions.size,'sesión','sesiones')}</small></div><div class="game-hours">${hours(g.total)}<small>HORAS</small></div></div>`).join('')}</div>`:empty('No hay juegos registrados','No hay juegos registrados con estos filtros.')}
function heatmap(){const end=new Date(Math.min(+range[1],Date.now())),start=new Date(end);start.setDate(start.getDate()-27);start.setHours(0,0,0,0);const cells=Array.from({length:28},(_,i)=>{const day=new Date(start);day.setDate(day.getDate()+i);return {day,m:dailyMinutes(selected,day)}}),max=Math.max(...cells.map(d=>d.m),1);return `<section class="panel"><div class="panel-head"><div><h2 class="section-title">Actividad de los últimos días</h2></div><span class="mini-label">28 DÍAS</span></div><div class="panel-body"><div class="heatmap">${Array.from({length:7},(_,i)=>`<span class="heat-label">${weekdays[(start.getDay()+i)%7].toUpperCase()}</span>`).join('')}${cells.map(({day,m})=>`<div class="heat-cell" style="background:${m?['#4e252d','#81303c','#b52f40','#ef3340'][Math.min(3,Math.ceil(m/max*4)-1)]:'#25262c'}" title="${date(day,{year:'numeric'})}: ${hours(m)} h" aria-label="${date(day)}: ${hours(m)} horas">${day.getDate()}</div>`).join('')}</div><div class="heat-foot"><span>${date(start)} — ${date(end)}</span><span class="heat-key">MENOS ${['#25262c','#4e252d','#81303c','#b52f40','#ef3340'].map(c=>`<i style="background:${c}"></i>`).join('')} MÁS</span></div></div></section>`}
function empty(title){return `<div class="empty"><h3>${title}</h3></div>`}
function livePanel(showEmpty=false){
 const live=voiceRecords(remoteState?.live||[]);
 if(!live.length)return showEmpty?'<section class="live-strip"><h2>Ahora en voz</h2><span>'+(!remoteState?.bot?.connected?'Sin datos en vivo':'Nadie en voz')+'</span></section>':'';
 const visible=live.slice(0,4).map(r=>esc(r.name)).join(' · ');
 return `<details class="live-strip">
 <summary><span>Ahora en voz</span><strong>${live.length}</strong><span class="live-preview">${visible}${live.length>4?' · +'+(live.length-4):''}</span></summary>
 <div class="live-grid">${live.map(r=>`<div class="live-player">${avatar(r.name,r.userId)}<div><strong>${esc(r.name)}</strong><small>${esc(r.channel||'Canal de voz')}${r.game?' · '+esc(r.game):''}${r.muted?' · Muteado':''}${r.streaming?' · Transmitiendo':''}</small></div></div>`).join('')}</div>
 </details>`;
}
function micDuration(seconds){return seconds<60?Math.round(seconds)+' s':seconds<3600?Math.floor(seconds/60)+' min '+Math.round(seconds%60)+' s':hours(seconds/60)+' h'}
function micPanel(){
 if(!remote)return '';
 const rows=microphoneSummary(selected),labels={activity:'Actividad detectada',no_activity:'Sin actividad detectada',partial:'Observación parcial',unknown:'Sin medición'};
 return `<section class="panel wide-section microphone-panel"><div class="panel-head"><h2 class="section-title">Actividad del micrófono</h2><button class="secondary" data-view="ajustes">Configurar ↗</button></div><div class="panel-body">${rows.length?`<div class="history-wrap"><table><thead><tr><th>INTEGRANTE</th><th>EN VOZ</th><th>OBSERVADO</th><th>MICRÓFONO ACTIVO ≈</th><th>ESTADO</th></tr></thead><tbody>${rows.map(p=>`<tr><td><div class="member-cell">${avatar(p.name,p.id)}${esc(p.name)}</div></td><td>${micDuration(p.voiceSeconds)}</td><td>${micDuration(p.observedSeconds)} · ${Math.round(p.coverage*100)}%</td><td>${p.observedSeconds?Math.round(p.activeSeconds)+' s':'—'}</td><td><span class="attendance-badge ${p.state==='no_activity'?'state-missing':p.state==='activity'?'state-present':'state-paused'}">${labels[p.state]}</span></td></tr>`).join('')}</tbody></table></div>`:empty('Sin mediciones')}</div></section>`;
}
function micSettings(){
 if(!remote)return '';
 const v=remoteState?.voice||{},labels={disabled:'DESACTIVADO',waiting:'ESPERANDO CONEXIÓN',connecting:'CONECTANDO',reconnecting:'RECONECTANDO',connected:'CONECTADO',error:'ERROR'};
 return `<section class="panel wide-section"><div class="panel-body"><span class="setting-status">${labels[v.status]||'ACTUALIZANDO'}</span><h3 class="section-title">Detector de micrófono</h3><label class="voice-channel-label">Canal de voz<select id="voice-channel"><option value="">Desactivado</option>${(v.channels||[]).map(c=>`<option value="${esc(c.id)}" ${c.id===v.channelId?'selected':''}>${esc(c.name)}</option>`).join('')}${v.channelId&&!(v.channels||[]).some(c=>c.id===v.channelId)?`<option value="${esc(v.channelId)}" selected>Canal no disponible</option>`:''}</select></label><div class="button-row"><button class="primary" id="save-voice">Guardar canal ↗</button><button class="secondary" id="refresh-server">Actualizar ↻</button></div>${v.error?`<div class="error" role="alert">${esc(v.error)}</div>`:''}${v.retryInSeconds>0?`<p class="voice-retry">Reintento automático en hasta ${Math.ceil(v.retryInSeconds)} s · ${v.attempts||0} intentos desde el arranque</p>`:''}</div></section>`;
}
function tutsSticker(){return '<img class="tuts-sticker" src="tuts-crowned.png" alt="" width="120" height="120">'}
function ioPasoSticker(){return '<img class="io-paso-sticker" src="io-paso.webp" alt="" width="64" height="64">'}
function ioPasoBadge(m){
 if(!m.ioPaso?.awarded)return '';
 const p=m.ioPaso,ratio=new Intl.NumberFormat('es-AR',{maximumFractionDigits:1}).format(p.ratio*100);
 const label=`${m.name}: io paso. Presente en espíritu, ausente en audio. Micrófono activo como máximo ≈ ${ratio}% de ${micDuration(p.observedSeconds)} observados en compañía; compañeros al menos ≈ ${Math.round(p.peerRatio*100)}%; cobertura ${Math.round(p.coverage*100)}%.`;
 return `<button type="button" class="io-paso-badge" data-io-paso="${esc(label)}" title="${esc(label)}" aria-label="${esc(label)}">${ioPasoSticker()}<span>IO PASO</span></button>`;
}
function awardContext(){
 const now=new Date(),records=remoteState?.bot?.connected?withLiveGaming(withLiveVoice(current(),remoteState.live,now,remoteState.bot.lastSeen),remoteState.awayLive,now,remoteState.bot.lastSeen):current();
 const end=new Date(Math.min(+range[1],+now)),start=tutsMode==='history'?historyStart(records,members,end):range[0];
 return {now,records,start,end};
}
function crauzySticker(){return '<img class="crauzy-sticker" src="crauzy-detective.webp" alt="Crauzy detective, lupa de gamer y sello Te vi online" width="192" height="192">'}
function crauzyDuration(minutes){const rounded=Math.floor(minutes);return rounded>=60?`${Math.floor(rounded/60)} h ${rounded%60} min`:`${rounded} min`}
function crauzyBadge(m){
 if(!m.crauzy?.winner)return '';
 const p=m.crauzy,label=`${m.name}: Crauzy te vio online. ${crauzyDuration(p.awayMinutes)} con juego visible fuera de nuestra voz; ${Math.round(p.share*100)}% de su tiempo de juego observado. No indica otro servidor ni con quién jugaba.`;
 return `<button type="button" class="crauzy-badge" data-crauzy="${esc(label)}" aria-label="${esc(label)}" title="${esc(label)}">${crauzySticker()}<span>TE VI ONLINE</span></button>`;
}
function crauzyPanel(){
 const {now,records,start,end}=awardContext(),rows=crauzyRanking(records,members,start,end,now),winners=rows.filter(m=>m.winner);
 const fresh=remoteState?.bot?.connected&&Date.parse(remoteState.bot.lastSeen)+60000>=+now,active=new Set(members.filter(m=>m.active).map(m=>m.id));
 const away=fresh?(remoteState.awayLive||[]).filter(r=>active.has(r.userId)&&r.game&&r.inVoice===false):[];
 return `<section class="crauzy-section wide-section" aria-labelledby="crauzy-heading"><div class="crauzy-heading"><div><h2 id="crauzy-heading">Crauzy <span>cazador de gheys</span></h2><p>Tiempo con juego visible fuera de nuestra voz.</p></div></div>
 <div class="crauzy-scope">${date(start,{year:'numeric'})} — ${date(end,{year:'numeric'})} · Toda la banda · ${remoteState?.bot?.connected?'Se actualiza cada 30 s':'Bot desconectado · registros guardados'}</div>
 <div class="crauzy-evidence">${crauzySticker()}<div><span class="crauzy-case-tag">${winners.length?'TE VI ONLINE':'TODOS CON COARTADA'}</span><h3>${winners.length?winners.map(m=>esc(m.name)).join(' / '):'El expediente sigue abierto.'}</h3><p>${winners.length?`${crauzyDuration(winners[0].awayMinutes)} con juego visible fuera de nuestros canales de voz. ${winners.length>1?'Empate: mismo tiempo, misma estampita.':'Crauzy guardó el recibo. Qué mala suerte tener presencia pública.'}`:'Todavía nadie acumula 30 minutos de juego visible fuera de nuestra voz en estas fechas. Sin evidencia, la lupa no acusa.'}</p></div></div>
 ${away.length?`<div class="crauzy-live"><span class="dot"></span><strong>Ahora con juego visible fuera de nuestra voz:</strong> ${away.map(r=>`${esc(r.name)} · ${esc(r.game)}`).join(' / ')}</div>`:''}
 ${rows.length?`<div class="crauzy-table-head" aria-hidden="true"><span>EXPEDIENTE / INTEGRANTE</span><span>JUEGOS FUERA DE VOZ</span><span>TIEMPO FUERA</span></div><ol class="crauzy-list">${rows.map(m=>`<li><span class="crauzy-position">${m.rank}</span><div class="crauzy-person">${avatar(m.name,m.id)}<div><strong>${esc(m.name)}</strong><span>${m.winner?'Crauzy te vio online':m.qualified?'En el radar':m.awayMinutes?'Menos de 30 min · sin sello':'Jugó en nuestra voz'}</span></div>${m.winner?crauzyBadge({name:m.name,crauzy:m}):''}</div><div class="crauzy-games">${m.games.length?m.games.slice(0,3).map(g=>`<span>${esc(g.name)}</span>`).join('')+(m.games.length>3?`<span>+${m.games.length-3} juegos</span>`:''):'—'}</div><div class="crauzy-time"><strong>${crauzyDuration(m.awayMinutes)}</strong><span>${Math.round(m.share*100)}% del juego observado</span></div></li>`).join('')}</ol>`:'<p class="crauzy-no-data">Todavía no hay juegos visibles registrados en estas fechas. Estar online, por sí solo, no arma un expediente.</p>'}
 <details class="crauzy-rules"><summary>¿Qué ve Crauzy? La lupa tiene límites.</summary><p>Ordenamos por minutos acumulados con <strong>juego visible y sin estar en ningún canal de voz de este servidor</strong>. Cuenta la actividad “Jugando” que Discord informa para integrantes de la banda; no confirma si estaban usando activamente el juego. Se necesitan <strong>30 minutos fuera de voz</strong> para llevarse el sticker. El puesto se compara por minutos completos y los empates comparten sello.</p><p>“Histórico” usa todos los registros disponibles hasta la fecha final. Los filtros de jugador, juego y actividad no alteran este ranking. Los pausados no compiten. Las sesiones en curso suman solo su cola pendiente, con el último pulso del bot y sin duplicar tiempo.</p><p>Discord debe mostrar el juego. <strong>Invisible, juego oculto o actividad no informada no se adivinan</strong>. Estar online sin juego no suma. No podemos afirmar en qué otro servidor estaban, con quién jugaban ni si jugaban solos; tampoco recuperar actividad de los cortes del bot. El sello de Crauzy se calcula aparte de Tuts e Io paso.</p></details></section>`;
}
function playerTitleButton(title,focusKey){
 return `<button type="button" class="player-title" data-focus-key="${esc(focusKey)}" data-title-fact="${esc(title.description)}" title="${esc(title.description)}">${esc(title.label)}</button>`;
}

function tutsPanel(){
 const {now,records,start,end}=awardContext();
 const rows=tutsRanking(records,members,start,end,now),weeks=weeklyTuts(records,members,start,end,now);
 const ioById=new Map(ioPasoRanking(records,members,start,end,now).map(m=>[m.id,m]));
 const crauzyById=new Map(crauzyRanking(records,members,start,end,now).map(m=>[m.id,m]));
 for(const m of rows){m.ioPaso=ioById.get(m.id);m.crauzy=crauzyById.get(m.id)}
 const titles=playerTitles(rows,records,start,end);
 const number=new Intl.NumberFormat('es-AR',{maximumFractionDigits:1});
 const score=m=>m.score===null?'—':number.format(m.score);
 const podium=Object.entries(TUTS_MEDALS).map(([key,medal])=>{
  const people=rows.filter(m=>m.medal===key);
  const champion=key==='gold'&&people.length===1?people[0]:null;
  return `<article class="tuts-place medal-${key}${people.length?'':' medal-vacant'}">
   <h3 class="medal-label"><span aria-hidden="true">${medal.icon}</span> ${medal.label}</h3>
   ${people.length?`<div class="medal-result"><p class="medal-names">${people.map(m=>esc(m.name)).join(' · ')}</p><p class="tuts-score">${score(people[0])}<small> / 100</small></p></div>
   ${champion?playerTitleButton(titles.get(champion.id),'podium-title-'+champion.id):`<p class="medal-slogan">${people.length>1?'Metal compartido. ':''}${medal.slogan}</p>`}
   ${key==='gold'?tutsSticker():''}`:'<p class="medal-names">Puesto vacante</p>'}
   </article>`;
 }).join('');
 const table=rows.length?`<details class="tuts-full">
  <summary>Ranking completo <span>${plural(rows.length,'integrante','integrantes')}</span></summary>
  <ol class="tuts-list">${rows.map(m=>{
   const title=titles.get(m.id),medal=TUTS_MEDALS[m.medal],badges=ioPasoBadge(m)+crauzyBadge(m);
   return `<li>
    <span class="tuts-list-rank" aria-label="${m.score===null?'Sin puesto':'Puesto '+m.rank}">${m.score===null?'—':m.rank}</span>
    <div class="tuts-list-person">${avatar(m.name,m.id)}<div class="tuts-person-copy">
     <strong>${esc(m.name)}${medal?` <span class="medal-chip" role="img" aria-label="${medal.label}" title="${medal.label}">${medal.icon}</span>`:''}</strong>
     ${playerTitleButton(title,'title-'+m.id)}
     ${m.provisional?'<small>Provisorio</small>':''}
    </div></div>
    ${badges?`<div class="tuts-awards">${badges}</div>`:''}
    <span class="tuts-list-stats">${plural(m.voiceDays,'día','días')} · ${hours(m.voiceMinutes)} h</span>
    <span class="tuts-list-score" aria-label="${m.score===null?'Sin puntaje':score(m)+' de 100 Tuts'}">${score(m)}</span>
   </li>`;
  }).join('')}</ol>
 </details>`:'';
 return `<section class="tuts-section wide-section" aria-labelledby="tuts-heading">
  <div class="tuts-heading">
   <div><h2 id="tuts-heading">¿Quién es más Tuts?</h2><p class="tuts-scope">Toda la banda · ${tutsMode==='history'?'Hasta '+date(end,{year:'numeric'}):'Cuanto menos voz, más Tuts'}</p></div>
   <div class="tuts-tabs" role="group" aria-label="Período del ranking">
    <button data-tuts-mode="period" data-focus-key="rank-period" aria-pressed="${tutsMode==='period'}">Este período</button>
    <button data-tuts-mode="history" data-focus-key="rank-history" aria-pressed="${tutsMode==='history'}">Histórico</button>
   </div>
  </div>
  ${rows.some(m=>m.winner)?`<div class="tuts-podium">${podium}</div>`:`<div class="tuts-empty"><strong>La corona junta polvo.</strong><p>${rows.length?'Todavía no hay sesiones de voz en estas fechas.':'No hay integrantes activos para estas fechas.'}</p></div>`}
  <div class="tuts-actions">
  ${table}
  <details class="tuts-history"><summary>Archivo de las excusas</summary>
   <div class="tuts-weeks">${weeks.length?weeks.map(w=>`<article><small>${date(w.start)} — ${date(new Date(+w.end-1),{year:'numeric'})}</small><strong>${w.winners.length?'👑 '+w.winners.map(m=>esc(m.name)).join(' / '):'Sin coronación'}</strong>${w.ioPaso.length?`<div class="io-paso-week">${ioPasoSticker()}<span>Io paso: ${w.ioPaso.map(m=>esc(m.name)).join(' / ')}</span></div>`:''}</article>`).join(''):'<p>Las semanas completas aparecerán acá.</p>'}</div>
  </details>
  <details class="tuts-rules"><summary>Cómo se gana</summary>
   <p><strong>100</strong> es el máximo Tuts. <strong>0</strong> es el mínimo. El índice pesa un 60% cuántos días entrás a voz y un 40% cuánto tiempo pasás ahí, en relación con los días que llevás en la lista. Los tres puntajes más altos se llevan oro, plata y bronce. Los empates comparten metal. Si llevás menos de siete días en el período, tu puesto es provisorio. Los pausados quedan fuera.</p>
   <p><strong>Io paso</strong> va junto al nombre y se calcula aparte. Pide al menos 50% del tiempo en silencio en sala compartida y la mitad o menos de actividad de micrófono que tus compañeros. Hacen falta 30 minutos observados en compañía y al menos 80% de cobertura de ambos lados. Si toda la sala está en silencio, el sello queda vacante. Los huecos de medición y el tiempo en soledad quedan fuera.</p>
   <p>Los rankings comparan a toda la banda. Los filtros de actividad aplican a las sesiones y estadísticas. “Histórico” usa todo lo registrado hasta la fecha final. El archivo muestra hasta seis semanas completas, con la lista y las pausas actuales y el horario de tu dispositivo.</p>
   <details class="tuts-receipt"><summary>Mostrá la cuenta, que acá hay acomodo</summary><p>Frecuencia = días en voz / días en la lista dentro del período. Duración = minutos en voz / esos mismos días. Dividimos cada valor por el mayor de la banda. <strong>Tuts = 100 − 100 × (0,6 × frecuencia relativa + 0,4 × duración relativa)</strong>. Io paso cruza horarios y canal. En tramos parcialmente compartidos usa límites conservadores para confirmar el silencio y la comparación. La detección de audio es aproximada. Sin voz registrada, no hay corona.</p></details>
  </details>
  </div>
 </section>`;
}

function overview(){
 return livePanel(true)+tutsPanel()+`<div class="overview-extras">
  <details class="overview-crauzy"><summary>Crauzy <span>Juego fuera de voz</span></summary>${crauzyPanel()}</details>
  <details class="overview-activity"><summary>Estadísticas <span>Actividad y micrófono</span></summary>
   <div class="overview-analytics">${stats()}<div class="content-grid">${activityChart()}${distribution()}</div>
   <div class="bottom-grid"><section class="panel"><div class="panel-head"><h2 class="section-title">Juegos más jugados</h2><button class="link-button" data-view="juegos">Ver juegos ↗</button></div>${gamesList()}</section>${heatmap()}</div>
   ${micPanel()}</div>
  </details>
 </div>`+recentSessions();
}
function playersView(){return attendancePanel(true)+`<section class="wide-section"><h2 class="section-title" style="margin-bottom:18px">Tiempo en voz por integrante</h2>${summary.players.length?`<div class="players-grid">${summary.players.map(playerCard).join('')}</div>`:empty('Sin actividad registrada','No hubo entradas a voz en este período.')}</section>`}
function gamesView(){return `<div class="view-intro"><span class="section-tag">${summary.games.length} JUEGOS</span></div>${summary.games.length?`<div class="game-grid">${summary.games.map((g,i)=>`<article class="game-card"><div class="game-icon" style="background:${['#344433','#574735','#3f3d4b','#444c33','#4a4339','#33464b'][i%6]}">${esc(initials(g.name))}</div><span class="mini-label">JUEGO / ${String(i+1).padStart(2,'0')}</span><h3>${esc(g.name)}</h3><span class="recent">${plural(g.sessions.size,'SESIÓN','SESIONES')} · ${plural(g.players.size,'JUGADOR','JUGADORES')}</span><div class="game-total">${hours(g.total)} <small>h jugando en voz</small></div><div class="name-tags">${[...g.players].map(([id,n])=>`<span>${esc(n)}</span>`).join('')}</div><div style="margin-top:20px"><button class="link-button" data-filter-game="${esc(g.name)}">Ver sus registros ↗</button></div></article>`).join('')}</div>`:empty('No hay juegos registrados','Probá otro período o cargá el nombre del juego en una sesión.')}`}
function table(rows,details=true){
 if(!rows.length)return empty('No hay registros en este período');
 return `<div class="history-wrap"><table class="session-table"><thead><tr><th scope="col">JUGADOR</th><th scope="col">FECHA / HORARIO</th><th scope="col">JUEGO</th><th scope="col">ACTIVIDAD</th><th scope="col">TIEMPO</th>${details?'<th scope="col">DETALLE</th>':''}</tr></thead><tbody>${rows.map(r=>`<tr><td data-label="Jugador"><div class="member-cell">${avatar(r.name,r.userId)}<span>${esc(r.name)}</span></div></td><td data-label="Fecha / horario" class="date-cell">${date(r.start,{year:'numeric'})}<br>${time(r.start)} → ${date(r.start)===date(r.end)?'':date(r.end)+' '}${time(r.end)}</td><td data-label="Juego">${esc(r.game||'—')}${r.streaming?' ↗':''}</td><td data-label="Actividad">${stateBadge(r)}${r.muted?' · M':''}${r.deafened?' · D':''}${r.camera?' · C':''}</td><td data-label="Tiempo" class="date-cell">${hours(r.minutes)} h</td>${details?`<td data-label="Detalle"><button class="icon-button" data-record-detail="${esc(r.id)}" aria-label="Detalle del registro de ${esc(r.name)}">↗</button></td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
function sortedSessions(){return [...selected].sort((a,b)=>b.start.localeCompare(a.start)||a.id.localeCompare(b.id))}
function pagination(total,currentPage,size,scope){
 const pages=Math.max(1,Math.ceil(total/size)),first=total?(currentPage-1)*size+1:0,last=Math.min(currentPage*size,total),attribute=scope==='recent'?'data-recent-page':'data-page';
 return `<nav class="pagination ${scope}-pagination" aria-label="Páginas de ${scope==='recent'?'últimas sesiones':'historial'}"><span>${first}–${last} de ${plural(total,'tramo','tramos')}</span><div><button class="secondary page-button" ${attribute}="${currentPage-1}" ${currentPage===1?'disabled':''} aria-label="Página anterior">← Anterior</button><span class="page-position">${currentPage} / ${pages}</span><button class="secondary page-button" ${attribute}="${currentPage+1}" ${currentPage===pages?'disabled':''} aria-label="Página siguiente">Siguiente →</button></div></nav>`;
}
function recentSessions(){
 const rows=sortedSessions(),size=10;
 recentPage=Math.max(1,Math.min(recentPage,Math.ceil(rows.length/size)||1));
 return `<section class="panel wide-section recent-sessions" id="recent-sessions"><div class="panel-head"><h2 class="section-title">Últimas sesiones</h2><button class="link-button" data-view="historial">Ver historial ↗</button></div><div class="sessions-body">${table(rows.slice((recentPage-1)*size,recentPage*size),false)}</div>${pagination(rows.length,recentPage,size,'recent')}</section>`;
}
function historyView(){
 const rows=sortedSessions(),size=15;
 page=Math.max(1,Math.min(page,Math.ceil(rows.length/size)||1));
 return `<section class="panel wide-section"><div class="table-toolbar"><input class="search" id="history-search" placeholder="Buscar jugador, juego o nota…" aria-label="Buscar en el historial" value="${esc(search)}"><div class="button-row"><button class="secondary" data-export-csv>Exportar vista CSV ↓</button></div></div>${table(rows.slice((page-1)*size,page*size))}${pagination(rows.length,page,size,'history')}</section>`;
}
function settingsView(){return `<section class="panel wide-section"><div class="panel-body"><h3 class="section-title">Administración</h3><div class="form-token"><label>Clave de administración<input type="password" id="admin-token" autocomplete="off"></label><button class="secondary" id="save-token">Guardar clave</button></div><div id="admin-error" class="error" role="alert"></div></div></section>`+micSettings()+`<section class="panel wide-section"><div class="panel-body"><h3 class="section-title">Exportar</h3><div class="button-row"><button class="secondary" data-export-json>Descargar JSON ↓</button><button class="secondary" data-export-csv>Descargar CSV ↓</button>${localBackup?'<button class="secondary" data-export-local>Descargar respaldo anterior ↓</button>':''}</div></div></section>`}

function setView(v){
 if(!titles[v])return;
 clearTimeout(searchTimer);view=v;search='';resetPages();
 $('#page-title').textContent=titles[v];
 for(const b of $$('.rail button[data-view]')){
  const current=b.dataset.view===v;b.classList.toggle('active',current);
  if(current)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
 }
 if(v!=='historial'){
  if(['solo','lobby'].includes($('#state-filter').value))$('#state-filter').value='';
  if($('[data-extra="inVoice"]').value==='false')$('[data-extra="inVoice"]').value='';
 }
 $('.filterbar').hidden=$('#filter-options').hidden=v==='ajustes';
 $('#filter-options').open=v!=='resumen';
 $('#custom-range').hidden=v==='ajustes'||period!=='custom';
 render();window.scrollTo({top:0,behavior:'instant'});
}
function openPlayer(id){const p=summary.players.find(p=>p.id===id);if(!p){openMember(id);return;}const s=summarize(selected.filter(r=>r.userId===id));$('#detail-title').textContent=p.name+' / detalle';$('#detail-content').innerHTML=`<div class="mini-label">${date(range[0],{year:'numeric'})} — ${date(range[1],{year:'numeric'})}</div><div class="detail-stats"><div><strong>${hours(p.total)} h</strong>EN VOZ</div><div><strong>${hours(p.play)} h</strong>JUGANDO</div><div><strong>${p.sessions.size}</strong>SESIONES</div></div><div class="detail-list">${Object.entries(p.groups).map(([k,m])=>`<div><span><i class="swatch" style="background:${STATES[k].color}"></i> ${STATES[k].label}</span><strong>${hours(m)} h · ${percent(m,p.total)}%</strong></div>`).join('')}</div><h3 class="section-title">Sus juegos</h3>${s.games.map(g=>`<div class="detail-game"><span>${esc(g.name)}</span><strong>${hours(g.total)} h</strong></div>`).join('')||''}<div class="dialog-actions"><button class="primary" data-player-history="${esc(p.id)}">Ver historial ↗</button></div>`;$('#detail-dialog').showModal()}
function recordDetail(id){const r=current().find(r=>r.id===id);if(!r)return;$('#detail-title').textContent=r.name;const fields=[['Juego',r.game||'—'],['Inicio',new Date(r.start).toLocaleString('es-AR')],['Fin',new Date(r.end).toLocaleString('es-AR')],['Canal',r.channel||'—'],['Presencia',r.status],['Muteado',r.muted?'Sí':'No'],['Ensordecido',r.deafened?'Sí':'No'],['Transmisión',r.streaming?'Sí':'No'],['Cámara',r.camera?'Sí':'No'],...(r.mic?[['Micrófono activo ≈',Math.round(r.mic.activeSeconds)+' s'],['Tiempo observado',Math.round(r.mic.observedSeconds)+' s']]:[])];$('#detail-content').innerHTML=`<div class="detail-list">${fields.map(([k,v])=>`<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>`;$('#detail-dialog').showModal()}
function localDate(d){const dt=new Date(d);return new Date(+dt-dt.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function adminToken(){try{return sessionStorage.getItem('vicio.admin')||''}catch{return ''}}
async function request(path,method='GET',body,token=adminToken()){
 const response=await fetch(path,{method,headers:{'Content-Type':'application/json',...(method==='GET'?{}:{Authorization:'Bearer '+token})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
 if(!response.ok){let message;try{message=(await response.json()).error}catch{}const error=Error(message||(response.status===401?'Clave de administración incorrecta o ausente.':'No se pudo completar la operación.'));error.status=response.status;throw error}
 return response.json();
}
async function refreshServer(silent=false){
 if(refreshing)return false;refreshing=true;
 try{
  const cursor=remoteState?.cursor;
  const d=await request('./api/state'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
  if(d.version!==1||!Array.isArray(d.records))throw Error('No se encontró el servidor de VICIO.');
  let records=validateImport(d).filter(r=>r.source==='bot');
  const roster=validateMembers(d.members||[]).filter(m=>/^\d+$/.test(m.id));
  if(d.full===false){
   if(!cursor||typeof d.cursor!=='string'||!Array.isArray(d.removedRecordIds)||d.removedRecordIds.some(id=>typeof id!=='string'))throw Error('Actualización de historial inválida.');
   if(records.length||d.removedRecordIds.length){
    const byId=new Map(local.map(record=>[record.id,record]));
    for(const id of d.removedRecordIds)byId.delete(id);
    for(const record of records)byId.set(record.id,record);
    records=[...byId.values()].sort((a,b)=>b.start.localeCompare(a.start));
    assertNoOverlap(records);
   }else records=local;
  }
  remote=true;remoteState=d;local=records;members=roster;
  populateFilters();render();
  if(!silent)toast('Lista e historial de Discord actualizados.');
  return true;
 }catch(e){
  if(remote){remoteState={...remoteState,live:[],awayLive:[],bot:{...remoteState?.bot,connected:false}};render()}
  if(!silent)toast('No se pudo conectar al servidor.');
  return false;
 }finally{refreshing=false}
}
function download(content,filename,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function exportJSON(){download(JSON.stringify({version:1,exportedAt:new Date().toISOString(),dataset:'bot',records:current(),members:currentMembers()},null,2),'vicio-respaldo-'+new Date().toISOString().slice(0,10)+'.json','application/json');toast('Respaldo completo exportado. No depende de los filtros.')}
function csvValue(v){let s=String(v??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}
function exportCSV(){const header=['Jugador','Inicio UTC','Fin UTC','Juego','Actividad','Horas en período','Presencia','Canal','Habló','Muteado','Ensordecido','Transmitió','Cámara','Origen','Nota'];const rows=selected.map(r=>[r.name,r.start,r.end,r.game||'',STATES[category(r)].label,(r.minutes/60).toFixed(3),r.status,r.channel,r.spoke,r.muted,r.deafened,r.streaming,r.camera,r.source,r.note]);download('\uFEFF'+[header,...rows].map(row=>row.map(csvValue).join(';')).join('\r\n'),'vicio-vista-'+new Date().toISOString().slice(0,10)+'.csv','text/csv;charset=utf-8');toast('Vista filtrada exportada en CSV.')}
document.addEventListener('click',e=>{const b=e.target.closest('button, a[data-view]');if(!b)return;
 if(b.dataset.ioPaso){toast(b.dataset.ioPaso);return}
 if(b.dataset.crauzy){toast(b.dataset.crauzy);return}
 if(b.dataset.tutsMode){tutsMode=b.dataset.tutsMode;render();return}
 if(b.dataset.titleFact){toast(b.dataset.titleFact);return}
 if(b.dataset.member){openMember(b.dataset.member);return}
 if(b.dataset.view){e.preventDefault();setView(b.dataset.view);return}
 if(b.classList.contains('close-dialog')){b.closest('dialog').close();return}

 if(b.dataset.playerDetail){openPlayer(b.dataset.playerDetail);return}
 if(b.dataset.recordDetail){recordDetail(b.dataset.recordDetail);return}
 if(b.dataset.recentPage){recentPage=Number(b.dataset.recentPage);render();return}
 if(b.dataset.page){page=Number(b.dataset.page);render();return}
 if(b.dataset.state){$('#state-filter').value=b.dataset.state;resetPages();render();return}
 if(b.dataset.filterGame){$('#game-filter').value=b.dataset.filterGame;setView('historial');return}
 if(b.dataset.playerHistory){$('#detail-dialog').close();$('#player-filter').value=b.dataset.playerHistory;setView('historial');return}
 if(b.hasAttribute('data-export-local')){if(localBackup)download(JSON.stringify(localBackup,null,2),'vicio-respaldo-local-pendiente.json','application/json');return}
 if(b.hasAttribute('data-export-json')){exportJSON();return}
 if(b.hasAttribute('data-export-csv')){exportCSV();return}
 if(b.id==='more-filters'){const open=$('#advanced-filters').hidden;$('#advanced-filters').hidden=!open;b.setAttribute('aria-expanded',String(open));b.textContent=open?'Menos filtros −':'Más filtros ＋';return}
 if(b.id==='reset-filters'){for(const s of ['#player-filter','#game-filter','#state-filter'])$(s).value='';$$('[data-extra]').forEach(x=>x.value='');search='';resetPages();render();return}
 if(b.id==='apply-range'){const start=$('#range-start').value,end=$('#range-end').value;if(!start||!end||start>end){toast('Elegí una fecha inicial y final válidas.');return}period='custom';resetPages();render();return}
 if(b.id==='refresh-server'){void refreshServer();return}
 if(b.id==='save-voice'){const channelId=$('#voice-channel').value;b.disabled=true;void (async()=>{try{const result=await request('./api/voice-channel','PUT',{channelId});remoteState={...remoteState,voice:result.voice};render();toast(channelId?'Canal guardado. El bot intentará conectarse.':'Detector desactivado.');setTimeout(()=>void refreshServer(true),3000)}catch(e){toast(e.message)}finally{b.disabled=false}})();return}
 if(b.id==='save-token'){const key=$('#admin-token').value;b.disabled=true;void(async()=>{try{await request('./api/admin/session','POST',undefined,key);sessionStorage.setItem('vicio.admin',key);$('#admin-token').value='';$('#admin-error').textContent='';toast('Clave guardada.')}catch(error){$('#admin-error').textContent=error.message}finally{b.disabled=false}})();return}
});
$('#period-filter').addEventListener('change',e=>{
 period=e.currentTarget.value;
 $('#custom-range').hidden=period!=='custom';
 if(period==='custom'&&!$('#range-start').value){
  $('#range-start').value=localDate(new Date(Date.now()-30*86400000)).slice(0,10);
  $('#range-end').value=localDate(new Date()).slice(0,10);
 }
 resetPages();render();
});
for(const el of [...$$('[data-extra]'),...['#player-filter','#game-filter','#state-filter'].map(s=>$(s))])el.addEventListener('change',()=>{resetPages();render()});
let searchTimer;document.addEventListener('input',e=>{if(e.target.id==='history-search'){const value=e.target.value,caret=e.target.selectionStart;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{search=value;resetPages();render();const input=$('#history-search');if(input){input.focus();input.setSelectionRange(caret,caret)}},180)}});
for(const d of $$('dialog'))d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('dialog[open]'))void refreshServer(true)});
populateFilters();setView('resumen');void refreshServer(true);setInterval(()=>{if(!document.hidden&&!$('dialog[open]'))void refreshServer(true)},30000);
