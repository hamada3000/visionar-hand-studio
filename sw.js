const CACHE = "visionar-advanced-v1";
const CORE = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const req=event.request;
  if(req.method!=="GET")return;
  const url=new URL(req.url);
  if(url.origin===self.location.origin){
    event.respondWith((async()=>{
      const cached=await caches.match(req);
      if(cached)return cached;
      try{
        const response=await fetch(req);
        if(response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(req,copy));}
        return response;
      }catch(e){
        if(req.mode==="navigate")return (await caches.match("./index.html"))||Response.error();
        throw e;
      }
    })());
  }
});
