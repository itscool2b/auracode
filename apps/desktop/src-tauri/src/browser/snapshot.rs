//! Linux: pictures of a page, from WebKitGTK's own snapshot, for the panel's stand-in while
//! something opens over the page and for the agents' screenshots. They match what the Windows
//! engine returns: what the tab shows as a JPEG, the whole page or one part of it as a PNG, base64,
//! in the screen's pixels.
//!
//! The page's process paints the picture; the main thread only asks for it and copies the pixels
//! out, and the encoding runs on a worker thread.

use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use image::ImageEncoder;
use serde_json::Value;
use tokio::sync::oneshot;
use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

use super::{Browser, BrowserError, SCRIPT_TIMEOUT, Shot, host};

/// The most device pixels one picture may hold (192 MB of pixels in the page's process, and
/// again here). A longer page is pictured in parts: what shows, or one element.
const MAX_PIXELS: f64 = 48_000_000.0;

/// How long a picture may take.
const TIMEOUT: Duration = Duration::from_secs(15);

/// What the engine pictures: what the tab shows, or the whole document. `Whole` carries the
/// document's size in CSS pixels, to refuse one too large before the engine paints it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum Region {
    Visible,
    Whole { width: f64, height: f64 },
}

/// A picture as the engine painted it: cairo's ARGB32 (premultiplied, native byte order), and how
/// many of its pixels make one CSS pixel (the page's zoom times the screen's scale).
pub(super) struct Picture {
    width: usize,
    height: usize,
    stride: usize,
    pixels: Vec<u8>,
    /// The engine gave no alpha (cairo's RGB24): every pixel is opaque.
    opaque: bool,
    scale: f64,
}

/// A rectangle in CSS pixels of the region pictured.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// A tab's page as `shot` asks, base64.
pub(super) async fn screenshot(
    browser: &Arc<Browser>,
    tab_id: &str,
    shot: Shot,
) -> Result<String, BrowserError> {
    let (region, crop) = match shot {
        Shot::Viewport { .. } => (Region::Visible, None),
        Shot::FullPage => {
            let page = measure(browser, tab_id).await?;
            (page.whole(), None)
        }
        Shot::Clip {
            x,
            y,
            width,
            height,
        } => {
            let page = measure(browser, tab_id).await?;
            let area = Area {
                x,
                y,
                width,
                height,
            };
            if page.shows(&area) {
                (Region::Visible, Some(area))
            } else {
                // Partly out of view: cut it from the whole document, where it starts at its
                // place in the document rather than in the view.
                let area = Area {
                    x: x + page.scroll_x,
                    y: y + page.scroll_y,
                    ..area
                };
                (page.whole(), Some(area))
            }
        }
    };
    let (sender, receiver) = oneshot::channel();
    let id = tab_id.to_owned();
    browser
        .on_main(move |_| host::snapshot(&id, region, sender))
        .await??;
    let picture = tokio::time::timeout(TIMEOUT, receiver)
        .await
        .map_err(|_| BrowserError::Timeout)?
        .map_err(|_| BrowserError::Page("The page went away.".into()))??;
    tauri::async_runtime::spawn_blocking(move || encode(&picture, crop, shot))
        .await
        .map_err(|_| BrowserError::Page("The picture could not be encoded.".into()))?
}

/// The page's view and document, in CSS pixels.
struct Measure {
    view_width: f64,
    view_height: f64,
    scroll_x: f64,
    scroll_y: f64,
    width: f64,
    height: f64,
}

impl Measure {
    fn whole(&self) -> Region {
        Region::Whole {
            width: self.width.max(self.view_width),
            height: self.height.max(self.view_height),
        }
    }

    /// Whether `area` lies within the view (half a pixel's give for rounding).
    fn shows(&self, area: &Area) -> bool {
        area.x >= -0.5
            && area.y >= -0.5
            && area.x + area.width <= self.view_width + 0.5
            && area.y + area.height <= self.view_height + 0.5
    }
}

/// Reads the page's view and document size.
async fn measure(browser: &Arc<Browser>, tab_id: &str) -> Result<Measure, BrowserError> {
    const SCRIPT: &str = "(() => { const root = document.documentElement; const body = document.body; return JSON.stringify([innerWidth, innerHeight, scrollX, scrollY, Math.max(root ? root.scrollWidth : 0, body ? body.scrollWidth : 0), Math.max(root ? root.scrollHeight : 0, body ? body.scrollHeight : 0)]); })()";
    let value = browser
        .eval(tab_id, SCRIPT.to_owned(), SCRIPT_TIMEOUT)
        .await?;
    let number = |index: usize| {
        value
            .get(index)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
    };
    match (
        number(0),
        number(1),
        number(2),
        number(3),
        number(4),
        number(5),
    ) {
        (
            Some(view_width),
            Some(view_height),
            Some(scroll_x),
            Some(scroll_y),
            Some(width),
            Some(height),
        ) => Ok(Measure {
            view_width,
            view_height,
            scroll_x,
            scroll_y,
            width,
            height,
        }),
        _ => Err(BrowserError::Page(
            "The page did not say how large it is.".into(),
        )),
    }
}

/// Asks the engine for a picture of `page` (main thread). `sender` gets it, or why not.
pub(super) fn take(
    page: &webkit2gtk::WebView,
    region: Region,
    sender: oneshot::Sender<Result<Picture, BrowserError>>,
) {
    use gtk::prelude::WidgetExt;
    let scale = page.zoom_level() * f64::from(page.scale_factor().max(1));
    let which = match region {
        Region::Visible => SnapshotRegion::Visible,
        Region::Whole { width, height } => {
            let pixels = width * height * scale * scale;
            if !pixels.is_finite() || pixels > MAX_PIXELS {
                let _ = sender.send(Err(BrowserError::Page(format!(
                    "The page is too large to picture whole ({} by {} pixels). Take a screenshot of what the tab shows, or of one element.",
                    (width * scale).round(),
                    (height * scale).round(),
                ))));
                return;
            }
            SnapshotRegion::FullDocument
        }
    };
    page.snapshot(
        which,
        SnapshotOptions::NONE,
        None::<&gtk::gio::Cancellable>,
        move |result| {
            let picture = result
                .map_err(|error| BrowserError::Page(format!("The engine took no picture: {error}")))
                .and_then(|surface| copy(surface, scale));
            let _ = sender.send(picture);
        },
    );
}

/// Copies the engine's picture out of its cairo surface.
fn copy(surface: gtk::cairo::Surface, scale: f64) -> Result<Picture, BrowserError> {
    let unreadable = || BrowserError::Page("The engine's picture could not be read.".into());
    let image = gtk::cairo::ImageSurface::try_from(surface).map_err(|_| unreadable())?;
    let opaque = match image.format() {
        gtk::cairo::Format::ARgb32 => false,
        gtk::cairo::Format::Rgb24 => true,
        _ => return Err(unreadable()),
    };
    let size = |value: i32| usize::try_from(value).map_err(|_| unreadable());
    let (width, height, stride) = (
        size(image.width())?,
        size(image.height())?,
        size(image.stride())?,
    );
    if width == 0 || height == 0 || stride < width * 4 {
        return Err(BrowserError::Page("The engine's picture is empty.".into()));
    }
    let mut pixels = Vec::new();
    image
        .with_data(|data| pixels = data.to_vec())
        .map_err(|_| unreadable())?;
    if pixels.len() < stride * height {
        return Err(unreadable());
    }
    Ok(Picture {
        width,
        height,
        stride,
        pixels,
        opaque,
        scale,
    })
}

/// The part of `picture` that `crop` (CSS pixels) names, in its own pixels, within its bounds.
fn bounds(picture: &Picture, crop: Option<Area>) -> Option<(usize, usize, usize, usize)> {
    let Some(area) = crop else {
        return Some((0, 0, picture.width, picture.height));
    };
    let clamp = |value: f64, limit: usize| {
        if value.is_finite() {
            // Within 0..=limit, so the cast keeps the value.
            value.round().clamp(0.0, limit as f64) as usize
        } else {
            0
        }
    };
    let left = clamp(area.x * picture.scale, picture.width);
    let top = clamp(area.y * picture.scale, picture.height);
    let right = clamp((area.x + area.width) * picture.scale, picture.width);
    let bottom = clamp((area.y + area.height) * picture.scale, picture.height);
    (right > left && bottom > top).then_some((left, top, right - left, bottom - top))
}

/// Encodes a picture as `shot` asks: a JPEG of what shows, a PNG otherwise, base64.
fn encode(picture: &Picture, crop: Option<Area>, shot: Shot) -> Result<String, BrowserError> {
    let (left, top, width, height) = bounds(picture, crop)
        .ok_or_else(|| BrowserError::Page("That part of the page is not in the picture.".into()))?;
    let failed = |error: image::ImageError| {
        BrowserError::Page(format!("The picture could not be encoded: {error}"))
    };
    let size = |value: usize| {
        u32::try_from(value)
            .map_err(|_| BrowserError::Page("The picture is too large to encode.".into()))
    };
    let (width32, height32) = (size(width)?, size(height)?);
    let mut bytes = Vec::new();
    match shot {
        Shot::Viewport { quality } => {
            let rgb = pixels(picture, left, top, width, height, false);
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality.clamp(1, 100))
                .write_image(&rgb, width32, height32, image::ExtendedColorType::Rgb8)
                .map_err(failed)?;
        }
        Shot::FullPage | Shot::Clip { .. } => {
            let rgba = pixels(picture, left, top, width, height, true);
            image::codecs::png::PngEncoder::new_with_quality(
                &mut bytes,
                image::codecs::png::CompressionType::Fast,
                image::codecs::png::FilterType::Adaptive,
            )
            .write_image(&rgba, width32, height32, image::ExtendedColorType::Rgba8)
            .map_err(failed)?;
        }
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// A part of the picture as RGBA (`alpha`), or as RGB over white for a JPEG.
fn pixels(
    picture: &Picture,
    left: usize,
    top: usize,
    width: usize,
    height: usize,
    alpha: bool,
) -> Vec<u8> {
    let channels = if alpha { 4 } else { 3 };
    let mut out = Vec::with_capacity(width * height * channels);
    for row in top..top + height {
        let start = row * picture.stride + left * 4;
        let line = picture.pixels.get(start..start + width * 4).unwrap_or(&[]);
        for pixel in line.as_chunks::<4>().0 {
            let value = u32::from_ne_bytes(*pixel);
            let a = if picture.opaque { 255 } else { value >> 24 };
            let [r, g, b] = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
            if alpha {
                // cairo premultiplies: divide the colour back out (a clear pixel has none).
                let straight = |channel: u32| {
                    (channel * 255 + a / 2)
                        .checked_div(a)
                        .map_or(0, |value| value.min(255) as u8)
                };
                out.extend([straight(r), straight(g), straight(b), a as u8]);
            } else {
                // Over white: a premultiplied colour plus the white that shows through.
                let over = |channel: u32| (channel + (255 - a)).min(255) as u8;
                out.extend([over(r), over(g), over(b)]);
            }
        }
        // A short line (never, by `copy`'s checks) still fills its row, so the encoder's sizes hold.
        out.resize((row - top + 1) * width * channels, 255);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 4x2 picture at `scale`: red, green, blue, and half-transparent white, then four of grey.
    fn picture(scale: f64) -> Picture {
        let argb = |a: u32, r: u32, g: u32, b: u32| (a << 24 | r << 16 | g << 8 | b).to_ne_bytes();
        let mut pixels = Vec::new();
        for value in [
            argb(255, 255, 0, 0),
            argb(255, 0, 255, 0),
            argb(255, 0, 0, 255),
            // Premultiplied: white at half opacity.
            argb(128, 128, 128, 128),
        ] {
            pixels.extend(value);
        }
        pixels.extend([0; 8]); // the stride's padding
        for _ in 0..4 {
            pixels.extend(argb(255, 100, 100, 100));
        }
        pixels.extend([0; 8]);
        Picture {
            width: 4,
            height: 2,
            stride: 24,
            pixels,
            opaque: false,
            scale,
        }
    }

    #[test]
    fn pixels_come_out_straight_or_over_white() {
        let picture = picture(1.0);
        assert_eq!(
            pixels(&picture, 0, 0, 4, 1, true),
            [
                255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128
            ]
        );
        assert_eq!(
            pixels(&picture, 2, 0, 2, 2, false),
            [0, 0, 255, 255, 255, 255, 100, 100, 100, 100, 100, 100]
        );
        let opaque = Picture {
            opaque: true,
            ..picture
        };
        // RGB24 leaves the top byte undefined: it never reads as transparency.
        assert_eq!(pixels(&opaque, 3, 0, 1, 1, true), [128, 128, 128, 255]);
    }

    #[test]
    fn a_crop_is_scaled_and_held_to_the_picture() {
        let picture = picture(2.0);
        assert_eq!(bounds(&picture, None), Some((0, 0, 4, 2)));
        let area = |x, y, width, height| {
            Some(Area {
                x,
                y,
                width,
                height,
            })
        };
        assert_eq!(
            bounds(&picture, area(0.5, 0.0, 1.0, 1.0)),
            Some((1, 0, 2, 2))
        );
        assert_eq!(
            bounds(&picture, area(-5.0, -5.0, 100.0, 100.0)),
            Some((0, 0, 4, 2))
        );
        assert_eq!(bounds(&picture, area(10.0, 0.0, 5.0, 5.0)), None);
        assert_eq!(bounds(&picture, area(f64::NAN, 0.0, 1.0, 1.0)), None);
    }

    #[test]
    fn shots_encode_as_the_windows_engine_returns_them() {
        let picture = picture(1.0);
        let decode = |text: String| {
            base64::engine::general_purpose::STANDARD
                .decode(text)
                .unwrap()
        };
        let jpeg = decode(encode(&picture, None, Shot::Viewport { quality: 80 }).unwrap());
        assert!(jpeg.starts_with(&[0xff, 0xd8, 0xff]), "a JPEG");
        let full = decode(encode(&picture, None, Shot::FullPage).unwrap());
        assert!(full.starts_with(b"\x89PNG\r\n\x1a\n"), "a PNG");
        let clip = Shot::Clip {
            x: 1.0,
            y: 0.0,
            width: 2.0,
            height: 1.0,
        };
        let area = |x, y| Area {
            x,
            y,
            width: 2.0,
            height: 1.0,
        };
        let part = decode(encode(&picture, Some(area(1.0, 0.0)), clip).unwrap());
        let decoded = image::load_from_memory(&part).unwrap().to_rgba8();
        assert_eq!(decoded.dimensions(), (2, 1));
        assert_eq!(decoded.as_raw(), &[0, 255, 0, 255, 0, 0, 255, 255]);
        assert!(encode(&picture, Some(area(9.0, 9.0)), clip).is_err());
    }

    #[test]
    fn a_view_shows_what_lies_within_it() {
        let page = Measure {
            view_width: 800.0,
            view_height: 600.0,
            scroll_x: 0.0,
            scroll_y: 1200.0,
            width: 800.0,
            height: 5000.0,
        };
        let area = |x, y, width, height| Area {
            x,
            y,
            width,
            height,
        };
        assert!(page.shows(&area(10.0, 10.0, 200.0, 100.0)));
        assert!(page.shows(&area(0.0, 0.0, 800.3, 600.0)));
        assert!(!page.shows(&area(10.0, 500.0, 200.0, 300.0)));
        assert_eq!(
            page.whole(),
            Region::Whole {
                width: 800.0,
                height: 5000.0
            }
        );
    }
}
