#!/usr/bin/env node
/**
 * ClawBot (Tencent iLink bot) BINDING probe — steps 1-5 of the bind flow.
 *
 * REAL calls to ilinkai.weixin.qq.com (NOT simulated). Purpose:
 *   1. GET get_bot_qrcode?bot_type=3      -> qrcode (poll id) + qrcode_img_content
 *   2. Save qrcode_img_content as a scannable PNG (scripts/clawbot-qr.png)
 *   3. Poll get_qrcode_status?qrcode=...  until { status:"confirmed", bot_token, baseurl }
 *   4. (human) scan the PNG with phone WeChat to confirm
 *   5. Print bot_token + baseurl + the FULL confirmed payload so we can SEE the
 *      bound identity (is the bot acting AS the CEO's account, or a separate bot?)
 *
 * Run:  node scripts/clawbot-bind-probe.mjs
 * Writes: scripts/clawbot-qr.png  (open + scan)  and  scripts/clawbot-bind-result.json
 *
 * Headers per the iLink spec:
 *   Content-Type: application/json
 *   X-WECHAT-UIN: base64(String(random uint32))   (regenerated per request)
 *   (Authorization/AuthorizationType only apply AFTER we hold a bot_token.)
 */

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = 'https://ilinkai.weixin.qq.com';
const HERE = dirname(fileURLToPath(import.meta.url));
const QR_PNG = join(HERE, 'clawbot-qr.png');
const RESULT_JSON = join(HERE, 'clawbot-bind-result.json');

function freshUin() {
  // base64(String(random uint32)) — anti-replay, regenerated per request.
  const n = Math.floor(Math.random() * 0xffffffff);
  return Buffer.from(String(n)).toString('base64');
}

function headers(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-WECHAT-UIN': freshUin(),
    ...extra,
  };
}

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

/** qrcode_img_content may be: a data: URL, a bare base64 PNG, or an http URL.
 *  For the iLink liteapp URL case we ENCODE the URL into a scannable QR PNG
 *  (via `npx qrcode`), since the URL itself is what WeChat must scan. */
function saveQr(content) {
  if (typeof content !== 'string' || content.length === 0) return { saved: false, note: 'empty qrcode_img_content' };
  if (content.startsWith('http://') || content.startsWith('https://')) {
    try {
      execFileSync('npx', ['-y', 'qrcode', '-o', QR_PNG, content], { stdio: 'pipe', timeout: 90000 });
      return { saved: true, path: QR_PNG, url: content, note: 'URL encoded into scannable QR PNG' };
    } catch (e) {
      return { saved: false, url: content, note: `could not render QR from URL (open URL on phone instead): ${e.message}` };
    }
  }
  let b64 = content;
  const m = content.match(/^data:image\/\w+;base64,(.*)$/);
  if (m) b64 = m[1];
  try {
    writeFileSync(QR_PNG, Buffer.from(b64, 'base64'));
    return { saved: true, path: QR_PNG };
  } catch (e) {
    return { saved: false, note: `could not decode/save as PNG: ${e.message}` };
  }
}

async function main() {
  console.log('=== ClawBot iLink bind probe ===');

  // STEP 1: fetch QR (bot_type=3)
  const qrUrl = `${BASE}/ilink/bot/get_bot_qrcode?bot_type=3`;
  console.log('[1] GET', qrUrl);
  const r1 = await getJson(qrUrl, { method: 'GET', headers: headers() });
  console.log('    http', r1.status);
  if (!r1.json) {
    console.log('    NON-JSON response (first 400 chars):', r1.text.slice(0, 400));
    console.log('    -> endpoint shape unknown; cannot proceed. Capture this for analysis.');
    return 1;
  }
  // Show keys so we learn the real response shape.
  console.log('    response keys:', Object.keys(r1.json));
  const qrcode = r1.json.qrcode ?? r1.json.data?.qrcode ?? r1.json.qrcode_id;
  const img = r1.json.qrcode_img_content ?? r1.json.data?.qrcode_img_content ?? r1.json.qrcode_img;
  console.log('    qrcode (poll id):', qrcode);
  const qr = saveQr(img);
  console.log('    qr image:', JSON.stringify(qr));
  if (!qrcode) {
    console.log('    !! no qrcode poll-id in response — dumping full json:');
    console.log(JSON.stringify(r1.json, null, 2).slice(0, 1500));
    return 1;
  }

  console.log('\n>>> SCAN scripts/clawbot-qr.png with your phone WeChat now (or the URL above). Waiting for confirm...\n');

  // STEP 3: poll status until confirmed (or ~3 min)
  const statusUrl = `${BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  let confirmed = null;
  for (let i = 0; i < 90; i++) {
    const rs = await getJson(statusUrl, { method: 'GET', headers: headers() });
    const st = rs.json?.status ?? rs.json?.data?.status;
    if (i % 5 === 0) console.log(`[3] t+${i * 2}s status=${st ?? '(?)'} http=${rs.status}`);
    if (st === 'confirmed' || rs.json?.bot_token || rs.json?.data?.bot_token) {
      confirmed = rs.json;
      break;
    }
    await new Promise((res) => setTimeout(res, 2000));
  }

  if (!confirmed) {
    console.log('\nRESULT: not confirmed within ~3 min (not scanned, or status never flipped).');
    return 1;
  }

  const botToken = confirmed.bot_token ?? confirmed.data?.bot_token;
  const baseurl = confirmed.baseurl ?? confirmed.data?.baseurl;
  console.log('\n=== CONFIRMED ===');
  console.log('bot_token:', botToken ? `${String(botToken).slice(0, 12)}… (len ${String(botToken).length})` : '(missing)');
  console.log('baseurl  :', baseurl ?? '(missing)');
  console.log('FULL confirmed payload (reveals bound identity — look for nickname/wxid/user fields):');
  console.log(JSON.stringify(confirmed, null, 2).slice(0, 2000));

  // Persist (gitignored — contains a live token) for the orchestrator to read.
  try {
    writeFileSync(RESULT_JSON, JSON.stringify({ bot_token: botToken, baseurl, confirmed }, null, 2));
    console.log('\nsaved ->', RESULT_JSON);
  } catch (e) {
    console.log('could not save result:', e.message);
  }
  console.log('=== done ===');
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('FATAL', e); process.exit(1); });
