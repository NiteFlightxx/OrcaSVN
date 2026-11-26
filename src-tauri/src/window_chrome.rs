use serde::Deserialize;

#[cfg(windows)]
pub(crate) fn set_taskbar_icon(window: &tauri::WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::{
        System::LibraryLoader::GetModuleHandleW,
        UI::WindowsAndMessaging::{
            LoadImageW, SendMessageW, ICON_BIG, IMAGE_ICON, LR_DEFAULTSIZE, LR_SHARED, WM_SETICON,
        },
    };

    // tauri-build embeds the configured bundle ICO under resource ID 32512.
    const BUNDLE_ICON_ID: u16 = 32512;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    // Setup runs on the window thread. Windows owns the shared icon for the
    // lifetime of the module. Tao already supplies the small caption icon.
    unsafe {
        let module = GetModuleHandleW(std::ptr::null());
        if module.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let icon = LoadImageW(
            module,
            usize::from(BUNDLE_ICON_ID) as *const u16,
            IMAGE_ICON,
            0,
            0,
            LR_DEFAULTSIZE | LR_SHARED,
        );
        if icon.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, icon as isize);
    }
    Ok(())
}

#[derive(Deserialize)]
pub(crate) struct CaptionColors {
    caption: u32,
    text: u32,
}

#[tauri::command]
pub(crate) fn sync_window_chrome(
    window: tauri::WebviewWindow,
    dark: Option<bool>,
    colors: Option<CaptionColors>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_COLOR_DEFAULT, DWMWA_TEXT_COLOR,
        };

        window
            .set_theme(dark.map(|dark| {
                if dark {
                    tauri::Theme::Dark
                } else {
                    tauri::Theme::Light
                }
            }))
            .map_err(|error| error.to_string())?;

        let handle = window.hwnd().map_err(|error| error.to_string())?.0;
        let (caption, text) = colors.map_or((DWMWA_COLOR_DEFAULT, DWMWA_COLOR_DEFAULT), |colors| {
            (to_colorref(colors.caption), to_colorref(colors.text))
        });
        for (attribute, value) in [(DWMWA_CAPTION_COLOR, caption), (DWMWA_TEXT_COLOR, text)] {
            // The handle belongs to this webview window. DWM reads a COLORREF
            // during the call. Older Windows versions keep the system theme
            // when the per-window palette attributes are unsupported.
            unsafe {
                DwmSetWindowAttribute(
                    handle,
                    attribute as u32,
                    (&value as *const u32).cast(),
                    std::mem::size_of::<u32>() as u32,
                );
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (
        window,
        dark,
        colors.map(|colors| (colors.caption, colors.text)),
    );
    Ok(())
}

#[cfg(windows)]
fn to_colorref(rgb: u32) -> u32 {
    ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)
}
