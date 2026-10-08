const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const port = 3000;

let db = new sqlite3.Database(
    path.join(__dirname, "restaurant.db"),
    (err) => {
        if (err) {
            return console.log(err);
        }

        console.log("Connected to the database");
    }
);

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));


// แสดงรายการอาหารของพนักงานครัว
app.get("/kitchen/orders", (req, res) => {

    const sql = `
        SELECT
            orders.Order_Id,
            orders.Order_Time,
            dining_table.Table_Number,
            menu_items.Menu_Name,
            order_detail.Quantity

        FROM orders

        JOIN dining_session
            ON orders.Session_Id = dining_session.Session_ID

        JOIN dining_table
            ON dining_session.Table_Id = dining_table.TABLE_ID

        JOIN order_detail
            ON orders.Order_Id = order_detail.Order_Id

        JOIN menu_items
            ON order_detail.Menu_Id = menu_items.Menu_Id

        WHERE orders.Close_Time IS NULL

        ORDER BY orders.Order_Time ASC
    `;

    db.all(sql, [], (err, rows) => {

        if (err) {
            console.log(err);
            return res.send("Database error");
        }

        let orderList = {};

        rows.forEach((row) => {

            if (!orderList[row.Order_Id]) {

                orderList[row.Order_Id] = {
                    Order_Id: row.Order_Id,
                    Order_Time: row.Order_Time,
                    Table_Number: row.Table_Number,
                    items: []
                };

            }

            orderList[row.Order_Id].items.push({
                Menu_Name: row.Menu_Name,
                Quantity: row.Quantity
            });

        });

        res.render("kitchen/orders", {
            orders: Object.values(orderList)
        });

    });

});


// อัปเดตว่าออเดอร์เสร็จแล้ว
app.post("/kitchen/orders/:orderId/update", (req, res) => {

    const orderId = req.params.orderId;

    const sql = `
        UPDATE orders
        SET Close_Time = CURRENT_TIMESTAMP
        WHERE Order_Id = ?
    `;

    db.run(sql, [orderId], (err) => {

        if (err) {
            console.log(err);
            return res.send("Database error");
        }

        res.redirect("/kitchen/orders");

    });

});


app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});