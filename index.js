const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

// Cookie da conta secundária Steam (opcional, aumenta rate limit)
const STEAM_COOKIE = process.env.STEAM_COOKIE || "";

// Cache simples em memória — evita bater no Steam para o mesmo item em menos de 10 min
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos

app.get("/", (req, res) => {
  res.json({ status: "CS2 Price Server online" });
});

// Rota principal: /price?item=NomeDoItem
app.get("/price", async (req, res) => {
  const item = req.query.item;
  if (!item) return res.status(400).json({ error: "Parâmetro 'item' obrigatório" });

  // Verifica cache
  const cached = cache.get(item);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json({ ...cached.data, cached: true });
  }

  try {
    const url = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=7&market_hash_name=${encodeURIComponent(item)}`;

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      "Referer": "https://steamcommunity.com/market/",
      "X-Requested-With": "XMLHttpRequest"
    };

    if (STEAM_COOKIE) headers["Cookie"] = `steamLoginSecure=${STEAM_COOKIE}`;

    const response = await fetch(url, { headers });

    if (response.status === 429) {
      return res.status(429).json({ error: "Steam rate limit — tente novamente em alguns segundos" });
    }

    if (response.status !== 200) {
      return res.status(response.status).json({ error: `Steam retornou HTTP ${response.status}` });
    }

    const data = await response.json();

    if (!data.success) {
      return res.status(404).json({ error: "Item não encontrado no Steam Market" });
    }

    const result = {
      item,
      lowest_price: data.lowest_price || null,
      median_price: data.median_price || null,
      volume: data.volume || null,
      preco_brl: parseBRL(data.lowest_price),
      volume_num: data.volume ? parseInt(data.volume.replace(/[^0-9]/g, "")) : null
    };

    // Salva no cache
    cache.set(item, { data: result, ts: Date.now() });

    res.json(result);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rota em lote: POST /prices com body { items: ["item1", "item2", ...] }
app.use(express.json());
app.post("/prices", async (req, res) => {
  const items = req.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Body deve ter { items: [...] }" });
  }

  const results = {};

  for (const item of items) {
    // Verifica cache
    const cached = cache.get(item);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      results[item] = cached.data;
      continue;
    }

    try {
      const url = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=7&market_hash_name=${encodeURIComponent(item)}`;
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://steamcommunity.com/market/",
        "X-Requested-With": "XMLHttpRequest"
      };
      if (STEAM_COOKIE) headers["Cookie"] = `steamLoginSecure=${STEAM_COOKIE}`;

      const response = await fetch(url, { headers });

      if (response.status === 429) {
        await sleep(3000);
        results[item] = { error: "rate_limit" };
        continue;
      }

      if (response.status !== 200) {
        results[item] = { error: `http_${response.status}` };
        continue;
      }

      const data = await response.json();
      if (!data.success) {
        results[item] = { error: "not_found" };
        continue;
      }

      const result = {
        item,
        preco_brl: parseBRL(data.lowest_price),
        volume_num: data.volume ? parseInt(data.volume.replace(/[^0-9]/g, "")) : null
      };

      cache.set(item, { data: result, ts: Date.now() });
      results[item] = result;

    } catch (err) {
      results[item] = { error: err.message };
    }

    await sleep(1000);
  }

  res.json(results);
});

function parseBRL(str) {
  if (!str) return null;
  let clean = str.replace(/R\$\s*/gi, "").trim();
  if (clean.includes(".") && clean.includes(",")) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else if (clean.includes(",")) {
    clean = clean.replace(",", ".");
  }
  clean = clean.replace(/[^\d.]/g, "");
  const v = parseFloat(clean);
  return isNaN(v) ? null : v;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

app.listen(PORT, () => {
  console.log(`CS2 Price Server rodando na porta ${PORT}`);
});
