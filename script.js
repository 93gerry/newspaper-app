const FEEDS = [
    { name: "IGN Italia", url: "https://it.ign.com/feed.xml", class: "ign" },
    { name: "Multiplayer", url: "https://multiplayer.it/feed/rss/news/", class: "multi" },
    { name: "Everyeye", url: "https://www.everyeye.it/feed/feed_news_rss.asp", class: "every" }
];

const DEALS_FEED = "https://www.instant-gaming.com/it/feed/rss/";

// Proxy CORS a cascata per garantire massima affidabilità
const PROXIES = [
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
];

let articles = [];
let deals = [];
let pendingArticles = null;
let pendingDeals = null;

let savedItems = JSON.parse(localStorage.getItem('np_saved_items_v17') || '[]');
let currentTab = 'news';
let currentPageIndex = 0;
let totalPages = 0;
let debounceTimer;

function toggleSearchModal(open) {
    const modal = document.getElementById('search-modal');
    if (modal) modal.classList.toggle('open', open);
}

function toggleFilterModal(open) {
    const modal = document.getElementById('filter-modal');
    if (modal) modal.classList.toggle('open', open);
}

function closeModalOnOverlay(e, modalId) {
    if (e.target.id === modalId) {
        document.getElementById(modalId).classList.remove('open');
    }
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
        const link = (i.querySelector("link")?.textContent || i.querySelector("guid")?.textContent || "#").trim();
        const pubDate = i.querySelector("pubDate")?.textContent || "";
        const descRaw = i.querySelector("description")?.textContent || i.getElementsByTagName("content:encoded")[0]?.textContent || "";
        
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
            desc: cleanDesc.length > 220 ? cleanDesc.slice(0, 220) + "..." : cleanDesc,
            image: img,
            time: formatDateTime(pubDate)
        };
    }).filter(i => i.title);
}

async function fetchFeed(url) {
    for (const proxyFn of PROXIES) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 secondi timeout
            const res = await fetch(proxyFn(url), { signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) {
                const text = await res.text();
                if (text && text.includes('<item>')) {
                    const parsed = parseXMLDoc(text);
                    if (parsed.length > 0) return parsed;
                }
            }
        } catch (e) {
            // Se fallisce passa al prossimo proxy
        }
    }
    return [];
}

async function loadData(isBackgroundRefresh = false) {
    try {
        const newsPromises = FEEDS.map(async f => {
            const items = await fetchFeed(f.url);
            return items.map(i => ({ ...i, source: f.name, sourceClass: f.class, type: 'news' }));
        });

        const dealsPromise = fetchFeed(DEALS_FEED).then(items => 
            items.map(i => ({ ...i, source: "Instant Gaming", sourceClass: "ig", type: 'deal' }))
        );

        const results = await Promise.all([...newsPromises, dealsPromise]);
        
        const fetchedNews = [];
        results.slice(0, FEEDS.length).forEach(arr => fetchedNews.push(...arr));
        const fetchedDeals = results[FEEDS.length] || [];

        if (!isBackgroundRefresh || articles.length === 0) {
            articles = fetchedNews;
            deals = fetchedDeals;
            render();
        } else {
            // Verifica se ci sono nuove notizie
            const hasNewArticles = fetchedNews.length > 0 && fetchedNews[0].id !== articles[0]?.id;
            const hasNewDeals = fetchedDeals.length > 0 && fetchedDeals[0].id !== deals[0]?.id;

            if (hasNewArticles || hasNewDeals) {
                pendingArticles = fetchedNews;
                pendingDeals = fetchedDeals;
                showToastUpdate(true);
            }
        }
    } catch (e) {
        console.error("Errore nel caricamento dati:", e);
    }
}

function showToastUpdate(show) {
    const toast = document.getElementById('toast-update');
    if (toast) toast.style.display = show ? 'block' : 'none';
}

function applyPendingUpdates() {
    if (pendingArticles) articles = pendingArticles;
    if (pendingDeals) deals = pendingDeals;
    pendingArticles = null;
    pendingDeals = null;
    showToastUpdate(false);
    currentPageIndex = 0;
    render();
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

    localStorage.setItem('np_saved_items_v17', JSON.stringify(savedItems));
    render();
}

function switchTab(t) {
    currentTab = t;
    currentPageIndex = 0;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`tab-${t}`);
    if (activeBtn) activeBtn.classList.add('active');

    const floatFilterBtn = document.getElementById('float-filter-btn');
    if (floatFilterBtn) {
        floatFilterBtn.style.display = (t === 'deals' || t === 'saved') ? 'flex' : 'none';
    }
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
            <img class="page-img" src="${item.image}" alt="${item.title}" loading="lazy" decoding="async" onerror="this.parentNode.style.display='none'">
        </div>
    ` : '';

    const timeHTML = item.time ? `<span class="page-time">🕒 ${item.time}</span>` : '';

    page.innerHTML = `
        <div class="page-paper" data-link="${item.link}">
            <div class="page-header">
                <div class="page-meta">
                    <span class="card-tag ${item.sourceClass || 'ig'}">${item.source}</span>
                    ${timeHTML}
                </div>
                <button class="star-btn ${isSaved ? 'active' : ''}" 
                        aria-label="${isSaved ? 'Rimuovi dai preferiti' : 'Salva nei preferiti'}"
                        onclick="toggleSave(event, '${item.id.replace(/'/g, "\\'")}')" 
                        title="PREFERITO">⭐</button>
            </div>
            
            <h1 class="page-title">${item.title}</h1>
            
            ${imageHTML}
            
            <div class="page-body">
                <p class="page-desc">${item.desc}</p>
            </div>

            <div class="page-footer">
                <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="read-btn" aria-label="Leggi articolo completo su ${item.source}">SWIPE IN ALTO ARTICOLO COMPLETO</a>
            </div>
        </div>
    `;
    return page;
}

function updatePagePosition(animate = true) {
    const track = document.getElementById('newspaper-track');
    const pages = track ? track.querySelectorAll('.newspaper-page') : [];
    
    totalPages = pages.length;
    if (currentPageIndex >= totalPages) currentPageIndex = Math.max(0, totalPages - 1);

    pages.forEach((page, i) => {
        const offset = i - currentPageIndex;
        const translateX = offset * 105;
        const translateZ = -Math.abs(offset) * 140;
        const rotateY = offset * -20;
        const opacity = offset === 0 ? 1 : Math.max(0.2, 1 - Math.abs(offset) * 0.4);
        const scale = offset === 0 ? 1 : 0.90;

        page.style.transition = animate ? 'transform 0.4s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s ease' : 'none';
        page.style.transform = `translateX(${translateX}vw) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`;
        page.style.opacity = opacity;
        page.style.zIndex = totalPages - Math.abs(offset);
    });

    updateDots();

    const prevBtn = document.getElementById('arrow-prev');
    const nextBtn = document.getElementById('arrow-next');
    if (prevBtn) prevBtn.style.display = currentPageIndex > 0 ? 'flex' : 'none';
    if (nextBtn) nextBtn.style.display = currentPageIndex < totalPages - 1 ? 'flex' : 'none';
}

function updateDots() {
    const dotsContainer = document.getElementById('page-dots');
    if (!dotsContainer) return;
    
    let html = '';
    const maxDots = Math.min(totalPages, 15);
    for (let i = 0; i < maxDots; i++) {
        const active = i === currentPageIndex ? 'active' : '';
        html += `<span class="dot ${active}" role="button" aria-label="Vai a pagina ${i + 1}" onclick="goToPage(${i})"></span>`;
    }
    dotsContainer.innerHTML = html;
}

function goToPage(i) {
    currentPageIndex = i;
    updatePagePosition();
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

let touchStartX = 0;
let touchStartY = 0;
let touchCurrentX = 0;
let touchCurrentY = 0;
let isSwiping = false;

const viewport = document.getElementById('viewport');

viewport.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isSwiping = true;
}, { passive: true });

viewport.addEventListener('touchmove', e => {
    if (!isSwiping) return;
    touchCurrentX = e.touches[0].clientX;
    touchCurrentY = e.touches[0].clientY;
}, { passive: true });

viewport.addEventListener('touchend', () => {
    if (!isSwiping) return;
    isSwiping = false;
    
    const diffX = touchStartX - touchCurrentX;
    const diffY = touchStartY - touchCurrentY;
    const threshold = 40;

    if (Math.abs(diffY) > Math.abs(diffX) && diffY > threshold) {
        const activePage = document.querySelectorAll('.newspaper-page')[currentPageIndex];
        if (activePage) {
            const link = activePage.querySelector('.page-paper').getAttribute('data-link');
            if (link && link !== '#') {
                window.open(link, '_blank');
            }
        }
        return;
    }

    if (Math.abs(diffX) > threshold) {
        if (diffX > 0) {
            nextPage();
        } else {
            prevPage();
        }
    }
}, { passive: true });

document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') nextPage();
    if (e.key === 'ArrowLeft') prevPage();
    if (e.key === 'ArrowUp') {
        const activePage = document.querySelectorAll('.newspaper-page')[currentPageIndex];
        if (activePage) {
            const link = activePage.querySelector('.page-paper').getAttribute('data-link');
            if (link && link !== '#') window.open(link, '_blank');
        }
    }
});

function render() {
    const track = document.getElementById('newspaper-track');
    if (!track) return;

    const searchInput = document.getElementById('search');
    const platformSelect = document.getElementById('platform-filter');

    const q = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const platformFilter = platformSelect ? platformSelect.value : 'ALL';

    track.innerHTML = "";
    let list = [];

    if (currentTab === 'saved') {
        list = savedItems;
    } else if (currentTab === 'deals') {
        list = deals;
    } else {
        list = articles;
    }

    const filtered = list.filter(i => {
        const matchesSearch = i.title.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q);
        let matchesFilter = true;

        if ((currentTab === 'deals' || currentTab === 'saved') && platformFilter !== 'ALL') {
            matchesFilter = i.title.toUpperCase().includes(platformFilter) || i.desc.toUpperCase().includes(platformFilter);
        }

        return matchesSearch && matchesFilter;
    });

    totalPages = filtered.length;
    if (currentPageIndex >= totalPages) currentPageIndex = Math.max(0, totalPages - 1);

    if (filtered.length === 0) {
        track.innerHTML = `
            <div class="newspaper-page">
                <div class="page-paper empty-state">
                    <h1 class="page-title">NESSUN CONTENUTO</h1>
                    <p class="page-desc">VERIFICA I FILTRI IMPOSTATI O LA CONNESSIONE.</p>
                </div>
            </div>
        `;
        updatePagePosition(false);
        return;
    }

    filtered.forEach(item => {
        track.appendChild(createPageElement(item));
    });

    updatePagePosition(false);
}

// Avvio primario + refresh periodico discreto
loadData(false);
setInterval(() => loadData(true), 120000);
