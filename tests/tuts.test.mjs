import test from 'node:test';
import assert from 'node:assert/strict';
import {tutsRanking,ioPasoRanking,weeklyTuts,withLiveVoice} from '../dist/tuts.js';
const start=new Date('2025-02-01T00:00:00Z'),end=new Date('2025-03-01T00:00:00Z');
const member=(id,since=start.toISOString())=>({id,name:'Jugador '+id,since,active:true});
const rec=(id,a='2025-02-10T19:00:00Z',b='2025-02-10T21:00:00Z')=>({userId:id,name:'Jugador '+id,start:a,end:b,inVoice:true,game:null});
test('el ausente gana y el más participativo tiene 0 Tuts',()=>{const rows=tutsRanking([rec('2')],[member('1'),member('2')],start,end);assert.equal(rows[0].id,'1');assert.equal(rows[0].score,100);assert.equal(rows[0].winner,true);assert.equal(rows[1].score,0)});
test('todos los ausentes empatados comparten corona, sin favorecer el nombre',()=>{const rows=tutsRanking([rec('3')],[member('1'),member('2'),member('3')],start,end);assert.deepEqual(rows.map(m=>m.rank),[1,1,3]);assert.equal(rows.filter(m=>m.winner).length,2)});
test('sin observaciones de voz no inventa un ganador',()=>{assert.ok(tutsRanking([],[member('1'),member('2')],start,end).every(m=>m.score===null&&!m.winner));assert.ok(tutsRanking([{...rec('1'),inVoice:false}],[member('1')],start,end).every(m=>!m.winner))});
test('las pausas, las altas posteriores y la actividad futura no entran',()=>{const rows=tutsRanking([rec('1','2025-03-02T19:00:00Z','2025-03-02T21:00:00Z')],[member('1'),{...member('2'),active:false},member('3','2025-04-01T00:00:00Z')],start,end);assert.equal(rows.length,1);assert.equal(rows[0].score,null)});
test('normaliza por antigüedad y marca resultados recientes provisionales',()=>{const rows=tutsRanking([rec('1','2025-02-27T19:00:00Z','2025-02-27T21:00:00Z'),rec('2')],[member('1','2025-02-27T00:00:00Z'),member('2')],start,end);const fresh=rows.find(m=>m.id==='1');assert.equal(fresh.provisional,true);assert.equal(fresh.score,0);assert.ok(rows.find(m=>m.id==='2').score>0)});
test('entrar más días y sumar más minutos siempre reduce el índice',()=>{const roster=[member('1'),member('2')];const a=tutsRanking([rec('1'),rec('2','2025-02-10T18:00:00Z','2025-02-10T23:00:00Z')],roster,start,end);const b=tutsRanking([rec('1'),rec('1','2025-02-11T19:00:00Z','2025-02-11T21:00:00Z'),rec('2','2025-02-10T18:00:00Z','2025-02-10T23:00:00Z')],roster,start,end);assert.ok(b.find(m=>m.id==='1').score<a.find(m=>m.id==='1').score)});
test('el directo agrega solo la cola que aún no se guardó y caduca con el heartbeat',()=>{const r=rec('1');const rows=withLiveVoice([r],[{...r,start:r.start}],new Date('2025-02-10T21:02:00Z'),'2025-02-10T21:00:00Z');assert.equal(rows.length,2);assert.equal(Date.parse(rows[1].start),Date.parse(r.end));assert.equal(rows[1].end,'2025-02-10T21:01:00.000Z');assert.equal(withLiveVoice([r],[r],new Date(),null).length,1)});
test('el histórico semanal no incorpora semanas futuras ni la semana en curso',()=>{const weeks=weeklyTuts([rec('1')],[member('1'),member('2')],start,end);assert.ok(weeks.length>0);assert.ok(weeks.every(w=>+w.start>=+start&&+w.end<=+end));assert.ok(weeks.some(w=>w.winners.some(m=>m.id==='2')))});

const micRec=(id,activeSeconds=0,observedSeconds=7200)=>({...rec(id),mic:{kind:'rtp',observedSeconds,activeSeconds}});
test('io paso distingue la mitad en silencio, entrega varios sellos y no altera el ranking Tuts',()=>{
 const records=[micRec('1',0),micRec('2',144),micRec('3',4320)],roster=['1','2','3','4'].map(id=>member(id));
 const rows=ioPasoRanking(records,roster,start,end);
 assert.deepEqual(rows.filter(m=>m.awarded).map(m=>m.id),['1','2']);
 assert.equal(rows.find(m=>m.id==='4').eligible,false);
 assert.deepEqual(tutsRanking(records,roster,start,end),tutsRanking(records.map(({mic,...r})=>r),roster,start,end));
});
test('faltantes, mute, presencia fuera de voz y muestras cortas no ganan io paso',()=>{
 const records=[micRec('1',5000),{...rec('2'),muted:true,spoke:'no'},micRec('3',0,1799),micRec('4',0,5700),{...micRec('5'),inVoice:false}];
 const rows=ioPasoRanking(records,['1','2','3','4','5','6'].map(id=>member(id)),start,end);
 assert.ok(rows.every(m=>!m.awarded));assert.equal(rows.filter(m=>m.eligible).length,1);
});
test('io paso incluye exactamente 50/50, excluye más actividad y exige 30 minutos y 80% de cobertura',()=>{
 const short=(id,active,observed)=>({...micRec(id,active,observed),end:'2025-02-10T19:37:30Z'});
 const roster=['1','2','3','4','5'].map(id=>member(id));
 const rows=ioPasoRanking([short('1',1125,2250),short('2',900,1800),short('3',901,1800),short('4',0,1799),short('5',0,1800)],roster,start,end);
 assert.deepEqual(rows.filter(m=>m.awarded).map(m=>m.id),['5','1','2']);
 assert.equal(rows.find(m=>m.id==='2').coverage,.8);
 assert.equal(rows.find(m=>m.id==='4').eligible,false);
});
test('io paso funciona sin compañeros y con toda la banda en silencio medido',()=>{
 assert.equal(ioPasoRanking([micRec('1')],[member('1')],start,end)[0].awarded,true);
 assert.ok(ioPasoRanking([micRec('1'),micRec('2')],[member('1'),member('2')],start,end).every(m=>m.awarded));
 assert.equal(ioPasoRanking([micRec('1',3600)],[member('1')],start,end)[0].awarded,true);
 assert.equal(ioPasoRanking([micRec('1',3601)],[member('1')],start,end)[0].awarded,false);
});
test('io paso respeta altas, pausas y fechas, y prorratea el micrófono recortado',()=>{
 const roster=[member('1'),member('2','2025-02-10T20:45:00Z'),{...member('3'),active:false},member('4','2025-04-01T00:00:00Z')];
 const rows=ioPasoRanking([micRec('1',5000),micRec('2'),micRec('3'),micRec('4')],roster,start,end);
 assert.deepEqual(rows.map(m=>m.id).sort(),['1','2']);assert.equal(rows.find(m=>m.id==='2').observedSeconds,900);assert.ok(rows.every(m=>!m.awarded));
 const clipped=ioPasoRanking([micRec('1',5000),micRec('2')],[member('1'),member('2')],new Date('2025-02-10T20:00:00Z'),new Date('2025-02-10T20:30:00Z'));
 assert.equal(clipped.find(m=>m.id==='1').activeSeconds,1250);assert.equal(clipped.find(m=>m.id==='1').observedSeconds,1800);assert.equal(clipped.find(m=>m.id==='2').awarded,true);
 assert.ok(ioPasoRanking([micRec('1',1440),micRec('2')],[member('1'),member('2')],start,new Date('2025-02-09T00:00:00Z')).every(m=>!m.awarded));
});
test('el archivo histórico recalcula io paso sin tomar actividad de otras semanas',()=>{
 const records=[micRec('1',5000),micRec('2')],roster=[member('1'),member('2')];
 const weeks=weeklyTuts(records,roster,start,end);
 assert.equal(weeks.filter(w=>w.ioPaso.length).length,1);assert.equal(weeks.find(w=>w.ioPaso.length).ioPaso[0].id,'2');
});
test('la cola en vivo sin medir no inventa silencio ni duplica los contadores',()=>{
 const records=[micRec('1',1440),micRec('2')],roster=[member('1'),member('2')];
 const live=withLiveVoice(records,[{...rec('2'),start:records[1].start}],new Date('2025-02-10T21:01:00Z'),'2025-02-10T21:00:00Z');
 const listener=ioPasoRanking(live,roster,start,end).find(m=>m.id==='2');
 assert.equal(listener.observedSeconds,7200);assert.equal(listener.activeSeconds,0);assert.equal(listener.voiceSeconds,7260);assert.equal(listener.awarded,true);
});
