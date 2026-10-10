# Japanese Restaurant QR Ordering System (Integrated Demo)

โปรเจกต์รวม 4 Actor ให้รันด้วย Node.js server เดียว, SQLite database เดียว และ port 3000 เดียว

- ลูกค้า: `/customer/...` (เข้าใช้งานจริงผ่าน QR ที่พนักงานบริการสร้าง)
- พนักงานบริการ: `/service/tables`
- พนักงานครัว: `/kitchen/orders`
- พนักงานแคชเชียร์: `/cashier`
- หน้ารวมสำหรับเดโม: `/`

## 1) ติดตั้งและรัน

```bash
npm install
npm start
```

เปิดบนเครื่อง:

```text
http://localhost:3000
```

## 2) Flow สำหรับเดโม

1. เปิด `/service/tables` หรือ `/service/qr`
2. เลือกโต๊ะ A1-A18 แล้วกดพิมพ์ QR
3. ตอนกดพิมพ์ ระบบสร้าง `dining_session` + `qr_token` และเปลี่ยนโต๊ะเป็น `OCCUPIED`
4. ลูกค้าสแกน QR -> กรอกชื่อ -> สั่งอาหาร
5. เมื่อกดยืนยันสั่งอาหาร ระบบสร้าง Order สถานะ `PREPARING`
6. `/kitchen/orders` เห็น Order และกด `เสร็จ`
7. Order เปลี่ยนเป็น `SERVED`; หน้า History ของลูกค้าจะเปลี่ยนจาก `กำลังเตรียม` เป็น `เสร็จแล้ว`
8. ลูกค้าทุกคนในโต๊ะสามารถเพิ่ม/แก้ผู้ร่วมหารของรายการใดก็ได้จากหน้า History
9. ลูกค้าชำระออนไลน์ได้ 2 แบบเท่านั้น:
   - `แยกบิล` = จ่ายเฉพาะยอดของตัวเอง
   - `รวมบิล` = จ่ายยอดคงเหลือของทุกคนในโต๊ะ
   ลูกค้าไม่มีหน้าสำหรับเลือกชื่อคนอื่นทีละคน
10. แคชเชียร์ยังสามารถเลือก 1 คน หรือ `เลือกหลายรายการ` เพื่อรับชำระที่เคาน์เตอร์
11. เมื่อทุกยอดที่ต้องจ่ายของโต๊ะชำระครบ ระบบเปลี่ยน session/table เป็น `CLEANING`
12. พนักงานบริการกดเปลี่ยนจาก `CLEANING` เป็น `AVAILABLE`

## 3) VAT / ค่าบริการ 7%

ระบบคำนวณตามกติกาที่ตกลงกัน:

```text
ราคาเมนู (ก่อน 7%)
-> แบ่งตามผู้ร่วมรับผิดชอบของรายการ
-> subtotal ของแต่ละคน
-> + 7%
-> ยอดสุทธิของแต่ละคน
```

ถ้ารายการ 300 บาทหาร 3 คน แต่ละคนรับผิดชอบ subtotal 100 บาท จากนั้นระบบจึงคิด 7% ของแต่ละคน

## 4) QR ให้มือถือใช้งานจากอินเทอร์เน็ตได้

โค้ดรองรับ `PUBLIC_BASE_URL` เพื่อไม่ผูกกับ Wi-Fi วงเดียวกัน แต่ตัว Node.js ที่รันใน Mac ยังต้องมี URL สาธารณะ เช่น tunnel (ngrok / Cloudflare Tunnel หรือบริการอื่น)

ตัวอย่างเมื่อมี public URL แล้ว:

```bash
PUBLIC_BASE_URL=https://example-tunnel.ngrok.app npm start
```

จากนั้น QR ที่พนักงานบริการพิมพ์จะชี้ไปที่:

```text
https://example-tunnel.ngrok.app/customer/start?token=...
```

ถ้าไม่กำหนด `PUBLIC_BASE_URL` ระบบจะใช้ host ที่เปิดเว็บอยู่ เช่น `http://localhost:3000` เหมาะสำหรับทดสอบในเครื่อง

## 5) Reset Database ก่อนเดโมใหม่

```bash
npm run reset-db
```

คำสั่งนี้ลบเฉพาะข้อมูลใช้งาน เช่น session, ลูกค้า, order, payment และคืนโต๊ะ A1-A18 เป็น `AVAILABLE` แต่ไม่ลบเมนูอาหารหรือหมวดหมู่

## Database

- `restaurant.db` คือ database ที่ทุก actor ใช้ร่วมกัน
- มี 18 โต๊ะ A1-A18
- มีเมนู 72 รายการและหมวดหมู่ 10 หมวด
- ข้อมูลทดสอบ session/order/payment เดิมถูกล้างออกแล้ว

## อัปเดตตาม feedback 1

- หน้า Service Staff อัปเดตสถานะโต๊ะแบบ polling อัตโนมัติ ไม่ต้องกด Refresh หลังพิมพ์ QR
- โต๊ะ `CLEANING` กดเปลี่ยนกลับ `AVAILABLE` ได้
- โต๊ะ `OCCUPIED` กดปิดโต๊ะได้หากยังไม่มี Order; session จะถูกเก็บเป็น `CANCELLED`
- Customer History แสดง Order ของทุกคนในโต๊ะ
- Customer History มีปุ่ม `เลือกผู้ร่วมหาร`, `รวมบิล`, `แยกบิล` และการชำระเงินเปิดเป็น Pop-up ในหน้า History โดยไม่เปลี่ยนหน้า
- หน้าเลือกผู้ร่วมหารแยกตามคนและ Order เพื่อให้เมนูชื่อเดียวกันที่สั่งคนละรอบแบ่งผู้ร่วมหารต่างกันได้ และทุกคนในโต๊ะสามารถแก้รายการของกันและกันได้
- หน้า Payment แสดงรายละเอียดบิลและเปิด Mock QR ใน Pop-up เมื่อกด `สแกนจ่าย`

## Kitchen flow (feedback v3)
- Main kitchen screen: `http://localhost:3000/kitchen/orders`
- Printed / status screen: `http://localhost:3000/kitchen/status`
- Click `พิมพ์` on an incoming order to open the browser print dialog; when the print dialog closes, that order moves to the status screen.
- Click `อัปเดต • เสร็จแล้ว` on the status screen to finish the order. It disappears from kitchen status and the customer history shows `เสร็จแล้ว`.

The customer sees order-confirmation as a popup inside the cart page instead of a separate page.

## Feedback v4 updates
- History -> `รวมบิล` / `แยกบิล` จะเข้าหน้าสรุปรายการและยอดชำระก่อน จากนั้นกด `สแกนจ่าย` จึงเปิด QR popup
- Kitchen เปลี่ยนข้อมูลแบบ realtime/polling โดยไม่ reload หน้า; กดพิมพ์แล้วอยู่หน้าหลัก
- หน้าเมนูลูกค้ากด `+` เพิ่มตะกร้าได้โดยไม่ refresh และไม่เลื่อนกลับด้านบน
- รอบนี้ไม่มีการเปลี่ยน schema ของฐานข้อมูล

### Cashier QR payment (v6)
การรับชำระด้วย QR ที่เคาน์เตอร์เป็นระบบจำลอง: พนักงานพิมพ์ QR ก่อน จากนั้นระบบจะแสดง Pop-up ให้พนักงานกด **ยืนยันการชำระเงิน** เองหลังลูกค้าสแกนจ่าย ไม่มีการนับถอยหลัง 3 วินาทีแล้ว
