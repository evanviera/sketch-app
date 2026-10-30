/** Shared Orchid identity. Font loading never blocks local image editing. */
export const brandBodyFont = '"proxima-nova", "Proxima Nova", Arial, sans-serif';
export const brandDisplayFont = '"din-condensed", "DIN Condensed", "Arial Narrow", Impact, sans-serif';

export function loadBrandFonts() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://use.typekit.net/sbo7krv.css';
  link.referrerPolicy = 'no-referrer';
  // Adobe's kit uses font-display:auto. Keep rendering the local font stack until
  // both brand families have actually loaded, including on an offline first run.
  link.onload = async () => {
    try {
      await Promise.all([
        document.fonts.load('400 16px "proxima-nova"'),
        document.fonts.load('700 16px "proxima-nova"'),
        document.fonts.load('400 32px "din-condensed"'),
      ]);
      document.documentElement.classList.add('brand-fonts-ready');
    } catch { /* System/local fallbacks are deliberately retained. */ }
  };
  document.head.append(link);
}
