import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as model from '../dist/model.js';
import * as roster from '../dist/attendance.js';

const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const member={id:'123',name:'Integrante de Discord',since:'2026-01-01T00:00:00Z',active:true};
const state={version:1,records:[],members:[member],live:[],bot:{connected:true}};

// Run the actual app bootstrap and sync logic; DOM rendering is covered in browser QA.
function app({saved=null,mode='demo',responses=[state]}={}){
 const storage=new Map([['vicio.mode.v1',mode]]);
 if(saved)storage.set('vicio.records.v1',JSON.stringify(saved));
 const element={addEventListener(){},elements:{inVoice:{addEventListener(){}}}};
 const callbacks=[];
 const sandbox={...model,...roster,Date,console,AbortSignal,
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
  document:{querySelector:selector=>selector==='dialog[open]'?null:element,querySelectorAll:()=>[],addEventListener(){}},
  setInterval:callback=>callbacks.push(callback),
  fetch:async()=>{const value=responses.shift();if(value instanceof Error)throw value;return {ok:true,json:async()=>value}}};
 vm.createContext(sandbox);
 const code=source.replace(/^import .*;\n/gm,'').replace(
  "populateFilters();setView('resumen');void refreshServer(true);",
  'populateFilters=()=>{};render=()=>{};toast=()=>{};');
 vm.runInContext(code+`;globalThis.api={refreshServer,currentMembers,current,settingsView,livePanel,
  chooseDemo(){mode='demo'},get mode(){return mode},get remote(){return remote},
  get backup(){return localBackup},get remoteState(){return remoteState}};`,sandbox);
 return {api:sandbox.api,storage,retry:callbacks[0]};
}

test('abrir el dashboard ignora la antigua preferencia de muestra ficticia',async()=>{
 const {api}=app();
 assert.equal(api.mode,'real');
 assert.equal(api.currentMembers().length,0);
 assert.equal(await api.refreshServer(true),true);
 assert.equal(api.remote,true);
 assert.equal(api.currentMembers()[0].name,member.name);
 assert.equal(api.currentMembers().length,1);
});

test('un backend que falla al inicio se vuelve a consultar sin activar la muestra',async()=>{
 const {api,retry}=app({responses:[new Error('Servicio iniciando'),state]});
 assert.equal(await api.refreshServer(true),false);
 assert.equal(api.mode,'real');
 retry();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(api.remote,true);
 assert.equal(api.currentMembers().length,1);
});

test('la lista local no bloquea Discord y conserva un respaldo sin sobrescribir el navegador',async()=>{
 const saved={version:1,records:[],members:[{...member,id:'manual-1',name:'Integrante local'}]};
 const {api,storage}=app({saved,responses:[state,state]});
 const original=storage.get('vicio.records.v1');
 await api.refreshServer(true);
 assert.equal(api.currentMembers()[0].id,'123');
 assert.equal(api.backup.members[0].id,'manual-1');
 assert.match(api.settingsView(),/Descargar respaldo local pendiente/);
 await api.refreshServer(true);
 assert.equal(api.backup.members[0].id,'manual-1');
 assert.equal(storage.get('vicio.records.v1'),original);
});

test('una respuesta inválida no sustituye la lista real anterior',async()=>{
 const {api}=app({responses:[state,{...state,members:[{...member,name:''}]}]});
 await api.refreshServer(true);
 assert.equal(await api.refreshServer(true),false);
 assert.equal(api.currentMembers()[0].id,'123');
 assert.equal(api.remoteState.bot.connected,false);
});

test('una muestra elegida explícitamente no se cierra con las actualizaciones periódicas',async()=>{
 const {api}=app();
 api.chooseDemo();
 await api.refreshServer(true);
 assert.equal(api.mode,'demo');
 assert.ok(api.currentMembers().some(m=>m.id==='toti'));
});

test('Ahora en voz nunca muestra usuarios que solo estén online',async()=>{
 const {api}=app({responses:[{...state,live:[{userId:'fuera',name:'Solo online',inVoice:false},
 {userId:'voz',name:'Dentro del canal',inVoice:true,status:'offline',muted:true,channel:'El after'}]}]});
 await api.refreshServer(true);
 const html=api.livePanel();assert.ok(!html.includes('Solo online'));assert.match(html,/Dentro del canal/);
 assert.match(html,/El after/);assert.match(html,/Muteado/);
});
