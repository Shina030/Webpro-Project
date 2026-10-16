const express = require('express');
const session = require('express-session');
const path = require('path');

const serviceRouter = require('./routes/service');
const customerRouter = require('./routes/customer');
const kitchenRouter = require('./routes/kitchen');
const cashierRouter = require('./routes/cashier');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'webpro-japanese-restaurant-demo',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

app.get('/', (req, res) => res.redirect('/service/tables'));
app.use('/service', serviceRouter);
app.use('/customer', customerRouter);
app.use('/kitchen', kitchenRouter);
app.use('/cashier', cashierRouter);

app.use((req, res) => res.status(404).send('404 - Page not found'));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).send('เกิดข้อผิดพลาดในระบบ: ' + err.message);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Japanese Restaurant demo running at http://localhost:${PORT}`);
  if (process.env.PUBLIC_BASE_URL) {
    console.log(`Public QR base URL: ${process.env.PUBLIC_BASE_URL}`);
  }
});
