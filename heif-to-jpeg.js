// CDN resources
const HEIC2ANY_CDN = 'https://unpkg.com/heic2any/dist/heic2any.min.js';
const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

const fileInput = document.getElementById('fileInput');
const uploader = document.getElementById('uploader');
const qualityRange = document.getElementById('quality');
const qval = document.getElementById('qval');
const wasmFallbackSelect = document.getElementById('wasmFallback');
const convertBtn = document.getElementById('convertBtn');
const downloadZipBtn = document.getElementById('downloadZipBtn');
const gallery = document.getElementById('gallery');
const globalStatus = document.getElementById('globalStatus');

qval.textContent = parseFloat(qualityRange.value).toFixed(2);
qualityRange.addEventListener('input', () => qval.textContent = parseFloat(qualityRange.value).toFixed(2));

// Drag and drop UX
['dragenter','dragover'].forEach(ev => {
  uploader.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); uploader.classList.add('dragging'); }, false);
});
['dragleave','drop'].forEach(ev => {
  uploader.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); uploader.classList.remove('dragging'); }, false);
});
uploader.addEventListener('drop', e => {
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length) addFiles(files);
});

fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files || []);
  if (files.length) {
    addFiles(files);
    // Clear value so the same files can be selected again if needed
    try { fileInput.value = ''; } catch (e) { /* ignore */ }
  }
});

uploader.addEventListener('keypress', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

convertBtn.addEventListener('click', () => {
  const fileCards = Array.from(document.querySelectorAll('.card[data-state="ready"]'));
  if (!fileCards.length) return alert('No files queued for conversion');
  // start conversion sequentially to avoid memory spikes
  convertSequential(fileCards.map(c => c.dataset.index));
});

downloadZipBtn.addEventListener('click', async () => {
  // collect converted blobs
  const converted = Array.from(document.querySelectorAll('.card[data-state="done"]')).map(c => {
    return {
      name: c.dataset.outname,
      blob: c._outblob
    };
  });
  if (!converted.length) return alert('No converted files to zip');
  globalStatus.textContent = 'Preparing ZIP...';
  if (!window.JSZip) {
    await loadScript(JSZIP_CDN);
  }
  if (!window.JSZip) {
    globalStatus.textContent = 'Failed to load ZIP library.';
    return;
  }
  const zip = new JSZip();
  converted.forEach(item => zip.file(item.name, item.blob));
  const zipBlob = await zip.generateAsync({ type: 'blob' }, meta => {
    globalStatus.textContent = `Zipping: ${Math.round(meta.percent)}%`;
  });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'converted-images.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  globalStatus.textContent = `ZIP downloaded (${converted.length} files)`;
});

// Store queued files in memory as cards
let queuedFiles = [];

function addFiles(files) {
  // Filter for file types (basic check)
  const heicFiles = files.filter(f => /\.(heic|heif)$/i.test(f.name) || f.type === 'image/heic' || f.type === 'image/heif');
  if (!heicFiles.length) {
    alert('No HEIC/HEIF files found in selection.');
    return;
  }
  // Deduplicate by name+size to avoid duplicate cards
  const newFiles = heicFiles.filter(f => !queuedFiles.some(q => q.name === f.name && q.size === f.size));
  if (!newFiles.length) {
    alert('No new HEIC/HEIF files were added (duplicates skipped).');
    return;
  }
  newFiles.forEach((file) => {
    const index = queuedFiles.length;
    queuedFiles.push(file);
    renderCard(file, index);
  });
  globalStatus.textContent = `${queuedFiles.length} file(s) queued`;
}

function renderCard(file, index) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.index = index;
  card.dataset.state = 'ready';
  card.dataset.inname = file.name;

  const name = document.createElement('div');
  name.className = 'meta';
  name.textContent = `${file.name} — ${(file.size/1024|0)} KB`;

  const status = document.createElement('div');
  status.className = 'status';
  status.textContent = 'Ready to convert';

  const preview = document.createElement('div');
  preview.style.minHeight = '120px';
  preview.style.display = 'flex';
  preview.style.alignItems = 'center';
  preview.style.justifyContent = 'center';
  preview.style.background = '#fff';
  preview.textContent = 'Preview after conversion';

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '8px';

  const convertNow = document.createElement('button');
  convertNow.className = 'btn';
  convertNow.textContent = 'Convert';
  convertNow.addEventListener('click', () => convertSingle(index));

  const downloadLink = document.createElement('a');
  downloadLink.className = 'download-link hidden';
  downloadLink.textContent = 'Download';
  downloadLink.href = '#';

  actions.appendChild(convertNow);
  actions.appendChild(downloadLink);

  card.appendChild(preview);
  card.appendChild(name);
  card.appendChild(status);
  card.appendChild(actions);

  gallery.appendChild(card);
}

async function convertSequential(indices) {
  for (const idx of indices) {
    const card = document.querySelector('.card[data-index="' + idx + '"]');
    if (!card) continue;
    if (card.dataset.state === 'done') continue;
    await convertCard(card);
  }
  // show zip button if any converted
  const anyDone = !!document.querySelector('.card[data-state="done"]');
  if (anyDone) downloadZipBtn.classList.remove('hidden');
  globalStatus.textContent = 'All conversions finished';
}

async function convertSingle(index) {
  const card = document.querySelector('.card[data-index="' + index + '"]');
  if (!card) return;
  if (card.dataset.state === 'done') return alert('Already converted');
  await convertCard(card);
  const anyDone = !!document.querySelector('.card[data-state="done"]');
  if (anyDone) downloadZipBtn.classList.remove('hidden');
}

async function convertCard(card) {
  const idx = parseInt(card.dataset.index, 10);
  const file = queuedFiles[idx];
  if (!file) return;
  const status = card.querySelector('.status');
  const preview = card.querySelector('div');

  const shouldForceWasm = wasmFallbackSelect.value === 'on';
  const shouldDisableWasm = wasmFallbackSelect.value === 'off';
  const quality = parseFloat(qualityRange.value) || 0.9;

  status.textContent = 'Converting...';
  card.dataset.state = 'busy';

  try {
    let outBlob = null;
    const canTryNative = typeof createImageBitmap === 'function' && !shouldForceWasm;
    if (canTryNative) {
      status.textContent = 'Trying native decode...';
      try {
        outBlob = await convertViaCreateImageBitmap(file, quality);
        status.innerHTML = '<span class="ok">Converted (native)</span>';
      } catch (err) {
        console.warn('Native decode failed:', err);
        if (shouldDisableWasm) throw err;
      }
    }
    if (!outBlob && !shouldDisableWasm) {
      status.textContent = 'Using WASM fallback...';
      if (!window.heic2any) {
        status.textContent = 'Loading converter library...';
        await loadScript(HEIC2ANY_CDN);
        await new Promise(r => setTimeout(r, 80));
      }
      if (!window.heic2any) throw new Error('heic2any load failed');
      outBlob = await convertViaHeic2any(file, quality);
      status.innerHTML = '<span class="ok">Converted (heic2any)</span>';
    }
    if (!outBlob) throw new Error('Conversion produced no output');

    // attach preview
    const url = URL.createObjectURL(outBlob);
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Converted JPEG preview';
    img.onload = () => URL.revokeObjectURL(url);
    preview.innerHTML = '';
    preview.appendChild(img);

    // download link
    const outName = (file.name || 'image').replace(/\.(heic|heif)$/i, '') + '.jpg';
    const downloadLink = card.querySelector('.download-link');
    const linkUrl = URL.createObjectURL(outBlob);
    downloadLink.href = linkUrl;
    downloadLink.download = outName;
    downloadLink.textContent = `Download ${outName}`;
    downloadLink.classList.remove('hidden');

    // store blob reference on card for zipping
    card._outblob = outBlob;
    card.dataset.outname = outName;
    card.dataset.state = 'done';

  } catch (err) {
    console.error(err);
    status.innerHTML = `<span class="err">Error: ${escapeHtml(err && err.message ? err.message : String(err))}</span>`;
    card.dataset.state = 'error';
  }
}

// Convert using createImageBitmap -> canvas -> toBlob
async function convertViaCreateImageBitmap(file, quality) {
  const imageBitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0);
  return await new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) return reject(new Error('canvas.toBlob produced null'));
      resolve(blob);
    }, 'image/jpeg', quality);
  });
}

// Convert using heic2any
async function convertViaHeic2any(file, quality) {
  const opts = { blob: file, toType: 'image/jpeg', quality: quality };
  const result = await window.heic2any(opts);
  if (Array.isArray(result)) return result[0];
  return result;
}

// Utility to load a script dynamically
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src="' + src + '"]')) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load script: ' + src));
    document.head.appendChild(s);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>\"']/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
