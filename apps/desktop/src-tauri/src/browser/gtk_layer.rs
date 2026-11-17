//! Wayland: the browser's pages as GTK widgets over the app's own page.
//!
//! wry's child webviews are X11 child windows, and Wayland has no counterpart: a window there is
//! one surface the toolkit draws. So on Wayland the pages join the window's widget tree. The app's
//! own page moves into a `gtk::Overlay`, and each live tab's WebKitGTK view is an overlay child,
//! in a holder of exactly the panel's rectangle. X11 keeps wry's child windows.
//!
//! The holder is the page's size on purpose. GDK draws the app's page with OpenGL and has to
//! upload, every frame, whatever GTK draws over it. One layer across the whole window made that
//! the whole window: the main process took 75 to 95 % of a core to show a small animation at 60
//! frames a second, against 13 % without the layer (4K at 2x, 16 November 2026). A holder the page
//! fills costs nothing beyond the page, and with no page shown nothing lies over the app at all.
//!
//! Everything here runs on the main thread, as the rest of the host does.

use std::cell::RefCell;
use std::collections::HashMap;

use gtk::prelude::*;

use super::BrowserRect;

thread_local! {
    static OVERLAY: RefCell<Option<gtk::Overlay>> = const { RefCell::new(None) };
    /// Where each holder goes, in the overlay's own coordinates (logical pixels).
    static PLACES: RefCell<HashMap<gtk::Widget, gtk::gdk::Rectangle>> = RefCell::new(HashMap::new());
}

/// GDK's name for the display the app runs on: `GdkWaylandDisplay` or `GdkX11Display`.
pub(super) fn display_kind() -> Option<String> {
    gtk::gdk::Display::default().map(|display| display.type_().name().to_owned())
}

/// Moves the window's page into an overlay the browser's pages can join. Done once, before the
/// window shows, so the page is moved while nothing is drawn yet.
pub(super) fn install(window: &tauri::WebviewWindow) -> Result<(), String> {
    if OVERLAY.with_borrow(Option::is_some) {
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
    column.remove(&page);
    overlay.add(&page);
    overlay.connect_get_child_position(|_, holder| {
        PLACES.with_borrow(|places| places.get(holder).copied())
    });
    column.pack_start(&overlay, true, true, 0);
    column.reorder_child(&overlay, i32::try_from(index).unwrap_or(0));
    overlay.show();
    OVERLAY.set(Some(overlay));
    Ok(())
}

/// Whether the pages are widgets here (Wayland) rather than child windows (X11).
pub(super) fn installed() -> bool {
    OVERLAY.with_borrow(Option::is_some)
}

/// A hidden holder for one page of `size`, over the app's page. wry builds the page inside it
/// (`build_gtk`); [`adopt`] then ties the holder's life to the page's.
pub(super) fn holder(size: (f64, f64)) -> Option<gtk::Fixed> {
    let overlay = OVERLAY.with_borrow(Clone::clone)?;
    let holder = gtk::Fixed::new();
    let (width, height) = (whole(size.0).max(1), whole(size.1).max(1));
    PLACES.with_borrow_mut(|places| {
        places.insert(
            holder.clone().upcast(),
            gtk::gdk::Rectangle::new(0, 0, width, height),
        );
    });
    overlay.add_overlay(&holder);
    Some(holder)
}

/// Removes a page's holder when the page is destroyed (wry destroys it when the tab sleeps or
/// closes). Without a page there is nothing to remove, and the holder goes at once.
pub(super) fn adopt(holder: &gtk::Fixed, webview: Option<&wry::WebView>) {
    let Some(webview) = webview else {
        discard(holder.upcast_ref());
        return;
    };
    let holder = holder.clone();
    widget_of(webview).connect_destroy(move |_| discard(holder.upcast_ref()));
}

fn discard(holder: &gtk::Widget) {
    PLACES.with_borrow_mut(|places| places.remove(holder));
    if let Some(overlay) = OVERLAY.with_borrow(Clone::clone) {
        overlay.remove(holder);
    }
}

/// The page's holder, when the page lives in the overlay.
fn holder_of(webview: &wry::WebView) -> Option<(gtk::Widget, gtk::Widget)> {
    let widget = widget_of(webview);
    let holder = widget.parent()?;
    PLACES
        .with_borrow(|places| places.contains_key(&holder))
        .then_some((holder, widget))
}

fn widget_of(webview: &wry::WebView) -> gtk::Widget {
    use wry::WebViewExtUnix;
    webview.webview().upcast()
}

/// Moves a page to `at` (logical pixels in the window's page). `false` when the page is not in
/// the overlay (X11), where wry moves it.
pub(super) fn place(webview: &wry::WebView, at: &BrowserRect) -> bool {
    let Some((holder, widget)) = holder_of(webview) else {
        return false;
    };
    let (width, height) = (whole(at.width).max(1), whole(at.height).max(1));
    PLACES.with_borrow_mut(|places| {
        places.insert(
            holder.clone(),
            gtk::gdk::Rectangle::new(whole(at.x), whole(at.y), width, height),
        );
    });
    widget.set_size_request(width, height);
    holder.queue_resize();
    true
}

/// Shows or hides a page with its holder. `false` when the page is not in the overlay.
pub(super) fn set_visible(webview: &wry::WebView, visible: bool) -> bool {
    let Some((holder, _)) = holder_of(webview) else {
        return false;
    };
    if visible {
        holder.show_all();
    } else {
        holder.hide();
    }
    true
}

/// GTK takes whole pixels. `as` saturates a float out of range.
fn whole(value: f64) -> i32 {
    value.round() as i32
}
