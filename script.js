const FEEDS = [
    { name: "IGN Italia", url: "https://it.ign.com/feed.xml", class: "ign" },
    { name: "Multiplayer", url: "https://multiplayer.it/feed/rss/news/", class: "multi" },
    { name: "Everyeye", url: "https://www.everyeye.it/feed/feed_news_rss.asp", class: "every" }
];

const DEALS_FEED = "https://www.instant-gaming.com/it/feed/rss/";

let articles = [];
let deals = [];
let savedItems = JSON.parse(localStorage.getItem('np_saved_items_v8') || '[]');
let currentTab = 'news';
let debounceTimer;

function toggleModal(open) {
    const modal = document.getElementById('filter-modal');
    if (modal) modal.classList.toggle('open', open);
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

function extractImageFromText(text) {
    if (!text) return null;
    const match = text.match(/src=["'](.*?\.(?:png|jpg|jpeg|webp|gif)(?:\?.*?)?)["']/i);
    return match ? match[1] : null;
}

function parseFeedXML(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const items = doc.querySelectorAll("item");
    
    return Array.from(items).map(i => {
        const title = (i.querySelector("title")?.textContent || "").replace(/<[^>]*>?/gm, '').trim();
        const link = (i.querySelector("link")?.textContent || "#").trim();
        const pubDate = i.querySelector("pubDate")?.textContent || "";
        const descRaw = i.querySelector("description")?.textContent || "";
        
        let img = null;
        const mediaContent = i.getElementsByTagName("media:content")[0];
        const mediaThumbnail = i.getElementsByTagName("media:thumbnail")[0];
        const enclosure = i.querySelector("enclosure");

        if (mediaContent && mediaContent.getAttribute("url")) {
            img = mediaContent.getAttribute("url");
        } else if (mediaThumbnail && mediaThumbnail.getAttribute("url")) {
            img = mediaThumbnail.getAttribute("url");
        } else if (enclosure && enclosure.getAttribute("url")) {
            img = enclosure.getAttribute("url");
        } else {
            img = extractImageFromText(descRaw);
        }

        const cleanDesc = descRaw.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();

        return {
            id: link || title,
            title: title,
            link: link,
            desc: cleanDesc.length > 90 ? cleanDesc.slice(0, 90) + "..." : cleanDesc,
            image: img,
            time: formatDateTime(pubDate)
        };
    });
}

async function fetchFeed(url) {
    // Tentativo 1: AllOrigins (restituisce il sorgente grezzo evitando problemi CORS)
    try {
        const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
        if (res.ok) {
            const text = await res.text();
            const parsed = parseFeedXML(text);
            if (parsed && parsed.length > 0) return parsed;
        }
    } catch(e) {}

    // Tentativo 2: CorsProxy
    try {
        const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
        if (res.ok) {
            const text = await res.text();
            const parsed = parseFeedXML(text);
            if (parsed && parsed.length > 0) return parsed;
        }
    } catch(e) {}

    // Tentativo 3: RSS2JSON
    try {
        const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`);
        if (res.ok) {
            const data = await res.json();
            if (data?.items) {
                return data.items.map(i => ({
                    id: i.link || i.guid,
                    title: i.title,
                    link: i.link,
                    desc: (i.description || '').replace(/<[^>]*>?/gm, '').slice(0, 90) + '...',
                    image: i.thumbnail || i.enclosure?.link || extractImageFromText(i.description),
                    time: formatDateTime(i.pubDate)
                }));
            }
        }
    } catch(e) {}

    return [];
}

async function loadData() {
    articles = [];
    deals = [];

    const newsPromises = FEEDS.map(f => 
        fetchFeed(f.url).then(items => 
            items.map(i => ({ ...i, source: f.name, sourceClass: f.class, type: 'news' }))
        )
    );

    const dealsPromise = fetchFeed(DEALS_FEED).then(items =>
        items.map(i => ({
            ...i,
            source: "Instant Gaming",
            sourceClass: "ig",
            type: 'deal'
        }))
    );

    const results = await Promise.allSettled([...newsPromises, dealsPromise]);

    results.forEach((res, idx) => {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
            if (idx < FEEDS.length) {
                articles.push(...res.value);
            } else {
                deals.push(...res.value);
            }
        }
    });

    render();
}

async function manualRefresh() {
    const btn = document.getElementById('refresh-btn');
    if (btn) btn.classList.add('spinning');
    
    const grid = document.getElementById('grid');
    if (grid) grid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';

    await loadData();
    if (btn) btn.classList.remove('spinning');
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

    localStorage.setItem('np_saved_items_v8', JSON.stringify(savedItems));
    render();
}

function switchTab(t) {
    currentTab = t;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`tab-${t}`);
    if (activeBtn) activeBtn.classList.add('active');
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
    if (!grid) return;

    const searchInput = document.getElementById('search');
    const newsSourceSelect = document.getElementById('news-source-filter');
    const platformSelect = document.getElementById('platform-filter');

    const q = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const newsSource = newsSourceSelect ? newsSourceSelect.value : 'ALL';
    const platformFilter = platformSelect ? platformSelect.value : 'ALL';

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
        grid.innerHTML = `<div class="status-box">CARICAMENTO O NESSUN RISULTATO TROVATO.</div>`;
        return;
    }

    filtered.forEach(item => fragment.appendChild(createCardElement(item)));
    grid.appendChild(fragment);
}

// Avvio immediato al caricamento script
loadData();
