#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use image::{ImageEncoder, ImageReader};
use std::{borrow::Cow, io::Cursor};
mod menu;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Emitter;

const MAX_BYTES: usize = 80 * 1024 * 1024;
const MAX_PIXELS: u64 = 40_000_000;

fn check_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > 16384
        || height > 16384
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err(
            "Image is too large. Use an image under 40 megapixels and 16,384 pixels per side."
                .into(),
        );
    }
    Ok(())
}

fn validate_image(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_BYTES {
        return Err("Image exceeds the 80 MB limit.".into());
    }
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let (w, h) = reader
        .into_dimensions()
        .map_err(|_| "Choose a valid PNG, JPEG, or WebP image.".to_string())?;
    check_dimensions(w, h)
}

fn encode_rgba(bytes: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    check_dimensions(width, height)?;
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(bytes, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    Ok(png)
}

fn raw_body(request: Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) if bytes.len() <= MAX_BYTES => Ok(bytes.clone()),
        _ => Err("Expected image bytes under 80 MB.".into()),
    }
}

#[tauri::command]
async fn open_image() -> Result<Response, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .pick_file()
        .await
    else {
        return Ok(Response::new(Vec::<u8>::new()));
    };
    tauri::async_runtime::spawn_blocking(move || {
        let metadata = std::fs::metadata(file.path()).map_err(|e| e.to_string())?;
        if metadata.len() > MAX_BYTES as u64 {
            return Err("Image exceeds the 80 MB limit.".into());
        }
        let bytes = std::fs::read(file.path()).map_err(|e| e.to_string())?;
        validate_image(&bytes)?;
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_clipboard_image() -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        let image = clipboard
            .get_image()
            .map_err(|_| "No image on the clipboard. Copy an image first.".to_string())?;
        let png = encode_rgba(&image.bytes, image.width as u32, image.height as u32)?;
        Ok(Response::new(png))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn copy_image(request: Request<'_>) -> Result<(), String> {
    let bytes = raw_body(request)?;
    tauri::async_runtime::spawn_blocking(move || {
        validate_image(&bytes)?;
        let image = image::load_from_memory(&bytes)
            .map_err(|e| e.to_string())?
            .into_rgba8();
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        clipboard
            .set_image(arboard::ImageData {
                width: image.width() as usize,
                height: image.height() as usize,
                bytes: Cow::Owned(image.into_raw()),
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_image(request: Request<'_>) -> Result<bool, String> {
    let filename = request
        .headers()
        .get("x-export-name")
        .and_then(|value| value.to_str().ok())
        .filter(|name| {
            name.len() <= 120
                && name.ends_with(".png")
                && name
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        })
        .unwrap_or("feedback.png")
        .to_owned();
    let bytes = raw_body(request)?;
    validate_image(&bytes)?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Export must be PNG.".into());
    }
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("PNG image", &["png"])
        .set_file_name(filename)
        .save_file()
        .await
    else {
        return Ok(false);
    };
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::write(file.path(), bytes).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn copy_text(text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        arboard::Clipboard::new()
            .map_err(|e| e.to_string())?
            .set_text(text)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .menu(menu::build)
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            open_image,
            read_clipboard_image,
            copy_image,
            save_image,
            copy_text,
            menu::sync_menu
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Snapback");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_limits_and_invalid_input() {
        assert!(check_dimensions(8000, 5000).is_ok());
        assert!(check_dimensions(8000, 5001).is_err());
        assert!(check_dimensions(0, 20).is_err());
        assert!(check_dimensions(16385, 1).is_err());
        assert!(validate_image(b"not an image").is_err());
    }
    #[test]
    fn clipboard_png_roundtrip() {
        let pixels = [255, 40, 0, 255, 0, 128, 255, 128];
        let png = encode_rgba(&pixels, 2, 1).unwrap();
        validate_image(&png).unwrap();
        assert_eq!(
            image::load_from_memory(&png).unwrap().into_rgba8().as_raw(),
            &pixels
        );
    }
}
