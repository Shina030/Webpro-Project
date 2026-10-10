# Merge Notes - สิ่งที่แก้จากไฟล์ของสมาชิก

## โครงสร้างโปรเจกต์

เดิมแต่ละ Actor มี Express app และ `listen(3000)` ของตัวเอง (`service.js`, `customer.js`, `kitchen.js`, `cashier.js`) ซึ่งไม่สามารถเปิดพร้อมกันที่ port เดียวได้

แก้เป็น:

- `index.js` = server หลักเพียงตัวเดียว
- `routes/service.js`
- `routes/customer.js`
- `routes/kitchen.js`
- `routes/cashier.js`
- ทุก route ใช้ `restaurant.db` เดียวผ่าน `db.js`
- ทุก Actor ใช้ port 3000 ร่วมกัน

## Database

ใช้ฐานจาก `restaurant-combined.db` และเปลี่ยนชื่อไฟล์ final เป็น `restaurant.db`

ลบเฉพาะข้อมูลทดสอบเดิมจาก:

- `dining_session`
- `customer`
- `orders`
- `order_detail`
- `order_item_participant`
- `payment`
- `payment_customer`

เก็บข้อมูล:

- `menu_category`
- `menu_items`
- `dining_table`

ตั้งโต๊ะเป็น:

- `table_id` 1-18
- `table_number` A1-A18
- `table_status` เริ่มต้น `AVAILABLE`

## ตารางที่เพิ่มจากฐานเดิมในช่วงพัฒนาส่วนแคชเชียร์

### `order_item_participant`
ใช้บันทึกว่า Order item หนึ่งรายการมีใครบ้างร่วมรับผิดชอบค่าอาหาร

คอลัมน์หลัก:

- `order_id`
- `menu_id`
- `customer_id`
- `session_id`
- `share_weight`
- `created_at`

เมื่อสั่งอาหารใหม่ ระบบจะเพิ่มผู้สั่งเป็น participant คนแรกอัตโนมัติ จากหน้า History ผู้สั่งสามารถเพิ่มเพื่อนในโต๊ะมาหารรายการนั้นได้

### `payment_customer`
เป็นตารางกลางระหว่าง `payment` และ `customer` เพราะ payment หนึ่งครั้งสามารถครอบคลุมหลายคนได้

คอลัมน์หลัก:

- `payment_id`
- `customer_id`
- `session_id`
- `subtotal`
- `service_fee`
- `total_amount`

## ตาราง `payment`
รองรับการชำระหลายครั้งใน session เดียว และมี:

- `subtotal`
- `service_rate` (0.07)
- `service_fee`
- `amount_paid`
- `amount_received`
- `change_amount`
- `payment_method`

## ตาราง `dining_session`
รองรับสถานะ:

- `OPEN`
- `CLEANING`
- `CLOSED`
- `CANCELLED`

เพิ่ม index ป้องกันโต๊ะเดียวมี session ที่ active (`OPEN`/`CLEANING`) ซ้ำพร้อมกัน

## ลูกค้า

แก้ `customer.js` เดิมที่ hard-code `session_id = 1` เป็นการใช้ session จริงจาก QR Token

Flow:

- QR -> `/customer/start?token=...`
- ตรวจ `qr_token`
- ลูกค้ากรอกชื่อ
- บันทึก customer ผูกกับ `dining_session` จริง
- cart ถูกเก็บใน browser session ของลูกค้าคนนั้น

ลูกค้าใช้การชำระเงิน 2 แบบ:

1. `แยกบิล` = customer ปัจจุบันเท่านั้น
2. `รวมบิล` = จ่ายยอดคงเหลือของทุกคนในโต๊ะ

ไม่มีการเลือกรายชื่อคนอื่นทีละคนจากหน้าลูกค้า

## ผู้ร่วมหารค่าอาหาร

หน้า `/customer/history` มีปุ่ม `เลือกผู้ร่วมหาร` และลูกค้าทุกคนในโต๊ะสามารถแก้ผู้ร่วมหารของรายการใดก็ได้

ยอดรายการ = `unit_price × quantity` แล้วแบ่งเท่ากันตาม participant จากนั้นรวม subtotal ของแต่ละคนและคิด 7%

เมื่อโต๊ะเริ่มมี payment แล้ว ระบบล็อกการแก้ participant เพื่อไม่ให้ยอดที่ชำระไปแล้วเปลี่ยนย้อนหลัง

## สถานะอาหาร

ลูกค้าจะเห็นเพียง 2 สถานะ:

- `PREPARING` / `PENDING` -> `กำลังเตรียม`
- `SERVED` -> `เสร็จแล้ว`

เมื่อยืนยัน Order ใหม่ ระบบบันทึกเป็น `PREPARING` และครัวเห็นใน `/kitchen/orders`

เมื่อครัวกด `เสร็จ`:

```sql
order_status = 'SERVED'
close_time = CURRENT_TIMESTAMP
```

หน้า History ลูกค้ามี polling อัปเดตสถานะโดยไม่ต้องสร้างสถานะเพิ่ม

## พนักงานบริการ

- เลือกโต๊ะ
- preview QR
- ตอนกดพิมพ์จึงสร้าง `dining_session` และ `qr_token`
- เปลี่ยน table เป็น `OCCUPIED`
- QR ใช้ URL ของ session จริง
- โต๊ะ `CLEANING` ไม่สามารถพิมพ์ QR ได้
- พนักงานบริการเท่านั้นที่เปลี่ยน `CLEANING` -> `AVAILABLE`

## ครัว

รวมโค้ดเดิมให้ใช้ database เดียว

- แสดงเฉพาะ Order ที่ `PENDING/PREPARING`
- กด `เสร็จ` -> `SERVED`
- เพิ่ม auto refresh สำหรับเดโมเพื่อให้ Order ใหม่เข้าหน้าครัวได้เร็ว

## แคชเชียร์

คง UI ตาม Storyboard เดิม

- dashboard โต๊ะทั้งหมด
- จุดเขียว = ชำระแล้ว
- จุดแดง = ยังไม่ชำระ
- เลือกคนเดียวหรือ `เลือกหลายรายการ`
- QR และเงินสดเป็น Popup ในหน้าเดิม
- QR เป็น Mock payment
- เงินสดคำนวณเงินทอน
- เมื่อทุกยอดที่มีภาระต้องจ่ายชำระครบ -> `CLEANING`

## QR Public URL

เพิ่มการรองรับ environment variable:

```text
PUBLIC_BASE_URL
```

จึงสามารถใช้ URL จาก tunnel เพื่อสแกนมือถือผ่านอินเทอร์เน็ต ไม่จำเป็นต้องอยู่ Wi-Fi วงเดียวกัน

## Feedback revision 2026-10-09

แก้ตาม `feedback 1.pdf` เพิ่มเติมดังนี้

### พนักงานบริการ
- กดโต๊ะสถานะ `CLEANING` (สีเหลือง/ส้ม) ได้ และมี Pop-up แสดง `รอทำความสะอาด -> ว่าง`
- กดโต๊ะสถานะ `OCCUPIED` (สีแดง) ได้เพื่อขอปิดโต๊ะ
- ปิดโต๊ะสีแดงได้เฉพาะกรณี session นั้น **ยังไม่มี Order** เท่านั้น
  - ไม่มีลูกค้า: ปิดได้
  - มีลูกค้าแต่ยังไม่สั่งอาหาร: ปิดได้
  - มี Order แล้ว: ปิดไม่ได้
- เมื่อปิดโต๊ะก่อนมี Order จะเก็บ session เดิมเป็น `CANCELLED` และเปลี่ยน `dining_table.table_status` กลับเป็น `AVAILABLE`
- หน้าโต๊ะและหน้าพิมพ์ QR ดึงสถานะโต๊ะใหม่อัตโนมัติประมาณทุก 1.2 วินาที
- หลังพิมพ์ QR สำเร็จ card โต๊ะเปลี่ยนเป็น `OCCUPIED` ทันทีโดยไม่ต้องกด Refresh เอง

### ลูกค้า - ประวัติ / ผู้ร่วมหาร
- หน้า `/customer/history` เปลี่ยนให้เห็น Order ของ **ทุกคนใน session โต๊ะเดียวกัน**
- แต่ละ Order แสดงชื่อผู้สั่ง, เลข Order, เวลา, รายการ, จำนวน, ราคา, สถานะอาหาร และชื่อผู้ร่วมรับผิดชอบ
- ปุ่มหลักด้านล่างมี 3 ปุ่ม:
  - `เลือกผู้ร่วมหาร`
  - `รวมบิล`
  - `แยกบิล`
- เพิ่มหน้า `/customer/history/share`
  - แยกตามคนสั่งและ Order
  - เมนูเดียวกันที่สั่งคนละ Order จึงเลือกหารแยกกันได้
  - กดไอคอนคนที่แต่ละรายการเพื่อเปิด Pop-up เลือกชื่อผู้ร่วมหาร
  - ลูกค้าทุกคนในโต๊ะสามารถเพิ่ม/ลบผู้ร่วมหารของรายการใดก็ได้ ไม่จำกัดเฉพาะคนสั่ง
  - ทุกคนยังเห็นชื่อผู้ร่วมหารของทุก Order เพื่อช่วยตรวจสอบการหาร
- เมื่อโต๊ะเริ่มมี Payment แล้ว ระบบยังล็อกการแก้ผู้ร่วมหารเพื่อไม่ให้ยอดที่จ่ายไปแล้วเปลี่ยนย้อนหลัง

### ลูกค้า - ชำระเงิน
- `แยกบิล` เปิด Mock QR Pop-up จากหน้า History เพื่อจ่ายยอดของลูกค้าปัจจุบันเท่านั้น
- `รวมบิล` เปิด Mock QR Pop-up จากหน้า History เพื่อจ่ายยอดคงเหลือของทุกคนในโต๊ะ
- ตัดหน้า `/customer/payment` ออก; URL เดิม redirect กลับ `/customer/history`
- หน้าชำระเงินแสดงรายการอาหาร, Order, จำนวน, ส่วนแบ่งที่ต้องรับผิดชอบ, subtotal, VAT 7% และยอดสุทธิแยกตามคน
- กด `สแกนจ่าย` แล้วแสดง Mock Thai QR เป็น Pop-up
- ยืนยันการชำระ -> รอ 3 วินาที -> บันทึก Payment ตาม logic เดิม

### Database
รอบ feedback นี้ **ไม่ได้เพิ่มตารางใหม่** เพราะโครงสร้างเดิมรองรับแล้ว:
- `dining_session.session_status = CANCELLED` ใช้สำหรับปิดโต๊ะที่เปิดผิดก่อนมี Order
- `order_item_participant` ใช้แยกผู้ร่วมหารในระดับ `(order_id, menu_id)` ทำให้เมนูเดียวกันคนละ Order แบ่งคนละชุดได้
- `payment_customer` รองรับทั้งแยกบิลและรวมบิล


## Feedback v3 (9 Oct 2026)
- เปิดสิทธิ์ให้ลูกค้าทุกคนในโต๊ะแก้ผู้ร่วมหารของทุก Order/รายการได้
- ไม่บังคับให้ผู้ใช้ปัจจุบันหรือคนสั่งต้องอยู่ใน participant list; แต่ต้องเหลืออย่างน้อย 1 คนต่อรายการ
- ตัดหน้า Customer Payment แยกออก และย้าย QR payment flow เป็น Pop-up ในหน้า History
- เอาลิงก์ “ชำระเงิน” ออกจากหน้าเมนู เพราะใช้ปุ่ม รวมบิล/แยกบิล ใน History แทน

## Feedback v3 revision

### Customer cart
- Removed the separate order-confirmation page from the customer flow.
- After `ยืนยันสั่งอาหาร`, the order is still saved immediately and sent to the kitchen, but the success result now opens as a modal on `/customer/cart`.
- Old `/customer/order/confirmation/:id` links redirect back to the cart modal flow.
- `views/customer/order-confirmation.ejs` is no longer used and was removed.

### Kitchen: exactly 2 working screens/use cases
1. `/kitchen/orders` - incoming orders. Each card has only a `พิมพ์` action. Newest orders are shown first so a new order pushes older cards along the grid.
2. `/kitchen/status` - orders that have already been printed. Each card has `อัปเดต • เสร็จแล้ว`. When clicked, the order becomes `SERVED`, disappears from the kitchen status page, and the customer history changes to `เสร็จแล้ว`.

Kitchen screen separation uses one small database flag instead of adding another customer-visible order status:
- `order_status = PREPARING` + `kitchen_printed = 0` = waiting to print on the kitchen main page
- `order_status = PREPARING` + `kitchen_printed = 1` = printed and waiting on the kitchen status page
- `order_status = SERVED` = finished

Customer UI still exposes only the requested two statuses: `กำลังเตรียม` and `เสร็จแล้ว`. The `kitchen_printed` flag is internal and is never shown to customers.

- Added a live clock at the bottom-right of the kitchen status screen.
- Kitchen pages auto-refresh while idle so new orders/status changes appear without manual refresh.

## Feedback v4 (2026-10-09)

รอบนี้ **ไม่มีการเพิ่ม/แก้โครงสร้างฐานข้อมูล** ใช้ schema เดิมจาก v4 ได้เลย

### 1) Customer payment flow
- เปลี่ยนปุ่ม `รวมบิล` และ `แยกบิล` ในหน้า History ให้ไปที่ Use Case `ชำระเงิน` ก่อน
- เพิ่ม `views/customer/payment.ejs`
- `/customer/payment?mode=TABLE` = รวมยอดค้างของทุกคนในโต๊ะ
- `/customer/payment?mode=OWN` = ยอดที่ผู้ใช้ปัจจุบันรับผิดชอบ
- หน้าชำระเงินแสดงรายการอาหาร, ยอดอาหาร, ค่าบริการ 7%, ยอดสุทธิ
- เมื่อกด `สแกนจ่าย` จึงเปิด QR Payment เป็น Popup
- QR และการยืนยันยังเป็นระบบจำลอง 3 วินาทีเหมือนเดิม

### 2) Kitchen no-refresh workflow
- เพิ่ม `GET /kitchen/api/orders?view=main|status` สำหรับดึงข้อมูลออเดอร์แบบ JSON
- หน้าหลักและหน้าสถานะ poll ข้อมูลทุกประมาณ 1.8 วินาที โดยไม่ reload ทั้งหน้า
- เมื่อหน้าหลักกด `พิมพ์`:
  - เปิด `window.print()`
  - อัปเดต `kitchen_printed = 1`
  - เอาการ์ดออกจากหน้าหลักทันที
  - **ยังอยู่หน้าหลัก** ไม่ redirect ไปหน้าสถานะ
- หน้าสถานะจะเห็นออเดอร์ที่พิมพ์แล้วโดยอัตโนมัติ
- กด `เสร็จแล้ว` จะอัปเดตเป็น `SERVED` และเอาการ์ดออกโดยไม่ reload

### 3) Customer menu add-to-cart without refresh
- ปุ่ม `+` หน้าเมนูเปลี่ยนเป็น AJAX
- เพิ่มอาหารลง session cart โดยไม่เปลี่ยนหน้าและไม่ scroll กลับด้านบน
- จำนวนรายการในแถบตะกร้าอัปเดตทันที
- เพิ่ม toast `เพิ่ม ... ลงตะกร้าแล้ว`
- POST `/customer/cart/add` รองรับ JSON response เมื่อเรียกจาก AJAX และยังรองรับ redirect แบบเดิมเป็น fallback

## Feedback v6 — Cashier QR confirmation
- ฝั่งแคชเชียร์: หลังยืนยันพิมพ์รายการและ QR แล้ว ระบบจะไม่จำลองการชำระอัตโนมัติ 3 วินาทีอีกต่อไป
- หลังปิดหน้าต่าง Print Preview ระบบจะแสดง Pop-up THAI QR PAYMENT พร้อม QR จำลองและยอดชำระ
- พนักงานต้องกด `ยืนยันการชำระเงิน` เอง หลังลูกค้าสแกน/ชำระแล้ว จึงบันทึก payment เป็นชำระแล้ว
- ปุ่ม `ยกเลิก` จะปิด Pop-up โดยยังไม่บันทึกการชำระเงิน
- ไม่มีการเปลี่ยนโครงสร้างฐานข้อมูลในรอบนี้

## Feedback v7
- เอาปุ่ม `+` ออกจากการ์ดเมนูในหน้ารายการอาหาร (`views/customer/menu.ejs`)
- หน้ารายการอาหารทำหน้าที่แสดงรายการอย่างเดียว ลูกค้าต้องกดรูปอาหารเพื่อเข้าไปหน้ารายละเอียดก่อน แล้วจึงเลือกจำนวนและกด `เพิ่มลงตะกร้า`
- ลบ JavaScript/CSS ที่ใช้กับปุ่ม `+` บนหน้ารายการอาหารซึ่งไม่ได้ใช้งานแล้ว
- ไม่มีการแก้ไขโครงสร้างฐานข้อมูล
