//! Wayland: the browser's pages as GTK widgets over the app's own page.
//!
//! wry's child webviews are X11 child windows, and Wayland has no counterpart: a window there is
//! one surface the toolkit draws. So on Wayland the pages join the window's widget tree. The app's
//! own page moves into a `gtk::Overlay`, and a `gtk::Fixed` laid over it holds one WebKitGTK view
//! per live tab, at the panel's rectangle. The layer passes input through wherever no page is, so
//! the app's page behaves as before. X11 keeps wry's child windows.
//!
//! Everything here runs on the main thread, as the rest of the host does.

use std::cell::RefCell;

use gtk::prelude::*;

use super::BrowserRect;

thread_local! {
    static LAYER: RefCell<Option<gtk::Fixed>> = const { RefCell::new(None) };
}

/// GDK's name for the display the app runs on: `GdkWaylandDisplay` or `GdkX11Display`.
pub(super) fn display_kind() -> Option<String> {
    gtk::gdk::Display::default().map(|display| display.type_().name().to_owned())
}

/// Puts the layer over the window's page. Done once, before the window shows, so the page is
/// moved while nothing is drawn yet.
pub(super) fn install(window: &tauri::WebviewWindow) -> Result<(), String> {
    if LAYER.with_borrow(Option::is_some) {
        return Ok(());
    }
    let column = window.default_vbox().map_err(|error| error.to_string())?;
    let children = column.children();
    let index = children
        .iter()
        .position(|child| child.type_().name() == "WebKitWebView")
        .ok_or("the window has no page to lay the browser over")?;
    let page = children[index].clone();
    let overlay = gtk::Overlay::new();
    let layer = gtk::Fixed::new();
    column.remove(&page);
    overlay.add(&page);
    overlay.add_overlay(&layer);
    overlay.set_overlay_pass_through(&layer, true);
    column.pack_start(&overlay, true, true, 0);
    column.reorder_child(&overlay, i32::try_from(index).unwrap_or(0));
    overlay.show();
    layer.show();
    LAYER.set(Some(layer));
    Ok(())
}

/// The layer, once installed.
pub(super) fn layer() -> Option<gtk::Fixed> {
    LAYER.with_borrow(Clone::clone)
}

/// Keeps a page at `at` (logical pixels in the window's page). wry allocates the widget once;
/// the layer would put it back at its first place and size on its next layout pass, so the
/// layer's own record of both changes too.
pub(super) fn place(webview: &wry::WebView, at: &BrowserRect) {
    use wry::WebViewExtUnix;
    let Some(layer) = layer() else {
        return;
    };
    let widget: gtk::Widget = webview.webview().upcast();
    if widget.parent().as_ref() != Some(layer.upcast_ref::<gtk::Widget>()) {
        return;
    }
    // GTK takes whole pixels; a page never has a side under one. `as` saturates out-of-range floats.
    let (x, y, width, height) = (
        at.x.round() as i32,
        at.y.round() as i32,
        at.width.round().max(1.0) as i32,
        at.height.round().max(1.0) as i32,
    );
    widget.set_size_request(width, height);
    layer.move_(&widget, x, y);
}
