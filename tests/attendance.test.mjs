import test from 'node:test';
import assert from 'node:assert/strict';
import {attendance,mergeMembers,validateMembers} from '../dist/attendance.js';
const member={id:'1',name:'Integrante',since:'2025-01-01T00:00:00Z',active:true};
const start=new Date('2025-02-01T00:00:00Z'),end=new Date('2025-03-01T00:00:00Z');
const rec={userId:'1',name:'Integrante',start:'2025-02-27T19:00:00Z',end:'2025-02-27T21:00:00Z',inVoice:true,game:'Juego'};
test('la lista conserva integrantes sin una sola conexión',()=>{const [r]=attendance([], [member],start,end);assert.equal(r.state,'never');assert.equal(r.days,0);assert.equal(r.last,null)});
test('no apareció en el período aunque tenga historial anterior',()=>{const [r]=attendance([{...rec,start:'2025-01-20T19:00:00Z',end:'2025-01-20T21:00:00Z'}],[member],start,end);assert.equal(r.state,'missing');assert.equal(r.days,0);assert.ok(r.gap>=39)});
test('estar online sin voz no cuenta como asistencia',()=>{const [r]=attendance([{...rec,inVoice:false}],[member],start,end);assert.equal(r.state,'never');assert.equal(r.last,null);assert.equal(r.gap,null);assert.ok(r.days>0);assert.equal(r.voiceDays,0)});
test('el corte histórico ignora conexiones futuras',()=>{const [r]=attendance([{...rec,start:'2025-03-05T19:00:00Z',end:'2025-03-05T21:00:00Z'}],[member],start,end);assert.equal(r.state,'never');assert.equal(r.last,null)});
test('un integrante que aún no estaba en lista no figura como ausente',()=>{const [r]=attendance([],[{...member,since:'2025-04-01T00:00:00Z'}],start,end);assert.equal(r.state,'not_started')});
test('pausar conserva al integrante sin acusar una ausencia',()=>{const [r]=attendance([],[{...member,active:false}],start,end);assert.equal(r.state,'paused')});
test('los cambios de estado de un mismo día no duplican asistencia',()=>{const a=new Date(2025,1,27,19),b=new Date(2025,1,27,20),c=new Date(2025,1,27,21);const rows=[{...rec,start:a.toISOString(),end:b.toISOString()},{...rec,start:b.toISOString(),end:c.toISOString()}];const [r]=attendance(rows,[member],start,end);assert.equal(r.days,1);assert.equal(r.voiceDays,1);assert.equal(r.playVoiceDays,1);assert.equal(r.minutes,120)});
test('migrar datos anteriores agrega integrantes observados y conserva los de cero conexiones',()=>{const merged=mergeMembers([{...member,id:'never',active:false}],[rec]);assert.equal(merged.length,2);assert.equal(merged.find(m=>m.id==='never').active,false);assert.equal(merged.find(m=>m.id==='1').since,rec.start)});
test('la lista rechaza IDs duplicados y nombres vacíos',()=>{assert.throws(()=>validateMembers([member,member]));assert.throws(()=>validateMembers([{...member,name:''}]))});

test('la presencia online reciente no tapa la última visita a voz',()=>{
 const oldVoice={...rec,start:'2025-02-01T19:00:00Z',end:'2025-02-01T20:00:00Z'};
 const [r]=attendance([oldVoice,{...rec,inVoice:false}],[member],start,end);
 assert.equal(r.state,'away');assert.ok(r.gap>=27);assert.equal(r.voiceDays,1);
 assert.equal(r.last.toISOString(),'2025-02-01T20:00:00.000Z');
});
test('online en el período sin entrar a voz sigue siendo una ausencia',()=>{
 const oldVoice={...rec,start:'2025-01-20T19:00:00Z',end:'2025-01-20T20:00:00Z'};
 const [r]=attendance([oldVoice,{...rec,inVoice:false}],[member],start,end);
 assert.equal(r.state,'missing');assert.equal(r.voiceDays,0);assert.ok(r.days>0);
});
