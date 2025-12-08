/* ========================================================
   MOMENTUM MONITOR V4 — app.js (MA26 Binance Accurate v2)
   Supertrend 10/3 + MA26 (final candles) + Trend Glow
   - MA 26 dihitung hanya dari candle yang sudah CLOSE
   - Arah MA (Up / Down / Sideways) pakai slope asli (tanpa threshold 0.04%)
   - History 1000 candle untuk akurasi lebih baik
=========================================================== */

let currentSymbol = "BTCUSDT";
let currentInterval = "1m";
const ATR_PERIOD = 10;
const MULTIPLIER = 3;

let candles = [];
let ws = null;

let lastTrend = null;
let lastMA = null;
let initializing = true;

/* ============================
   DOM ELEMENTS
============================ */
const elPrice = document.getElementById("price");
const elSymbolSelect = document.getElementById("symbol-select");

const elSuperBox = document.getElementById("supertrend-box");
const elSuperStatus = document.getElementById("supertrend-status");
const elSuperValue = document.getElementById("supertrend-value");

const elMABox = document.getElementById("ma90-box");       // ID HTML tetap
const elMAStatus = document.getElementById("ma90-status");
const elMAValue = document.getElementById("ma90-value");

const elLiveDot = document.getElementById("live-dot");
const elLiveText = document.getElementById("live-text");
const elLastUpdate = document.getElementById("last-update");

const elLogBody = document.getElementById("log-body");
const elLogMeta = document.getElementById("log-meta-text");

const toast = document.getElementById("toast");
const toastMsg = document.getElementById("toast-msg");

/* ============================
   UTILITIES
============================ */

function fmt(n, d = 8) {
  if (n == null || isNaN(n)) return "–";
  return Number(n).toFixed(d).replace(/0+$/, "").replace(/\.$/, "");
}

function setLive(isOnline) {
  if (isOnline) {
    elLiveDot.classList.remove("offline");
    elLiveDot.classList.add("online");
    elLiveText.textContent = "Online";
  } else {
    elLiveDot.classList.remove("online");
    elLiveDot.classList.add("offline");
    elLiveText.textContent = "Offline";
  }
}

function pushLog(text) {
  const div = document.createElement("div");
  div.className = "log-entry";
  div.textContent = text;
  elLogBody.prepend(div);
  elLogMeta.textContent = text;
}

function showToast(msg) {
  toastMsg.textContent = msg;
  toast.style.display = "flex";
  setTimeout(() => (toast.style.display = "none"), 2500);
}

/* ============================
   MATH — SUPERtrend
============================ */

function trueRange(high, low, prevClose) {
  if (prevClose == null) return high - low;
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

function computeSupertrend(candles, period, mult) {
  if (!candles || candles.length < period + 3)
    return { supertrend: null, trend: null };

  const n = candles.length;
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);

  const tr = [];
  for (let i = 0; i < n; i++) {
    const prevClose = i > 0 ? closes[i - 1] : null;
    tr.push(trueRange(highs[i], lows[i], prevClose));
  }

  const atr = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += tr[j];
    atr[i] = sum / period;
  }

  const basicUp = [], basicDn = [];
  const finalUp = [], finalDn = [];
  const st = [], trend = [];

  for (let i = 0; i < n; i++) {
    if (atr[i] == null) continue;

    const hl2 = (highs[i] + lows[i]) / 2;

    basicUp[i] = hl2 + mult * atr[i];
    basicDn[i] = hl2 - mult * atr[i];

    if (i === 0 || atr[i - 1] == null) {
      finalUp[i] = basicUp[i];
      finalDn[i] = basicDn[i];
      trend[i] = closes[i] > finalUp[i] ? "bull" : "bear";
      st[i] = trend[i] === "bull" ? finalDn[i] : finalUp[i];
      continue;
    }

    finalUp[i] =
      basicUp[i] < finalUp[i - 1] || closes[i - 1] > finalUp[i - 1]
        ? basicUp[i]
        : finalUp[i - 1];

    finalDn[i] =
      basicDn[i] > finalDn[i - 1] || closes[i - 1] < finalDn[i - 1]
        ? basicDn[i]
        : finalDn[i - 1];

    if (st[i - 1] === finalUp[i - 1]) {
      if (closes[i] <= finalUp[i]) {
        trend[i] = "bear";
        st[i] = finalUp[i];
      } else {
        trend[i] = "bull";
        st[i] = finalDn[i];
      }
    } else {
      if (closes[i] >= finalDn[i]) {
        trend[i] = "bull";
        st[i] = finalDn[i];
      } else {
        trend[i] = "bear";
        st[i] = finalUp[i];
      }
    }
  }

  const idx = n - 1;
  return { supertrend: st[idx], trend: trend[idx] };
}

/* ============================
   MATH — MA26 (final candles only)
============================ */

function computeMA(candles, len = 26) {
  // gunakan hanya candle yang sudah close (isFinal = true),
  // supaya cocok dengan cara Binance / TradingView menghitung MA
  const finals = candles.filter(c => c.isFinal);
  if (finals.length < len) return null;

  let sum = 0;
  for (let i = finals.length - len; i < finals.length; i++) {
    sum += finals[i].close;
  }
  return sum / len;
}

// arah MA berdasarkan slope murni (tanpa threshold persentase)
function getMADirection(now, prev) {
  if (!now || !prev) return "sideways";
  const diff = now - prev;
  if (diff > 0) return "up";
  if (diff < 0) return "down";
  return "sideways";
}

/* ============================
   UI UPDATE
============================ */

function updateGlow(box, mode) {
  box.classList.remove("uptrend", "downtrend", "sideways");

  if (mode === "bull") box.classList.add("uptrend");
  else if (mode === "bear") box.classList.add("downtrend");
  else if (mode === "up") box.classList.add("uptrend");
  else if (mode === "down") box.classList.add("downtrend");
  else box.classList.add("sideways");
}

function updateIndicators(stVal, stTrend, maVal, maDir, price, isFinal) {
  // price & waktu
  elPrice.textContent = fmt(price, 8);
  elLastUpdate.textContent = new Date().toLocaleTimeString();

  /* SUPERtrend */
  elSuperValue.textContent = fmt(stVal, 8);
  elSuperStatus.textContent =
    stTrend === "bull" ? "Uptrend" : stTrend === "bear" ? "Downtrend" : "–";

  updateGlow(elSuperBox, stTrend);

  /* MA26 (ID tetap ma90) */
  if (maVal == null) {
    elMAValue.textContent = "–";
  } else {
    elMAValue.textContent = fmt(maVal, 8);
  }

  const label =
    maDir === "up" ? "Uptrend" : maDir === "down" ? "Downtrend" : "Sideways";
  elMAStatus.textContent = label;

  updateGlow(elMABox, maDir);

  /* Log flip Supertrend hanya saat candle close */
  if (isFinal) {
    if (lastTrend && lastTrend !== stTrend && !initializing) {
      const msg = `${currentSymbol} Supertrend flip → ${elSuperStatus.textContent}`;
      pushLog(msg);
      showToast(msg);
    }
    lastTrend = stTrend;
  }
}

/* ============================
   HANDLE KLINE
============================ */

function handleKline(k) {
  const openTime = k.t;
  const isFinal = k.x;

  const c = {
    openTime,
    open: parseFloat(k.o),
    high: parseFloat(k.h),
    low: parseFloat(k.l),
    close: parseFloat(k.c),
    isFinal,
  };

  const idx = candles.findIndex(x => x.openTime === openTime);

  if (idx >= 0) {
    candles[idx] = c;
  } else {
    candles.push(c);
    if (candles.length > 2000) candles.shift();
  }

  const { supertrend, trend } = computeSupertrend(candles, ATR_PERIOD, MULTIPLIER);

  // default: pakai MA terakhir yang sudah diketahui
  let ma26 = lastMA;
  let maDir = "sideways";

  // hanya hitung MA baru jika candle baru saja CLOSE (supaya sama dengan chart)
  if (isFinal) {
    const newMA = computeMA(candles, 26);
    if (newMA !== null) {
      maDir = getMADirection(newMA, lastMA);
      lastMA = newMA;
      ma26 = newMA;
    }
  }

  updateIndicators(supertrend, trend, ma26, maDir, c.close, isFinal);
}

/* ============================
   FETCH HISTORY
============================ */

async function fetchHistory(symbol, interval) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000`;
  const res = await fetch(url);
  const data = await res.json();

  candles = data.map(d => ({
    openTime: d[0],
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    isFinal: true, // semua data history adalah candle yang sudah close
  }));

  // siapkan nilai MA awal dari history final
  lastMA = computeMA(candles, 26);
}

/* ============================
   WEBSOCKET STREAM
============================ */

function connectWS() {
  if (ws) ws.close();

  const stream = `${currentSymbol.toLowerCase()}@kline_${currentInterval}`;
  ws = new WebSocket(`wss://stream.binance.com:9443/ws/${stream}`);

  ws.onopen = () => setLive(true);

  ws.onmessage = msg => {
    const data = JSON.parse(msg.data);
    if (data.e === "kline") handleKline(data.k);
  };

  ws.onclose = () => {
    setLive(false);
    setTimeout(connectWS, 2500);
  };

  ws.onerror = () => setLive(false);
}

/* ============================
   LOAD TOP 50
============================ */

async function loadTop50() {
  const res = await fetch("https://api.binance.com/api/v3/ticker/24hr");
  const data = await res.json();

  let usdt = data.filter(
    t =>
      t.symbol.endsWith("USDT") &&
      !t.symbol.includes("UP") &&
      !t.symbol.includes("DOWN")
  );

  usdt.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
  usdt = usdt.slice(0, 50);

  elSymbolSelect.innerHTML = "";
  usdt.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.symbol;
    opt.textContent = t.symbol;
    elSymbolSelect.appendChild(opt);
  });

  // pastikan dropdown menampilkan currentSymbol bila ada di top50
  const exists = Array.from(elSymbolSelect.options).some(
    o => o.value === currentSymbol
  );
  if (!exists && elSymbolSelect.options.length > 0) {
    currentSymbol = elSymbolSelect.options[0].value;
  }
}

/* ============================
   EVENT HANDLERS
============================ */

elSymbolSelect.addEventListener("change", async e => {
  currentSymbol = e.target.value;
  initializing = true;

  await fetchHistory(currentSymbol, currentInterval);
  connectWS();

  setTimeout(() => (initializing = false), 2000);
});

document.getElementById("tf-row").addEventListener("click", async e => {
  const btn = e.target.closest(".tf-btn");
  if (!btn) return;

  const tf = btn.dataset.interval;
  if (tf === currentInterval) return;

  document.querySelectorAll(".tf-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  currentInterval = tf;
  initializing = true;

  await fetchHistory(currentSymbol, currentInterval);
  connectWS();

  setTimeout(() => (initializing = false), 2000);
});

/* ============================
   INIT
============================ */

(async function init() {
  await loadTop50();
  await fetchHistory(currentSymbol, currentInterval);
  connectWS();

  setTimeout(() => (initializing = false), 2000);
})();
