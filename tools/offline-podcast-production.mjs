import { chromium } from 'playwright';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile);

const url=process.env.PRODUCTION_URL||'https://parris-tech-services.github.io/ElodinDeepLore/';
const html=await readFile('index.html','utf8');
const match=html.match(/<script id="elodin-podcast-data" type="application\/json">([\s\S]*?)<\/script>/);
if(!match)throw new Error('Elodin podcast catalogue missing');
const episodes=JSON.parse(match[1]);
const direct=episodes.map((e,index)=>({...e,index})).filter(e=>e.audio);
const requested=process.env.EPISODE_TITLE||'';
const selected=requested?direct.filter(e=>e.title===requested):(process.env.ALL_EPISODES==='1'?direct:direct.slice(0,1));
if(!selected.length)throw new Error('No direct Elodin podcast selected');

const output='offline-evidence';await mkdir(output,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const options={headless:true,ignoreDefaultArgs:['--mute-audio'],viewport:{width:412,height:915},deviceScaleFactor:2.625,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',serviceWorkers:'allow'};
const state=page=>page.locator('#elodin-podcast-dialog audio').evaluate(a=>({time:a.currentTime,duration:a.duration,paused:a.paused,readyState:a.readyState,src:a.currentSrc,error:a.error?.message||null}));

async function openEpisode(page,e){
 await page.evaluate(({index})=>localStorage.setItem('elodin-deep-lore-podcast-v1',JSON.stringify({currentIndex:index,recent:[]})),e);
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Open fantasy storytelling podcasts'}).waitFor({timeout:60000});
 await page.getByRole('button',{name:'Open fantasy storytelling podcasts'}).click();
 await page.getByRole('heading',{name:e.title,exact:true}).waitFor();
}
async function waitDeploy(page,e){
 const deadline=Date.now()+8*60_000;
 while(Date.now()<deadline){
  try{await openEpisode(page,e);if(await page.getByRole('button',{name:/Download offline|Offline saved|Retry offline download/}).count())return}catch{}
  await sleep(15000);await page.goto(url,{waitUntil:'domcontentloaded'});
 }
 throw new Error('Elodin production never exposed offline build');
}
async function isolate(ctx,page,evidence,label){
 await ctx.setOffline(true);
 const failed=await page.evaluate(async()=>{try{await fetch('https://example.com/?offline='+crypto.randomUUID(),{mode:'no-cors',cache:'no-store'});return false}catch{return true}});
 assert(failed,'Network probe unexpectedly succeeded');
 for(const worker of ctx.serviceWorkers())assert(await worker.evaluate(async()=>{try{await fetch('https://example.com/?worker='+crypto.randomUUID(),{mode:'no-cors',cache:'no-store'});return false}catch{return true}}),'Service worker retained network');
 evidence.push({step:label,networkProbeFailed:true});
}
async function playback(page,evidence,label){
 const audio=page.locator('#elodin-podcast-dialog audio');await audio.waitFor();await audio.evaluate(a=>a.play());
 const before=await state(page);await sleep(10000);const after=await state(page);
 assert(!after.paused&&!after.error&&after.readyState>=2&&after.time-before.time>7,'Offline playback did not progress');
 const target=Math.min(after.duration*.65,after.duration-30);assert(target>60,'Episode too short for meaningful seek');
 await audio.evaluate((a,t)=>{a.currentTime=t},target);await sleep(7000);const sought=await state(page);
 assert(sought.time>target+4&&!sought.error&&!sought.paused,'Seek playback failed');
 await audio.evaluate(a=>a.pause());const paused=await state(page);await sleep(2500);const held=await state(page);
 assert(held.paused&&Math.abs(held.time-paused.time)<.25,'Pause failed');
 await audio.evaluate(a=>a.play());await sleep(5000);const resumed=await state(page);
 assert(!resumed.paused&&!resumed.error&&resumed.time-held.time>3,'Resume failed');
 evidence.push({step:label,before,after,target,sought,paused,held,resumed});
 const recording=join(output,label.replaceAll(' ','-')+'.wav');
 await execute('ffmpeg',['-y','-f','pulse','-i','offline_test.monitor','-t','5',recording]);
 const {stderr}=await execute('ffmpeg',['-i',recording,'-af','volumedetect','-f','null','-']);
 const peak=stderr.match(/max_volume: ([-\d.]+) dB/);assert(peak&&Number(peak[1])>-85,'No non-silent system audio');
 evidence.push({step:label+' system audio',maxDb:Number(peak[1])});
}

const results=[];
for(const e of selected){
 const evidence=[];const result={title:e.title,status:'FAIL',evidence};results.push(result);let ctx;
 try{
  const profile=await mkdtemp(join(tmpdir(),'elodin-profile-'));
  ctx=await chromium.launchPersistentContext(profile,options);let page=await ctx.newPage();
  await page.goto(url,{waitUntil:'domcontentloaded'});await waitDeploy(page,e);
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const button=page.getByRole('button',{name:/Download offline|Retry offline download/});
  if(await button.count()){await button.click();await page.getByRole('button',{name:/Offline saved/}).waitFor({timeout:300000})}
  const stored=await page.evaluate(async audioUrl=>{const cache=await caches.open('elodin-podcast-audio-v1');const r=await cache.match(audioUrl,{ignoreVary:true});if(!r)return{missing:true};if(r.type==='opaque')return{type:'opaque',hashUnavailable:true};const bytes=await r.arrayBuffer();return{type:r.type,size:bytes.byteLength,contentLength:r.headers.get('content-length'),mime:r.headers.get('content-type'),sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')}},e.audio);
  assert(!stored.missing,'Downloaded media missing');evidence.push({step:'stored media',stored});
  await isolate(ctx,page,evidence,'network disabled');await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Open fantasy storytelling podcasts'}).click();await page.getByRole('heading',{name:e.title,exact:true}).waitFor();await playback(page,evidence,'offline');
  await ctx.close();ctx=null;
  ctx=await chromium.launchPersistentContext(profile,{...options,offline:true,proxy:{server:'http://127.0.0.1:9'}});page=await ctx.newPage();await page.goto(url,{waitUntil:'domcontentloaded'});await isolate(ctx,page,evidence,'restart remains offline');await page.getByRole('button',{name:'Open fantasy storytelling podcasts'}).click();await page.getByRole('heading',{name:e.title,exact:true}).waitFor();await playback(page,evidence,'restarted');
  if(stored.type==='opaque'){const audio=page.locator('#elodin-podcast-dialog audio');await audio.evaluate(a=>{a.pause();a.currentTime=0;a.playbackRate=16});await audio.evaluate(a=>a.play());const duration=(await state(page)).duration;await page.waitForFunction(()=>document.querySelector('#elodin-podcast-dialog audio')?.ended,{},{timeout:duration/16*1000+60000});const end=await state(page);assert(Math.abs(end.time-duration)<1&&!end.error,'Opaque episode did not fully decode offline');evidence.push({step:'complete opaque episode decoded offline',duration,end})}
  else{assert(stored.size>100000,'Readable stored media too small');if(stored.contentLength)assert.equal(stored.size,Number(stored.contentLength),'Stored length mismatch')}
  result.status='PASS';
 }catch(error){result.error=error.stack||String(error);console.error(e.title,error)}
 finally{if(ctx)await ctx.close();await writeFile(join(output,'results.json'),JSON.stringify(results,null,2))}
}
console.log(JSON.stringify(results,null,2));if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
