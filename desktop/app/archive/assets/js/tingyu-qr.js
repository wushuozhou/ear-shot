// Tingyu adapter for qrcode-generator (MIT). The encoder retains its own license.
(() => {
  let pendingLibrary;
  function loadLibrary() {
    if (typeof window.qrcode === 'function') return Promise.resolve(window.qrcode);
    if (!pendingLibrary) {
      pendingLibrary = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL('assets/js/lib/qrcode-generator.js', document.baseURI).href;
        script.onload = () => {
          script.remove();
          if (typeof window.qrcode === 'function') resolve(window.qrcode);
          else reject(new Error('QR encoder unavailable'));
        };
        script.onerror = () => { script.remove(); reject(new Error('QR encoder failed to load')); };
        document.head.appendChild(script);
      }).catch(error => { pendingLibrary = null; throw error; });
    }
    return pendingLibrary;
  }
  window.TingyuQR = {
    async create(value, size = 256, config = {}) {
      const encoder = await loadLibrary();
      encoder.stringToBytes = encoder.stringToBytesFuncs['UTF-8'];
      const level = String(config.level || 'L').toUpperCase();
      const qr = encoder(0, ['L', 'M', 'Q', 'H'].includes(level) ? level : 'L');
      qr.addData(String(value), 'Byte');
      qr.make();
      const modules = qr.getModuleCount();
      const requested = Number(size);
      size = Math.max(modules + 8, Math.min(4096, Number.isFinite(requested) ? Math.round(requested) : 256));
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      const cell = Math.max(1, Math.floor(size / (modules + 8)));
      const offset = Math.floor((size - modules * cell) / 2);
      context.globalAlpha = config.backgroundAlpha ?? 1;
      context.fillStyle = config.background || '#fff';
      context.fillRect(0, 0, size, size);
      context.globalAlpha = config.foregroundAlpha ?? 1;
      context.fillStyle = config.foreground || '#000';
      for (let row = 0; row < modules; row++) {
        for (let col = 0; col < modules; col++) {
          if (qr.isDark(row, col)) context.fillRect(offset + col * cell, offset + row * cell, cell, cell);
        }
      }
      context.globalAlpha = 1;
      return canvas;
    },
  };
})();
