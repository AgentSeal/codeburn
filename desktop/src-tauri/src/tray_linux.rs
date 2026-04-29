use std::sync::{Arc, Mutex};

use ksni::{Category, Icon, Status, ToolTip, Tray, TrayMethods};
use tauri::{AppHandle, Emitter};

/// StatusNotifierItem-backed tray for Linux. Bypasses libappindicator so left-click
/// fires `activate(x, y)` with real screen coordinates, which is what Tauri's Linux
/// tray path cannot deliver. See tauri-apps/tauri#7283 for the upstream gap.
///
/// No menu() is exported. Exporting a menu causes most SNI hosts (notably
/// gnome-shell-extension-appindicator) to swallow left-click as a menu-open and
/// never fire Activate. Quit/Refresh/Open Full Report live in the popover footer.
pub struct CodeburnTray {
    app: AppHandle,
    title: String,
    icon: Vec<Icon>,
}

impl CodeburnTray {
    fn new(app: AppHandle, icon: Vec<Icon>) -> Self {
        Self {
            app,
            title: "CodeBurn".to_string(),
            icon,
        }
    }
}

impl Tray for CodeburnTray {
    fn id(&self) -> String {
        "org.agentseal.codeburn".to_string()
    }

    fn title(&self) -> String {
        self.title.clone()
    }

    fn category(&self) -> Category {
        Category::ApplicationStatus
    }

    fn status(&self) -> Status {
        Status::Active
    }

    fn icon_pixmap(&self) -> Vec<Icon> {
        self.icon.clone()
    }

    fn tool_tip(&self) -> ToolTip {
        ToolTip {
            icon_name: String::new(),
            icon_pixmap: Vec::new(),
            title: "CodeBurn".to_string(),
            description: self.title.clone(),
        }
    }

    fn activate(&mut self, x: i32, y: i32) {
        let _ = self
            .app
            .emit("codeburn://tray-activate", TrayClick { x, y });
    }

    fn secondary_activate(&mut self, x: i32, y: i32) {
        let _ = self
            .app
            .emit("codeburn://tray-secondary", TrayClick { x, y });
    }
}

#[derive(Clone, serde::Serialize)]
struct TrayClick {
    x: i32,
    y: i32,
}

/// Type-erased handle for the Linux tray so callers can push title updates without
/// naming the `ksni::Handle<CodeburnTray>` generic parameter across module boundaries.
#[derive(Clone)]
pub struct LinuxTrayHandle {
    inner: Arc<Mutex<Option<ksni::Handle<CodeburnTray>>>>,
}

impl LinuxTrayHandle {
    pub fn empty() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }

    fn set(&self, handle: ksni::Handle<CodeburnTray>) {
        if let Ok(mut guard) = self.inner.lock() {
            *guard = Some(handle);
        }
    }

}

/// Decode the bundled tray.png into ARGB32 pixels that the SNI spec expects.
/// Falls back to an empty icon list (host shows a broken-icon placeholder) if the
/// asset can't be decoded. We'd rather render a blank icon than crash the tray.
fn load_icon() -> Vec<Icon> {
    // Embedded at build time so the binary is self-contained.
    let bytes = include_bytes!("../icons/tray.png");
    let Ok(decoder) = png::Decoder::new(bytes.as_slice()).read_info().map_err(|_| ()) else {
        return Vec::new();
    };
    decode_png(decoder)
}

fn decode_png(mut reader: png::Reader<&[u8]>) -> Vec<Icon> {
    let info = reader.info().clone();
    let width = info.width as i32;
    let height = info.height as i32;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    if reader.next_frame(&mut buf).is_err() {
        return Vec::new();
    }
    // SNI expects ARGB32 in network byte order. PNG decoder gives RGBA8.
    let pixel_count = (width as usize) * (height as usize);
    let mut argb = Vec::with_capacity(pixel_count * 4);
    for chunk in buf.chunks_exact(4) {
        let (r, g, b, a) = (chunk[0], chunk[1], chunk[2], chunk[3]);
        argb.extend_from_slice(&[a, r, g, b]);
    }
    vec![Icon {
        width,
        height,
        data: argb,
    }]
}

pub async fn spawn(app: AppHandle, handle_out: LinuxTrayHandle) -> anyhow::Result<()> {
    let tray = CodeburnTray::new(app, load_icon());
    let handle = tray.spawn().await?;
    handle_out.set(handle);
    Ok(())
}
