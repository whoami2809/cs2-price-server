const express = require("express");
const fetch = require("node-fetch");
const app = express();
const PORT = process.env.PORT || 3000;
const STEAM_COOKIE = process.env.STEAM_COOKIE || "";
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

// Cotação USD→BRL usada apenas no fallback pricehistory (que retorna USD)
const USD_TO_BRL = 5.85;

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "CS2 Price Server online" });
});

app.get("/price", async (req, res) => {
  const item = req.query.item;
  if (!item) return res.status(400).json({ error: "Parâmetro 'item' obrigatório" });

  const cached = cache.get(item);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json({ ...cached.data, cached: true });
  }

  const headers = buildHeaders();

  // 1) priceoverview com currency=7 (BRL) — retorna R$ direto
  try {
    const url = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=7&market_hash_name=${encodeURIComponent(item)}`;
    const response = await fetch(url, { headers });
    if (response.status === 200) {
      const data = await response.json();
      if (data.success && (data.lowest_price || data.median_price)) {
        const preco = parseBRL(data.lowest_price) || parseBRL(data.median_price);
        const result = {
          item,
          lowest_price: data.lowest_price || null,
          median_price: data.median_price || null,
          volume: data.volume || null,
          preco_brl: preco,
          volume_num: data.volume ? parseInt(data.volume.replace(/[^0-9]/g, "")) : null,
          fonte: "listagem_ativa"
        };
        cache.set(item, { data: result, ts: Date.now() });
        return res.json(result);
      }
    }
  } catch(e) {}

  // 2) Fallback: pricehistory — retorna USD, precisa converter
  if (STEAM_COOKIE) {
    try {
      const url = `https://steamcommunity.com/market/pricehistory/?appid=730&market_hash_name=${encodeURIComponent(item)}`;
      const response = await fetch(url, { headers });
      if (response.status === 200) {
        const data = await response.json();
        if (data.success && data.prices && data.prices.length > 0) {
          const last = data.prices[data.prices.length - 1];
          const precoUSD = parseFloat(last[1]);
          // pricehistory sempre retorna USD — converte para BRL
          const precoBRL = Math.round(precoUSD * USD_TO_BRL * 100) / 100;
          const result = {
            item,
            lowest_price: null,
            median_price: null,
            volume: null,
            preco_brl: precoBRL,
            volume_num: null,
            fonte: "ultimo_negociado_usd_convertido",
            ultima_negociacao: last[0]
          };
          cache.set(item, { data: result, ts: Date.now() });
          return res.json(result);
        }
      }
    } catch(e) {}
  }

  return res.status(404).json({ error: "sem_preco", item });
});

function buildHeaders() {
  const h = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "pt-BR,pt;q=0.9",
    "Referer": "https://steamcommunity.com/market/",
    "X-Requested-With": "XMLHttpRequest"
  };
  if (STEAM_COOKIE) h["Cookie"] = `steamLoginSecure=${STEAM_COOKIE}`;
  return h;
}

function parseBRL(str) {
  if (!str) return null;
  let clean = str.replace(/R\$\s*/gi, "").trim();
  // Remove ponto de milhar, troca vírgula decimal por ponto
  if (clean.includes(".") && clean.includes(",")) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else if (clean.includes(",")) {
    clean = clean.replace(",", ".");
  }
  clean = clean.replace(/[^\d.]/g, "");
  const v = parseFloat(clean);
  return isNaN(v) ? null : v;
}

app.listen(PORT, () => {
  console.log(`CS2 Price Server rodando na porta ${PORT}`);
});
