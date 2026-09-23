# Multiplayer Plan — Slime Run Adventure

> สถานะ: เสร็จแล้ว (Phase 1–3) — WebSocket relay + NetBus + ผู้ชม (spectator) + host admits + host-authoritative results
> วันที่จัดทำ: 2026-09-22

## ข้อค้นพบหลัก (กำหนดทิศทาง)

- ปัจจุบันแต่ละเครื่อง/แต่ละแท็บรัน simulation ของตัวเองอยู่แล้ว (`new Game()` ต่อเครื่อง)
- `seed` ใน RoomState ยังไม่ถูกใช้จริงใน sim — สนาม/event ใช้ `Math.random()` ของแต่ละเครื่อง (`Game.ts` บรรทัด ~559: `EVENTS.filter(() => Math.random() < 0.55)`)
- ระบบห้องปัจจุบัน (`src/lobby/roomBus.ts`) ใช้ `BroadcastChannel` + `localStorage` → ทำงานเฉพาะหลายแท็บในเบราว์เซอร์เดียวกัน ไม่ข้ามเครื่อง
- **ดังนั้น:** ไม่ทำ deterministic lockstep (ยากมาก ต้อง sync physics substeps) แต่ทำโมเดล
  **"Shared Lobby + Synced Start + แข่งด้วยเวลาจริง"** — ทุกเครื่องเห็นสไลม์ทุกตัววิ่งใน sim ของตัวเอง
  (สนาม seed เดียวกัน) จบแล้วส่ง finishTime ขึ้น server มารวมอันดับ

## สถาปัตยกรรม

```
[เบราว์เซอร์ A (host)] ──wss──┐
[เบราว์เซอร์ B]        ──wss──┤──> [Relay Server (Node + ws)]
[เบราว์เซอร์ C]        ──wss──┘         │ broadcast RoomState ให้ทุกคน
                                        │ เก็บ finish times
[เว็บ static] อยู่บน Vercel (แยกจาก server)
```

- **Host ยังเป็น authoritative ของห้อง** (เหมือนเดิม) — server เป็นแค่ relay + presence
- Logic ใน roomBus ย้ายมาได้เกือบทั้งหมดเพราะ host ยังตัดสินใจทุกอย่าง

## รายการไฟล์

### ไฟล์ server (deploy แยกบน Render/Railway ฟรี — Vercel ไม่รองรับ WebSocket server)
| ไฟล์ | หน้าที่ |
|---|---|
| 🆕 `server/index.js` | WebSocket relay ด้วย library `ws` (~150 บรรทัด): join by room code, relay ข้อความระหว่างสมาชิก, heartbeat/ตัดคนหลุด, ลบห้องที่ไม่มีคน > 45 นาที, เก็บผลแข่ง (finishTime) ต่อห้อง |
| 🆕 `server/package.json` | `{ "dependencies": { "ws": "^8" }, "start": "node index.js" }` |

### ไฟล์ client (Vercel)
| ไฟล์ | การแก้ |
|---|---|
| 🆕 `src/lobby/netBus.ts` | คลาส `NetBus` มี **API เหมือน `RoomBus` ทุก method** (create/join/leave/addAI/patch/kick/subscribe/start ฯลฯ) แต่พูดกับ wss — App.tsx สลับใช้ได้แทบไม่แก้ logic |
| ✏️ `src/App.tsx` | เลือก transport: มี `import.meta.env.VITE_WS_URL` → `NetBus`, ไม่มี → fallback `RoomBus` (same-device เดิม) |
| ✏️ `src/game/Game.ts` | เพิ่ม callback ส่งผล: `{ playerId, finishTime }` ขึ้น server (ผ่าน callbacks ที่ App ให้) |
| ✏️ `src/lobby/types.ts` | เพิ่ม msg: `{ t: "finish", ... }`, `{ t: "results", ... }` |
| ✏️ `.env` / Vercel | `VITE_WS_URL=wss://<your-app>.onrender.com` |

**ไม่แตะ:** `roomBus.ts` (เก็บเป็น offline mode), UI (RoomScreen ใช้ state เดิม), เกม core

## ขั้นตอน

1. **Phase 1 — Lobby ข้ามเครื่อง**: server relay + NetBus → สร้างห้อง/จอย/เปลี่ยนสี/เตะ/เติม AI ข้ามเครื่องจริง
2. **Phase 2 — Start sync**: host กดเริ่ม → broadcast `{t:"start", seed, members}` → ทุกเครื่องเข้าสนามพร้อมกัน (protocol มีอยู่แล้ว แค่ย้ายไปวิ่งบน wss)
3. **Phase 3 — รวมผล**: แต่ละเครื่องส่ง finishTime ของสไลม์ตัวเอง → server รวม + broadcast `{t:"results"}` → หน้า Results แสดงอันดับจากผลรวมจริง (แทนที่แต่ละเครื่องเห็นอันดับต่างกัน)

## ข้อจำกัดที่ยอมรับ

- สไลม์คนอื่นเป็น "เงา" ใน sim ของเรา — การชนไม่ sync เรียลไทม์ (อันดับตัดสินด้วยเวลาจริง)
- AI generate ที่เครื่อง host แล้ว broadcast ชื่อ/สี ทุกเครื่อง sim AI ของตัวเอง
- Render ฟรี tier sleep เมื่อไม่มีคน ~15 นาที → จอยครั้งแรกช้า ~30 วิ

## จุดอ้างอิงในโค้ด (ณ วันจัดทำ)

- `src/lobby/roomBus.ts` — API ต้นแบบของ NetBus (`create/join/leave/addAI/removeAI/fillAI/patch/kick/subscribe`)
- `src/lobby/types.ts` — `RoomState`, `RoomMember`, `BusMsg` (ใช้ต่อได้เลย)
- `src/App.tsx` ~58–75 — จุดต่อ room state → `PlayerConfig[]` เข้าเกม (ใช้ `% SLIME_COLORS.length`)
- `src/game/Game.ts` — `onFinish` callback มีอยู่แล้ว (`cb.onFinish(toInfo(b), rank)`) ต่อยอดส่งผลขึ้น server ได้ทันที
- สถานะเกมปัจจุบัน: MAX_SPEED=15, MAD (ท้าย 30% / 10 วิ / ×1.2 / 0.5 วิ / คูลดาวน์ 20 วิ), 40 สี, ball↔ball restitution 0.75
