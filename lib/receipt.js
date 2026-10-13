const { createCanvas } = require('canvas');

function money(value) {
    return Number(value || 0).toFixed(2);
}

function shortText(ctx, text, maxWidth) {
    let value = String(text || '');
    if (ctx.measureText(value).width <= maxWidth) return value;

    while (value.length > 1 && ctx.measureText(value + '...').width > maxWidth) {
        value = value.slice(0, -1);
    }
    return value + '...';
}

function line(ctx, y, width) {
    ctx.beginPath();
    ctx.moveTo(24, y);
    ctx.lineTo(width - 24, y);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function generateReceipt(data) {
    const width = 576;
    const itemCount = data.items.length;
    const height = 620 + (itemCount * 38);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000000';

    let y = 46;

    ctx.textAlign = 'center';
    ctx.font = 'bold 34px Sarabun, "TH Sarabun New", sans-serif';
    ctx.fillText('จิกะเท็ตสึ', width / 2, y);

    y += 34;
    ctx.font = '18px Sarabun, "TH Sarabun New", sans-serif';
    ctx.fillText('JIKATETSU JAPANESE RESTAURANT', width / 2, y);

    y += 34;
    line(ctx, y, width);

    y += 34;
    ctx.textAlign = 'left';
    ctx.font = '19px Sarabun, "TH Sarabun New", sans-serif';
    ctx.fillText(`Receipt No: ${data.paymentId}`, 24, y);

    y += 27;
    ctx.fillText(`Table: ${data.tableNumber}`, 24, y);

    y += 27;
    ctx.fillText(`Date: ${data.date}`, 24, y);

    y += 27;
    ctx.fillText(`Payment: ${data.method}`, 24, y);

    y += 32;
    line(ctx, y, width);

    y += 34;
    ctx.font = 'bold 19px Sarabun, "TH Sarabun New", sans-serif';
    ctx.fillText('QTY', 24, y);
    ctx.fillText('ITEM', 82, y);
    ctx.textAlign = 'right';
    ctx.fillText('PRICE', width - 24, y);

    ctx.font = '18px Sarabun, "TH Sarabun New", sans-serif';
    data.items.forEach(item => {
        y += 38;
        ctx.textAlign = 'left';
        ctx.fillText(String(item.qty), 24, y);
        ctx.fillText(shortText(ctx, item.name, 330), 82, y);
        ctx.textAlign = 'right';
        ctx.fillText(money(item.price), width - 24, y);
    });

    y += 30;
    line(ctx, y, width);

    y += 36;
    ctx.font = '19px Sarabun, "TH Sarabun New", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Subtotal', 24, y);
    ctx.textAlign = 'right';
    ctx.fillText(money(data.subtotal), width - 24, y);

    y += 30;
    ctx.textAlign = 'left';
    ctx.fillText('Service 7%', 24, y);
    ctx.textAlign = 'right';
    ctx.fillText(money(data.serviceFee), width - 24, y);

    y += 38;
    ctx.font = 'bold 25px Sarabun, "TH Sarabun New", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('TOTAL', 24, y);
    ctx.textAlign = 'right';
    ctx.fillText(money(data.total), width - 24, y);

    if (data.method === 'CASH') {
        y += 34;
        ctx.font = '19px Sarabun, "TH Sarabun New", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Cash', 24, y);
        ctx.textAlign = 'right';
        ctx.fillText(money(data.amountReceived), width - 24, y);

        y += 28;
        ctx.textAlign = 'left';
        ctx.fillText('Change', 24, y);
        ctx.textAlign = 'right';
        ctx.fillText(money(data.change), width - 24, y);
    }

    y += 36;
    line(ctx, y, width);

    y += 42;
    ctx.textAlign = 'center';
    ctx.font = '20px Sarabun, "TH Sarabun New", sans-serif';
    ctx.fillText('ขอบคุณที่ใช้บริการ', width / 2, y);

    y += 28;
    ctx.font = '17px Sarabun, "TH Sarabun New", sans-serif';
    ctx.fillText('Thank you and please come again', width / 2, y);

    return canvas.toBuffer('image/png');
}

module.exports = { generateReceipt };
