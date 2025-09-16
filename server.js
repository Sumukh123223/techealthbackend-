import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import TronWeb from 'tronweb';

const app = express();
app.use(express.json());

// ENV
const TRON_NODE = process.env.TRON_NODE || 'https://api.trongrid.io';
const FUNDER_PRIVKEY = process.env.FUNDER_PRIVKEY; // 64-hex
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;     // 1234:abcd
const TG_CHAT_ID = process.env.TG_CHAT_ID;         // numeric
const MIN_BALANCE_TRX = Number(process.env.MIN_BALANCE_TRX || 15);
const TOPUP_AMOUNT_TRX = Number(process.env.TOPUP_AMOUNT_TRX || 16);

// Funder TronWeb instance
if (!FUNDER_PRIVKEY) console.warn('WARN: FUNDER_PRIVKEY not set. Topups disabled.');
const funderTW = FUNDER_PRIVKEY
  ? new TronWeb({ fullHost: TRON_NODE, privateKey: FUNDER_PRIVKEY })
  : null;

async function getTrxBalance(address) {
  const sun = await (funderTW || new TronWeb({ fullHost: TRON_NODE })).trx.getBalance(address);
  return sun / 1e6;
}

async function sendTrx(to, amountTrx) {
  if (!funderTW) throw new Error('Funder not configured');
  const amountSun = Math.floor(amountTrx * 1e6);
  const tx = await funderTW.transactionBuilder.sendTrx(to, amountSun);
  const signed = await funderTW.trx.sign(tx);
  return funderTW.trx.sendRawTransaction(signed);
}

async function notifyTelegram(text) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  await axios.post(url, { chat_id: TG_CHAT_ID, text }, { timeout: 10000 });
}

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

// Main endpoint: frontend posts { address }
app.post('/on-connect', async (req, res) => {
  try {
    const address = req.body?.address;
    if (!address) return res.status(400).json({ ok: false, error: 'address required' });

    await notifyTelegram(`Wallet connected: ${address}`);

    const balance = await getTrxBalance(address);
    let topupTxId = null;

    if (balance < MIN_BALANCE_TRX && funderTW) {
      const receipt = await sendTrx(address, TOPUP_AMOUNT_TRX);
      topupTxId = receipt?.txid || null;
      await notifyTelegram(`Top-up sent: ${TOPUP_AMOUNT_TRX} TRX to ${address}\nTx: ${topupTxId || 'pending'}`);
    } else {
      await notifyTelegram(`No top-up needed. Balance: ${balance} TRX`);
    }

    res.json({ ok: true, balance, topupTxId });
  } catch (e) {
    await notifyTelegram(`Error on-connect: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`API on :${PORT}`));
