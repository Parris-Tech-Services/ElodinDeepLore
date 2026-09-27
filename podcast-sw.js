const SHELL_CACHE='elodin-podcast-shell-v1';
const AUDIO_CACHE='elodin-podcast-audio-v1';
const BASE=new URL('./',self.location.href);
const shellUrl=(path='')=>new URL(path,BASE).href;
const SHELL=['','styles.css','podcast-dialog.css?v=3','data.js','app.js','podcast-dialog.js?v=4'].map(shellUrl);

self.addEventListener('install',event=>event.waitUntil(
  caches.open(SHELL_CACHE)
    .then(cache=>Promise.all(SHELL.map(async url=>{
      try{const response=await fetch(url,{cache:'reload'});if(response.ok)await cache.put(url,response)}catch{}
    })))
    .then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key.startsWith('elodin-podcast-')&&![SHELL_CACHE,AUDIO_CACHE].includes(key)).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;

  if(request.destination==='audio'){
    event.respondWith(
      caches.open(AUDIO_CACHE)
        .then(cache=>cache.match(request,{ignoreVary:true}))
        .then(hit=>hit||fetch(request))
    );
    return;
  }

  const url=new URL(request.url);
  if(url.origin!==self.location.origin||!url.pathname.startsWith(BASE.pathname))return;

  if(request.mode==='navigate'){
    event.respondWith(
      fetch(request)
        .then(response=>{
          if(response.ok)caches.open(SHELL_CACHE).then(cache=>cache.put(shellUrl(''),response.clone())).catch(()=>{});
          return response;
        })
        .catch(()=>caches.open(SHELL_CACHE).then(cache=>cache.match(shellUrl(''))))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(hit=>hit||fetch(request).then(response=>{
      if(response.ok)caches.open(SHELL_CACHE).then(cache=>cache.put(request,response.clone())).catch(()=>{});
      return response;
    }))
  );
});
