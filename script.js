/* --- CONFIGURAZIONE E VARIABILI STATO --- */
const FEEDS = [
    { name: "IGN Italia", url: "https://it.ign.com/feed.xml", class: "ign" },
    { name: "Multiplayer", url: "https://multiplayer.it/feed/rss/news/", class: "multi" },
    { name: "Everyeye", url: "https://www.everyeye.it/feed/feed_news_rss.asp", class: "every" }
];

const PROXIES = [
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`
];

// Chiavi per localStorage
const CACHE_KEY_NEWS = 'np_cache_news_v1';
const CACHE_KEY_SAVED = 'np_saved_items_v18'; // Aggiornata versione saved

// Stato dell'applicazione
let articles = []; // Array completo in memoria
let deals = [];    // Array completo CheapShark
let pendingArticles = null; // Buffer per aggiornamenti background

let savedItems = JSON.parse(localStorage.getItem(CACHE_KEY_SAVED) || '[]');
let currentTab = 'news';
let currentPageIndex = 0;
let totalPages = 0;
let debounceTimer;

// Stato Virtualizzazione DOM
const MAX_DOM_PAGES = 3; // Quante pagine reali tenere nel DOM (Corrente, Prec, Succ)

/* --- INIZIALIZZAZIONE (PATTERN STALE-WHILE-REVALIDATE) --- */
document.addEventListener('DOMContentLoaded', () => {
    initPlatform();
});

async function initPlatform() {
    // 1. Avvio Istantaneo (Cache First)
    const cachedData = localStorage.getItem(CACHE_KEY_NEWS);
    if (cachedData) {
        articles = JSON.parse(cachedData);
        // Render immediato con dati vecchi
        currentPageIndex = 0;
        renderVirtualDom(); 
    }

    // 2. Aggiornamento in Background (Revalidate)
    // Carica dati freschi dalla rete. Se diversi, mostra il toast.
    await loadData(true); 

    // 3. Avvia refresh periodico (ogni 5 minuti)
    setInterval(() => loadData(true), 300000);
}


/* --- MOTORE DI RENDERING VIRTUALIZZATO (ESTREMA VELOCITÀ) --- */

// Renderizza solo le pagine necessarie nel DOM
function renderVirtualDom() {
    const track = document.getElementById('newspaper-track');
    if (!track) return;

    // Recupera la lista filtrata corrente
    const filteredList = getFilteredList();
    totalPages = filteredList.length;

    // Gestione stati vuoti
    if (totalPages === 0) {
        track.innerHTML = `
            <div class="newspaper-page active">
                <div class="page-paper empty-state">
                    <h1 class="page-title">NESSUN CONTENUTO</h1>
                    <p class="page-desc">VERIFICA I FILTRI O LA CONNESSIONE.</p>
                </div>
            </div>
        `;
        updateNavigationUi();
        return;
    }

    // Pulisce il DOM
    track.innerHTML = "";

    // Calcola il range di pagine da montare (Virtualizzazione)
    let start = Math.max(0, currentPageIndex - 1);
    let end = Math.min(totalPages - 1, currentPageIndex + 1);

    // Assicura di montare sempre MAX_DOM_PAGES se possibile
    if (end - start + 1 < MAX_DOM_PAGES) {
        if (start === 0) {
            end = Math.min(totalPages - 1, start + MAX_DOM_PAGES - 1);
        } else if (end === totalPages - 1) {
            start = Math.max(0, end - MAX_DOM_PAGES + 1);
        }
    }

    // Crea e monta solo le pagine nel range
    for (let i = start; i <= end; i++) {
        const item = filteredList[i];
        const pageElement = createPageElement(item, i);
        track.appendChild(pageElement);
    }

    // Applica le trasformazioni 3D e aggiorna UI
    setTimeout(() => {
        updatePageTransforms(filteredList);
        updateNavigationUi();
    }, 10); // Piccolo delay per permettere al browser di digerire il nuovo DOM
}

// Crea l'elemento HTML per una singola pagina
function createPageElement(item, index) {
    const isSaved = savedItems.some(s => s.id === item.id);
    const page = document.createElement('div');
    page.className = `newspaper-page index-${index}`;
    // Salviamo l'indice reale come data attribute per updatePageTransforms
    page.dataset.realIndex = index; 

    // SVG Icons minimali
    const ICONS = {
        star: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
        starFilled: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
        clock: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
    };

    const imageHTML = item.image ? `
        <div class="page-cover">
            <img class="page-img" src="${item.image}" alt="${item.title}" loading="lazy" decoding="async" onerror="this.parentNode.style.display='none'">
        </div>
    ` : '';

    const timeHTML = item.time ? `<span class="page-time">${ICONS.clock} ${item.time}</span>` : '';

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
                        title="PREFERITO">
                        ${isSaved ? ICONS.starFilled : ICONS.star}
                </button>
            </div>
            <h1 class="page-title">${item.title}</h1>
            ${imageHTML}
            <div class="page-body">
                <p class="page-desc">${item.desc}</p>
            </div>
            <div class="page-footer">
                <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="read-btn" aria-label="Leggi articolo completo">SWIPE IN ALTO ARTICOLO COMPLETO</a>
            </div>
        </div>
    `;
    return page;
}

// Applica le trasformazioni 3D solo alle pagine montate nel DOM
function updatePageTransforms(filteredList) {
    const pages = document.querySelectorAll('.newspaper-track .newspaper-page');
    
    pages.forEach((page) => {
        // Recupera l'indice reale salvato nel DOM
        const realIndex = parseInt(page.dataset.realIndex);
        const offset = realIndex - currentPageIndex;

        // Logica di trasformazione 3D originale
        const translateX = offset * 105;
        const translateZ = -Math.abs(offset) * 140;
        const rotateY = offset * -20;
        const opacity = offset === 0 ? 1 : Math.max(0.2, 1 - Math.abs(offset) * 0.4);
        const scale = offset === 0 ? 1 : 0.90;

        page.style.transform = `translateX(${translateX}vw) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`;
        page.style.opacity = opacity;
        page.style.zIndex = filteredList.length - Math.abs(offset);
        
        if (offset === 0) {
            page.classList.add('active');
        } else {
            page.classList.remove('active');
        }
    });
}

// Aggiorna indicatori, frecce e stato navigazione
function updateNavigationUi() {
    // 1. Frecce laterali
    const prevBtn = document.getElementById('arrow-prev');
    const nextBtn = document.getElementById('arrow-next');
    if (prevBtn) prevBtn.style.display = currentPageIndex > 0 ? 'flex' : 'none';
    if (nextBtn) nextBtn.style.display = currentPageIndex < totalPages - 1 ? 'flex' : 'none';

    // 2. Indicatori Pagine (Dots)
    const dotsContainer = document.getElementById('page-dots');
    if (!dotsContainer) return;
    
    dotsContainer.innerHTML = "";
    // Limita il numero di dots per performance
    const maxDots = Math.min(totalPages, 20); 
    for (let i = 0; i < maxDots; i++) {
        const dot = document.createElement('span');
        dot.className = `dot ${i === currentPageIndex ? 'active' : ''}`;
        dot.setAttribute('role', 'button');
        dot.setAttribute('aria-label', `Vai a pagina ${i + 1}`);
        dot.onclick = () => goToPage(i);
        dotsContainer.appendChild(dot);
    }
}


/* --- GESTIONE DATI E CACHING --- */

// Helper per recuperare la lista corrente basata sul tab
function getFilteredList() {
    const searchInput = document.getElementById('search');
    const platformSelect = document.getElementById('platform-filter');
    const q = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const platformFilter = platformSelect ? platformSelect.value : 'ALL';

    let baseList = [];
    if (currentTab === 'saved') baseList = savedItems;
    else if (currentTab === 'deals') baseList = deals;
    else baseList = articles;

    const filtered = baseList.filter(i => {
        const matchesSearch = i.title.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q);
        let matchesFilter = true;
        if ((currentTab === 'deals' || currentTab === 'saved') && platformFilter !== 'ALL') {
            matchesFilter = i.title.toUpperCase().includes(platformFilter) || i.desc.toUpperCase().includes(platformFilter);
        }
        return matchesSearch && matchesFilter;
    });
    return filtered;
}

// Carica i dati dalla rete (con fallback proxy e buffer per update revalidate)
async function loadData(isBackgroundRefresh = false) {
    try {
        const newsPromises = FEEDS.map(async f => {
            const items = await fetchFeed(f.url);
            return items.map(i => ({ ...i, source: f.name, sourceClass: f.class, type: 'news' }));
        });

        const dealsPromise = fetchDealsEngine(); // Nuovo motore CheapShark

        const results = await Promise.all([...newsPromises, dealsPromise]);
        
        const fetchedNews = [];
        results.slice(0, FEEDS.length).forEach(arr => fetchedNews.push(...arr));
        const fetchedDeals = results[FEEDS.length] || [];

        if (!isBackgroundRefresh || articles.length === 0) {
            // Primo caricamento o cache vuota: applica subito
            articles = fetchedNews;
            deals = fetchedDeals;
            localStorage.setItem(CACHE_KEY_NEWS, JSON.stringify(articles)); // Salva in cache
            currentPageIndex = 0;
            renderVirtualDom();
        } else {
            // Revalidate in background: confronta ID prima notizia
            const staleFirstId = articles[0]?.id;
            const freshFirstId = fetchedNews[0]?.id;

            if (freshFirstId !== staleFirstId && fetchedNews.length > 0) {
                // Ci sono nuove notizie! Salva nel buffer e mostra Toast
                pendingArticles = fetchedNews;
                pendingDeals = fetchedDeals;
                localStorage.setItem(CACHE_KEY_NEWS, JSON.stringify(fetchedNews)); // Aggiorna cache
                showToastUpdate(true);
            }
        }
    } catch (e) {
        console.error("Errore nel caricamento dati freschi:", e);
    }
}

// Gestione Toast Notifica
function showToastUpdate(show) {
    const toast = document.getElementById('toast-update');
    if (toast) toast.style.display = show ? 'block' : 'none';
}

// Applica gli aggiornamenti pendenti scaricati in background
function applyPendingUpdates() {
    if (pendingArticles) articles = pendingArticles;
    if (pendingDeals) deals = pendingDeals;
    pendingArticles = null;
    pendingDeals = null;
    showToastUpdate(false);
    currentPageIndex = 0; // Torna a pagina 1 per vedere le nuove
    renderVirtualDom();
}

// Parser XML Ottimizzato lineare
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
        // Parsing immagini lineare, priorità media:content
        const mediaContent = i.getElementsByTagName("media:content")[0];
        const enclosure = i.querySelector("enclosure");

        if (mediaContent && mediaContent.getAttribute("url")) {
            img = mediaContent.getAttribute("url");
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
    }).filter(i => i.title); // Rimuove item senza titolo
}

// Fetch con fallback proxy rapido
async function fetchFeed(url) {
    // Usa solo il primo proxy, il secondo solo in caso di errore di rete duro
    for (const proxyFn of PROXIES) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout rapido
            const res = await fetch(proxyFn(url), { signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) {
                const text = await res.text();
                if (text && text.includes('<item>')) {
                    return parseXMLDoc(text);
                }
            }
        } catch (e) { /* passa al prossimo proxy */ }
    }
    return [];
}

// Nuovo Motore Offerte CheapShark (Zero CORS, velocissimo)
async function fetchDealsEngine() {
    try {
        // Recupera 30 migliori offerte Metacritic
        const res = await fetch("https://www.cheapshark.com/api/1.0/deals?storeID=1&pageSize=30&sortBy=Metacritic");
        if (res.ok) {
            const data = await res.json();
            return data.map(d => {
                const savings = Math.round(parseFloat(d.savings));
                return {
                    id: `deal-${d.dealID}`,
                    title: `${d.title} (-${savings}%)`,
                    link: `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
                    desc: `OFFERTA STEAM: PREZZO $${d.salePrice} (anzichè $${d.normalPrice}). Rating: ${d.steamRatingText || 'N/D'}.`,
                    image: d.thumb ? d.thumb.replace('capsule_sm_120', 'header') : null, // Immagine più grande
                    time: "IN CORSO",
                    source: "STEAM DEAL",
                    sourceClass: "ig",
                    type: 'deal'
                };
            });
        }
    } catch (e) { console.warn("CheapShark fallback atteso"); }
    return [];
}


/* --- NAVIGAZIONE INTERAZIONE --- */

function toggleSave(e, id) {
    e.preventDefault(); e.stopPropagation();
    const pool = [...articles, ...deals, ...savedItems];
    const item = pool.find(i => i.id === id);
    if (!item) return;

    const idx = savedItems.findIndex(i => i.id === id);
    if (idx > -1) savedItems.splice(idx, 1);
    else savedItems.push(item);

    localStorage.setItem(CACHE_KEY_SAVED, JSON.stringify(savedItems));
    
    // Non serve rifare il render virtuale completo, basta aggiornare le stelle
    const filteredList = getFilteredList();
    updatePageTransforms(filteredList); 
    
    // Se siamo nel tab 'saved', serve il render completo perché l'item sparisce
    if (currentTab === 'saved') renderVirtualDom();
}

function switchTab(t) {
    currentTab = t;
    currentPageIndex = 0;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${t}`)?.classList.add('active');
    
    // Mostra/Nascondi ingranaggio filtri
    document.getElementById('float-filter-btn').style.display = (t === 'deals' || t === 'saved') ? 'flex' : 'none';
    
    renderVirtualDom();
}

// Navigazione a pagina specifica
function goToPage(i) {
    if (i >= 0 && i < totalPages && i !== currentPageIndex) {
        currentPageIndex = i;
        renderVirtualDom(); // Cruciale: ricostruisce il DOM virtualizzato
    }
}

function prevPage() {
    if (currentPageIndex > 0) {
        currentPageIndex--;
        renderVirtualDom();
    }
}

function nextPage() {
    const filteredList = getFilteredList();
    if (currentPageIndex < filteredList.length - 1) {
        currentPageIndex++;
        renderVirtualDom();
    }
}

// Debounce per ricerca/filtri
function debounceRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        currentPageIndex = 0;
        renderVirtualDom();
    }, 150);
}


/* --- GESTIONE GESTURE E TASTIERA --- */
let touchStartX = 0; let touchStartY = 0;
const viewport = document.getElementById('viewport');

viewport.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
}, { passive: true });

viewport.addEventListener('touchend', e => {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchStartX - touchEndX;
    const diffY = touchStartY - touchEndY;
    const threshold = 50;

    // Swipe Verticale (Apri articolo)
    if (Math.abs(diffY) > Math.abs(diffX) && diffY > threshold) {
        const activePage = document.querySelector('.newspaper-page.active');
        if (activePage) {
            const link = activePage.querySelector('.page-paper').getAttribute('data-link');
            if (link && link !== '#') window.open(link, '_blank');
        }
    } 
    // Swipe Orizzontale (Cambia pagina)
    else if (Math.abs(diffX) > threshold) {
        if (diffX > 0) nextPage();
        else prevPage();
    }
}, { passive: true });

// Navigazione Tastiera
document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') nextPage();
    else if (e.key === 'ArrowLeft') prevPage();
    else if (e.key === 'ArrowUp') {
        const activePage = document.querySelector('.newspaper-page.active');
        if (activePage) {
            const link = activePage.querySelector('.page-paper').getAttribute('data-link');
            if (link && link !== '#') window.open(link, '_blank');
        }
    }
});
