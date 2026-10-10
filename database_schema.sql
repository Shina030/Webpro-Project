CREATE TABLE customer (
    customer_id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES dining_session(session_id) ON DELETE RESTRICT,
    UNIQUE (customer_id, session_id)
);

CREATE TABLE dining_session (
    session_id INTEGER PRIMARY KEY,
    table_id INTEGER NOT NULL,
    open_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    close_time TEXT,
    session_status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (session_status IN ('OPEN', 'CLEANING', 'CLOSED', 'CANCELLED')),
    qr_id TEXT UNIQUE,
    qr_token TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (table_id) REFERENCES dining_table(table_id) ON DELETE RESTRICT,
    CHECK (
        (session_status = 'OPEN' AND close_time IS NULL)
        OR
        (session_status IN ('CLEANING', 'CLOSED', 'CANCELLED') AND close_time IS NOT NULL)
    ),
    CHECK (close_time IS NULL OR close_time >= open_time)
);

CREATE TABLE dining_table (
    table_id INTEGER PRIMARY KEY,
    table_number TEXT NOT NULL UNIQUE
, table_status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (table_status IN ('AVAILABLE','OCCUPIED','CLEANING')));

CREATE TABLE menu_category (
    category_id TEXT NOT NULL PRIMARY KEY,
    category_name TEXT NOT NULL UNIQUE
);

CREATE TABLE menu_items (
    menu_id TEXT NOT NULL PRIMARY KEY,
    menu_name TEXT NOT NULL,
    menu_description TEXT NOT NULL,
    price NUMERIC NOT NULL CHECK (price >= 0),
    menu_picture TEXT NOT NULL,
    category_id TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES menu_category(category_id) ON DELETE RESTRICT
);

CREATE TABLE order_detail (
    order_id INTEGER NOT NULL,
    menu_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity > 0),
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
    PRIMARY KEY (order_id, menu_id),
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE RESTRICT,
    FOREIGN KEY (menu_id) REFERENCES menu_items(menu_id) ON DELETE RESTRICT
);

CREATE TABLE order_item_participant (
    order_id INTEGER NOT NULL,
    menu_id TEXT NOT NULL,
    customer_id INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    share_weight NUMERIC NOT NULL DEFAULT 1 CHECK (share_weight > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (order_id, menu_id, customer_id),
    FOREIGN KEY (order_id, menu_id) REFERENCES order_detail(order_id, menu_id) ON DELETE CASCADE,
    FOREIGN KEY (order_id, session_id) REFERENCES orders(order_id, session_id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id, session_id) REFERENCES customer(customer_id, session_id) ON DELETE CASCADE
);

CREATE TABLE orders (
    order_id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    order_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    close_time TEXT,
    order_status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (order_status IN ('PENDING', 'PREPARING', 'SERVED', 'CANCELLED')),
    kitchen_printed INTEGER NOT NULL DEFAULT 0
        CHECK (kitchen_printed IN (0, 1)),
    FOREIGN KEY (session_id) REFERENCES dining_session(session_id) ON DELETE RESTRICT,
    FOREIGN KEY (customer_id, session_id) REFERENCES customer(customer_id, session_id) ON DELETE RESTRICT,
    CHECK (close_time IS NULL OR close_time >= order_time),
    UNIQUE (order_id, session_id)
);

CREATE TABLE payment (
    payment_id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'QR', 'TRANSFER', 'CARD')),
    payment_status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (payment_status IN ('PENDING', 'PAID', 'CANCELLED')),
    subtotal NUMERIC NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    service_rate NUMERIC NOT NULL DEFAULT 0.07 CHECK (service_rate >= 0),
    service_fee NUMERIC NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
    amount_paid NUMERIC NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    amount_received NUMERIC NOT NULL DEFAULT 0 CHECK (amount_received >= 0),
    change_amount NUMERIC NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
    paid_at TEXT,
    FOREIGN KEY (session_id) REFERENCES dining_session(session_id) ON DELETE RESTRICT,
    CHECK (payment_status != 'PAID' OR paid_at IS NOT NULL),
    UNIQUE (payment_id, session_id)
);

CREATE TABLE payment_customer (
    payment_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    subtotal NUMERIC NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    service_fee NUMERIC NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
    total_amount NUMERIC NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    PRIMARY KEY (payment_id, customer_id),
    FOREIGN KEY (payment_id, session_id) REFERENCES payment(payment_id, session_id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id, session_id) REFERENCES customer(customer_id, session_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_one_active_session_per_table
ON dining_session(table_id)
WHERE session_status IN ('OPEN', 'CLEANING');

CREATE INDEX idx_order_item_participant_customer
ON order_item_participant(customer_id, session_id);

CREATE INDEX idx_payment_customer_customer ON payment_customer(customer_id, session_id);

CREATE INDEX idx_payment_session ON payment(session_id, payment_status);