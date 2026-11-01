# Snapback — notes for AI agents

Snapback is a Tauri 2 + TypeScript image-feedback app, part of the Forme suite. See `README.md` for running, releasing and verifying.

## Branding

Snapback follows **[evanviera/forme-brand](https://github.com/evanviera/forme-brand)**, the single source of truth for the suite's look, naming and voice (Limn is the reference app).

- Don't invent colors, fonts, sizes or UI patterns here. Use the variables at the top of `src/styles.css`; every grey must be on forme-brand's neutral ramp. If something new is needed, change forme-brand first.
- Blue is only for the next action, the current selection, focus and unread dots. Text is never under 11px or heavier than 600.
- Annotation colors are user content, not UI colors; keep them marked `brand-ignore`.
- Never name the studio behind the apps anywhere in the app.
- Before finishing visual work, run `node scripts/check.mjs ../sketch-app` from a forme-brand checkout.
