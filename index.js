const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 3000;

// Connect to SQLite Database
let db = new sqlite3.Database('./restaurant.db', (err) => {
    if (err) {
        return console.error('Database connection error:', err.message);
    }
    console.log('Connected to the SQLite database: restaurant.db');
});

// Middleware Setup
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Session Configuration
app.use(session({
    secret: 'japanese-restaurant-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 60 * 60000 }
}));

// Initialize Cart Session
app.use((req, res, next) => {
    if (!req.session.cart) {
        req.session.cart = [];
    }
    next();
});

// Complete ordered list of images matching your exact folder counts:
// A (16), B (12), C (4), D (3), E (8), F (3), G (8), H (5), I (8), J (5)
const imageCounts = {
    A: 16,
    B: 12,
    C: 4,
    D: 3,
    E: 8,
    F: 3,
    G: 8,
    H: 5,
    I: 8,
    J: 5
};

const imageCodes = [];
Object.keys(imageCounts).forEach(prefix => {
    const count = imageCounts[prefix];
    for (let i = 1; i <= count; i++) {
        imageCodes.push(`${prefix}${String(i).padStart(2, '0')}`);
    }
});

// Maps row index 0, 1, 2... directly to imageCodes[0], imageCodes[1], imageCodes[2]...
function getSequentialPictureCode(index) {
    const safeIndex = index % imageCodes.length;
    return imageCodes[safeIndex];
}

// ================= ROUTES ================= //

// Screen 1: Welcome & Login
app.get('/', (req, res) => {
    res.render('login');
});

app.post('/login', (req, res) => {
    const { username } = req.body;
    if (username) {
        req.session.username = username;
        return res.redirect('/menu');
    }
    res.redirect('/');
});

// Screen 2: Menu Catalog
app.get('/menu', (req, res) => {
    if (!req.session.username) return res.redirect('/');

    const query = 'SELECT menu_id AS id, menu_name AS name, price, menu_description AS description, menu_picture AS pimage FROM menu_items ORDER BY menu_id ASC';
    db.all(query, (err, rows) => {
        if (err) {
            console.error("Database query error:", err.message);
            return res.status(500).send("Database error: " + err.message);
        }

        const formattedRows = rows.map((item, index) => ({
            ...item,
            pimage: getSequentialPictureCode(index)
        }));

        const totalItems = req.session.cart.reduce((sum, item) => sum + item.quantity, 0);
        res.render('menu', {
            items: formattedRows,
            cartCount: totalItems,
            username: req.session.username
        });
    });
});

// Screen 3: Item Detail View
app.get('/menu/:id', (req, res) => {
    const itemId = req.params.id;

    const query = 'SELECT menu_id AS id, menu_name AS name, price, menu_description AS description, menu_picture AS pimage FROM menu_items ORDER BY menu_id ASC';
    db.all(query, (err, rows) => {
        if (err || !rows) {
            return res.redirect('/menu');
        }

        const index = rows.findIndex(row => row.id == itemId);
        if (index === -1) {
            return res.redirect('/menu');
        }

        const item = rows[index];
        item.pimage = `/menu_pic/${getSequentialPictureCode(index)}.png`;
        res.render('item-detail', { item });
    });
});

// Add Item to Cart
app.post('/cart/add', (req, res) => {
    const { menu_id, quantity } = req.body;
    const qty = parseInt(quantity) || 1;

    const query = 'SELECT menu_id AS id, menu_name AS name, price FROM menu_items WHERE menu_id = ?';
    db.get(query, [menu_id], (err, item) => {
        if (err || !item) return res.redirect('/menu');

        const existingIndex = req.session.cart.findIndex(i => i.id === item.id);
        if (existingIndex > -1) {
            req.session.cart[existingIndex].quantity += qty;
        } else {
            req.session.cart.push({
                id: item.id,
                name: item.name,
                price: item.price,
                quantity: qty
            });
        }
        res.redirect('/menu');
    });
});

// Screen 4: View Cart
app.get('/cart', (req, res) => {
    const cart = req.session.cart || [];
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    res.render('cart', { cart, total });
});

// Update Cart Quantity (+ / -)
app.post('/cart/update', (req, res) => {
    const { id, action } = req.body;
    const itemIndex = req.session.cart.findIndex(i => i.id == id);

    if (itemIndex > -1) {
        if (action === 'increase') {
            req.session.cart[itemIndex].quantity += 1;
        } else if (action === 'decrease') {
            req.session.cart[itemIndex].quantity -= 1;
            if (req.session.cart[itemIndex].quantity <= 0) {
                req.session.cart.splice(itemIndex, 1);
            }
        }
    }
    res.redirect('/cart');
});

// Screen 5: Place Order
app.post('/order/checkout', (req, res) => {
    const cart = req.session.cart;
    if (!cart || cart.length === 0) return res.redirect('/menu');

    const customerName = req.session.username || 'ลูกค้า';

    // 1. Create Customer record
    const customerSql = 'INSERT INTO customer (session_id, customer_name) VALUES (?, ?)';
    db.run(customerSql, [1, customerName], function (err) {
        if (err) {
            console.error(err.message);
            return res.status(500).send("Database error");
        }
        const customerId = this.lastID;

        // 2. Create Order record
        const orderSql = 'INSERT INTO orders (session_id, customer_id, order_status) VALUES (?, ?, ?)';
        db.run(orderSql, [1, customerId, 'PENDING'], function (err) {
            if (err) {
                console.error(err.message);
                return res.status(500).send("Database error");
            }

            const orderId = this.lastID;
            const detailSql = 'INSERT INTO order_detail (order_id, menu_id, quantity, unit_price) VALUES (?, ?, ?, ?)';
            const stmt = db.prepare(detailSql);

            cart.forEach(item => {
                stmt.run(orderId, item.id, item.quantity, item.price);
            });
            stmt.finalize();

            req.session.cart = [];
            res.redirect(`/order/confirmation/${orderId}`);
        });
    });
});

// Order Confirmation View
app.get('/order/confirmation/:id', (req, res) => {
    const orderId = req.params.id;
    const orderQuery = 'SELECT orders.*, customer.customer_name FROM orders JOIN customer ON orders.customer_id = customer.customer_id WHERE orders.order_id = ?';
    db.get(orderQuery, [orderId], (err, order) => {
        if (err || !order) return res.redirect('/menu');

        const itemsQuery = `
          SELECT order_detail.*, menu_items.menu_name AS name, order_detail.unit_price AS price
          FROM order_detail 
          JOIN menu_items ON order_detail.menu_id = menu_items.menu_id 
          WHERE order_id = ?
        `;
        db.all(itemsQuery, [orderId], (err, items) => {
            const total_price = items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
            res.render('order-confirmation', { order: { ...order, total_price }, items });
        });
    });
});

// Start Server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});