const FEEDS = [
    { name: "IGN Italia", url: "https://it.ign.com/feed.xml", class: "ign" },
    { name: "Multiplayer", url: "https://multiplayer.it/feed/rss/news/", class: "multi" },
    { name: "Everyeye", url: "https://www.everyeye.it/feed/feed_news_rss.asp", class: "every" }
];

const DEALS_FEED = "https://www.instant-gaming.com/it/feed/rss/";
const CACHE_KEY = "newspaper_cache_v7";
const CACHE_TIME_KEY = "newspaper_cache_time_v7";
const CACHE_DURATION = 5 * 60 * 1000; // Cache 5 minuti per velocizzare i ricaricamenti

let articles = [];
let deals = [];
let savedItems = JSON.parse(localStorage.getItem('np_saved_items_v7') || '[]');
let currentTab = 'news';
let debounceTimer;

function toggleModal(open) {
    document.getElementById('filter-modal').classList.toggle('open', open);
}

function closeModalOnOverlay(e) {
    if (e.target.id === 'filter-modal') toggleModal(false);
}

function formatDateTime(dateStr) {
    if (!dateStr) return '';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '';
        const day = date.getDate().toString().padStart(2, '0');
        const month = date.toLocaleString('it-IT', { month: 'short' }).toUpperCase().replace('.', '');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${day} ${month} - ${hours}:${minutes}`;
    } catch (e) {
        return '';
    }
}

function extractImageFromHtml(html) {
    if (!html) return null;
    const match = html.match(/src=["'](.*?\.(?:png|jpg|jpeg|webp|gif))["']/i);
    return match ? match[1] : null;
}

function parseXML(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, "text/xml");
    return Array.from(xml.querySelectorAll("item")).map(i => {
        const link = (i.querySelector("link")?.textContent || "#").trim();
        const title = (i.querySelector("title")?.textContent || "").replace(/<[^>]*>?/gm, '').trim();
        const descRaw = i.querySelector("description")?.textContent || i.querySelector("encoded")?.textContent || "";
        const pubDateRaw = i.querySelector("pubDate")?.textContent || "";
        
        const media = i.getElementsByTagName("media:content")[0] || i.getElementsByTagName("media:thumbnail")[0];
        const enc = i.querySelector("enclosure");
        let img = media?.getAttribute("url") || enc?.getAttribute("url") || extractImageFromHtml(descRaw);

        return {
            id: link || title,
            title: title,
            link: link,
            desc: descRaw.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').slice(0, 90).trim() + "...",
            image: img,
            time: formatDateTime(pubDateRaw)
        };
    });
}

async function fetchFeedWithFallback(feedUrl) {
    // 1. Prova via AllOrigins
    try {
        const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`);
        if (res.ok) {
            const xmlText = await res.text();
            const parsed = parseXML(xmlText);
            if (parsed.length > 0) return parsed;
        }
    } catch(e) {}

    // 2. Fallback via rss2json
    try {
        const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`);
        if (res.ok) {
            const data = await res.json();
            if (data?.items) {
                return data.items.map(item => ({
                    id: item.link || item.guid,
                    title: item.title,
                    link: item.link,
                    desc: (item.description || '').replace(/<[^>]*>?/gm, '').slice(0, 90) + '...',
                    image: item.thumbnail || item.enclosure?.link || extractImageFromHtml(item.content || item.description),
                    time: formatDateTime(item.pubDate)
                }));
            }
        }
    } catch(e) {}

    return [];
}

async function loadData(forceRefresh = false) {
    const now = Date.now();
    const cachedTime = sessionStorage.getItem(CACHE_TIME_KEY);
    const cachedData = sessionStorage.getItem(CACHE_KEY);

    if (!forceRefresh && cachedData && cachedTime && (now - cachedTime < CACHE_DURATION)) {
        const parsed = JSON.parse(cachedData);
        articles = parsed.articles || [];
        deals = parsed.deals || [];
        render();
        return;
    }

    // Caricamento in parallelo totale
    const newsPromises = FEEDS.map(f => 
        fetchFeedWithFallback(f.url).then(items => 
            items.map(i => ({ ...i, source: f.name, sourceClass: f.class, type: 'news' }))
        )
    );

    const dealsPromise = fetchFeedWithFallback(DEALS_FEED).then(items =>
        items.map(i => ({
            ...i,
            source: "Instant Gaming",
            sourceClass: "ig",
            type: 'deal'
        }))
    );

    const results = await Promise.allSettled([...newsPromises, dealsPromise]);
    
    articles = [];
    deals = [];

    results.forEach((res, idx) => {
        if (res.status === 'fulfilled') {
            if (idx < FEEDS.length) {
                articles.push(...res.value);
            } else {
                deals.push(...res.value);
            }
        }
    });

    // Salva in cache
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ articles, deals }));
    sessionStorage.setItem(CACHE_TIME_KEY, now.toString());

    render();
}

async function manualRefresh() {
    const btn = document.getElementById('refresh-btn');
    btn.classList.add('spinning');
    await loadData(true);
    btn.classList.remove('spinning');
}

function toggleSave(e, id) {
    e.preventDefault();
    e.stopPropagation();

    const pool = [...articles, ...deals, ...savedItems];
    const item = pool.find(i => i.id === id);
    if (!item) return;

    const idx = savedItems.findIndex(i => i.id === id);
    if (idx > -1) {
        savedItems.splice(idx, 1);
    } else {
        savedItems.push(item);
    }

    localStorage.setItem('np_saved_items_v7', JSON.stringify(savedItems));
    render();
}

function switchTab(t) {
    currentTab = t;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${t}`).classList.add('active');
    render();
}

function debounceRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 150);
}

function createCardElement(item) {
    const isSaved = savedItems.some(s => s.id === item.id);
    const card = document.createElement('a');
    card.className = 'card';
    card.href = item.link;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    
    // Immagine con Lazy Loading e gestione errore trasparente
    const imageHTML = item.image ? `
        <div class="card-cover">
            <img class="card-img" src="${item.image}" alt="" loading="lazy" decoding="async" onerror="this.parentNode.style.display='none'">
        </div>
    ` : '';

    const timeHTML = item.time ? `<span class="card-time">🕒 ${item.time}</span>` : '';

    card.innerHTML = `
        ${imageHTML}
        <div class="card-body">
            <div class="card-header">
                <div class="card-meta">
                    <span class="card-tag ${item.sourceClass || 'ig'}">${item.source}</span>
                    ${timeHTML}
                </div>
                <button class="star-btn ${isSaved ? 'active' : ''}" onclick="toggleSave(event, '${item.id.replace(/'/g, "\\'")}')">⭐</button>
            </div>
            <h2 class="card-title">${item.title}</h2>
            <p class="card-desc">${item.desc}</p>
        </div>
    `;
    return card;
}

function render() {
    const grid = document.getElementById('grid');
    const q = document.getElementById('search').value.toLowerCase().trim();
    const newsSource = document.getElementById('news-source-filter').value;
    const platformFilter = document.getElementById('platform-filter').value;
    
    grid.innerHTML = "";
    const fragment = document.createDocumentFragment();

    if (currentTab === 'saved') {
        const savedFiltered = savedItems.filter(i => i.title.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q));

        if (savedFiltered.length === 0) {
            grid.innerHTML = `<div class="status-box">NESSUN PREFERITO SALVATO.</div>`;
            return;
        }

        const savedNewsList = savedFiltered.filter(i => i.type === 'news');
        const savedDealsList = savedFiltered.filter(i => i.type === 'deal');

        if (savedNewsList.length > 0) {
            const div = document.createElement('div');
            div.className = 'section-divider';
            div.textContent = '📰 NEWS PREFERITE';
            fragment.appendChild(div);
            savedNewsList.forEach(item => fragment.appendChild(createCardElement(item)));
        }

        if (savedDealsList.length > 0) {
            const div = document.createElement('div');
            div.className = 'section-divider';
            div.textContent = '🏷️ OFFERTE PREFERITE';
            fragment.appendChild(div);
            savedDealsList.forEach(item => fragment.appendChild(createCardElement(item)));
        }
        grid.appendChild(fragment);
        return;
    }

    let list = currentTab === 'news' ? articles : deals;

    const filtered = list.filter(i => {
        const matchesSearch = i.title.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q);
        let matchesFilter = true;

        if (currentTab === 'news' && newsSource !== 'ALL') {
            matchesFilter = i.source === newsSource;
        } else if (currentTab === 'deals' && platformFilter !== 'ALL') {
            matchesFilter = i.title.toUpperCase().includes(platformFilter) || i.desc.toUpperCase().includes(platformFilter);
        }

        return matchesSearch && matchesFilter;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="status-box">NESSUN ELEMENTO TROVATO.</div>`;
        return;
    }

    filtered.forEach(item => fragment.appendChild(createCardElement(item)));
    grid.appendChild(fragment);
}

loadData();
