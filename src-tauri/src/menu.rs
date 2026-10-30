use std::collections::HashMap;
use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem as Native, Submenu},
    AppHandle, Wry,
};

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, title: &str, accelerator: Option<&str>| {
        MenuItem::with_id(app, id, title, true, accelerator)
    };
    let menu = Menu::new(app)?;
    #[cfg(target_os = "macos")]
    menu.append(&Submenu::with_items(
        app,
        "Snapback",
        true,
        &[
            &Native::about(
                app,
                Some("About Orchid Snapback"),
                Some(AboutMetadata {
                    name: Some("Orchid Snapback".into()),
                    version: Some(env!("CARGO_PKG_VERSION").into()),
                    comments: Some("Image feedback for artists".into()),
                    ..Default::default()
                }),
            )?,
            &Native::separator(app)?,
            &Native::services(app, None)?,
            &Native::separator(app)?,
            &Native::hide(app, None)?,
            &Native::hide_others(app, None)?,
            &Native::show_all(app, None)?,
            &Native::separator(app)?,
            &Native::quit(app, None)?,
        ],
    )?)?;
    menu.append(&Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item("open", "Open Image…", Some("CmdOrCtrl+O"))?,
            &item("paste-image", "Paste Image", Some("CmdOrCtrl+Shift+V"))?,
            &Native::separator(app)?,
            &item("export", "Export Annotated PNG…", Some("CmdOrCtrl+S"))?,
            &item(
                "sheet",
                "Preview / Export Notes Sheet…",
                Some("CmdOrCtrl+Shift+S"),
            )?,
            &item(
                "copy-image",
                "Copy Annotated Image",
                Some("CmdOrCtrl+Shift+C"),
            )?,
            &item("copy-sheet", "Copy Notes Sheet", None)?,
            &item("copy-notes", "Copy Feedback as Text", None)?,
            &Native::separator(app)?,
            &Native::close_window(app, None)?,
            #[cfg(not(target_os = "macos"))]
            &Native::quit(app, None)?,
        ],
    )?)?;
    menu.append(&Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &item("undo", "Undo", Some("CmdOrCtrl+Z"))?,
            &item("redo", "Redo", Some("CmdOrCtrl+Shift+Z"))?,
            &Native::separator(app)?,
            &Native::cut(app, None)?,
            &Native::copy(app, None)?,
            &Native::paste(app, None)?,
            &Native::select_all(app, None)?,
            &Native::separator(app)?,
            &item("edit-text", "Edit Selected Text / Feedback…", None)?,
            &item("delete", "Delete Selected Annotation", None)?,
        ],
    )?)?;
    let tools = Submenu::new(app, "Tools", true)?;
    for (id, label) in [
        ("select", "Select"),
        ("pen", "Pen"),
        ("arrow", "Arrow"),
        ("rectangle", "Rectangle"),
        ("highlight", "Highlight"),
        ("text", "Text"),
        ("pin", "Feedback Note"),
        ("hand", "Pan"),
    ] {
        tools.append(&item(&format!("tool-{id}"), label, None)?)?;
    }
    menu.append(&tools)?;
    menu.append(&Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("fit", "Fit Image", Some("CmdOrCtrl+0"))?,
            &item("actual-size", "Actual Size", Some("CmdOrCtrl+1"))?,
            &item("zoom-in", "Zoom In", Some("CmdOrCtrl+Plus"))?,
            &item("zoom-out", "Zoom Out", Some("CmdOrCtrl+Minus"))?,
            &item("original", "Show / Hide Original", None)?,
            &Native::separator(app)?,
            &Native::fullscreen(app, None)?,
        ],
    )?)?;
    menu.append(&Submenu::with_items(
        app,
        "Window",
        true,
        &[&Native::minimize(app, None)?, &Native::maximize(app, None)?],
    )?)?;
    menu.append(&Submenu::with_items(
        app,
        "Help",
        true,
        &[&item(
            "help",
            "Keyboard Shortcuts",
            Some("CmdOrCtrl+Slash"),
        )?],
    )?)?;
    Ok(menu)
}

#[tauri::command]
pub fn sync_menu(app: AppHandle, states: HashMap<String, bool>) -> Result<(), String> {
    if let Some(menu) = app.menu() {
        for root in menu.items().map_err(|error| error.to_string())? {
            if let Some(submenu) = root.as_submenu() {
                for child in submenu.items().map_err(|error| error.to_string())? {
                    if let Some(item) = child.as_menuitem() {
                        if let Some(enabled) = states.get(item.id().as_ref()) {
                            item.set_enabled(*enabled)
                                .map_err(|error| error.to_string())?;
                        }
                    }
                }
            }
        }
    }
    Ok(())
}
