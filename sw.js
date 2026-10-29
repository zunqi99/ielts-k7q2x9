var CACHE = "ielts-static-v2";
var ASSETS = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/engine.js",
  "./js/app.js",
  "./js/bank.js",
  "./js/docs.js",
  "./data/words.json",
  "./data/grammar.json",
  "./data/articles.json",
  "./data/gloss.json",
  "./data/practice.json",
  "./data/dict.json",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./vendor/mammoth.browser.min.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./robots.txt"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        if (req.mode === "navigate") return caches.match("./index.html");
      });
    })
  );
});
