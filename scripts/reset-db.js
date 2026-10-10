const { run, transaction } = require('../db');

(async () => {
  try {
    await transaction(async () => {
      await run('DELETE FROM payment_customer');
      await run('DELETE FROM payment');
      await run('DELETE FROM order_item_participant');
      await run('DELETE FROM order_detail');
      await run('DELETE FROM orders');
      await run('DELETE FROM customer');
      await run('DELETE FROM dining_session');
      await run("UPDATE dining_table SET table_status='AVAILABLE'");
      for (let i = 1; i <= 18; i++) {
        await run('UPDATE dining_table SET table_number=? WHERE table_id=?', [`A${i}`, i]);
      }
    });
    console.log('Demo data reset: A1-A18 are AVAILABLE. Menu data was preserved.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
