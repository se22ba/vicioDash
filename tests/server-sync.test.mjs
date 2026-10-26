import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as model from '../dist/model.js';
import * as roster from '../dist/attendance.js';

const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const member={id:'123',name:'Integrante de Discord',since:'2026-01-01T00:00:00Z',active:true};
const state={version:1,records:[],members:[member],live:[],bot:{connected:true}};

function app({saved=null,responses=[state],token=''}={}){
 const storage=new Map([['vicio.mode.v1','demo']]),session=new Map(token?[['vicio.admin',token]]:[]),elements=new Map(),handlers=new Map(),calls=[];
 if(saved)storage.set('vicio.records.v1',JSON.stringify(saved));
 const el=selector=>{if(selector==='dialog[open]')return null;if(!elements.has(selector))elements.set(selector,{
  value:'',hidden:false,disabled:false,textContent:'',elements:{id:{value:''},active:{checked:true}},
  addEventListener:(event,callback)=>handlers.set(selector+':'+event,callback),reset(){},focus(){},
  showModal(){this.open=true},close(){this.open=false},querySelector:()=>el(selector+' submit')});return elements.get(selector)};
 const callbacks=[];
 const sandbox={...model,...roster,Date,console,AbortSignal,
  localStorage:{getItem:key=>storage.get(key)??null},
  sessionStorage:{getItem:key=>session.get(key)??null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)},
  document:{querySelector:el,querySelectorAll:()=>[],addEventListener(){}},
  setInterval:callback=>callbacks.push(callback),
  fetch:async(path,options)=>{calls.push({path,...options});const value=responses.shift();if(value instanceof Error)throw value;
   return value?.httpError?{ok:false,status:value.httpError,json:async()=>({error:'Clave incorrecta.'})}:{ok:true,json:async()=>value}}};
 vm.createContext(sandbox);
 const code=source.replace(/^import .*;\n/gm,'').replace("populateFilters();setView('resumen');void refreshServer(true);",'populateFilters=()=>{};render=()=>{};toast=()=>{};');
 vm.runInContext(code+`;globalThis.api={refreshServer,currentMembers,current,settingsView,livePanel,openMember,get backup(){return localBackup},get remoteState(){return remoteState},get remote(){return remote}};`,sandbox);
 return {api:sandbox.api,storage,session,el,calls,retry:callbacks[0],submit:()=>handlers.get('#member-form:submit')({preventDefault(){},currentTarget:el('#member-form')})};
}

test('solo se muestran datos del bot, sin reactivar una muestra o un historial local',async()=>{
 const saved={version:1,records:[],members:[{...member,id:'manual-1',name:'Anterior'}]};
 const {api}=app({saved});
 assert.equal(api.currentMembers().length,0);
 assert.equal(await api.refreshServer(true),true);
 assert.equal(api.currentMembers()[0].name,member.name);
 assert.ok(api.backup);assert.equal(api.backup.members[0].id,'manual-1');
});

test('un fallo inicial se reintenta sin inventar integrantes ni actividad',async()=>{
 const {api,retry}=app({responses:[new Error('Iniciando'),state]});
 assert.equal(await api.refreshServer(true),false);assert.equal(api.current().length,0);
 retry();await new Promise(resolve=>setImmediate(resolve));assert.equal(api.remote,true);
});

test('la UI no ofrece carga, importación ni correcciones humanas',async()=>{
 const {api}=app();await api.refreshServer(true);
 assert.doesNotMatch(html,/record-form|add-record|import-file|toggle-data|name="discordId"|name="since"/);
 assert.doesNotMatch(api.settingsView(),/Importar|Agregar integrante|Registrar sesión/);
});

test('la pausa pide la clave en el formulario y solo envía el estado activo',async()=>{
 const {api,el,session,calls,submit}=app({responses:[state,{member:{...member,active:false}}]});
 await api.refreshServer(true);api.openMember('123');
 assert.equal(el('#member-token-row').hidden,false);assert.equal(el('#member-token').required,true);
 el('#member-token').value='clave-valida';el('#member-form').elements.active.checked=false;
 await submit();
 assert.equal(calls.at(-1).method,'PATCH');assert.deepEqual(JSON.parse(calls.at(-1).body),{active:false});
 assert.equal(calls.at(-1).headers.Authorization,'Bearer clave-valida');
 assert.equal(api.currentMembers()[0].active,false);assert.equal(el('#member-dialog').open,false);
 assert.equal(session.get('vicio.admin'),'clave-valida');
});

test('una clave vieja incorrecta abre la entrada de clave sin perder el estado del formulario',async()=>{
 const {api,el,session,submit}=app({token:'clave-vieja',responses:[state,{httpError:401}]});
 await api.refreshServer(true);api.openMember('123');assert.equal(el('#member-token-row').hidden,true);
 el('#member-form').elements.active.checked=false;await submit();
 assert.equal(el('#member-token-row').hidden,false);assert.equal(el('#member-dialog').open,true);
 assert.equal(session.has('vicio.admin'),false);assert.match(el('#member-error').textContent,/Clave incorrecta/);
 assert.equal(api.currentMembers()[0].active,true);
});

test('una respuesta inválida no sustituye los datos anteriores',async()=>{
 const {api}=app({responses:[state,{...state,members:[{...member,name:''}]}]});
 await api.refreshServer(true);assert.equal(await api.refreshServer(true),false);
 assert.equal(api.currentMembers()[0].id,'123');assert.equal(api.remoteState.bot.connected,false);
});

test('Ahora en voz excluye a los usuarios online y oculta la sección vacía',async()=>{
 const {api}=app({responses:[{...state,live:[{userId:'fuera',name:'Solo online',inVoice:false},{userId:'voz',name:'Dentro',inVoice:true,channel:'Canal'}]},state]});
 await api.refreshServer(true);assert.doesNotMatch(api.livePanel(),/Solo online/);assert.match(api.livePanel(),/Dentro/);
 await api.refreshServer(true);assert.equal(api.livePanel(),'');
});
