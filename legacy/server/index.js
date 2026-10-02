process.env.TZ ||= 'America/Los_Angeles';

const config = require('./config');
const { openDatabase } = require('./db');
const { createPaymentProvider } = require('./payments');
const { createApp } = require('./app');

const db = openDatabase(config.databasePath);
const payments = createPaymentProvider(config);
const { app, orders } = createApp({ db, config, payments });

const sweep = () => orders.sweep().catch((err) => console.error('Order sweep failed:', err));
sweep();
setInterval(sweep, 60 * 1000).unref();

app.listen(config.port, () => {
  console.log(`Bite Wise running at http://localhost:${config.port}`);
  if (payments.mode === 'mock') {
    console.log('Payments: MOCK mode (no real charges). Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY to use Stripe.');
  } else {
    console.log('Payments: Stripe');
  }
});
