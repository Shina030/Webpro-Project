const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { all, get, run, transaction } = require('../db');

const router = express.Router();

function baseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  return configured || `${req.protocol}://${req.get('host')}`;
}

async function listTables(status = 'ALL') {
  let sql = `SELECT * FROM dining_table`;
  const params = [];
  if (['AVAILABLE', 'OCCUPIED', 'CLEANING'].includes(status)) {
    sql += ` WHERE table_status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY table_id`;
  return all(sql, params);
}

router.get('/', (req, res) => res.redirect('/service/tables'));

router.get('/tables', async (req, res, next) => {
  try {
    const status = req.query.status || 'ALL';
    const tables = await listTables(status);
    res.render('service/service-tables', { tables, status });
  } catch (err) {
    next(err);
  }
});

router.get('/api/tables', async (req, res) => {
  try {
    const status = req.query.status || 'ALL';
    const tables = await listTables(status);
    res.json({ ok: true, tables });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.get('/tables/:id/close-info', async (req, res) => {
  try {
    const table = await get(`SELECT * FROM dining_table WHERE table_id = ?`, [req.params.id]);
    if (!table) return res.status(404).json({ ok: false, message: 'ไม่พบโต๊ะ' });
    if (table.table_status !== 'OCCUPIED') {
      return res.status(400).json({ ok: false, message: 'ปิดโต๊ะได้เฉพาะโต๊ะที่มีสถานะไม่ว่าง' });
    }

    const session = await get(
      `SELECT * FROM dining_session
       WHERE table_id = ? AND session_status = 'OPEN'
       ORDER BY session_id DESC LIMIT 1`,
      [table.table_id]
    );

    if (!session) {
      return res.json({
        ok: true,
        table,
        session: null,
        customerCount: 0,
        orderCount: 0,
        canClose: true,
        message: 'ไม่พบ session ที่กำลังเปิด สามารถเปลี่ยนโต๊ะกลับเป็นว่างได้'
      });
    }

    const customerCountRow = await get(
      `SELECT COUNT(*) AS total FROM customer WHERE session_id = ?`,
      [session.session_id]
    );
    const orderCountRow = await get(
      `SELECT COUNT(*) AS total FROM orders WHERE session_id = ? AND order_status <> 'CANCELLED'`,
      [session.session_id]
    );

    const customerCount = Number(customerCountRow?.total || 0);
    const orderCount = Number(orderCountRow?.total || 0);
    const canClose = orderCount === 0;

    res.json({
      ok: true,
      table,
      session,
      customerCount,
      orderCount,
      canClose,
      message: canClose
        ? (customerCount === 0
          ? 'โต๊ะนี้ยังไม่มีลูกค้า สามารถปิดโต๊ะได้'
          : 'มีลูกค้าในโต๊ะ แต่ยังไม่มีการสั่งอาหาร สามารถปิดโต๊ะได้')
        : 'ไม่สามารถปิดโต๊ะได้ เพราะมีรายการอาหารแล้ว'
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/tables/:id/available', async (req, res) => {
  try {
    const table = await get(`SELECT * FROM dining_table WHERE table_id = ?`, [req.params.id]);
    if (!table) return res.status(404).json({ ok: false, message: 'ไม่พบโต๊ะ' });
    if (table.table_status !== 'CLEANING') {
      return res.status(400).json({ ok: false, message: 'เปลี่ยนเป็นว่างได้เฉพาะโต๊ะที่กำลังรอทำความสะอาด' });
    }

    await transaction(async () => {
      await run(
        `UPDATE dining_session
         SET session_status = 'CLOSED', close_time = COALESCE(close_time, CURRENT_TIMESTAMP)
         WHERE table_id = ? AND session_status = 'CLEANING'`,
        [table.table_id]
      );
      await run(`UPDATE dining_table SET table_status = 'AVAILABLE' WHERE table_id = ?`, [table.table_id]);
    });

    res.json({ ok: true, tableId: table.table_id, tableStatus: 'AVAILABLE' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/tables/:id/close', async (req, res) => {
  try {
    const table = await get(`SELECT * FROM dining_table WHERE table_id = ?`, [req.params.id]);
    if (!table) return res.status(404).json({ ok: false, message: 'ไม่พบโต๊ะ' });
    if (table.table_status !== 'OCCUPIED') {
      return res.status(400).json({ ok: false, message: 'ปิดโต๊ะได้เฉพาะโต๊ะที่มีสถานะไม่ว่าง' });
    }

    const session = await get(
      `SELECT * FROM dining_session
       WHERE table_id = ? AND session_status = 'OPEN'
       ORDER BY session_id DESC LIMIT 1`,
      [table.table_id]
    );

    if (session) {
      const orderCountRow = await get(
        `SELECT COUNT(*) AS total FROM orders
         WHERE session_id = ? AND order_status <> 'CANCELLED'`,
        [session.session_id]
      );
      if (Number(orderCountRow?.total || 0) > 0) {
        return res.status(400).json({
          ok: false,
          message: 'ไม่สามารถปิดโต๊ะได้ เพราะโต๊ะนี้มีรายการอาหารแล้ว'
        });
      }
    }

    await transaction(async () => {
      if (session) {
        await run(
          `UPDATE dining_session
           SET session_status = 'CANCELLED', close_time = CURRENT_TIMESTAMP
           WHERE session_id = ? AND session_status = 'OPEN'`,
          [session.session_id]
        );
      }
      await run(`UPDATE dining_table SET table_status = 'AVAILABLE' WHERE table_id = ?`, [table.table_id]);
    });

    res.json({ ok: true, tableId: table.table_id, tableStatus: 'AVAILABLE' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.get('/qr', async (req, res, next) => {
  try {
    const tables = await all(`SELECT * FROM dining_table ORDER BY table_id`);
    res.render('service/service-qr', { tables });
  } catch (err) {
    next(err);
  }
});

router.get('/qr/:id', async (req, res) => {
  try {
    const table = await get(`SELECT * FROM dining_table WHERE table_id = ?`, [req.params.id]);
    if (!table) return res.status(404).json({ error: 'ไม่พบโต๊ะ' });
    if (table.table_status === 'CLEANING') {
      return res.status(400).json({ error: 'โต๊ะกำลังรอทำความสะอาด ไม่สามารถพิมพ์ QR Code ได้' });
    }

    const session = await get(
      `SELECT * FROM dining_session
       WHERE table_id = ? AND session_status = 'OPEN'
       ORDER BY session_id DESC LIMIT 1`,
      [table.table_id]
    );

    const existing = Boolean(session && session.qr_token);
    const token = existing ? session.qr_token : crypto.randomBytes(18).toString('hex');
    const url = `${baseUrl(req)}/customer/start?token=${encodeURIComponent(token)}`;
    const qrData = await QRCode.toDataURL(url, { width: 320, margin: 1 });

    res.json({ table, token, url, qrData, existing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/qr/:id/print', async (req, res) => {
  try {
    const table = await get(`SELECT * FROM dining_table WHERE table_id = ?`, [req.params.id]);
    if (!table) return res.status(404).json({ error: 'ไม่พบโต๊ะ' });
    if (table.table_status === 'CLEANING') {
      return res.status(400).json({ error: 'โต๊ะกำลังรอทำความสะอาด' });
    }

    let session = await get(
      `SELECT * FROM dining_session
       WHERE table_id = ? AND session_status = 'OPEN'
       ORDER BY session_id DESC LIMIT 1`,
      [table.table_id]
    );

    if (!session) {
      const token = req.body.token || crypto.randomBytes(18).toString('hex');
      const qrId = `QR-${table.table_number}-${Date.now()}`;
      const created = await transaction(async () => {
        const result = await run(
          `INSERT INTO dining_session (table_id, session_status, qr_id, qr_token)
           VALUES (?, 'OPEN', ?, ?)`,
          [table.table_id, qrId, token]
        );
        await run(`UPDATE dining_table SET table_status = 'OCCUPIED' WHERE table_id = ?`, [table.table_id]);
        return result;
      });
      session = await get(`SELECT * FROM dining_session WHERE session_id = ?`, [created.id]);
    } else if (table.table_status !== 'OCCUPIED') {
      await run(`UPDATE dining_table SET table_status = 'OCCUPIED' WHERE table_id = ?`, [table.table_id]);
    }

    const url = `${baseUrl(req)}/customer/start?token=${encodeURIComponent(session.qr_token)}`;
    const qrData = await QRCode.toDataURL(url, { width: 520, margin: 1 });
    res.json({
      ok: true,
      token: session.qr_token,
      url,
      qrData,
      sessionId: session.session_id,
      tableNumber: table.table_number,
      tableStatus: 'OCCUPIED'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
