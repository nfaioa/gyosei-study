// 初回のオンライン表示後、問題演習画面をオフラインでも開けるようにする。
const CACHE='gyosei-study-static-v2';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('gyosei-study-static-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith(fetch(event.request).then(res=>{
    if(res.ok){const saved=res.clone();caches.open(CACHE).then(cache=>cache.put(event.request,saved));}
    return res;
  }).catch(()=>caches.match(event.request).then(r=>r||caches.match('./index.html'))));
});
