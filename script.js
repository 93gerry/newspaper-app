const FEEDS = [
    { name: "IGN Italia", url: "https://it.ign.com/feed.xml", class: "ign" },
    { name: "Multiplayer", url: "https://multiplayer.it/feed/rss/news/", class: "multi" },
    { name: "Everyeye", url: "https://www.everyeye.it/feed/feed_news_rss.asp", class: "every" }
];

const DEALS_FEED = "https://www.instant-gaming.com/it/feed/rss/";

let articles = [];
let deals = [];
let savedItems = JSON.parse(localStorage.getItem('np_saved_items_v10') || '[]');
let currentTab = 'news';
let currentPageIndex = 0;
let totalPages = 0;
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

function parseXMLDoc(xmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");
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
            desc: cleanDesc.length > 160 ? cleanDesc.slice(0, 160) + "..." : cleanDesc,
            image: img,
            time: formatDateTime(pubDate)
        };
    });
}

async function fetchFeed(url) {
    try {
        const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
        if (res.ok) {
            const text = await res.text();
            const parsed = parseXMLDoc(text);
            if (parsed.length > 0) return parsed;
        }
    } catch(e) {}

    try {
        const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`);
        if (res.ok) {
            const data = await res.json();
            if (data?.items) {
                return data.items.map(i => ({
                    id: i.link || i.guid,
                    title: i.title,
                    link: i.link,
                    desc: (i.description || '').replace(/<[^>]*>?/gm, '').slice(0, 160) + '...',
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

    for (const f of FEEDS) {
        const items = await fetchFeed(f.url);
        articles.push(...items.map(i => ({ ...i, source: f.name, sourceClass: f.class, type: 'news' })));
    }

    const dealItems = await fetchFeed(DEALS_FEED);
    deals.push(...dealItems.map(i => ({ ...i, source: "Instant Gaming", sourceClass: "ig", type: 'deal' })));

    render();
}

async function manualRefresh() {
    const btn = document.getElementById('refresh-btn');
    if (btn) btn.classList.add('spinning');
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

    localStorage.setItem('np_saved_items_v10', JSON.stringify(savedItems));
    render();
}

function switchTab(t) {
    currentTab = t;
    currentPageIndex = 0;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`tab-${t}`);
    if (activeBtn) activeBtn.classList.add('active');
    render();
}

function debounceRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        currentPageIndex = 0;
        render();
    }, 150);
}

function createPageElement(item) {
    const isSaved = savedItems.some(s => s.id === item.id);
    const page = document.createElement('div');
    page.className = 'newspaper-page';

    const imageHTML = item.image ? `
        <div class="page-cover">
            <img class="page-img" src="${item.image}" alt="" loading="lazy" decoding="async" onerror="this.parentNode.style.display='none'">
        </div>
    ` : '<div class="page-cover-placeholder">🐤 NEWSPAPER EDITION</div>';

    const timeHTML = item.time ? `<span class="page-time">🕒 ${item.time}</span>` : '';

    page.innerHTML = `
        <div class="page-paper">
            <div class="page-header">
                <div class="page-meta">
                    <span class="card-tag ${item.sourceClass || 'ig'}">${item.source}</span>
                    ${timeHTML}
                </div>
                <button class="star-btn ${isSaved ? 'active' : ''}" onclick="toggleSave(event, '${item.id.replace(/'/g, "\\'")}')">⭐</button>
            </div>
            
            <h1 class="page-title">${item.title}</h1>
            
            ${imageHTML}
            
            <div class="page-body">
                <p class="page-desc">${item.desc}</p>
            </div>

            <div class="page-footer">
                <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="read-btn">LEGGI ARTICOLO COMPLETO ➔</a>
            </div>
        </div>
    `;
    return page;
}

function updatePagePosition(animate = true) {
    const track = document.getElementById('newspaper-track');
    const indicator = document.getElementById('page-indicator');
    
    if (track) {
        track.style.transition = animate ? 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)' : 'none';
        track.style.transform = `translateX(-${currentPageIndex * 100}vw)`;
    }
    
    if (indicator) {
        indicator.textContent = totalPages > 0 ? `PAGINA ${currentPageIndex + 1} DI ${totalPages}` : `PAGINA 0 DI 0`;
    }

    const prevBtn = document.getElementById('arrow-prev');
    const nextBtn = document.getElementById('arrow-next');
    if (prevBtn) prevBtn.style.display = currentPageIndex > 0 ? 'flex' : 'none';
    if (nextBtn) nextBtn.style.display = currentPageIndex < totalPages - 1 ? 'flex' : 'none';
}

function prevPage() {
    if (currentPageIndex > 0) {
        currentPageIndex--;
        updatePagePosition();
    }
}

function nextPage() {
    if (currentPageIndex < totalPages - 1) {
        currentPageIndex++;
        updatePagePosition();
    }
}

// Gestione Touch Swipe Fluido con il dito su smartphone
let touchStartX = 0;
let touchCurrentX = 0;
let isSwiping = false;

const viewport = document.getElementById('viewport');

viewport.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    isSwiping = true;
}, { passive: true });

viewport.addEventListener('touchmove', e => {
    if (!isSwiping) return;
    touchCurrentX = e.touches[0].clientX;
}, { passive: true });

viewport.addEventListener('touchend', () => {
    if (!isSwiping) return;
    isSwiping = false;
    const diff = touchStartX - touchCurrentX;
    const threshold = 50;

    if (Math.abs(diff) > threshold) {
        if (diff > 0) {
            nextPage();
        } else {
            prevPage();
        }
    }
}, { passive: true });

// Gestione tastiera PC
document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') nextPage();
    if (e.key === 'ArrowLeft') prevPage();
});

function render() {
    const track = document.getElementById('newspaper-track');
    if (!track) return;

    const searchInput = document.getElementById('search');
    const newsSourceSelect = document.getElementById('news-source-filter');
    const platformSelect = document.getElementById('platform-filter');

    const q = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const newsSource = newsSourceSelect ? newsSourceSelect.value : 'ALL';
    const platformFilter = platformSelect ? platformSelect.value : 'ALL';

    track.innerHTML = "";
    let list = [];

    if (currentTab === 'saved') {
        list = savedItems;
    } else {
        list = currentTab === 'news' ? articles : deals;
    }

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

    totalPages = filtered.length;
    
    if (currentPageIndex >= totalPages) {
        currentPageIndex = Math.max(0, totalPages - 1);
    }

    if (filtered.length === 0) {
        track.innerHTML = `
            <div class="newspaper-page">
                <div class="page-paper empty-state">
                    <h1 class="page-title">NESSUN RISULTATO</h1>
                    <p class="page-desc">CAMBIA I FILTRI O VERIFICA LA CONNESSIONE.</p>
                </div>
            </div>
        `;
        updatePagePosition();
        return;
    }

    filtered.forEach(item => {
        track.appendChild(createPageElement(item));
    });

    updatePagePosition(false);
}

loadData();
