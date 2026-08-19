const CACHE_VERSION = "ai-phone-pwa-v6";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      ))
      // 鍒锋柊棰勭紦瀛樼殑 "/" 蹇収锛氬畠鏄绾垮鑸殑鏈€缁堝厹搴曪紝鑻ュ仠鐣欏湪鏃ч儴缃茬増鏈紝
      // 寮曠敤鐨勬棫 hash CSS/JS 宸?404锛屼細娓叉煋鍑烘棤鏍峰紡椤甸潰锛堟枃瀛楀爢鍦ㄥ乏涓婅锛夈€?      .then(() => caches.open(STATIC_CACHE))
      .then((cache) => cache.add(new Request("/", { cache: "reload" })).catch(() => {}))
      .then(() => self.clients.claim())
  );
});

function isCacheableRequest(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/_next/static/")) return true;
  return ["font", "image", "script", "style", "worker"].includes(request.destination);
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const fallback = await caches.match("/");
    if (fallback) return fallback;
    throw error;
  }
}

// 闈欐€佽祫婧愶紙瀛椾綋/鍥剧墖/鑴氭湰/鏍峰紡/妯″瀷锛夌敤 cache-first锛氬懡涓紦瀛樼洿鎺ヨ繑鍥烇紝
// 涓嶅啀姣忔閮藉湪鍚庡彴鎶婃暣浠芥枃浠堕噸鏂版媺涓€閬嶆牎楠屻€傚瓧浣撳姩杈?7~24MB锛屾棫鐨?// stale-while-revalidate 浼氭寔缁噸涓嬶紝鏄甫瀹界垎鎺夌殑涓诲洜涔嬩竴銆?// 闇€瑕佹洿鏂扮紦瀛樺唴瀹规椂锛屽崌 CACHE_VERSION 鍗冲彲璁╂棫缂撳瓨鍦?activate 鏃舵竻绌恒€?async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (isCacheableRequest(request)) {
    event.respondWith(cacheFirst(request));
  }
});
