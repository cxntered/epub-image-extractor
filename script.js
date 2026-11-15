const MIME = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
};

const $ = (id) => document.getElementById(id);

const setStatus = (text, error = false) => {
    const message = $('message');
    message.textContent = text;
    message.classList.toggle('error', error);
};

let toastTimer, toastHideTimer;

const showToast = (text) => {
    const el = $('toast');
    el.textContent = text;
    try {
        if (!el.matches(':popover-open')) el.showPopover();
    } catch (e) { }
    el.classList.add('on');
    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove('on');
        toastHideTimer = setTimeout(() => { try { el.hidePopover(); } catch (e) { } }, 200);
    }, 1800);
};

const basename = (path) => path.split('/').pop();
const extensionOf = (name) => name.split('.').pop().toLowerCase();
const formatSize = (size) => size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`;

const loadImage = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height, img });
    img.onerror = () => resolve({ width: 0, height: 0, img: null });
    img.src = src;
});

const downloadBlob = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href));
};

const copyImage = async (image, name) => {
    try {
        // clipboards only support png, so convert to png first
        let png = image.blob;
        if (image.blob.type !== 'image/png') {
            const { width, height, img } = await loadImage(image.src);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        showToast(`copied ${name} to clipboard`);
    } catch (err) {
        showToast(`failed to copy ${name} to clipboard`);
        console.error(err);
    }
};

let images = [];
let bookName = '';
let current = 0;

// resolve a href from inside the epub against the document it appears in
const resolveHref = (base, href) => {
    try {
        return decodeURIComponent(new URL(href.split('#')[0].split('?')[0], `http://epub/${base}`).pathname.slice(1));
    } catch (e) {
        return null;
    }
};

// order entries by where they appear in the book (cover first, then reading order)
const orderByUsage = async (zip, entries) => {
    const byPath = new Map(), byLowerPath = new Map();
    entries.forEach((entry) => {
        byPath.set(entry.name, entry);
        byLowerPath.set(entry.name.toLowerCase(), entry);
    });

    const paths = [];
    try {
        const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
        const opfPath = parseXml(await zip.file('META-INF/container.xml').async('string'))
            .querySelector('rootfile').getAttribute('full-path');
        const opf = parseXml(await zip.file(opfPath).async('string'));

        const items = new Map();
        opf.querySelectorAll('manifest > item').forEach((item) => items.set(item.getAttribute('id'), item));

        const meta = opf.querySelector('metadata > meta[name="cover"]');
        const cover = opf.querySelector('manifest > item[properties~="cover-image"]') || (meta && items.get(meta.getAttribute('content')));
        if (cover) paths.push(resolveHref(opfPath, cover.getAttribute('href')));

        for (const ref of opf.querySelectorAll('spine > itemref')) {
            const item = items.get(ref.getAttribute('idref'));
            const docPath = item && resolveHref(opfPath, item.getAttribute('href'));
            const file = docPath && zip.file(docPath);
            if (!file) continue;
            const text = await file.async('string');
            for (const match of text.matchAll(/<(?:img|image)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
                paths.push(resolveHref(docPath, match[1]));
            }
        }
    } catch (e) { /* fall back to filename order */ }

    const ordered = [], seen = new Set();
    for (const path of paths) {
        const entry = path && (byPath.get(path) || byLowerPath.get(path.toLowerCase()));
        if (entry && !seen.has(entry)) {
            seen.add(entry);
            ordered.push(entry);
        }
    }

    return ordered.concat(entries.filter((entry) => !seen.has(entry)));
};

const handleFile = async (file) => {
    if (!file) return;

    if (!/\.epub$/i.test(file.name)) {
        setStatus('only .epub files can be opened.', true);
        return;
    }

    images.forEach((image) => URL.revokeObjectURL(image.src));
    images = [];
    $('grid').replaceChildren();
    $('toolbar').classList.remove('on');

    bookName = file.name.replace(/\.epub$/i, '');
    setStatus(`loading ${file.name}...`);

    try {
        const zip = await JSZip.loadAsync(file);
        const entries = zip.file(/.*/).filter((entry) => MIME[extensionOf(entry.name)]);

        if (entries.length === 0) {
            setStatus('no images found in epub file.', true);
            return;
        }

        entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        for (const entry of await orderByUsage(zip, entries)) {
            const blob = new Blob([await entry.async('arraybuffer')], { type: MIME[extensionOf(entry.name)] });
            const src = URL.createObjectURL(blob);
            const { width, height } = await loadImage(src);
            images.push({ name: entry.name, blob, src, width, height });
        }

        renderGrid();
        setStatus('');
    } catch (err) {
        setStatus('could not read epub file. make sure it is a valid epub file.', true);
        console.error(err);
    }
};

const renderGrid = () => {
    $('summary').textContent = `${images.length} image${images.length === 1 ? '' : 's'}`;
    $('toolbar').classList.add('on');

    const grid = $('grid');
    images.forEach((image, index) => {
        const name = basename(image.name);
        const card = document.createElement('div');

        card.className = 'card';
        card.innerHTML = `
            <button class="thumb" type="button" aria-label="View larger"><img alt=""></button>
            <div class="meta">
                <div class="name"></div><div class="info"></div>
            </div>
            <div class="actions">
                <button data-action="copy">copy</button><button data-action="download">download</button>
            </div>
        `;

        const thumb = card.querySelector('.thumb');
        const img = thumb.querySelector('img');
        img.src = image.src;
        img.alt = name;

        const nameEl = card.querySelector('.name');
        nameEl.textContent = name;
        nameEl.title = image.name;

        card.querySelector('.info').textContent = `${image.width}×${image.height} · ${formatSize(image.blob.size)}`;
        thumb.onclick = () => openLightbox(index);
        card.querySelector('[data-action="copy"]').onclick = () => copyImage(image, name);
        card.querySelector('[data-action="download"]').onclick = () => downloadBlob(image.blob, name);

        grid.appendChild(card);
    });
};

const lightbox = $('lightbox');

const renderLightbox = () => {
    const image = images[current];
    const name = basename(image.name);
    const lightboxImage = $('lightbox-image');

    lightboxImage.src = image.src;
    lightboxImage.alt = name;
    $('lightbox-name').textContent = name;
    $('lightbox-name').title = image.name;
    $('lightbox-info').textContent = `${image.width}×${image.height} · ${formatSize(image.blob.size)}`;
    $('lightbox-count').textContent = `${current + 1} / ${images.length}`;
    lightbox.classList.toggle('single', images.length < 2);
};

const openLightbox = (index) => {
    current = index;
    renderLightbox();
    if (!lightbox.open) lightbox.showModal();
};

const stepLightbox = (delta) => {
    current = (current + delta + images.length) % images.length;
    renderLightbox();
};

const downloadAll = async () => {
    const button = $('download-all');
    button.disabled = true;
    button.textContent = 'preparing zip...';

    try {
        const zip = new JSZip();
        const used = new Set();

        for (const image of images) {
            const base = basename(image.name);
            let name = base, n = 2;
            while (used.has(name)) name = base.replace(/(\.[^.]*)?$/, `-${n++}$1`);
            used.add(name);
            zip.file(name, image.blob);
        }

        downloadBlob(await zip.generateAsync({ type: 'blob' }), `${bookName} images.zip`);
    } finally {
        button.disabled = false;
        button.textContent = 'download all as .zip';
    }
};

$('file').addEventListener('change', (e) => handleFile(e.target.files[0]));

const drop = $('drop');
const setDragging = (on) => (e) => {
    e.preventDefault();
    drop.classList.toggle('over', on);
};
drop.addEventListener('dragenter', setDragging(true));
drop.addEventListener('dragover', setDragging(true));
drop.addEventListener('dragleave', setDragging(false));
drop.addEventListener('dragend', setDragging(false));
drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    handleFile(e.dataTransfer.files[0]);
});

$('download-all').addEventListener('click', downloadAll);

$('lightbox-previous').addEventListener('click', () => stepLightbox(-1));
$('lightbox-next').addEventListener('click', () => stepLightbox(1));
$('lightbox-close').addEventListener('click', () => lightbox.close());
$('lightbox-copy').addEventListener('click', () => copyImage(images[current], basename(images[current].name)));
$('lightbox-download').addEventListener('click', () => downloadBlob(images[current].blob, basename(images[current].name)));

lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target.classList.contains('lightbox-stage')) lightbox.close();
});
lightbox.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepLightbox(-1);
    }
    if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepLightbox(1);
    }
});
