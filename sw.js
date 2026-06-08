// 1. REGLA DE ORO: Cambia este nombre ('v2', 'v3', 'v4'...) CADA VEZ que edites tu index.html
const CACHE_NAME = 'a-tu-puerta-v2';

const urlsToCache = [
    './',
    './index.html',
    'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

// Instalación del Service Worker
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('PWA: Guardando archivos nuevos en caché...');
                return cache.addAll(urlsToCache);
            })
            .then(() => {
                // Obliga al nuevo Service Worker a activarse inmediatamente
                return self.skipWaiting();
            })
    );
});

// Activación del Service Worker: Aquí es donde se destruye el index.html viejo
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        console.log('PWA: Limpiando caché antigua obsoleta:', cache);
                        return caches.delete(cache); // Borra el archivo viejo de la memoria del teléfono
                    }
                })
            );
        }).then(() => {
            // Toma el control de la PWA instalada de manera inmediata
            return self.clients.claim();
        })
    );
});

// Intercepción de peticiones para modo offline rápido
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response; // Devuelve del caché si existe
                }
                return fetch(event.request); // Si no, busca en internet
            })
    );
});
