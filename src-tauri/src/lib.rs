use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::{
    collections::HashMap,
    env,
    fs,
    path::{Path, PathBuf},
    process::{self, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, Size, Theme, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use objc2_foundation::{NSProcessInfo, NSString};

const UPDATE_DOWNLOAD_EVENT: &str = "update-download-progress";

#[derive(Default)]
struct AppState {
    sessions: Mutex<HashMap<u64, SimulationSessionInternal>>,
    next_session_id: AtomicU64,
    locale: Mutex<String>,
    pending_launch_files: Mutex<Vec<String>>,
    startup_revealed: AtomicBool,
    startup_painted: AtomicBool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParseResult {
    file_path: String,
    file_name: String,
    extension: String,
    encoding: String,
    total_lines: usize,
    total_moves: usize,
    warnings: Vec<String>,
    content: String,
    lines: Vec<NcLine>,
    bounds: Bounds,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NcLine {
    number: usize,
    text: String,
    motion: Option<MotionType>,
    x: Option<f64>,
    y: Option<f64>,
    z: Option<f64>,
    feed: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum MotionType {
    Rapid,
    Linear,
    ArcCw,
    ArcCcw,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Bounds {
    min_x: f64,
    min_y: f64,
    min_z: f64,
    max_x: f64,
    max_y: f64,
    max_z: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MachineProfile {
    file_path: String,
    profile_type: String,
    post_name: String,
    machine_type: String,
    version: String,
    options: HashMap<String, String>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolLibrary {
    file_path: String,
    name: String,
    version: String,
    items: Vec<ToolItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolItem {
    index: usize,
    raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimulationConfig {
    program_lines: Vec<NcLine>,
    breakpoints: Vec<usize>,
    speed: SimulationSpeed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum SimulationSpeed {
    Low,
    Standard,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimulationSession {
    session_id: u64,
    frame_count: usize,
    current_index: usize,
    speed: SimulationSpeed,
    follow_tool: bool,
    current_line: usize,
    current_position: Vec3,
}

#[derive(Debug, Clone)]
struct SimulationSessionInternal {
    frames: Vec<FrameState>,
    current_index: usize,
    breakpoints: Vec<usize>,
    follow_tool: bool,
    camera: CameraState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StepSimulationRequest {
    session_id: u64,
    mode: StepMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum StepMode {
    Next,
    Prev,
    ToStart,
    ToEnd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrameState {
    index: usize,
    line_number: usize,
    position: Vec3,
    motion: Option<MotionType>,
    paused_by_breakpoint: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CameraState {
    target: Vec3,
    position: Vec3,
    zoom: f64,
    view_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Vec3 {
    x: f64,
    y: f64,
    z: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FollowState {
    session_id: u64,
    follow_tool: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportOptions {
    encoding: ExportEncoding,
    line_ending: LineEnding,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum ExportEncoding {
    Utf8,
    Utf8Bom,
    Ansi,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum LineEnding {
    Lf,
    CrLf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    path: String,
    bytes_written: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocaleState {
    locale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartupAppearance {
    resolved_theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NcFileItem {
    path: String,
    file_name: String,
    size_bytes: u64,
    created_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDownloadRequest {
    url: String,
    version: String,
    os: String,
    package_kind: Option<String>,
    file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreparedUpdatePackage {
    path: String,
    file_name: String,
    version: String,
    os: String,
    package_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDownloadProgressPayload {
    status: String,
    version: String,
    file_name: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<f64>,
    path: Option<String>,
    error: Option<String>,
}

fn read_text_auto(path: &Path) -> Result<(String, String), String> {
    let bytes = fs::read(path).map_err(|e| format!("failed to read file: {e}"))?;

    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let text = String::from_utf8(bytes[3..].to_vec())
            .map_err(|e| format!("failed to decode UTF-8 BOM file: {e}"))?;
        return Ok((text, "UTF-8 BOM".to_string()));
    }

    if let Ok(text) = String::from_utf8(bytes.clone()) {
        return Ok((text, "UTF-8".to_string()));
    }

    let (decoded, _, had_errors) = encoding_rs::GB18030.decode(&bytes);
    if !had_errors {
        return Ok((decoded.into_owned(), "GBK".to_string()));
    }

    Err("failed to decode file as UTF-8 or GBK".to_string())
}

#[tauri::command]
fn set_startup_appearance(
    appearance: StartupAppearance,
    app: tauri::AppHandle,
) -> Result<StartupAppearance, String> {
    write_startup_appearance(&app, &appearance)?;
    Ok(appearance)
}

#[tauri::command]
fn notify_startup_ready(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if state.startup_revealed.load(Ordering::SeqCst) {
        return Ok(());
    }
    reveal_main_window(&app, &state)
}

#[tauri::command]
fn notify_startup_boot_ready(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if let Some(splash) = app.get_webview_window("startup_splash") {
        let _ = splash.close();
    }

    if !state.startup_revealed.load(Ordering::SeqCst) {
        reveal_main_window(&app, &state)?;
    }

    Ok(())
}

#[tauri::command]
fn notify_startup_painted(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if state.startup_painted.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    if let Some(splash) = app.get_webview_window("startup_splash") {
        let _ = splash.close();
    }

    Ok(())
}

#[tauri::command]
fn open_nc_file(path: String) -> Result<ParseResult, String> {
    let file = PathBuf::from(&path);
    let (content, encoding) = read_text_auto(&file)?;
    let mut lines = Vec::new();
    let mut warnings = Vec::new();
    let mut current = Vec3::default();
    let mut min = Vec3 {
        x: f64::MAX,
        y: f64::MAX,
        z: f64::MAX,
    };
    let mut max = Vec3 {
        x: f64::MIN,
        y: f64::MIN,
        z: f64::MIN,
    };
    let mut move_count = 0;

    for (idx, raw_line) in content.lines().enumerate() {
        let cleaned = strip_comment(raw_line);
        let motion = detect_motion(&cleaned);
        let x = extract_axis(&cleaned, 'X');
        let y = extract_axis(&cleaned, 'Y');
        let z = extract_axis(&cleaned, 'Z');
        let feed = extract_axis(&cleaned, 'F');

        if let Some(v) = x {
            current.x = v;
        }
        if let Some(v) = y {
            current.y = v;
        }
        if let Some(v) = z {
            current.z = v;
        }

        if motion.is_some() {
            move_count += 1;
            min.x = min.x.min(current.x);
            min.y = min.y.min(current.y);
            min.z = min.z.min(current.z);
            max.x = max.x.max(current.x);
            max.y = max.y.max(current.y);
            max.z = max.z.max(current.z);
        }

        if cleaned.contains("M98") || cleaned.contains("G65") {
            warnings.push(format!("Line {} uses subprogram call; verify compatibility", idx + 1));
        }

        lines.push(NcLine {
            number: idx + 1,
            text: raw_line.to_string(),
            motion,
            x,
            y,
            z,
            feed,
        });
    }

    if move_count == 0 {
        min = Vec3::default();
        max = Vec3::default();
        warnings.push("No motion blocks detected.".to_string());
    }

    Ok(ParseResult {
        file_path: path.clone(),
        file_name: file
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string(),
        extension: file
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string(),
        encoding,
        total_lines: lines.len(),
        total_moves: move_count,
        warnings,
        content,
        lines,
        bounds: Bounds {
            min_x: min.x,
            min_y: min.y,
            min_z: min.z,
            max_x: max.x,
            max_y: max.y,
            max_z: max.z,
        },
    })
}

#[tauri::command]
fn load_machine_profile(path: String) -> Result<MachineProfile, String> {
    let content = fs::read_to_string(&path).map_err(|e| format!("failed to read profile: {e}"))?;
    let ini = parse_ini_like(&content);

    let post_name = ini
        .get("PostInfo")
        .and_then(|s| s.get("Name"))
        .cloned()
        .unwrap_or_else(|| "UNKNOWN".to_string());

    let machine_type = ini
        .get("PostInfo")
        .and_then(|s| s.get("McnType"))
        .cloned()
        .unwrap_or_else(|| "0".to_string());

    let version = ini
        .get("Info")
        .and_then(|s| s.get("Version"))
        .cloned()
        .unwrap_or_else(|| "0".to_string());

    let mut options = HashMap::new();
    if let Some(post_info) = ini.get("PostInfo") {
        for (k, v) in post_info {
            options.insert(k.clone(), v.clone());
        }
    }

    let profile_type = Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mdl")
        .to_lowercase();

    let warnings = if !matches!(profile_type.as_str(), "mdl" | "wdl" | "ldl") {
        vec!["Unknown profile extension; parser used compatibility mode.".to_string()]
    } else {
        vec![]
    };

    Ok(MachineProfile {
        file_path: path,
        profile_type,
        post_name,
        machine_type,
        version,
        options,
        warnings,
    })
}

#[tauri::command]
fn load_tool_library(path: String) -> Result<ToolLibrary, String> {
    let content = fs::read_to_string(&path).map_err(|e| format!("failed to read tool file: {e}"))?;
    let ini = parse_ini_like(&content);
    let version = ini
        .get("Info")
        .and_then(|s| s.get("Version"))
        .cloned()
        .unwrap_or_else(|| "0".to_string());

    let mut items = vec![];
    if let Some(tools) = ini.get("Tools") {
        for (k, v) in tools {
            if let Some(raw_idx) = k.strip_prefix("Item") {
                if let Ok(index) = raw_idx.parse::<usize>() {
                    items.push(ToolItem {
                        index,
                        raw: v.clone(),
                    });
                }
            }
        }
    }
    items.sort_by_key(|t| t.index);

    Ok(ToolLibrary {
        file_path: path,
        name: "ToolLibrary".to_string(),
        version,
        items,
    })
}

#[tauri::command]
fn start_simulation(config: SimulationConfig, state: tauri::State<'_, AppState>) -> Result<SimulationSession, String> {
    if config.program_lines.is_empty() {
        return Err("program_lines is empty".to_string());
    }

    let frames = build_frames(&config.program_lines, &config.breakpoints);
    let session_id = state.next_session_id.fetch_add(1, Ordering::Relaxed) + 1;
    let first_frame = frames.first().cloned().ok_or_else(|| "No frames generated".to_string())?;

    let internal = SimulationSessionInternal {
        frames,
        current_index: 0,
        breakpoints: config.breakpoints,
        follow_tool: false,
        camera: CameraState {
            target: first_frame.position.clone(),
            position: Vec3 {
                x: first_frame.position.x + 120.0,
                y: first_frame.position.y + 120.0,
                z: first_frame.position.z + 120.0,
            },
            zoom: 1.0,
            view_name: "Iso".to_string(),
        },
    };

    state
        .sessions
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?
        .insert(session_id, internal);

    Ok(SimulationSession {
        session_id,
        frame_count: build_frames(&config.program_lines, &[]).len(),
        current_index: 0,
        speed: config.speed,
        follow_tool: false,
        current_line: first_frame.line_number,
        current_position: first_frame.position,
    })
}

#[tauri::command]
fn step_simulation(request: StepSimulationRequest, state: tauri::State<'_, AppState>) -> Result<FrameState, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let session = sessions
        .get_mut(&request.session_id)
        .ok_or_else(|| "session not found".to_string())?;

    let len = session.frames.len();
    if len == 0 {
        return Err("empty session".to_string());
    }

    session.current_index = match request.mode {
        StepMode::Next => (session.current_index + 1).min(len - 1),
        StepMode::Prev => session.current_index.saturating_sub(1),
        StepMode::ToStart => 0,
        StepMode::ToEnd => len - 1,
    };

    let mut frame = session.frames[session.current_index].clone();
    frame.paused_by_breakpoint = session.breakpoints.contains(&frame.line_number);

    if session.follow_tool {
        session.camera.target = frame.position.clone();
    }

    Ok(frame)
}

#[tauri::command]
fn set_camera(session_id: u64, camera_state: CameraState, state: tauri::State<'_, AppState>) -> Result<CameraState, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;

    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "session not found".to_string())?;

    session.camera = camera_state.clone();
    Ok(camera_state)
}

#[tauri::command]
fn set_named_view(session_id: u64, view_name: String, state: tauri::State<'_, AppState>) -> Result<CameraState, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "session not found".to_string())?;

    let current = session.frames[session.current_index].position.clone();
    let camera = named_view_camera(&view_name, current);
    session.camera = camera.clone();
    Ok(camera)
}

#[tauri::command]
fn toggle_camera_follow_tool(session_id: u64, enabled: bool, state: tauri::State<'_, AppState>) -> Result<FollowState, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;

    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "session not found".to_string())?;

    session.follow_tool = enabled;
    Ok(FollowState {
        session_id,
        follow_tool: enabled,
    })
}

#[tauri::command]
fn export_nc_file(path: String, content: String, export_options: ExportOptions) -> Result<ExportResult, String> {
    let normalized = match export_options.line_ending {
        LineEnding::Lf => content.replace("\r\n", "\n"),
        LineEnding::CrLf => content.replace("\r\n", "\n").replace('\n', "\r\n"),
    };

    let bytes = match export_options.encoding {
        ExportEncoding::Utf8 => normalized.into_bytes(),
        ExportEncoding::Utf8Bom => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(normalized.as_bytes());
            out
        }
        ExportEncoding::Ansi => {
            let (cow, _, _) = encoding_rs::GBK.encode(&normalized);
            cow.into_owned()
        }
    };

    fs::write(&path, &bytes).map_err(|e| format!("failed to export file: {e}"))?;
    Ok(ExportResult {
        path,
        bytes_written: bytes.len(),
    })
}

#[tauri::command]
fn set_locale(locale: String, state: tauri::State<'_, AppState>) -> Result<LocaleState, String> {
    let mut lock = state
        .locale
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    *lock = locale.clone();
    Ok(LocaleState { locale })
}

fn startup_appearance_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create app config dir: {e}"))?;
    Ok(dir.join("startup-appearance.json"))
}

fn read_startup_appearance<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<StartupAppearance> {
    let path = startup_appearance_path(app).ok()?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<StartupAppearance>(&content).ok()
}

fn write_startup_appearance<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    appearance: &StartupAppearance,
) -> Result<(), String> {
    let path = startup_appearance_path(app)?;
    let content = serde_json::to_vec_pretty(appearance)
        .map_err(|e| format!("failed to serialize startup appearance: {e}"))?;
    fs::write(path, content).map_err(|e| format!("failed to write startup appearance: {e}"))
}

fn startup_theme_background(theme: &str) -> tauri::webview::Color {
    match theme {
        "dark" => tauri::webview::Color(0, 0, 0, 255),
        "navy" => tauri::webview::Color(2, 6, 23, 255),
        _ => tauri::webview::Color(238, 242, 247, 255),
    }
}

fn startup_theme_window_theme(theme: &str) -> Option<Theme> {
    match theme {
        "dark" | "navy" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        _ => None,
    }
}

fn startup_splash_path(theme: &str) -> String {
    format!("startup-splash.html?theme={theme}&transparent=1")
}

fn startup_splash_window_background() -> tauri::webview::Color {
    tauri::webview::Color(0, 0, 0, 0)
}

fn position_window_centered(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    width: f64,
    height: f64,
) {
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let monitor_pos = monitor.position();
        let monitor_size = monitor.size();
        let scale = monitor.scale_factor().max(1.0);
        let logical_width = monitor_size.width as f64 / scale;
        let logical_height = monitor_size.height as f64 / scale;
        let centered_x = monitor_pos.x as f64 / scale + ((logical_width - width) * 0.5).max(0.0);
        let centered_y = monitor_pos.y as f64 / scale + ((logical_height - height) * 0.5).max(0.0);
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
            centered_x,
            centered_y,
        )));
    } else {
        let _ = window.center();
    }
}

fn show_startup_splash(app: &tauri::AppHandle, theme: &str) -> Result<(), String> {
    if app.get_webview_window("startup_splash").is_some() {
        return Ok(());
    }
    let splash_width = 760.0;
    let splash_height = 500.0;

    let splash = WebviewWindowBuilder::new(
        app,
        "startup_splash",
        WebviewUrl::App(startup_splash_path(theme).into()),
    )
      .title("First NC")
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .focused(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .visible(false)
    .inner_size(splash_width, splash_height)
    .background_color(startup_splash_window_background())
    .theme(startup_theme_window_theme(theme))
    .build()
    .map_err(|e| format!("failed to build startup splash: {e}"))?;

    let _ = splash.set_background_color(Some(startup_splash_window_background()));
    let _ = splash.set_theme(startup_theme_window_theme(theme));
    position_window_centered(app, &splash, splash_width, splash_height);
    let _ = splash.show();
    Ok(())
}

fn reveal_main_window(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, AppState>,
) -> Result<(), String> {
    if state.startup_revealed.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window unavailable".to_string())?;
    window
        .show()
        .map_err(|e| format!("failed to show main window: {e}"))?;
    let _ = window.set_focus();
    Ok(())
}

fn apply_adaptive_window_size(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let min_width = 980.0;
    let min_height = 640.0;
    let _ = window.set_min_size(Some(Size::Logical(tauri::LogicalSize::new(
        min_width, min_height,
    ))));
    let _ = window.set_fullscreen(false);
    let _ = window.unmaximize();

    if let Ok(Some(monitor)) = window.current_monitor() {
        let monitor_size = monitor.size();
        let scale = monitor.scale_factor().max(1.0);
        let logical_w = monitor_size.width as f64 / scale;
        let logical_h = monitor_size.height as f64 / scale;

        let max_w = (logical_w - 120.0).max(min_width);
        let max_h = (logical_h - 120.0).max(min_height);
        let target_w = (logical_w * 0.74).clamp(min_width, max_w);
        let target_h = (logical_h * 0.78).clamp(min_height, max_h);

        let _ = window.set_size(Size::Logical(tauri::LogicalSize::new(target_w, target_h)));
    }

    let _ = window.center();
}

#[tauri::command]
fn list_nc_files_in_folder(folder_path: String) -> Result<Vec<NcFileItem>, String> {
    let mut files: Vec<NcFileItem> = fs::read_dir(&folder_path)
        .map_err(|e| format!("failed to read folder: {e}"))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if !(path.is_file()
                && path
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "nc" | "anc"))
                    .unwrap_or(false))
            {
                return None;
            }

            let metadata = entry.metadata().ok()?;
            let created = metadata
                .created()
                .or_else(|_| metadata.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let path_str = path.to_str()?.to_string();
            let file_name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();

            Some(NcFileItem {
                path: path_str,
                file_name,
                size_bytes: metadata.len(),
                created_at_ms: created,
            })
        })
        .collect();

    files.sort_by_key(|item| item.file_name.to_lowercase());

    Ok(files)
}

#[tauri::command]
fn get_launch_nc_file() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .filter_map(|arg| normalize_launch_arg_to_file(arg.to_string_lossy().as_ref()))
        .find_map(|path| path.to_str().map(|s| s.to_string()))
}

#[tauri::command]
fn take_pending_launch_nc_files(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut lock = state
        .pending_launch_files
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    Ok(std::mem::take(&mut *lock))
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("unsupported url scheme".to_string()),
    }

    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open")
        .arg(parsed.as_str())
        .status()
        .map_err(|e| format!("failed to open url: {e}"))?;

    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("cmd")
        .args(["/C", "start", "", parsed.as_str()])
        .status()
        .map_err(|e| format!("failed to open url: {e}"))?;

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = std::process::Command::new("xdg-open")
        .arg(parsed.as_str())
        .status()
        .map_err(|e| format!("failed to open url: {e}"))?;

    if !status.success() {
        return Err(format!("failed to open url, exit status: {status}"));
    }

    Ok(())
}

#[tauri::command]
async fn download_update_package(
    request: UpdateDownloadRequest,
    app: tauri::AppHandle,
) -> Result<PreparedUpdatePackage, String> {
    let parsed = url::Url::parse(&request.url).map_err(|e| format!("invalid url: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("unsupported url scheme".to_string()),
    }

    let file_name = resolve_update_file_name(&parsed, &request);
    let updates_dir = update_download_dir(&app)?;
    let package_path = updates_dir.join(&file_name);
    let temp_path = package_path.with_extension(format!(
        "{}.part",
        package_path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("download")
    ));

    let _ = app.emit(
        UPDATE_DOWNLOAD_EVENT,
        UpdateDownloadProgressPayload {
            status: "started".to_string(),
            version: request.version.clone(),
            file_name: file_name.clone(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: Some(0.0),
            path: None,
            error: None,
        },
    );

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("failed to create update client: {e}"))?;
    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("failed to download update: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("update download failed with status {}", response.status()));
    }

    let total_bytes = response.content_length();
    let mut stream = response.bytes_stream();
    let mut downloaded_bytes = 0u64;
    let mut file =
        fs::File::create(&temp_path).map_err(|e| format!("failed to create update file: {e}"))?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("failed to stream update: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("failed to write update file: {e}"))?;
        downloaded_bytes += chunk.len() as u64;

        let percent = total_bytes.and_then(|total| {
            if total == 0 {
                None
            } else {
                Some((downloaded_bytes as f64 / total as f64) * 100.0)
            }
        });

        let _ = app.emit(
            UPDATE_DOWNLOAD_EVENT,
            UpdateDownloadProgressPayload {
                status: "progress".to_string(),
                version: request.version.clone(),
                file_name: file_name.clone(),
                downloaded_bytes,
                total_bytes,
                percent,
                path: None,
                error: None,
            },
        );
    }

    file.flush()
        .map_err(|e| format!("failed to finalize update file: {e}"))?;
    drop(file);
    fs::rename(&temp_path, &package_path)
        .map_err(|e| format!("failed to move update file into place: {e}"))?;

    let prepared = PreparedUpdatePackage {
        path: package_path
            .to_str()
            .ok_or_else(|| "invalid update file path".to_string())?
            .to_string(),
        file_name: file_name.clone(),
        version: request.version.clone(),
        os: request.os.clone(),
        package_kind: normalize_update_package_kind(request.package_kind.as_deref()),
    };

    let _ = app.emit(
        UPDATE_DOWNLOAD_EVENT,
        UpdateDownloadProgressPayload {
            status: "finished".to_string(),
            version: request.version,
            file_name,
            downloaded_bytes,
            total_bytes,
            percent: Some(100.0),
            path: Some(prepared.path.clone()),
            error: None,
        },
    );

    Ok(prepared)
}

#[tauri::command]
fn launch_prepared_update(package_path: String, app: tauri::AppHandle) -> Result<(), String> {
    let path = PathBuf::from(&package_path);
    if !path.is_file() {
        return Err("prepared update package is missing".to_string());
    }

    if is_in_app_update_package(&path) {
        spawn_standalone_updater(&path, &app)?;
        app.exit(0);
        return Ok(());
    }

    launch_interactive_update_package(&path)?;
    app.exit(0);
    Ok(())
}

fn resolve_update_file_name(parsed: &url::Url, request: &UpdateDownloadRequest) -> String {
    if let Some(explicit) = request
        .file_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return sanitize_update_file_name(explicit);
    }

    if let Some(last) = parsed
        .path_segments()
        .and_then(|segments| segments.filter(|segment| !segment.is_empty()).last())
    {
        let decoded = percent_decode_path_segment(last);
        if has_supported_update_extension(&decoded) {
            return sanitize_update_file_name(&decoded);
        }
    }

    infer_update_package_file_name(
        &request.version,
        &request.os,
        normalize_update_package_kind(request.package_kind.as_deref()),
    )
}

fn sanitize_update_file_name(input: &str) -> String {
    let filtered: String = input
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
        .collect();
    if filtered.is_empty() {
        "first-nc-update.bin".to_string()
    } else {
        filtered
    }
}

fn has_supported_update_extension(input: &str) -> bool {
    let lower = input.to_ascii_lowercase();
    [".msi", ".exe", ".deb", ".dmg", ".app", ".tar.gz"]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
}

fn normalize_update_package_kind(value: Option<&str>) -> String {
    match value.unwrap_or("installer").trim().to_ascii_lowercase().as_str() {
        "in_app_update" => "in_app_update".to_string(),
        _ => "installer".to_string(),
    }
}

fn infer_update_package_file_name(version: &str, os: &str, package_kind: String) -> String {
    if package_kind == "in_app_update" {
        return format!("first-nc-{version}-{os}-in-app-update.tar.gz");
    }
    let extension = match os.to_ascii_lowercase().as_str() {
        "windows" => "exe",
        "ubuntu" => "deb",
        _ => "dmg",
    };
    format!("first-nc-{version}-{os}-installer.{extension}")
}

fn is_in_app_update_package(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase().ends_with(".tar.gz"))
        .unwrap_or(false)
}

fn launch_interactive_update_package(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = Command::new("open")
        .arg(path.as_os_str())
        .status()
        .map_err(|e| format!("failed to launch update package: {e}"))?;

    #[cfg(target_os = "windows")]
    let status = Command::new("cmd")
        .args(["/C", "start", ""])
        .arg(path.as_os_str())
        .status()
        .map_err(|e| format!("failed to launch update package: {e}"))?;

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open")
        .arg(path.as_os_str())
        .status()
        .map_err(|e| format!("failed to launch update package: {e}"))?;

    if !status.success() {
        return Err(format!("failed to launch update package, exit status: {status}"));
    }

    Ok(())
}

fn percent_decode_path_segment(input: &str) -> String {
    let mut out = String::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = bytes[i + 1] as char;
            let lo = bytes[i + 2] as char;
            if let Ok(value) = u8::from_str_radix(&format!("{hi}{lo}"), 16) {
                out.push(value as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn update_download_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .join("updates");
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create update dir: {e}"))?;
    Ok(dir)
}

fn spawn_standalone_updater<R: tauri::Runtime>(
    package_path: &Path,
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let current_exe = env::current_exe().map_err(|e| format!("failed to resolve current executable: {e}"))?;
    let updates_dir = update_download_dir(app)?;
    let temp_updater_path = updates_dir.join(temp_updater_name());
    let _ = fs::remove_file(&temp_updater_path);
    fs::copy(&current_exe, &temp_updater_path)
        .map_err(|e| format!("failed to stage updater executable: {e}"))?;
    ensure_executable_permissions(&temp_updater_path)?;

    let target_path = resolve_update_target_path(&current_exe)?;
    let restart_path = resolve_restart_path(&current_exe)?;

    Command::new(&temp_updater_path)
        .arg("--apply-update")
        .arg("--parent-pid")
        .arg(process::id().to_string())
        .arg("--package-path")
        .arg(package_path)
        .arg("--target-path")
        .arg(target_path)
        .arg("--restart-path")
        .arg(restart_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to launch standalone updater: {e}"))?;

    Ok(())
}

fn temp_updater_name() -> String {
    #[cfg(target_os = "windows")]
    {
        return format!("first-nc-updater-{}.exe", process::id());
    }

    #[cfg(not(target_os = "windows"))]
    {
        format!("first-nc-updater-{}", process::id())
    }
}

fn resolve_update_target_path(current_exe: &Path) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        return current_app_bundle_path(current_exe);
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(current_exe.to_path_buf())
    }
}

fn resolve_restart_path(current_exe: &Path) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let bundle_path = current_app_bundle_path(current_exe)?;
        return Ok(bundle_path
            .join("Contents")
            .join("MacOS")
            .join(
                current_exe
                    .file_name()
                    .ok_or_else(|| "missing executable name".to_string())?,
            ));
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(current_exe.to_path_buf())
    }
}

#[cfg(target_os = "macos")]
fn current_app_bundle_path(current_exe: &Path) -> Result<PathBuf, String> {
    current_exe
        .ancestors()
        .find(|ancestor| {
            ancestor
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("app"))
                .unwrap_or(false)
        })
        .map(Path::to_path_buf)
        .ok_or_else(|| "failed to resolve installed app bundle path".to_string())
}

#[cfg(not(target_os = "windows"))]
fn ensure_executable_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)
        .map_err(|e| format!("failed to read updater permissions: {e}"))?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)
        .map_err(|e| format!("failed to mark updater executable: {e}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn ensure_executable_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn maybe_run_updater_mode() -> Result<bool, String> {
    let mut args = env::args_os().skip(1);
    let Some(first) = args.next() else {
        return Ok(false);
    };
    if first != "--apply-update" {
        return Ok(false);
    }

    let mut parent_pid: Option<u32> = None;
    let mut package_path: Option<PathBuf> = None;
    let mut target_path: Option<PathBuf> = None;
    let mut restart_path: Option<PathBuf> = None;

    while let Some(flag) = args.next() {
        match flag.to_string_lossy().as_ref() {
            "--parent-pid" => {
                parent_pid = args
                    .next()
                    .and_then(|value| value.to_string_lossy().parse::<u32>().ok());
            }
            "--package-path" => package_path = args.next().map(PathBuf::from),
            "--target-path" => target_path = args.next().map(PathBuf::from),
            "--restart-path" => restart_path = args.next().map(PathBuf::from),
            _ => {}
        }
    }

    run_standalone_updater(
        parent_pid.ok_or_else(|| "missing updater parent pid".to_string())?,
        package_path.ok_or_else(|| "missing updater package path".to_string())?,
        target_path.ok_or_else(|| "missing updater target path".to_string())?,
        restart_path.ok_or_else(|| "missing updater restart path".to_string())?,
    )?;
    Ok(true)
}

fn run_standalone_updater(
    parent_pid: u32,
    package_path: PathBuf,
    target_path: PathBuf,
    restart_path: PathBuf,
) -> Result<(), String> {
    wait_for_process_exit(parent_pid);

    let work_dir = env::temp_dir().join(format!("first-nc-update-{}", process::id()));
    if work_dir.exists() {
        fs::remove_dir_all(&work_dir).map_err(|e| format!("failed to reset update workspace: {e}"))?;
    }
    fs::create_dir_all(&work_dir).map_err(|e| format!("failed to create update workspace: {e}"))?;

    extract_tar_archive(&package_path, &work_dir)?;
    apply_extracted_update(&work_dir, &target_path, &restart_path)?;
    restart_updated_application(&target_path, &restart_path)?;

    let _ = fs::remove_file(&package_path);
    Ok(())
}

fn wait_for_process_exit(parent_pid: u32) {
    for _ in 0..300 {
        if !process_is_running(parent_pid) {
            break;
        }
        thread::sleep(Duration::from_millis(250));
    }
    thread::sleep(Duration::from_millis(500));
}

#[cfg(target_os = "windows")]
fn process_is_running(pid: u32) -> bool {
    Command::new("cmd")
        .args(["/C", "tasklist", "/FI", &format!("PID eq {pid}")])
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn process_is_running(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn extract_tar_archive(package_path: &Path, output_dir: &Path) -> Result<(), String> {
    let status = Command::new("tar")
        .args(["-xzf"])
        .arg(package_path)
        .args(["-C"])
        .arg(output_dir)
        .status()
        .map_err(|e| format!("failed to extract update package: {e}"))?;
    if !status.success() {
        return Err(format!("failed to extract update package, exit status: {status}"));
    }
    Ok(())
}

fn apply_extracted_update(
    extracted_root: &Path,
    target_path: &Path,
    restart_path: &Path,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = restart_path;
        return replace_app_bundle(extracted_root, target_path);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let replacement = find_replacement_binary(extracted_root, restart_path)?;
        return replace_single_file(&replacement, target_path);
    }
}

#[cfg(target_os = "macos")]
fn replace_app_bundle(extracted_root: &Path, target_path: &Path) -> Result<(), String> {
    let replacement = fs::read_dir(extracted_root)
        .map_err(|e| format!("failed to inspect extracted update bundle: {e}"))?
        .filter_map(|entry| entry.ok().map(|value| value.path()))
        .find(|path| {
            path.extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("app"))
                .unwrap_or(false)
        })
        .ok_or_else(|| "missing app bundle in extracted update package".to_string())?;

    let backup_path = target_path.with_extension("app.old");
    let _ = fs::remove_dir_all(&backup_path);
    if target_path.exists() {
        fs::rename(target_path, &backup_path)
            .map_err(|e| format!("failed to move old app bundle aside: {e}"))?;
    }
    fs::rename(&replacement, target_path)
        .map_err(|e| format!("failed to activate new app bundle: {e}"))?;
    let _ = fs::remove_dir_all(&backup_path);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn find_replacement_binary(extracted_root: &Path, restart_path: &Path) -> Result<PathBuf, String> {
    let target_name = restart_path
        .file_name()
        .ok_or_else(|| "missing restart executable name".to_string())?;
    find_named_file_recursive(extracted_root, target_name)
        .ok_or_else(|| "missing replacement executable in extracted update package".to_string())
}

#[cfg(not(target_os = "macos"))]
fn replace_single_file(source: &Path, target_path: &Path) -> Result<(), String> {
    let parent = target_path
        .parent()
        .ok_or_else(|| "missing target parent directory".to_string())?;
    let target_name = target_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "invalid target file name".to_string())?;
    let staged_target = parent.join(format!("{target_name}.new"));
    let backup_path = parent.join(format!(
        "{}.old",
        target_name
    ));
    let _ = fs::remove_file(&backup_path);
    fs::copy(source, &staged_target).map_err(|e| format!("failed to stage replacement executable: {e}"))?;
    ensure_executable_permissions(&staged_target)?;
    if target_path.exists() {
        fs::rename(target_path, &backup_path)
            .map_err(|e| format!("failed to move old executable aside: {e}"))?;
    }
    if staged_target != target_path {
        fs::rename(&staged_target, target_path)
            .map_err(|e| format!("failed to activate replacement executable: {e}"))?;
    }
    let _ = fs::remove_file(&backup_path);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn find_named_file_recursive(root: &Path, target_name: &std::ffi::OsStr) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_named_file_recursive(&path, target_name) {
                return Some(found);
            }
            continue;
        }
        if path.file_name() == Some(target_name) {
            return Some(path);
        }
    }
    None
}

fn restart_updated_application(target_path: &Path, restart_path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = restart_path;
        let status = Command::new("open")
            .arg(target_path)
            .status()
            .map_err(|e| format!("failed to relaunch app bundle: {e}"))?;
        if !status.success() {
            return Err(format!("failed to relaunch app bundle, exit status: {status}"));
        }
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Command::new(restart_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("failed to relaunch updated app: {e}"))?;
        Ok(())
    }
}

fn normalize_launch_arg_to_file(raw: &str) -> Option<PathBuf> {
    let arg = raw.trim();
    if arg.is_empty() {
        return None;
    }
    // macOS process serial argument, not a file path.
    if arg.starts_with("-psn_") {
        return None;
    }

    let path = if arg.starts_with("file://") {
        let url = url::Url::parse(arg).ok()?;
        url.to_file_path().ok()?
    } else {
        PathBuf::from(arg)
    };

    if !path.is_file() {
        return None;
    }

    Some(path)
}

fn collect_launch_paths_from_args() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .filter_map(|arg| normalize_launch_arg_to_file(arg.to_string_lossy().as_ref()))
        .filter_map(|path| path.to_str().map(|s| s.to_string()))
        .collect()
}

#[cfg(target_os = "macos")]
fn normalize_opened_url_to_file(url: &url::Url) -> Option<String> {
    let path = url.to_file_path().ok()?;
    if !path.is_file() {
        return None;
    }
    path.to_str().map(|s| s.to_string())
}


fn strip_comment(line: &str) -> String {
    let mut no_paren = String::new();
    let mut in_paren = false;
    for c in line.chars() {
        if c == '(' {
            in_paren = true;
            continue;
        }
        if c == ')' {
            in_paren = false;
            continue;
        }
        if !in_paren {
            no_paren.push(c);
        }
    }

    no_paren
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_uppercase()
}

fn detect_motion(line: &str) -> Option<MotionType> {
    if line.contains("G00") || line.contains("G0 ") {
        Some(MotionType::Rapid)
    } else if line.contains("G01") || line.contains("G1 ") {
        Some(MotionType::Linear)
    } else if line.contains("G02") || line.contains("G2 ") {
        Some(MotionType::ArcCw)
    } else if line.contains("G03") || line.contains("G3 ") {
        Some(MotionType::ArcCcw)
    } else {
        None
    }
}

fn extract_axis(line: &str, axis: char) -> Option<f64> {
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == axis {
            let mut number = String::new();
            while let Some(next) = chars.peek() {
                if next.is_ascii_digit() || *next == '.' || *next == '-' || *next == '+' {
                    number.push(*next);
                    chars.next();
                } else {
                    break;
                }
            }
            if !number.is_empty() {
                if let Ok(v) = number.parse::<f64>() {
                    return Some(v);
                }
            }
        }
    }
    None
}

fn build_frames(lines: &[NcLine], breakpoints: &[usize]) -> Vec<FrameState> {
    let mut frames = Vec::new();
    let mut current = Vec3::default();

    for line in lines {
        if let Some(v) = line.x {
            current.x = v;
        }
        if let Some(v) = line.y {
            current.y = v;
        }
        if let Some(v) = line.z {
            current.z = v;
        }

        if line.motion.is_some() {
            frames.push(FrameState {
                index: frames.len(),
                line_number: line.number,
                position: current.clone(),
                motion: line.motion.clone(),
                paused_by_breakpoint: breakpoints.contains(&line.number),
            });
        }
    }

    if frames.is_empty() {
        frames.push(FrameState {
            index: 0,
            line_number: 1,
            position: Vec3::default(),
            motion: None,
            paused_by_breakpoint: false,
        });
    }

    frames
}

fn named_view_camera(view_name: &str, target: Vec3) -> CameraState {
    let (dx, dy, dz) = match view_name.to_lowercase().as_str() {
        "top" => (0.0, 0.0, 180.0),
        "front" => (0.0, 180.0, 0.0),
        "left" => (180.0, 0.0, 0.0),
        "lathe" => (150.0, -80.0, 50.0),
        _ => (120.0, 120.0, 120.0),
    };

    CameraState {
        target: target.clone(),
        position: Vec3 {
            x: target.x + dx,
            y: target.y + dy,
            z: target.z + dz,
        },
        zoom: 1.0,
        view_name: view_name.to_string(),
    }
}

fn parse_ini_like(content: &str) -> HashMap<String, HashMap<String, String>> {
    let mut out: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut section = "default".to_string();

    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }

        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].to_string();
            continue;
        }

        if let Some((k, v)) = line.split_once('=') {
            out.entry(section.clone()).or_default().insert(
                k.trim().to_string(),
                v.trim().trim_matches('"').to_string(),
            );
        }
    }

    out
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    match maybe_run_updater_mode() {
        Ok(true) => return,
        Ok(false) => {}
        Err(error) => panic!("standalone updater failed: {error}"),
    }

    #[cfg(target_os = "macos")]
    apply_macos_process_name();

    let initial_launch_files = collect_launch_paths_from_args();

    tauri::Builder::default()
        .manage(AppState {
            sessions: Mutex::new(HashMap::new()),
            next_session_id: AtomicU64::new(0),
            locale: Mutex::new("zh-CN".to_string()),
            pending_launch_files: Mutex::new(initial_launch_files),
            startup_revealed: AtomicBool::new(false),
            startup_painted: AtomicBool::new(false),
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            app.handle().plugin(tauri_plugin_dialog::init())?;
            apply_adaptive_window_size(app);
            if let Some(main_window) = app.get_webview_window("main") {
                let appearance = read_startup_appearance(app.handle()).unwrap_or(StartupAppearance {
                    resolved_theme: "light".to_string(),
                });
                let _ = main_window.set_background_color(Some(startup_theme_background(&appearance.resolved_theme)));
                let _ = main_window.set_theme(startup_theme_window_theme(&appearance.resolved_theme));
                show_startup_splash(app.handle(), &appearance.resolved_theme)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_startup_appearance,
            notify_startup_ready,
            notify_startup_boot_ready,
            notify_startup_painted,
            open_nc_file,
            load_machine_profile,
            load_tool_library,
            start_simulation,
            step_simulation,
            set_camera,
            set_named_view,
            toggle_camera_follow_tool,
            export_nc_file,
            set_locale,
            list_nc_files_in_folder,
            get_launch_nc_file,
            take_pending_launch_nc_files,
            open_external_url,
            download_update_package,
            launch_prepared_update
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(not(target_os = "macos"))]
            let _ = (&app, &event);
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let files: Vec<String> = urls
                    .iter()
                    .filter_map(normalize_opened_url_to_file)
                    .collect();
                if files.is_empty() {
                    return;
                }

                if let Ok(mut pending) = app.state::<AppState>().pending_launch_files.lock() {
                    pending.extend(files.iter().cloned());
                }

                for path in files {
                    let _ = app.emit("launch-nc-file", path);
                }
            }
        });
}

#[cfg(target_os = "macos")]
fn apply_macos_process_name() {
    let process_name = NSString::from_str("First NC");
    let process_info = NSProcessInfo::processInfo();
    process_info.setProcessName(&process_name);
}
