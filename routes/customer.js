const express = require('express');
const QRCode = require('qrcode');
const { all, get, run, transaction } = require('../db');
const {
  buildSessionBills,
  round2,
  createPaidPayment,
  markSessionCleaningIfSettled
} = require('../lib/billing');

const router = express.Router();

function clearCustomerSession(req) {
  req.session.customerId = null;
  req.session.diningSessionId = null;
  req.session.qrToken = null;
  req.session.username = null;
  req.session.cart = [];
}

async function requireCustomer(req, res, next) {
  try {
    const customerId = Number(req.session.customerId);
    const sessionId = Number(req.session.diningSessionId);
    if (!customerId || !sessionId) return res.redirect('/customer/demo');

    const customer = await get(
      `SELECT c.customer_id, c.customer_name, c.session_id,
              ds.session_status, ds.qr_token, dt.table_number
       FROM customer c
       JOIN dining_session ds ON ds.session_id = c.session_id
       JOIN dining_table dt ON dt.table_id = ds.table_id
       WHERE c.customer_id = ? AND c.session_id = ?`,
      [customerId, sessionId]
    );
    if (!customer) {
      clearCustomerSession(req);
      return res.redirect('/customer/demo');
    }
    req.customerContext = customer;
    next();
  } catch (err) {
    next(err);
  }
}

async function requireOpenCustomer(req, res, next) {
  await requireCustomer(req, res, () => {
    if (req.customerContext.session_status !== 'OPEN') {
      return res.status(400).send('Session ของโต๊ะนี้สิ้นสุดการสั่งอาหารแล้ว');
    }
    next();
  });
}

function cartOf(req) {
  if (!Array.isArray(req.session.cart)) req.session.cart = [];
  return req.session.cart;
}

async function loadSessionOrders(sessionId) {
  const orders = await all(
    `SELECT o.order_id, o.order_time, o.order_status, o.customer_id, c.customer_name
     FROM orders o
     JOIN customer c ON c.customer_id = o.customer_id
     WHERE o.session_id = ? AND o.order_status <> 'CANCELLED'
     ORDER BY o.order_id DESC`,
    [sessionId]
  );

  for (const order of orders) {
    order.items = await all(
      `SELECT od.menu_id, od.quantity, od.unit_price, mi.menu_name
       FROM order_detail od
       JOIN menu_items mi ON mi.menu_id = od.menu_id
       WHERE od.order_id = ?
       ORDER BY od.menu_id`,
      [order.order_id]
    );
    for (const item of order.items) {
      item.participants = await all(
        `SELECT c.customer_id, c.customer_name
         FROM order_item_participant op
         JOIN customer c ON c.customer_id = op.customer_id
         WHERE op.order_id = ? AND op.menu_id = ?
         ORDER BY c.customer_id`,
        [order.order_id, item.menu_id]
      );
    }
  }
  return orders;
}

function groupOrdersByCustomer(orders) {
  const map = new Map();
  for (const order of orders) {
    if (!map.has(order.customer_id)) {
      map.set(order.customer_id, {
        customer_id: order.customer_id,
        customer_name: order.customer_name,
        orders: []
      });
    }
    map.get(order.customer_id).orders.push(order);
  }
  return [...map.values()];
}

router.get('/demo', (req, res) => {
  res.send(`
    <!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:'Sarabun','TH Sarabun New',Tahoma,sans-serif;background:#f5f6f8;padding:40px}.box{max-width:620px;margin:auto;background:#fff;padding:30px;border-radius:16px;box-shadow:0 10px 30px #0001;line-height:1.7}a{color:#1769aa}</style>
    <div class="box"><h2>หน้าลูกค้าเข้าใช้งานผ่าน QR Code</h2><p>ให้พนักงานบริการไปที่ <a href="/service/qr">/service/qr</a> เลือกโต๊ะ แล้วกดพิมพ์ QR ก่อน จากนั้นสแกน QR ด้วยมือถือเพื่อเริ่ม session ลูกค้า</p></div></html>
  `);
});

router.get('/start', async (req, res, next) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(400).send('QR token ไม่ถูกต้อง');

    const dining = await get(
      `SELECT ds.session_id, ds.qr_token, ds.session_status, dt.table_number
       FROM dining_session ds
       JOIN dining_table dt ON dt.table_id = ds.table_id
       WHERE ds.qr_token = ? AND ds.session_status = 'OPEN'`,
      [token]
    );
    if (!dining) return res.status(404).send('QR Code นี้ยังไม่เปิดใช้งาน หรือ session สิ้นสุดแล้ว');

    if (Number(req.session.diningSessionId) === Number(dining.session_id) && req.session.customerId) {
      const existing = await get(
        `SELECT customer_id FROM customer WHERE customer_id = ? AND session_id = ?`,
        [req.session.customerId, dining.session_id]
      );
      if (existing) return res.redirect('/customer/menu');
    }

    clearCustomerSession(req);
    req.session.diningSessionId = dining.session_id;
    req.session.qrToken = token;
    res.render('customer/login', { token, tableNumber: dining.table_number });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const token = String(req.body.token || req.session.qrToken || '').trim();
    if (!username) return res.status(400).send('กรุณากรอกชื่อผู้ใช้งาน');

    const dining = await get(
      `SELECT session_id FROM dining_session
       WHERE qr_token = ? AND session_status = 'OPEN'`,
      [token]
    );
    if (!dining) return res.status(400).send('QR Code นี้ไม่สามารถใช้งานได้แล้ว');

    const result = await run(
      `INSERT INTO customer (session_id, customer_name) VALUES (?, ?)`,
      [dining.session_id, username]
    );

    req.session.customerId = result.id;
    req.session.diningSessionId = dining.session_id;
    req.session.qrToken = token;
    req.session.username = username;
    req.session.cart = [];
    res.redirect('/customer/menu');
  } catch (err) {
    next(err);
  }
});

router.get('/menu', requireOpenCustomer, async (req, res, next) => {
  try {
    const items = await all(
      `SELECT menu_id AS id, menu_name AS name, price,
              menu_description AS description, menu_picture AS pimage,
              category_id
       FROM menu_items
       ORDER BY menu_id`
    );
    const cart = cartOf(req);
    const totalItems = cart.reduce((sum, item) => sum + Number(item.quantity), 0);
    res.render('customer/menu', {
      items: items.map(item => ({ ...item, pimage: item.id })),
      cartCount: totalItems,
      username: req.customerContext.customer_name,
      tableNumber: req.customerContext.table_number
    });
  } catch (err) {
    next(err);
  }
});

router.get('/menu/:id', requireOpenCustomer, async (req, res, next) => {
  try {
    const item = await get(
      `SELECT menu_id AS id, menu_name AS name, price,
              menu_description AS description, category_id
       FROM menu_items WHERE menu_id = ?`,
      [req.params.id]
    );
    if (!item) return res.redirect('/customer/menu');
    item.pimage = item.id;
    res.render('customer/item-detail', { item });
  } catch (err) {
    next(err);
  }
});

router.post('/cart/add', requireOpenCustomer, async (req, res, next) => {
  const wantsJson = req.get('accept')?.includes('application/json');
  try {
    const menuId = String(req.body.menu_id || '');
    const qty = Math.max(1, Math.min(5, parseInt(req.body.quantity, 10) || 1));
    const item = await get(
      `SELECT menu_id AS id, menu_name AS name, price FROM menu_items WHERE menu_id = ?`,
      [menuId]
    );
    if (!item) {
      if (wantsJson) return res.status(404).json({ ok: false, message: 'ไม่พบรายการอาหาร' });
      return res.redirect('/customer/menu');
    }

    const cart = cartOf(req);
    const existing = cart.find(i => i.id === item.id);
    if (existing) existing.quantity = Math.min(5, existing.quantity + qty);
    else cart.push({ id: item.id, name: item.name, price: Number(item.price), quantity: qty });

    const cartCount = cart.reduce((sum, cartItem) => sum + Number(cartItem.quantity || 0), 0);
    if (wantsJson) {
      return res.json({
        ok: true,
        cartCount,
        item: { id: item.id, name: item.name, quantity: existing ? existing.quantity : qty }
      });
    }
    res.redirect('/customer/menu');
  } catch (err) {
    if (wantsJson) return res.status(500).json({ ok: false, message: err.message });
    next(err);
  }
});

router.get('/cart', requireOpenCustomer, async (req, res, next) => {
  try {
    const cart = cartOf(req);
    const total = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
    let confirmation = null;
    const orderedId = Number(req.query.ordered);

    if (orderedId) {
      const order = await get(
        `SELECT o.order_id, o.order_status, o.order_time, c.customer_name
         FROM orders o
         JOIN customer c ON c.customer_id = o.customer_id
         WHERE o.order_id = ? AND o.customer_id = ? AND o.session_id = ?`,
        [orderedId, req.customerContext.customer_id, req.customerContext.session_id]
      );

      if (order) {
        const items = await all(
          `SELECT od.quantity, od.unit_price AS price, mi.menu_name AS name
           FROM order_detail od
           JOIN menu_items mi ON mi.menu_id = od.menu_id
           WHERE od.order_id = ?
           ORDER BY od.menu_id`,
          [orderedId]
        );
        const totalPrice = round2(items.reduce(
          (sum, item) => sum + Number(item.price) * Number(item.quantity),
          0
        ));
        confirmation = {
          order: { ...order, total_price: totalPrice },
          items
        };
      }
    }

    res.render('customer/cart', { cart, total, confirmation });
  } catch (err) {
    next(err);
  }
});

router.post('/cart/update', requireOpenCustomer, (req, res) => {
  const cart = cartOf(req);
  const id = String(req.body.id || '');
  const action = req.body.action;
  const item = cart.find(i => i.id === id);
  if (item) {
    if (action === 'increase') item.quantity = Math.min(5, item.quantity + 1);
    if (action === 'decrease') item.quantity -= 1;
    if (item.quantity <= 0) req.session.cart = cart.filter(i => i.id !== id);
  }
  res.redirect('/customer/cart');
});

router.post('/order/checkout', requireOpenCustomer, async (req, res, next) => {
  try {
    const cart = cartOf(req);
    if (cart.length === 0) return res.redirect('/customer/menu');

    const ids = cart.map(item => item.id);
    const placeholders = ids.map(() => '?').join(',');
    const menuRows = await all(
      `SELECT menu_id, menu_name, price FROM menu_items WHERE menu_id IN (${placeholders})`,
      ids
    );
    const menuMap = new Map(menuRows.map(row => [row.menu_id, row]));
    if (menuRows.length !== ids.length) return res.status(400).send('พบรายการอาหารที่ไม่ถูกต้อง');

    const orderId = await transaction(async () => {
      const order = await run(
        `INSERT INTO orders (session_id, customer_id, order_status)
         VALUES (?, ?, 'PREPARING')`,
        [req.customerContext.session_id, req.customerContext.customer_id]
      );

      for (const cartItem of cart) {
        const menu = menuMap.get(cartItem.id);
        const quantity = Math.max(1, Math.min(5, Number(cartItem.quantity) || 1));
        await run(
          `INSERT INTO order_detail (order_id, menu_id, quantity, unit_price)
           VALUES (?, ?, ?, ?)`,
          [order.id, menu.menu_id, quantity, Number(menu.price)]
        );
        await run(
          `INSERT INTO order_item_participant
             (order_id, menu_id, customer_id, session_id, share_weight)
           VALUES (?, ?, ?, ?, 1)`,
          [order.id, menu.menu_id, req.customerContext.customer_id, req.customerContext.session_id]
        );
      }
      return order.id;
    });

    req.session.cart = [];
    res.redirect(`/customer/cart?ordered=${orderId}`);
  } catch (err) {
    next(err);
  }
});

router.get('/order/confirmation/:id', requireCustomer, (req, res) => {
  res.redirect(`/customer/cart?ordered=${req.params.id}`);
});

router.get('/history', requireCustomer, async (req, res, next) => {
  try {
    const orders = await loadSessionOrders(req.customerContext.session_id);
    const paidExists = await get(
      `SELECT 1 AS found FROM payment
       WHERE session_id = ? AND payment_status = 'PAID' LIMIT 1`,
      [req.customerContext.session_id]
    );

    res.render('customer/history', {
      orders,
      customer: req.customerContext,
      sharingLocked: Boolean(paidExists)
    });
  } catch (err) {
    next(err);
  }
});

router.get('/history/share', requireCustomer, async (req, res, next) => {
  try {
    const orders = await loadSessionOrders(req.customerContext.session_id);
    const people = await all(
      `SELECT customer_id, customer_name FROM customer
       WHERE session_id = ? ORDER BY customer_id`,
      [req.customerContext.session_id]
    );
    const paidExists = await get(
      `SELECT 1 AS found FROM payment
       WHERE session_id = ? AND payment_status = 'PAID' LIMIT 1`,
      [req.customerContext.session_id]
    );

    res.render('customer/share', {
      groups: groupOrdersByCustomer(orders),
      people,
      currentCustomerId: Number(req.customerContext.customer_id),
      sharingLocked: Boolean(paidExists)
    });
  } catch (err) {
    next(err);
  }
});

router.post('/history/share', requireOpenCustomer, async (req, res, next) => {
  try {
    const orderId = Number(req.body.order_id);
    const menuId = String(req.body.menu_id || '');
    let selected = req.body.participant_ids || [];
    if (!Array.isArray(selected)) selected = [selected];
    selected = [...new Set(selected.map(Number).filter(Number.isInteger))];

    const order = await get(
      `SELECT order_id, session_id, customer_id FROM orders
       WHERE order_id = ? AND session_id = ?`,
      [orderId, req.customerContext.session_id]
    );
    if (!order) return res.status(404).send('ไม่พบออเดอร์นี้ในโต๊ะของคุณ');

    const item = await get(
      `SELECT 1 AS found FROM order_detail WHERE order_id = ? AND menu_id = ?`,
      [orderId, menuId]
    );
    if (!item) return res.status(404).send('ไม่พบรายการอาหาร');

    const hasPaid = await get(
      `SELECT 1 AS found FROM payment WHERE session_id = ? AND payment_status = 'PAID' LIMIT 1`,
      [req.customerContext.session_id]
    );
    if (hasPaid) return res.status(400).send('ไม่สามารถแก้ผู้ร่วมหารหลังจากโต๊ะเริ่มมีการชำระเงินแล้ว');

    const validPeople = await all(
      `SELECT customer_id FROM customer WHERE session_id = ?`,
      [req.customerContext.session_id]
    );
    const validIds = new Set(validPeople.map(p => Number(p.customer_id)));
    selected = selected.filter(id => validIds.has(id));
    if (selected.length === 0) {
      return res.status(400).send('กรุณาเลือกผู้ร่วมหารอย่างน้อย 1 คน');
    }

    await transaction(async () => {
      await run(
        `DELETE FROM order_item_participant WHERE order_id = ? AND menu_id = ?`,
        [orderId, menuId]
      );
      for (const customerId of selected) {
        await run(
          `INSERT INTO order_item_participant
             (order_id, menu_id, customer_id, session_id, share_weight)
           VALUES (?, ?, ?, ?, 1)`,
          [orderId, menuId, customerId, req.customerContext.session_id]
        );
      }
    });

    res.redirect('/customer/history/share');
  } catch (err) {
    next(err);
  }
});

router.get('/api/order-status', requireCustomer, async (req, res, next) => {
  try {
    const rows = await all(
      `SELECT order_id, order_status FROM orders
       WHERE session_id = ? AND order_status <> 'CANCELLED'`,
      [req.customerContext.session_id]
    );
    res.json({ ok: true, orders: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/payment', requireCustomer, async (req, res, next) => {
  try {
    const mode = String(req.query.mode || 'OWN').toUpperCase() === 'TABLE' ? 'TABLE' : 'OWN';
    const bills = await buildSessionBills(req.customerContext.session_id);
    const own = bills[req.customerContext.customer_id] || null;
    const unpaidBills = Object.values(bills).filter(bill => !bill.isPaid && bill.total > 0);
    const selectedBills = mode === 'TABLE'
      ? unpaidBills
      : (own && !own.isPaid && own.total > 0 ? [own] : []);

    const selectedSubtotal = round2(selectedBills.reduce((sum, bill) => sum + bill.subtotal, 0));
    const selectedService = round2(selectedBills.reduce((sum, bill) => sum + bill.service_fee, 0));
    const selectedTotal = round2(selectedBills.reduce((sum, bill) => sum + bill.total, 0));

    res.render('customer/payment', {
      customer: req.customerContext,
      mode,
      selectedBills,
      selectedSubtotal,
      selectedService,
      selectedTotal
    });
  } catch (err) {
    next(err);
  }
});

async function resolveCustomerPayment(req, type) {
  const bills = await buildSessionBills(req.customerContext.session_id);
  if (type === 'OWN') {
    const own = bills[req.customerContext.customer_id];
    if (!own || own.total <= 0) throw new Error('คุณไม่มียอดที่ต้องชำระ');
    if (own.isPaid) throw new Error('ยอดของคุณชำระแล้ว');
    return { bills, customerIds: [Number(req.customerContext.customer_id)] };
  }
  if (type === 'TABLE') {
    const unpaid = Object.values(bills).filter(b => !b.isPaid && b.total > 0);
    if (unpaid.length === 0) throw new Error('ไม่มีรายการค้างชำระในโต๊ะนี้');
    return { bills, customerIds: unpaid.map(b => b.customer_id) };
  }
  throw new Error('รูปแบบการชำระเงินไม่ถูกต้อง');
}

router.post('/api/payment/qr', requireCustomer, async (req, res) => {
  try {
    if (req.customerContext.session_status !== 'OPEN') throw new Error('โต๊ะนี้ปิดการรับชำระแล้ว');
    const type = String(req.body.type || '').toUpperCase();
    const { bills, customerIds } = await resolveCustomerPayment(req, type);
    const selected = customerIds.map(id => bills[id]);
    const total = round2(selected.reduce((sum, bill) => sum + bill.total, 0));
    const payload = `DEMO-THAI-QR|TABLE:${req.customerContext.table_number}|TYPE:${type}|AMOUNT:${total.toFixed(2)}|${Date.now()}`;
    const qrDataUrl = await QRCode.toDataURL(payload, { width: 500, margin: 1 });
    res.json({ ok: true, qrDataUrl, total, customerCount: customerIds.length, type });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.post('/api/payment/pay', requireCustomer, async (req, res) => {
  try {
    if (req.customerContext.session_status !== 'OPEN') throw new Error('โต๊ะนี้ปิดการรับชำระแล้ว');
    const type = String(req.body.type || '').toUpperCase();
    const { customerIds } = await resolveCustomerPayment(req, type);
    const result = await createPaidPayment({
      sessionId: req.customerContext.session_id,
      customerIds,
      method: 'QR',
      amountReceived: 0
    });
    const sessionStatus = await markSessionCleaningIfSettled(req.customerContext.session_id);
    res.json({
      ok: true,
      type,
      total: result.total,
      customerCount: customerIds.length,
      sessionStatus
    });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

module.exports = router;
