import test from 'node:test';
import assert from 'node:assert/strict';
import {crauzyRanking,withLiveGaming} from '../dist/crauzy.js';

const start=new Date('2025-02-01T00:00:00Z'),end=new Date('2025-03-01T00:00:00Z');
const member=(id,changes={})=>({id,name:'Jugador '+id,since:start.toISOString(),active:true,...changes});
const rec=(id,changes={})=>({userId:id,name:'Jugador '+id,game:'Juego visible',inVoice:false,status:'online',source:'bot',start:'2025-02-10T19:00:00Z',end:'2025-02-10T21:00:00Z',...changes});

test('Crauzy cuenta juego visible fuera de voz y conserva el total de juego observado',()=>{
 const rows=crauzyRanking([rec('1'),rec('1',{inVoice:true,start:'2025-02-11T19:00:00Z',end:'2025-02-11T21:00:00Z'}),rec('2',{inVoice:true})],[member('1'),member('2')],start,end);
 assert.equal(rows[0].awayMinutes,120);assert.equal(rows[0].playingMinutes,240);assert.equal(rows[0].share,.5);assert.equal(rows[0].winner,true);
 assert.equal(rows[1].awayMinutes,0);assert.equal(rows[1].winner,false);
});
test('online sin juego, invisible, orígenes humanos y voz desconocida quedan fuera',()=>{
 for(const changes of [{game:null},{game:' '},{status:'offline'},{status:'invisible'},{source:'manual'},{source:'demo'},{inVoice:undefined}])assert.equal(crauzyRanking([rec('1',changes)],[member('1')],start,end).length,0);
 assert.equal(crauzyRanking([rec('1',{status:'idle'}),rec('2',{status:'dnd'})],[member('1'),member('2')],start,end).length,2);
});
test('ordena por minutos fuera, no por porcentaje ni nombre; comparte empates',()=>{
 const records=[rec('1'),rec('1',{inVoice:true,start:'2025-02-11T19:00:00Z',end:'2025-02-11T23:00:00Z'}),rec('2'),rec('3',{end:'2025-02-10T20:30:00Z'})];
 const rows=crauzyRanking(records,['1','2','3'].map(id=>member(id)),start,end);
 assert.deepEqual(rows.map(m=>m.rank),[1,1,3]);assert.deepEqual(rows.filter(m=>m.winner).map(m=>m.id),['1','2']);assert.ok(rows[0].share<rows[2].share);
});
test('treinta minutos acumulados ganan sello; veintinueve no',()=>{
 const partial=rec('1',{end:'2025-02-10T19:15:00Z'}),second=rec('1',{start:'2025-02-10T20:00:00Z',end:'2025-02-10T20:15:00Z'});
 assert.equal(crauzyRanking([partial,second],[member('1')],start,end)[0].winner,true);
 assert.equal(crauzyRanking([rec('1',{end:'2025-02-10T19:29:59Z'})],[member('1')],start,end)[0].winner,false);
});
test('respeta pertenencia, pausas, fechas elegidas y el corte actual',()=>{
 const rows=crauzyRanking([rec('1'),rec('2'),rec('3'),rec('4')],[member('1',{since:'2025-02-10T20:45:00Z'}),member('2',{active:false}),member('3',{since:'2025-04-01T00:00:00Z'})],start,end);
 assert.equal(rows.length,1);assert.equal(rows[0].awayMinutes,15);assert.equal(rows[0].winner,false);
 assert.equal(crauzyRanking([rec('1')],[member('1')],new Date('2025-02-10T20:00:00Z'),new Date('2025-02-10T20:30:00Z'))[0].awayMinutes,30);
 assert.equal(crauzyRanking([rec('1')],[member('1')],start,end,new Date('2025-02-10T19:30:00Z'))[0].awayMinutes,30);
 assert.equal(crauzyRanking([rec('1')],[member('1')],start,new Date('2025-02-09T00:00:00Z')).length,0);
});
test('agrega los juegos del expediente sin confundirlos con juegos en voz',()=>{
 const records=[rec('1',{game:' Uno '}),rec('1',{game:'Dos',start:'2025-02-11T19:00:00Z',end:'2025-02-11T20:00:00Z'}),rec('1',{game:'Con la banda',inVoice:true})];
 assert.deepEqual(crauzyRanking(records,[member('1')],start,end)[0].games.map(g=>g.name),['Uno','Dos']);
});
test('el directo suma solo la cola pendiente y no transporta contadores de micrófono',()=>{
 const records=[rec('1')],live=[{...rec('1'),mic:{kind:'rtp',observedSeconds:20,activeSeconds:1}}];
 const result=withLiveGaming(records,live,new Date('2025-02-10T21:02:00Z'),'2025-02-10T21:00:00Z');
 assert.equal(result.length,2);assert.equal(result[1].start,'2025-02-10T21:00:00.000Z');assert.equal(result[1].end,'2025-02-10T21:01:00.000Z');assert.equal(result[1].mic,undefined);
 assert.equal(crauzyRanking(result,[member('1')],start,end)[0].awayMinutes,121);
 assert.equal(records.length,1);
});
test('sin pulso válido, juegos ocultos o usuarios en voz no se inventa directo fuera de voz',()=>{
 const records=[rec('1')],now=new Date('2025-02-10T21:01:00Z');
 for(const lastSeen of [null,'no-es-fecha','2025-02-10T18:00:00Z'])assert.equal(withLiveGaming(records,[rec('1')],now,lastSeen).length,1);
 for(const changes of [{inVoice:true},{game:null},{status:'offline'}])assert.equal(withLiveGaming(records,[rec('1',changes)],now,'2025-02-10T21:00:00Z').length,1);
});
