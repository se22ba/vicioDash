import test from 'node:test';
import assert from 'node:assert/strict';
import {category,validateRecord,validateImport,assertNoOverlap,selectRecords,summarize,bounds,dailyMinutes,makeDemo,esc} from '../dist/model.js';
const base={id:'a',userId:'1',name:'Jugador',start:'2025-10-01T22:00:00Z',end:'2025-10-02T02:00:00Z',game:null,inVoice:true,spoke:'unknown',muted:false,deafened:false,streaming:false,camera:false,status:'online',source:'manual',sessionId:'session-a',channel:'Club',note:''};
test('clasifica las seis combinaciones sin inferir habla del mute',()=>{
 assert.equal(category(base),'quiet');assert.equal(category({...base,muted:true}),'quiet');assert.equal(category({...base,spoke:'no'}),'ghost');assert.equal(category({...base,spoke:'yes'}),'chat');assert.equal(category({...base,inVoice:false}),'lobby');assert.equal(category({...base,game:'Game'}),'squad');assert.equal(category({...base,game:'Game',inVoice:false}),'solo');
});
test('recorta intervalos en ambos extremos del período',()=>{
 const [r]=selectRecords([base],{start:new Date('2025-10-01T23:00:00Z'),end:new Date('2025-10-02T01:00:00Z')});assert.equal(r.minutes,120);assert.equal(summarize([r]).total,120);
});
test('agrega tramos de una sesión una sola vez y conserva el juego',()=>{
 const rows=[{...base,minutes:60,game:'Game'},{...base,id:'b',minutes:30,spoke:'yes'}];const s=summarize(rows);assert.equal(s.sessions,1);assert.equal(s.total,90);assert.equal(s.play,60);assert.equal(s.voice,90);assert.equal(s.games[0].players.size,1);
});
test('cuenta horas-persona y no duración grupal',()=>{const s=summarize([{...base,minutes:60},{...base,userId:'2',minutes:60}]);assert.equal(s.total,120);assert.equal(s.sessions,2)});
test('combina los filtros de presencia, voz y micrófono',()=>{const filter={start:new Date('2025-01-01'),end:new Date('2026-01-01'),extras:{status:'online',inVoice:'true',muted:'false'}};assert.equal(selectRecords([base],filter).length,1);assert.equal(selectRecords([base],{...filter,extras:{...filter.extras,muted:'true'}}).length,0)});
test('rechaza superposiciones, acepta límites adyacentes y otros jugadores',()=>{
 assert.throws(()=>assertNoOverlap([base,{...base,id:'b',start:'2025-10-02T01:00:00Z'}]),/superpuestos/);
 assert.doesNotThrow(()=>assertNoOverlap([base,{...base,id:'b',start:base.end,end:'2025-10-02T03:00:00Z'},{...base,id:'c',userId:'2'}]));
});
test('valida respaldos sin aceptar IDs duplicados ni futuros',()=>{
 assert.equal(validateImport({version:1,records:[base]}).length,1);assert.throws(()=>validateImport({version:1,records:[base,base]}),/repetidos/);assert.throws(()=>validateRecord({...base,end:'2099-10-02T02:00:00Z'}));assert.throws(()=>validateRecord({...base,inVoice:'yes'}));assert.throws(()=>validateRecord({...base,end:base.start}));
});
test('un mes desde 31 de marzo termina en febrero, sin desbordamiento',()=>{const [s]=bounds('month',new Date(2026,2,31,14));assert.equal(s.getMonth(),1);assert.equal(s.getDate(),28)});
test('un año desde 29 de febrero ajusta al último día del mes',()=>{const [s]=bounds('year',new Date(2024,1,29,14));assert.equal(s.getFullYear(),2023);assert.equal(s.getMonth(),1);assert.equal(s.getDate(),28)});
test('el mapa diario divide correctamente una sesión a medianoche local',()=>{
 const a=new Date(2025,9,1,22),b=new Date(2025,9,2,2);const rows=[{...base,start:a.toISOString(),end:b.toISOString(),clippedStart:a,clippedEnd:b}];assert.equal(dailyMinutes(rows,a),120);assert.equal(dailyMinutes(rows,b),120);
});
test('muestra anual consistente y segura para renderizar nombres',()=>{const demo=makeDemo(new Date('2026-10-26T12:00:00Z'));assert.ok(demo.length>1000);assert.doesNotThrow(()=>validateImport({version:1,records:demo}));assert.equal(esc('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;')});

test('solo los tramos en voz suman al club, incluso con Discord invisible o mute',async()=>{
 const {voiceRecords}=await import('../dist/model.js');
 const records=[{inVoice:false,userId:'online',game:'Juego solo',minutes:60},
 {inVoice:true,userId:'invisible',name:'Invisible',status:'offline',muted:true,game:null,minutes:30,sessionId:'s',end:'2025-01-01'},
 {inVoice:true,userId:'jugador',name:'Jugador',game:'Juego en voz',minutes:45,sessionId:'s',end:'2025-01-01'}];
 const result=summarize(voiceRecords(records));
 assert.equal(result.total,75);assert.equal(result.players.length,2);assert.equal(result.play,45);
 assert.equal(result.games[0].name,'Juego en voz');assert.ok(!result.players.some(p=>p.id==='online'));
 assert.equal(records.length,3);
});
