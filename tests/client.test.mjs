import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../web/cloud.js',import.meta.url),'utf8');
function setup(replies=[]){
  const calls=[];
  const context={window:{},location:{hostname:'example.github.io'},URL,AbortController,setTimeout,clearTimeout,
    fetch:async(url,options)=>{calls.push({url,...options,payload:JSON.parse(options.body)});const reply=replies.shift();if(reply instanceof Error)throw reply;return {ok:reply.status<400,status:reply.status,json:async()=>reply.body};}};
  vm.runInNewContext(source,context);
  return {Cloud:context.window.KinpassCloud,calls};
}
test('no Telegram initData means no anonymous cloud access',()=>{
  const {Cloud,calls}=setup();assert.throws(()=>new Cloud('https://example.supabase.co/functions/v1/kinpass-api',''),/Telegram/);assert.equal(calls.length,0);
});
test('public configuration is URL only and cloud sends raw initData in POST body',async()=>{
  const {Cloud,calls}=setup([{status:200,body:{documents:[],revision:0}}]);
  const cloud=new Cloud('https://example.supabase.co/functions/v1/kinpass-api','signed-telegram-value');
  await cloud.load();assert.equal(calls[0].payload.initData,'signed-telegram-value');assert.equal(calls[0].payload.action,'load');
  assert.equal(calls[0].credentials,'omit');assert.equal(calls[0].url.includes('signed-telegram-value'),false);assert.equal('userId' in calls[0].payload,false);
});
test('successful save advances revision, stale response adopts server revision for retry',async()=>{
  const {Cloud,calls}=setup([{status:200,body:{documents:[],revision:2}},{status:409,body:{error:'REVISION_CONFLICT',documents:[{id:'remote'}],revision:3}},{status:200,body:{documents:[{id:'remote'},{id:'new'}],revision:4}}]);
  const cloud=new Cloud('https://example.supabase.co/functions/v1/kinpass-api','signed');await cloud.load();
  await assert.rejects(()=>cloud.save([{id:'new'}]),e=>e.code==='REVISION_CONFLICT'&&e.documents[0].id==='remote');assert.equal(cloud.revision,3);
  await cloud.save([{id:'remote'},{id:'new'}]);assert.equal(calls[2].payload.revision,3);assert.equal(cloud.revision,4);
});
test('network failure does not claim a save or advance revision',async()=>{
  const {Cloud}=setup([new Error('offline')]);const cloud=new Cloud('https://example.supabase.co/functions/v1/kinpass-api','signed');
  await assert.rejects(()=>cloud.save([{id:'new'}]),/Нет связи/);assert.equal(cloud.revision,0);assert.equal(cloud.saving,false);
});
test('malformed success state is rejected',async()=>{
  const {Cloud}=setup([{status:200,body:{documents:'bad',revision:-1}}]);const cloud=new Cloud('https://example.supabase.co/functions/v1/kinpass-api','signed');
  await assert.rejects(()=>cloud.load(),/неполные/);
});
test('upload and preview are scoped by document id, caller cannot send identity',async()=>{
  const {Cloud,calls}=setup([{status:200,body:{file:'42/doc/a.jpg',fileName:'a.jpg'}},{status:200,body:{url:'https://signed.example/a.jpg',mimeType:'image/jpeg'}}]);
  const cloud=new Cloud('https://example.supabase.co/functions/v1/kinpass-api','signed');await cloud.upload('doc','a.jpg','data:image/jpeg;base64,/9j/4A==');await cloud.file('doc');
  assert.equal(calls[0].payload.documentId,'doc');assert.equal(calls[1].payload.action,'file');assert.equal('path' in calls[1].payload,false);
});
test('production server URL requires HTTPS',()=>{
  const {Cloud}=setup();assert.throws(()=>new Cloud('http://example.supabase.co/functions/v1/kinpass-api','signed'),/HTTPS/);
});
