const input = document.querySelector('#file-input');
const dropzone = document.querySelector('#dropzone');
const settings = document.querySelector('#settings');
const results = document.querySelector('#results');
const status = document.querySelector('#pair-status');
const quality = document.querySelector('#quality');
let dffFile = null;
let txdFile = null;
let optimizedDff = null;
let optimizedTxd = null;
let txdModule = null;

const formatBytes = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

quality.addEventListener('input', () => document.querySelector('#quality-value').textContent = `${quality.value}%`);
input.addEventListener('change', () => addFiles(input.files));
document.addEventListener('paste', (event) => {
  const files = event.clipboardData ? [...event.clipboardData.files] : [];
  if (files.length) addFiles(files);
});
document.querySelector('#clear-button').addEventListener('click', clearFiles);
document.querySelector('#optimize-button').addEventListener('click', optimizeSkin);
document.querySelector('#download-all').addEventListener('click', downloadSkin);

for (const eventName of ['dragenter', 'dragover']) dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.add('dragover'); });
for (const eventName of ['dragleave', 'drop']) dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.remove('dragover'); });
dropzone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));

function addFiles(fileList) {
  for (const file of fileList) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'dff') dffFile = file;
    if (extension === 'txd') txdFile = file;
  }
  updatePair();
}

function updatePair() {
  status.classList.remove('pair-error');
  settings.hidden = true;
  results.hidden = true;
  status.hidden = false;
  status.replaceChildren();
  const dff = document.createElement('span');
  dff.className = `pair-file ${dffFile ? 'ready' : ''}`;
  dff.textContent = dffFile ? `✓ ${dffFile.name}` : '○ Falta el archivo .DFF';
  const txd = document.createElement('span');
  txd.className = `pair-file ${txdFile ? 'ready' : ''}`;
  txd.textContent = txdFile ? `✓ ${txdFile.name}` : '○ Falta el archivo .TXD';
  status.append(dff, txd);
  if (dffFile && txdFile) {
    status.classList.add('pair-complete');
    settings.hidden = false;
  } else {
    status.classList.remove('pair-complete');
    status.classList.add('pair-incomplete');
  }
}

function clearFiles() {
  dffFile = txdFile = optimizedDff = optimizedTxd = null;
  input.value = '';
  status.hidden = true;
  settings.hidden = true;
  results.hidden = true;
}

async function loadTxdEngine() {
  if (!txdModule) {
    try {
      txdModule = await import('./pkg/skinlite_txd.js');
      await txdModule.default();
    } catch {
      if (location.protocol === 'file:') {
        throw new Error('El optimizador no carga abriendo index.html con doble clic. Usá la página publicada o serví la carpeta con un servidor local.');
      }
      throw new Error('No se pudo cargar el optimizador. Probá de nuevo en unos minutos.');
    }
  }
  return txdModule;
}

async function optimizeSkin() {
  if (!dffFile || !txdFile) return;
  const button = document.querySelector('#optimize-button');
  button.disabled = true;
  button.textContent = 'Procesando…';
  try {
    const engine = await loadTxdEngine();
    const bytes = new Uint8Array(await txdFile.arrayBuffer());
    const maxDimension = Number(document.querySelector('#max-size').value);
    const detail = Number(quality.value) / 100;
    const processed = engine.optimize_txd(bytes, maxDimension, detail);
    optimizedDff = { file: dffFile, name: dffFile.name, size: dffFile.size, unchanged: true };
    const name = txdFile.name.replace(/\.txd$/i, '') + '-ligera.txd';
    optimizedTxd = { file: new Blob([processed], { type: 'application/octet-stream' }), name, size: processed.length, unchanged: false };
    renderResults();
  } catch (error) {
    status.hidden = false;
    status.classList.add('pair-error');
    status.textContent = error.message || 'No se pudo abrir el TXD. Revisá que sea un archivo válido de GTA San Andreas para PC.';
    settings.hidden = false;
    results.hidden = true;
  } finally {
    button.disabled = false;
    button.textContent = 'Optimizar TXD';
  }
}

function renderResults() {
  const oldSize = txdFile.size;
  const saved = oldSize - optimizedTxd.size;
  const summary = document.querySelector('#summary');
  summary.replaceChildren();
  const headline = document.createElement('strong');
  headline.textContent = saved > 0 ? `El TXD pesa ${formatBytes(saved)} menos.` : 'El TXD ya estaba optimizado.';
  const details = document.createElement('span');
  details.textContent = `${formatBytes(oldSize)} → ${formatBytes(optimizedTxd.size)}`;
  summary.append(headline, details);

  const list = document.querySelector('#file-list');
  list.replaceChildren();
  for (const item of [optimizedDff, optimizedTxd]) {
    const row = document.createElement('div');
    row.className = 'file-row';
    const name = document.createElement('span'); name.className = 'filename'; name.textContent = item.name;
    const size = document.createElement('span'); size.className = 'filesize'; size.textContent = formatBytes(item.size);
    const note = document.createElement('span'); note.className = 'saved'; note.textContent = item.unchanged ? 'Sin cambios' : (saved > 0 ? 'Más liviano' : 'Optimizado');
    row.append(name, size, note);
    list.append(row);
  }
  status.hidden = true;
  settings.hidden = true;
  results.hidden = false;
  results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function downloadSkin() {
  if (!optimizedDff || !optimizedTxd) return;
  const dffBytes = new Uint8Array(await optimizedDff.file.arrayBuffer());
  const txdBytes = new Uint8Array(await optimizedTxd.file.arrayBuffer());
  const zip = zipFiles([
    { name: optimizedDff.name, data: dffBytes },
    { name: optimizedTxd.name, data: txdBytes },
  ]);
  const zipName = `skinlite-${txdFile.name.replace(/\.txd$/i, '')}.zip`;
  download(zip, zipName);
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function zipFiles(files) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const directory = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const checksum = crc32(file.data);
    const local = new Uint8Array(30 + name.length + file.data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(file.data, 30 + name.length);
    parts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    directory.push(central);

    offset += local.length;
  }

  const directorySize = directory.reduce((total, entry) => total + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}

function download(file, name) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
