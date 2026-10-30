# Snapback

A local desktop image-feedback tool for artists, rebuilt with **Tauri 2 + Rust** and a small TypeScript canvas editor. Open an image, mark it up, and copy the result into your conversation.

## Run

Requires Node.js 22.12+ (or current LTS), Rust stable, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). macOS is the primary build target.

```sh
npm ci
npm start
```

`npm run dev` runs a browser preview. `npm run dist` builds the macOS application and DMG; `npm run dist -- --bundles app` builds only the application. Build artifacts are in `src-tauri/target/release/bundle/`.

## Included

- Open PNG, JPEG, or WebP files; drag and drop; paste images from the native clipboard.
- Pen, arrows, rectangles, translucent highlights, multiline text, numbered feedback pins.
- Six markup colors, adjustable stroke weight, 45° arrows and square constraints with Shift.
- 150 undo steps, redo, pan, cursor-centered zoom, fit, actual-size inspection, and nearest-neighbor source display at 200% or higher.
- Hold **O** or the comparison button to view the unmarked original.
- Copy a full-resolution annotated image, or export a transparent-capable PNG.
- Export or copy a **notes sheet**: the annotated image and every numbered note together in a single dark PNG with light feedback text and matching square numbers, without headings or branding, with an export preview and automatic text wrapping. Use **Copy notes sheet** in the header for immediate copying, or **Preview notes sheet** in the sidebar (Cmd/Ctrl+Shift+S) to preview and save.
- **Move and resize note markers:** choose the pin tool (N), then drag an existing marker. Select a marker (or its numbered sidebar badge) to expose its corner resize handle and diameter slider. Each drag/resize is one undo step and persists in recovered drafts. Escape cancels a drag.
- **Select any annotation (V):** click or drag arrows, boxes, text, numbered notes, pen strokes, or highlights. Drag selection handles to resize; press Delete/Backspace or use Delete annotation to remove it. Clicking empty canvas deselects. Selection chooses the topmost hit, follows the actual freehand curve, and supports undo/recovery.
- **Move and resize arrows, boxes, and text:** choose the matching tool (A, R, or T), then drag an existing annotation. Arrows expose both endpoints, boxes expose four corners, and text has a corner handle that scales its font and line spacing. Hold Alt to create a new annotation over an existing one. Each gesture is one undo step; Escape cancels it.
- **Edit existing feedback:** click its text in the sidebar or select the marker and choose Edit feedback. Double-click a marker with N or canvas text with T to edit in place. Saving retains its number, position, and size; changes support undo and draft recovery.
- Native application menus: File (open, paste image, PNG export, notes sheet, copying), Edit (undo/redo, standard text clipboard commands, edit selected text, delete selection), Tools, View (fit, actual size, zoom, original), Window, and Help. Items enable according to the current review, selection, and dialog state.
- Copy numbered notes separately as text.
- Automatic local recovery of the most recent image and its editable annotation data using IndexedDB.
- Confirmation before replacing an image with annotations. Invalid input leaves the current review intact.

Nothing uploads images or automatically sends messages. Paste the copied result into the conversation with the artist. The editor and logo work offline; the shared Orchid Adobe font kit loads asynchronously with local font fallbacks.

The approved Studio Dark identity follows the sibling Orchid clients, payroll, and website repos: black chrome, a neutral charcoal canvas, orange actions, Proxima Nova body text, and DIN Condensed headings. The logo is bundled locally; the Adobe kit uses the same `sbo7krv` stylesheet as those apps. Image markup colors remain independent of the interface accent.

The app icon uses the approved **Markup** design: a light pencil and framing corners on a dark rounded tile. Its master, generation prompt, and regeneration command are in `assets/app-icon/`. Tauri's native icons and the browser-preview favicon are generated from this master.

Numbered markers are solid squares without white outlines, both on the canvas and in exported images.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Open / paste | Cmd/Ctrl+O / Cmd/Ctrl+Shift+V |
| Copy image / export PNG | Cmd/Ctrl+Shift+C / Cmd/Ctrl+S |
| Notes sheet | Cmd/Ctrl+Shift+S |
| Move / resize marker | N, then drag marker / its corner |
| Pen / arrow / rectangle | B / A / R |
| Highlight / text / numbered pin | H / T / N |
| Select / delete | V / Delete or Backspace |
| Pan | Hold Space and drag, middle-button drag, or the Pan tool |
| Zoom | Cmd/Ctrl+wheel or trackpad pinch; + / − |
| Fit / 100% | 0 / 1 |
| Original | Hold O |
| Undo / redo | Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z |
| Submit text | Cmd/Ctrl+Enter |
| Cancel active stroke | Escape |
| Shortcut reference | ? |

## Performance and architecture

`src-tauri/src/main.rs` owns native file dialogs, image validation, clipboard images/text, and PNG saving. Image payloads cross Tauri IPC as raw binary, avoiding base64/JSON array overhead. Image decoding, clipboard encoding, and file I/O run on blocking workers.

`src/model.ts` stores vector annotations independently from the source image. Undo shares unchanged annotation objects instead of copying full-resolution image buffers. `src/main.ts` composites a static source image, a committed annotation layer, and a separate active-stroke layer. Pointer events are coalesced and preview painting is scheduled once per animation frame. Each interactive annotation layer is capped at 8 megapixels; export renders at the original source dimensions. Window resizing never crops or changes source pixels.

`src/notes-sheet.ts` creates an opaque notes sheet with all current annotations and a dark numbered text panel with light feedback text and no branding or header. The sheet's image section is capped at 4096 pixels on its longest side for sharing; ordinary PNG export remains full resolution. Small images are not enlarged. The notes column occupies roughly one third of the sheet; feedback starts at 28 px and scales with the export width (about 18 px when viewed at 1000 px wide), with proportional spacing and numbered squares. All notes are included, in numeric order, with paragraphs and long words wrapped. If a sheet exceeds the supported canvas size, export reports an error rather than truncating notes.

Input limits: 80 MB, 40 megapixels, and 16,384 pixels per side. These are guardrails, not a guarantee of equal performance across all machines. Full-resolution export still needs a source-sized canvas and PNG encoding. JPEG/WebP are decoded by the webview; PNG exports do not retain source EXIF/ICC metadata. This is a feedback tool, not a color-managed production editor.

## Verification

```sh
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npx playwright install chromium
npm run test:e2e
```

Unit tests cover history branching and bounds, arrow geometry, fit, and pin numbering. Browser tests cover drawing, undo/redo, resize integrity, safe note rendering, recovery, replacement protection, invalid input, pixel inspection, full-resolution export with visible annotation pixels, marker drag/resize/undo/recovery, and notes-sheet text completeness and exported marker pixels. Rust tests cover input limits and RGBA/PNG roundtrip preservation.

Verified on macOS during this rebuild: 13 model/layout tests, 19 browser workflow tests, 2 Rust tests, clean Clippy checks, and the release app's native open → draw → copy → paste → save flow. The native smoke export retained its 1024 × 1024 dimensions. The app bundle measured 5.74 MiB, with about 33.1 KB of production JavaScript before gzip. These are build measurements, not frame-rate or startup benchmarks.

## Next features worth adding

1. **Revision comparison:** align the artist's new version with the previous one and toggle, swipe, or highlight differences.
2. **Reusable feedback stamps:** save phrases such as “push this silhouette” or “keep this detail” for repeated reviews.
3. **Review queue:** drop a batch of images, move between them with shortcuts, and export a numbered set.
4. **Multi-selection:** move or delete a group of annotations together.
5. **Shareable review files:** package the original image and editable feedback so another reviewer can continue a session.

Current scope is one local review at a time. Multiple projects, screen capture, online review links, and automatic messaging are not implemented.
