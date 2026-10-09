const QRCode = require('qrcode');
const { all, get, run, transaction } = require('../db');

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function buildSessionBills(sessionId) {
  const customers = await all(
    `SELECT customer_id, customer_name, session_id
     FROM customer
     WHERE session_id = ?
     ORDER BY customer_id`,
    [sessionId]
  );

  const paidRows = await all(
    `SELECT DISTINCT pc.customer_id
     FROM payment_customer pc
     JOIN payment p ON p.payment_id = pc.payment_id
     WHERE pc.session_id = ? AND p.payment_status = 'PAID'`,
    [sessionId]
  );
  const paidIds = new Set(paidRows.map(row => Number(row.customer_id)));

  const details = await all(
    `SELECT o.order_id,
            o.customer_id AS owner_id,
            od.menu_id,
            od.quantity,
            od.unit_price,
            mi.menu_name
     FROM orders o
     JOIN order_detail od ON od.order_id = o.order_id
     JOIN menu_items mi ON mi.menu_id = od.menu_id
     WHERE o.session_id = ?
       AND o.order_status <> 'CANCELLED'
     ORDER BY o.order_id, od.menu_id`,
    [sessionId]
  );

  const participantRows = await all(
    `SELECT order_id, menu_id, customer_id, share_weight
     FROM order_item_participant
     WHERE session_id = ?
     ORDER BY customer_id`,
    [sessionId]
  );

  const participantMap = new Map();
  for (const row of participantRows) {
    const key = `${row.order_id}|${row.menu_id}`;
    if (!participantMap.has(key)) participantMap.set(key, []);
    participantMap.get(key).push({
      customer_id: Number(row.customer_id),
      weight: Number(row.share_weight || 1)
    });
  }

  const bills = {};
  for (const customer of customers) {
    bills[customer.customer_id] = {
      customer_id: Number(customer.customer_id),
      customer_name: customer.customer_name,
      session_id: Number(sessionId),
      items: [],
      subtotal: 0,
      service_fee: 0,
      total: 0,
      isPaid: paidIds.has(Number(customer.customer_id))
    };
  }

  for (const item of details) {
    const key = `${item.order_id}|${item.menu_id}`;
    let participants = participantMap.get(key);
    if (!participants || participants.length === 0) {
      participants = [{ customer_id: Number(item.owner_id), weight: 1 }];
    }

    const itemTotal = round2(Number(item.unit_price) * Number(item.quantity));
    const weightTotal = participants.reduce((sum, p) => sum + p.weight, 0) || 1;
    let allocated = 0;

    participants.forEach((participant, index) => {
      if (!bills[participant.customer_id]) return;
      let share;
      if (index === participants.length - 1) {
        share = round2(itemTotal - allocated);
      } else {
        share = round2(itemTotal * participant.weight / weightTotal);
        allocated = round2(allocated + share);
      }
      bills[participant.customer_id].items.push({
        order_id: Number(item.order_id),
        menu_id: item.menu_id,
        menu_name: item.menu_name,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        share_count: participants.length,
        shared: participants.length > 1,
        share_amount: share
      });
      bills[participant.customer_id].subtotal = round2(bills[participant.customer_id].subtotal + share);
    });
  }

  for (const bill of Object.values(bills)) {
    bill.service_fee = round2(bill.subtotal * 0.07);
    bill.total = round2(bill.subtotal + bill.service_fee);
    bill.outstanding = bill.isPaid ? 0 : bill.total;
  }

  return bills;
}

async function markSessionCleaningIfSettled(sessionId) {
  const session = await get(
    `SELECT ds.*, dt.table_status
     FROM dining_session ds
     JOIN dining_table dt ON dt.table_id = ds.table_id
     WHERE ds.session_id = ?`,
    [sessionId]
  );
  if (!session || session.session_status !== 'OPEN') return session ? session.session_status : null;

  const bills = await buildSessionBills(sessionId);
  const liable = Object.values(bills).filter(b => b.total > 0);
  const hasOrders = liable.length > 0;
  const allSettled = hasOrders && liable.every(b => b.isPaid);

  if (allSettled) {
    await transaction(async () => {
      await run(
        `UPDATE dining_session
         SET session_status = 'CLEANING', close_time = COALESCE(close_time, CURRENT_TIMESTAMP)
         WHERE session_id = ? AND session_status = 'OPEN'`,
        [sessionId]
      );
      await run(
        `UPDATE dining_table
         SET table_status = 'CLEANING'
         WHERE table_id = (SELECT table_id FROM dining_session WHERE session_id = ?)`,
        [sessionId]
      );
    });
    return 'CLEANING';
  }

  return session.session_status;
}

async function makeMockQr(payload) {
  return QRCode.toDataURL(payload, { width: 520, margin: 1 });
}

async function createPaidPayment({ sessionId, customerIds, method, amountReceived }) {
  const ids = [...new Set((customerIds || []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) throw new Error('กรุณาเลือกลูกค้าที่ต้องการชำระเงิน');

  return transaction(async () => {
    const session = await get(
      `SELECT * FROM dining_session WHERE session_id = ? AND session_status = 'OPEN'`,
      [sessionId]
    );
    if (!session) throw new Error('Session นี้ไม่สามารถรับชำระเงินได้');

    const bills = await buildSessionBills(sessionId);
    const selected = ids.map(id => bills[id]).filter(Boolean);
    if (selected.length !== ids.length) throw new Error('พบรายชื่อลูกค้าที่ไม่อยู่ในโต๊ะนี้');
    if (selected.some(b => b.isPaid)) throw new Error('มีลูกค้าที่ชำระเงินแล้วอยู่ในรายการที่เลือก');
    if (selected.some(b => b.total <= 0)) throw new Error('มีลูกค้าที่ไม่มียอดต้องชำระ');

    const subtotal = round2(selected.reduce((sum, b) => sum + b.subtotal, 0));
    const serviceFee = round2(selected.reduce((sum, b) => sum + b.service_fee, 0));
    const total = round2(selected.reduce((sum, b) => sum + b.total, 0));
    const received = method === 'CASH' ? round2(Number(amountReceived || 0)) : total;
    if (method === 'CASH' && received < total) throw new Error('จำนวนเงินสดที่ได้รับไม่เพียงพอ');
    const change = method === 'CASH' ? round2(received - total) : 0;

    const payment = await run(
      `INSERT INTO payment (
         session_id, payment_method, payment_status,
         subtotal, service_rate, service_fee,
         amount_paid, amount_received, change_amount, paid_at
       ) VALUES (?, ?, 'PAID', ?, 0.07, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [sessionId, method, subtotal, serviceFee, total, received, change]
    );

    for (const bill of selected) {
      await run(
        `INSERT INTO payment_customer (
           payment_id, customer_id, session_id, subtotal, service_fee, total_amount
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [payment.id, bill.customer_id, sessionId, bill.subtotal, bill.service_fee, bill.total]
      );
    }

    return {
      paymentId: payment.id,
      subtotal,
      serviceFee,
      total,
      amountReceived: received,
      change,
      selectedBills: selected
    };
  });
}

module.exports = {
  round2,
  buildSessionBills,
  markSessionCleaningIfSettled,
  makeMockQr,
  createPaidPayment
};
