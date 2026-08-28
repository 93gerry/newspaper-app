const FEEDS = [
    { name: "IGN Italia", url: "https://it.ign.com/feed.xml", class: "ign" },
    { name: "Multiplayer", url: "https://multiplayer.it/feed/rss/news/", class: "multi" },
    { name: "Everyeye", url: "https://www.everyeye.it/feed/feed_news_rss.asp", class: "every" }
];

let articles = [];
let deals = [];
let savedItems = JSON.parse(localStorage.getItem('np_saved_items_v6') || '[]');
let currentTab = 'news';

function toggleModal(open) {
    document.getElementById('filter-modal').classList.toggle('open', open);
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

async function fetchFeedData(feedUrl) {
    const apiEndpoints = [
        `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`
    ];

    for (let endpoint of apiEndpoints) {
        try {
            const res = await fetch(endpoint);
            if (!res.ok) continue;

            if (endpoint.includes('rss2json')) {
                const data = await res.json();
                if (data && data.status === 'ok' && data.items) {
                    return data.items.map(item => ({
                        id: item.link || item.guid,
                        title: item.title,
                        link: item.link,
                        desc: (item.description || '').replace(/<[^>]*>?/gm, '').slice(0, 95) + '...',
                        image: item.thumbnail || item.enclosure?.link || extractImageFromHtml(item.content || item.description),
                        time: formatDateTime(item.pubDate)
                    }));
                }
            } else {
                const text = await res.text();
                return parseXMLString(text);
            }
        } catch (e) {
            continue;
        }
    }
    return [];
}

function extractImageFromHtml(html) {
    if (!html) return null;
    const match = html.match(/src=["'](.*?\.(?:png|jpg|jpeg|webp|gif))["']/i);
    return match ? match[1] : null;
}

function parseXMLString(xmlStr) {
    try {
        const xml = new DOMParser().parseFromString(xmlStr, "text/xml");
        return Array.from(xml.querySelectorAll("item")).map(i => {
            const link = (i.querySelector("link")?.textContent || "#").trim();
            const title = (i.querySelector("title")?.textContent || "").replace(/<[^>]*>?/gm, '').trim();
            const descRaw = i.querySelector("description")?.textContent || "";
            const pubDateRaw = i.querySelector("pubDate")?.textContent || "";
            const media = i.getElementsByTagName("media:content")[0] || i.getElementsByTagName("media:thumbnail")[0];
            const enc = i.querySelector("enclosure");
            
            let img = media?.getAttribute("url") || enc?.getAttribute("url") || extractImageFromHtml(descRaw);

            return {
                id: link || title,
                title: title,
                link: link,
                desc: descRaw.replace(/<[^>]*>?/gm, '').slice(0, 95) + "...",
                image: img,
                time: formatDateTime(pubDateRaw)
            };
        });
    } catch(e) {
        return [];
    }
}

async function loadData() {
    articles = [];
    deals = [];

    const newsTasks = FEEDS.map(async f => {
        const items = await fetchFeedData(f.url);
        return items.map(i => ({ ...i, source: f.name, sourceClass: f.class, type: 'news' }));
    });

    const dealsTask = (async () => {
        const items = await fetchFeedData("https://www.instant-gaming.com/it/feed/rss/");
        return items.map((i, idx) => ({ 
            ...i, 
            source: "Instant Gaming", 
            sourceClass: "ig",
            type: 'deal',
            image: i.image || `https://gaming-cdn.com/images/products/${idx + 1000}/300x400/cover.jpg`
        }));
    })();

    const results = await Promise.all([...newsTasks, dealsTask]);
    
    results.forEach((resSet, idx) => {
        if (idx < FEEDS.length) {
            articles.push(...resSet);
        } else {
            deals.push(...resSet);
        }
    });

    render();
}

async function manualRefresh() {
    const btn = document.getElementById('refresh-btn');
    btn.classList.add('spinning');
    
    const grid = document.getElementById('grid');
    grid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    
    await loadData();
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

    localStorage.setItem('np_saved_items_v6', JSON.stringify(savedItems));
    render();
}

function switchTab(t) {
    currentTab = t;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${t}`).classList.add('active');
    render();
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
            <img class="card-img" src="${item.image}" alt="" loading="lazy" onerror="this.parentNode.style.display='none'">
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
    const countPill = document.getElementById('item-count');
    const q = document.getElementById('search').value.toLowerCase();
    const newsSource = document.getElementById('news-source-filter').value;
    const platformFilter = document.getElementById('platform-filter').value;
    
    grid.innerHTML = "";
    const fragment = document.createDocumentFragment();

    if (currentTab === 'saved') {
        const savedFiltered = savedItems.filter(i => {
            return i.title.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q);
        });

        countPill.textContent = savedFiltered.length;

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

    countPill.textContent = filtered.length;

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="status-box">NESSUN ELEMENTO TROVATO.</div>`;
        return;
    }

    filtered.forEach(item => fragment.appendChild(createCardElement(item)));
    grid.appendChild(fragment);
}

loadData();
