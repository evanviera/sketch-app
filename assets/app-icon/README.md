# Snapback app icon

Approved direction: **2 — Markup**, a light pencil with framing corners on a dark rounded tile. The pencil tip is the shared accent blue (`#3b8cff`), recolored from the original master. This is the app's only identity mark; the app shows no studio branding.

`markup.png` is the production master. Native sizes are generated with:

```sh
npx tauri icon assets/app-icon/markup.png --output src-tauri/icons
cp src-tauri/icons/32x32.png public/brand/snapback-icon.png
```

Created with the built-in image-generation tool from the approved concept. The final edit only isolated the rounded tile with transparent exterior corners.

Final edit prompt:

> Edit target: the provided approved Snapback app icon. This is a production background-extraction edit only. Preserve the exact white diagonal pencil, the exact two white framing corners, their positions, proportions, dark gaps, and the dark charcoal rounded-square tile. Keep the ENTIRE rounded-square tile opaque, including its dark interior. Remove ONLY the almost-black exterior backdrop OUTSIDE the rounded-square tile, replacing those exterior pixels with real alpha transparency. Keep the current tile scale and generous outer transparent margin; keep square image dimensions. Do not redesign, add elements, change geometry, crop the tile, remove the dark tile, add text, add a shadow, or turn the dark interior transparent. Output one isolated opaque dark rounded-square app icon with the approved off-white glyph, surrounded by genuine transparent corners.
