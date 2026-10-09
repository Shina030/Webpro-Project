const express = require('express');
const QRCode = require('qrcode');
const { all, get } = require('../db');
const {
  buildSessionBills,
  round2,
  createPaidPayment,
  markSessionCleaningIfSettled
} = require('../lib/billing');

const router = express.Router();

function elapsedText(openTime) {
  if (!openTime) return '00:00';
  const opened = new Date(String(openTime).replace(' ', 'T') + 'Z');
  const now = new Date();
  let minutes = Math.max(0, Math.floor((now - opened) / 60000));
  const hours = Math.floor(minutes / 60);
  minutes %= 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

router.get('/', async (req, res, next) => {
  try {
    const tableRows = await all(`SELECT * FROM dining_table ORDER BY table_id`);
    const tables = [];

    for (const table of tableRows) {
      const session = await get(
        `SELECT * FROM dining_session
         WHERE table_id = ? AND session_status IN ('OPEN', 'CLEANING')
         ORDER BY session_id DESC LIMIT 1`,
        [table.table_id]
      );

      if (!session) {
        tables.push({
          ...table,
          cardStatus: 'EMPTY',
          elapsed: '00:00',
          customerCount: 0,
          customers: [],
          session_id: null
        });
        continue;
      }

      if (session.session_status === 'OPEN') {
        await markSessionCleaningIfSettled(session.session_id);
      }

      const refreshed = await get(`SELECT * FROM dining_session WHERE session_id = ?`, [session.session_id]);
      const customers = await all(
        `SELECT customer_id, customer_name FROM customer WHERE session_id = ? ORDER BY customer_id`,
        [session.session_id]
      );
      const bills = await buildSessionBills(session.session_id);
      const customerView = customers.map(customer => ({
        ...customer,
        isPaid: bills[customer.customer_id]
          ? (bills[customer.customer_id].isPaid || bills[customer.customer_id].total <= 0)
          : false
      }));

      tables.push({
        ...table,
        table_status: refreshed.session_status === 'CLEANING' ? 'CLEANING' : table.table_status,
        cardStatus: refreshed.session_status === 'CLEANING' ? 'CLEANING' : 'UNPAID',
        elapsed: elapsedText(session.open_time),
        customerCount: customers.length,
        customers: customerView,
        session_id: session.session_id
      });
    }

    res.render('cashier/dashboard', { tables });
  } catch (err) {
    next(err);
  }
});

router.get('/payment/:sessionId', async (req, res, next) => {
  try {
    const session = await get(
      `SELECT ds.*, dt.table_number
       FROM dining_session ds
       JOIN dining_table dt ON dt.table_id = ds.table_id
       WHERE ds.session_id = ?`,
      [req.params.sessionId]
    );
    if (!session) return res.status(404).send('ไม่พบ session');
    if (session.session_status !== 'OPEN') return res.redirect('/cashier');

    const bills = await buildSessionBills(session.session_id);
    const customers = await all(
      `SELECT customer_id, customer_name FROM customer WHERE session_id = ? ORDER BY customer_id`,
      [session.session_id]
    );
    const customerView = customers.map(customer => ({
      ...customer,
      isPaid: bills[customer.customer_id]
        ? (bills[customer.customer_id].isPaid || bills[customer.customer_id].total <= 0)
        : false
    }));

    const billsJson = JSON.stringify(bills).replace(/</g, '\\u003c');
    res.render('cashier/payment', {
      session,
      customers: customerView,
      billsJson
    });
  } catch (err) {
    next(err);
  }
});

async function validateSelection(sessionId, rawIds) {
  const ids = [...new Set((rawIds || []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) throw new Error('กรุณาเลือกลูกค้าที่ต้องการชำระเงิน');

  const session = await get(
    `SELECT * FROM dining_session WHERE session_id = ? AND session_status = 'OPEN'`,
    [sessionId]
  );
  if (!session) throw new Error('Session นี้ปิดการรับชำระแล้ว');

  const bills = await buildSessionBills(sessionId);
  const selected = ids.map(id => bills[id]).filter(Boolean);
  if (selected.length !== ids.length) throw new Error('พบรายชื่อลูกค้าที่ไม่อยู่ในโต๊ะนี้');
  if (selected.some(b => b.isPaid)) throw new Error('มีลูกค้าที่ชำระแล้วอยู่ในรายการที่เลือก');
  if (selected.some(b => b.total <= 0)) throw new Error('มีลูกค้าที่ไม่มียอดต้องชำระ');

  return { ids, bills, selected };
}

router.post('/api/mock-qr', async (req, res) => {
  try {
    const sessionId = Number(req.body.sessionId);
    const { selected } = await validateSelection(sessionId, req.body.customerIds);
    const total = round2(selected.reduce((sum, bill) => sum + bill.total, 0));
    const payload = `DEMO-CASHIER-THAI-QR|SESSION:${sessionId}|AMOUNT:${total.toFixed(2)}|${Date.now()}`;
    const qrDataUrl = await QRCode.toDataURL(payload, { width: 520, margin: 1 });
    res.json({ ok: true, qrDataUrl, total });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.post('/api/pay', async (req, res) => {
  try {
    const sessionId = Number(req.body.sessionId);
    const method = String(req.body.method || '').toUpperCase();
    if (!['QR', 'CASH'].includes(method)) throw new Error('วิธีชำระเงินไม่ถูกต้อง');

    const { ids } = await validateSelection(sessionId, req.body.customerIds);
    const result = await createPaidPayment({
      sessionId,
      customerIds: ids,
      method,
      amountReceived: Number(req.body.amountReceived || 0)
    });
    const sessionStatus = await markSessionCleaningIfSettled(sessionId);

    res.json({
      ok: true,
      method,
      subtotal: result.subtotal,
      serviceFee: result.serviceFee,
      total: result.total,
      amountReceived: result.amountReceived,
      change: result.change,
      sessionStatus
    });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

module.exports = router;
