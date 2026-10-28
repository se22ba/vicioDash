import test from 'node:test';
import assert from 'node:assert/strict';
import {tutsRanking,ioPasoRanking,weeklyTuts,withLiveVoice,playerTitles} from '../dist/tuts.js';
const start=new Date('2025-02-01T00:00:00Z'),end=new Date('2025-03-01T00:00:00Z');
const member=(id,since=start.toISOString())=>({id,name:'Jugador '+id,since,active:true});
const rec=(id,a='2025-02-10T19:00:00Z',b='2025-02-10T21:00:00Z')=>({userId:id,name:'Jugador '+id,start:a,end:b,inVoice:true,channelId:'99',game:null});
test('el ausente gana y el más participativo tiene 0 Tuts',()=>{const rows=tutsRanking([rec('2')],[member('1'),member('2')],start,end);assert.equal(rows[0].id,'1');assert.equal(rows[0].score,100);assert.equal(rows[0].winner,true);assert.equal(rows[1].score,0)});
test('todos los ausentes empatados comparten corona, sin favorecer el nombre',()=>{const rows=tutsRanking([rec('3')],[member('1'),member('2'),member('3')],start,end);assert.deepEqual(rows.map(m=>m.rank),[1,1,3]);assert.equal(rows.filter(m=>m.winner).length,2)});
test('sin observaciones de voz no inventa un ganador',()=>{assert.ok(tutsRanking([],[member('1'),member('2')],start,end).every(m=>m.score===null&&!m.winner));assert.ok(tutsRanking([{...rec('1'),inVoice:false}],[member('1')],start,end).every(m=>!m.winner))});
test('las pausas, las altas posteriores y la actividad futura no entran',()=>{const rows=tutsRanking([rec('1','2025-03-02T19:00:00Z','2025-03-02T21:00:00Z')],[member('1'),{...member('2'),active:false},member('3','2025-04-01T00:00:00Z')],start,end);assert.equal(rows.length,1);assert.equal(rows[0].score,null)});
test('normaliza por antigüedad y marca resultados recientes provisionales',()=>{const rows=tutsRanking([rec('1','2025-02-27T19:00:00Z','2025-02-27T21:00:00Z'),rec('2')],[member('1','2025-02-27T00:00:00Z'),member('2')],start,end);const fresh=rows.find(m=>m.id==='1');assert.equal(fresh.provisional,true);assert.equal(fresh.score,0);assert.ok(rows.find(m=>m.id==='2').score>0)});
test('entrar más días y sumar más minutos siempre reduce el índice',()=>{const roster=[member('1'),member('2')];const a=tutsRanking([rec('1'),rec('2','2025-02-10T18:00:00Z','2025-02-10T23:00:00Z')],roster,start,end);const b=tutsRanking([rec('1'),rec('1','2025-02-11T19:00:00Z','2025-02-11T21:00:00Z'),rec('2','2025-02-10T18:00:00Z','2025-02-10T23:00:00Z')],roster,start,end);assert.ok(b.find(m=>m.id==='1').score<a.find(m=>m.id==='1').score)});
test('el directo agrega solo la cola que aún no se guardó y caduca con el heartbeat',()=>{const r=rec('1');const rows=withLiveVoice([r],[{...r,start:r.start}],new Date('2025-02-10T21:02:00Z'),'2025-02-10T21:00:00Z');assert.equal(rows.length,2);assert.equal(Date.parse(rows[1].start),Date.parse(r.end));assert.equal(rows[1].end,'2025-02-10T21:01:00.000Z');assert.equal(withLiveVoice([r],[r],new Date(),null).length,1)});
test('el histórico semanal no incorpora semanas futuras ni la semana en curso',()=>{const weeks=weeklyTuts([rec('1')],[member('1'),member('2')],start,end);assert.ok(weeks.length>0);assert.ok(weeks.every(w=>+w.start>=+start&&+w.end<=+end));assert.ok(weeks.some(w=>w.winners.some(m=>m.id==='2')))});

const micRec=(id,activeSeconds=0,observedSeconds=7200)=>({...rec(id),mic:{kind:'rtp',observedSeconds,activeSeconds}});
const roster=(...ids)=>ids.map(id=>member(id));
test('io paso compara solo compañía en el mismo canal y destaca al oyente',()=>{
 const records=[micRec('1',0),micRec('2',4000),micRec('3',6000)],members=roster('1','2','3','4');
 const rows=ioPasoRanking(records,members,start,end);
 assert.deepEqual(rows.filter(m=>m.awarded).map(m=>m.id),['1']);assert.equal(rows.find(m=>m.id==='1').voiceSeconds,7200);
 assert.deepEqual(tutsRanking(records,members,start,end),tutsRanking(records.map(({mic,...r})=>r),members,start,end));
});
test('estar solo, en distinto canal, sin canal o sin horarios coincidentes no gana',()=>{
 for(const records of [[micRec('1')],[micRec('1'),{...micRec('2',7200),channelId:'100'}],[{...micRec('1'),channelId:''},micRec('2',7200)],[micRec('1'),{...micRec('2',7200),start:'2025-02-10T21:00:00Z',end:'2025-02-10T23:00:00Z'}]]){
  assert.ok(ioPasoRanking(records,roster('1','2'),start,end).every(m=>!m.awarded));
 }
});
test('hablar igual o tener a toda la sala en silencio no reparte stickers a todos',()=>{
 for(const active of [0,1440,3600])assert.ok(ioPasoRanking([micRec('1',active),micRec('2',active)],roster('1','2'),start,end).every(m=>!m.awarded));
});
test('el 50/50 exacto cuenta si tiene la mitad de actividad que su compañero',()=>{
 const rows=ioPasoRanking([micRec('1',3600),micRec('2',7200)],roster('1','2'),start,end);
 assert.equal(rows.find(m=>m.id==='1').awarded,true);assert.equal(rows.find(m=>m.id==='2').awarded,false);
 assert.ok(ioPasoRanking([micRec('1',3601),micRec('2',7200)],roster('1','2'),start,end).every(m=>!m.awarded));
});
test('exige 30 minutos observados y 80% de cobertura compartida de ambos lados',()=>{
 const short=(id,active,observed)=>({...micRec(id,active,observed),end:'2025-02-10T19:37:30Z'});
 const good=ioPasoRanking([short('1',0,1800),short('2',1800,1800)],roster('1','2'),start,end);
 assert.equal(good.find(m=>m.id==='1').awarded,true);assert.equal(good.find(m=>m.id==='1').coverage,.8);
 for(const records of [[short('1',0,1799),short('2',1800,1800)],[short('1',0,1800),short('2',0,1799)],[short('1',0,1800),{...short('2',0,1800),mic:undefined}]])assert.ok(ioPasoRanking(records,roster('1','2'),start,end).every(m=>!m.awarded));
});
test('el tiempo a solas queda afuera y la actividad ambigua no se convierte en silencio',()=>{
 const peer={...micRec('2',2400,2400),start:'2025-02-10T20:20:00Z'};
 const silent=ioPasoRanking([micRec('1',0),peer],roster('1','2'),start,end).find(m=>m.id==='1');
 assert.equal(silent.voiceSeconds,2400);assert.equal(silent.observedSeconds,2400);assert.equal(silent.awarded,true);
 const uncertain=ioPasoRanking([micRec('1',2000),peer],roster('1','2'),start,end).find(m=>m.id==='1');
 assert.equal(uncertain.awarded,false);assert.ok(uncertain.ratio>.5);
});
test('no duplica tiempo compartido con varios compañeros ni con tramos adyacentes',()=>{
 const rows=ioPasoRanking([micRec('1'),micRec('2',7200),micRec('3',7200)],roster('1','2','3'),start,end);
 assert.equal(rows.find(m=>m.id==='1').voiceSeconds,7200);assert.deepEqual(rows.filter(m=>m.awarded).map(m=>m.id),['1']);
 const peers=[{...micRec('2',3600,3600),end:'2025-02-10T20:00:00Z'},{...micRec('2',3600,3600),start:'2025-02-10T20:00:00Z'}];
 assert.equal(ioPasoRanking([micRec('1'),...peers],roster('1','2'),start,end).find(m=>m.id==='1').observedSeconds,7200);
});
test('respeta pausas, altas y fechas; una persona pausada igual puede estar en la sala',()=>{
 const rows=ioPasoRanking([micRec('1'),micRec('2',7200),micRec('3'),micRec('4')],[member('1'),{...member('2'),active:false},member('3','2025-02-10T20:45:00Z'),member('4','2025-04-01T00:00:00Z')],start,end);
 assert.deepEqual(rows.map(m=>m.id).sort(),['1','3']);assert.equal(rows.find(m=>m.id==='1').awarded,true);assert.equal(rows.find(m=>m.id==='3').awarded,false);
 const clipped=ioPasoRanking([micRec('1'),micRec('2',7200)],roster('1','2'),new Date('2025-02-10T20:00:00Z'),new Date('2025-02-10T20:30:00Z'));
 assert.equal(clipped.find(m=>m.id==='1').observedSeconds,1800);assert.equal(clipped.find(m=>m.id==='1').awarded,true);
 assert.ok(ioPasoRanking([micRec('1'),micRec('2',7200)],roster('1','2'),start,new Date('2025-02-09T00:00:00Z')).every(m=>!m.awarded));
});
test('el archivo semanal usa solo encuentros de su semana',()=>{
 const weeks=weeklyTuts([micRec('1'),micRec('2',7200)],roster('1','2'),start,end);
 assert.equal(weeks.filter(w=>w.ioPaso.length).length,1);assert.equal(weeks.find(w=>w.ioPaso.length).ioPaso[0].id,'1');
});
test('las colas en vivo sin medir no inventan silencio ni duplican contadores',()=>{
 const records=[micRec('1'),micRec('2',7200)],live=withLiveVoice(records,records,new Date('2025-02-10T21:01:00Z'),'2025-02-10T21:00:00Z');
 const listener=ioPasoRanking(live,roster('1','2'),start,end).find(m=>m.id==='1');
 assert.equal(listener.observedSeconds,7200);assert.equal(listener.activeSeconds,0);assert.equal(listener.voiceSeconds,7260);assert.equal(listener.awarded,true);
});
test('oro plata y bronce corresponden a tres niveles distintos y los empates comparten metal',()=>{
 const members=roster('1','2','3','4','5'),records=[rec('3','2025-02-10T19:00:00Z','2025-02-10T19:30:00Z'),rec('4','2025-02-10T19:00:00Z','2025-02-10T20:00:00Z'),rec('5')];
 const rows=tutsRanking(records,members,start,end);
 assert.deepEqual(rows.map(m=>m.medal),['gold','gold','silver','bronze',null]);assert.deepEqual(rows.map(m=>m.rank),[1,1,3,4,5]);
 assert.ok(tutsRanking([],members,start,end).every(m=>m.medal===null));
});
test('los títulos de partida se ganan con datos reales y admiten empates',()=>{
 const records=[rec('2'),rec('2','2025-02-11T19:00:00Z','2025-02-11T21:00:00Z'),...['Uno','Dos','Tres'].map(game=>({...rec('3'),game}))];
 const rows=tutsRanking(records,roster('1','2','3'),start,end),titles=playerTitles(rows,records,start,end);
 assert.ok(titles.get('1').some(t=>t.label==='Operador fantasma'));assert.ok(titles.get('2').some(t=>t.label==='Fichaje perfecto'));assert.ok(titles.get('3').some(t=>t.label==='Multiclase'));assert.ok(titles.get('3').some(t=>t.label==='El ancla'));
});
