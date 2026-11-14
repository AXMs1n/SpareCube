// SpareCube Service Worker — v28
// เปลี่ยนจาก v27:
//   1) HTML/หน้าเว็บ = network-first → อัปเดตใหม่เห็นทันที (ไม่ค้าง 1 รอบเหมือนเดิม)
//   2) แคช CDN ที่จำเป็นจริง (เดิมคอมเมนต์บอกว่าแคช แต่ไม่ได้แคชเลย)
//   3) แก้ตัวกรองที่บังเอิญบล็อก fonts.googleapis.com (เดิมเช็ค "googleapis" แบบกว้างไป
//      ทำให้ไฟล์ CSS ของฟอนต์ไม่เคยถูกแคช → ออฟไลน์ฟอนต์หลุด)
//   4) จำกัดจำนวนไฟล์ในแคช ไม่ให้โตไม่หยุด

const CACHE_NAME = "sparecube-shell-v28";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

// ไลบรารีภายนอกที่แอปใช้จริง — แคชไว้เพื่อให้เปิดได้ตอนออฟไลน์
const CDN_ASSETS = [
  "https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700&display=swap",
  "https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/3.44.0/tabler-icons.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js",
];

const MAX_CACHE_ENTRIES = 80;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // แยกกัน: ถ้า CDN ตัวใดตัวหนึ่งล่ม ไม่ให้การติดตั้งทั้งชุดล้มตาม
    await cache.addAll(APP_SHELL);
    await Promise.all(CDN_ASSETS.map((url) =>
      cache.add(url).catch(() => { /* ข้ามได้ ไม่วิกฤต */ })
    ));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

function isLiveData(url) {
  // ข้อมูลสด / การยืนยันตัวตน ต้องไม่ผ่านแคชเด็ดขาด
  const h = url.hostname;
  return (
    h === "firestore.googleapis.com" ||
    h === "identitytoolkit.googleapis.com" ||
    h === "securetoken.googleapis.com" ||
    h === "www.googleapis.com" ||
    h.includes("firebaseio.com") ||
    h === "script.google.com" ||
    h === "script.googleusercontent.com"
  );
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_CACHE_ENTRIES) return;
  // ลบของเก่าสุดก่อน (ตัวแรกๆ ในคิว)
  await Promise.all(keys.slice(0, keys.length - MAX_CACHE_ENTRIES).map((k) => cache.delete(k)));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (isLiveData(url)) return;            // ปล่อยผ่านไปเน็ตเวิร์กตามปกติ
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // ---- หน้าเว็บ (navigation): เน็ตก่อน ถ้าออฟไลน์ค่อยใช้แคช ----
  // วิธีนี้ทำให้ deploy แล้วเห็นของใหม่ทันที (ของเดิมเป็น cache-first → ค้าง 1 รอบ)
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", fresh.clone());
        }
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match("./index.html")) || (await cache.match("./")) ||
               new Response("ออฟไลน์ และยังไม่มีไฟล์ที่แคชไว้", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  // ---- ไฟล์อื่น: แคชก่อน (เร็ว) + อัปเดตเบื้องหลัง ----
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);

    const network = fetch(req).then(async (res) => {
      if (res && res.status === 200 && (res.type === "basic" || res.type === "cors")) {
        cache.put(req, res.clone()).then(() => trimCache(cache)).catch(() => {});
      }
      return res;
    }).catch(() => null);

    return cached || (await network) ||
      new Response("", { status: 504, statusText: "offline" });
  })());
});
