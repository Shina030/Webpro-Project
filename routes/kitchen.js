const express = require('express');
const { all, run } = require('../db');

const router = express.Router();

router.get('/', (req, res) => res.redirect('/kitchen/orders'));

async function loadKitchenOrders(statuses, printed) {
  const placeholders = statuses.map(() => '?').join(',');
  const rows = await all(
    `SELECT
       o.order_id AS Order_Id,
       o.order_time AS Order_Time,
       o.order_status AS Order_Status,
       dt.table_number AS Table_Number,
       c.customer_name AS Customer_Name,
       mi.menu_name AS Menu_Name,
       od.quantity AS Quantity
     FROM orders o
     JOIN dining_session ds ON ds.session_id = o.session_id
     JOIN dining_table dt ON dt.table_id = ds.table_id
     JOIN customer c ON c.customer_id = o.customer_id
     JOIN order_detail od ON od.order_id = o.order_id
     JOIN menu_items mi ON mi.menu_id = od.menu_id
     WHERE o.order_status IN (${placeholders})
       AND COALESCE(o.kitchen_printed, 0) = ?
     ORDER BY o.order_time DESC, o.order_id DESC, mi.menu_id ASC`,
    [...statuses, printed ? 1 : 0]
  );

  const orderMap = new Map();
  for (const row of rows) {
    if (!orderMap.has(row.Order_Id)) {
      orderMap.set(row.Order_Id, {
        Order_Id: row.Order_Id,
        Order_Time: row.Order_Time,
        Order_Status: row.Order_Status,
        Table_Number: row.Table_Number,
        Customer_Name: row.Customer_Name,
        items: []
      });
    }
    orderMap.get(row.Order_Id).items.push({
      Menu_Name: row.Menu_Name,
      Quantity: row.Quantity
    });
  }
  return [...orderMap.values()];
}

router.get('/orders', async (req, res, next) => {
  try {
    const orders = await loadKitchenOrders(['PENDING', 'PREPARING'], false);
    res.render('kitchen/orders', { orders });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/:orderId/print', async (req, res, next) => {
  try {
    await run(
      `UPDATE orders
       SET kitchen_printed = 1
       WHERE order_id = ? AND order_status IN ('PENDING', 'PREPARING')`,
      [req.params.orderId]
    );

    if (req.get('accept')?.includes('application/json')) {
      return res.json({ ok: true });
    }
    res.redirect('/kitchen/status');
  } catch (err) {
    next(err);
  }
});

router.get('/status', async (req, res, next) => {
  try {
    const orders = await loadKitchenOrders(['PENDING', 'PREPARING'], true);
    res.render('kitchen/status', { orders });
  } catch (err) {
    next(err);
  }
});


router.get('/api/orders', async (req, res) => {
  try {
    const view = String(req.query.view || 'main');
    const printed = view === 'status';
    const orders = await loadKitchenOrders(['PENDING', 'PREPARING'], printed);
    res.json({ ok: true, orders, count: orders.length });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/orders/:orderId/update', async (req, res, next) => {
  try {
    await run(
      `UPDATE orders
       SET order_status = 'SERVED', close_time = COALESCE(close_time, CURRENT_TIMESTAMP)
       WHERE order_id = ? AND order_status IN ('PENDING', 'PREPARING') AND kitchen_printed = 1`,
      [req.params.orderId]
    );
    if (req.get('accept')?.includes('application/json')) {
      return res.json({ ok: true });
    }
    res.redirect('/kitchen/status');
  } catch (err) {
    if (req.get('accept')?.includes('application/json')) {
      return res.status(500).json({ ok: false, message: err.message });
    }
    next(err);
  }
});

module.exports = router;
