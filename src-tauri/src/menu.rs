//! macOS 메뉴 막대. 단축키는 메뉴에 걸어 두고, 누르면 화면에 `menu` 이벤트로 알린다.
//!
//! 기본 메뉴의 "윈도우 닫기(⌘W)"는 넣지 않는다. ⌘W는 앱 창이 아니라 세션 탭을 닫는다.

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accel: Option<&str>| MenuItem::with_id(app, id, text, true, accel);
    let sep = || PredefinedMenuItem::separator(app);

    let app_menu = Submenu::with_items(
        app,
        "DHost",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("DHost 정보"), Some(AboutMetadata::default()))?,
            &sep()?,
            &item("page.settings", "설정…", Some("CmdOrCtrl+,"))?,
            &sep()?,
            &PredefinedMenuItem::services(app, Some("서비스"))?,
            &sep()?,
            &PredefinedMenuItem::hide(app, Some("DHost 가리기"))?,
            &PredefinedMenuItem::hide_others(app, Some("기타 가리기"))?,
            &PredefinedMenuItem::show_all(app, Some("모두 보기"))?,
            &sep()?,
            &PredefinedMenuItem::quit(app, Some("DHost 종료"))?,
        ],
    )?;

    // 복사·붙여넣기는 이 메뉴가 있어야 웹뷰에서 동작한다.
    let edit = Submenu::with_items(
        app,
        "편집",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("실행 취소"))?,
            &PredefinedMenuItem::redo(app, Some("실행 복귀"))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, Some("오려두기"))?,
            &PredefinedMenuItem::copy(app, Some("복사하기"))?,
            &PredefinedMenuItem::paste(app, Some("붙여넣기"))?,
            &PredefinedMenuItem::select_all(app, Some("전체 선택"))?,
        ],
    )?;

    let tab_items: Vec<MenuItem<R>> = (1..=9)
        .map(|n| {
            let text = if n == 9 {
                "마지막 탭".to_string()
            } else {
                format!("{n}번째 탭")
            };
            item(&format!("tab.{n}"), &text, Some(&format!("CmdOrCtrl+{n}")))
        })
        .collect::<tauri::Result<_>>()?;
    let new_tab = item("tab.new", "새 탭(서버 검색)", Some("CmdOrCtrl+T"))?;
    let close_tab = item("tab.close", "탭 닫기", Some("CmdOrCtrl+W"))?;
    let next = item("tab.next", "다음 탭", Some("CmdOrCtrl+Shift+]"))?;
    let prev = item("tab.prev", "이전 탭", Some("CmdOrCtrl+Shift+["))?;
    let reconnect = item("tab.reconnect", "재접속", Some("CmdOrCtrl+R"))?;
    let reset = item("term.reset", "터미널 화면 초기화", None)?;
    let search = item("search", "서버 검색", Some("CmdOrCtrl+K"))?;
    let (s1, s2, s3) = (sep()?, sep()?, sep()?);
    let mut session_items: Vec<&dyn tauri::menu::IsMenuItem<R>> = vec![
        &new_tab, &search, &s1, &close_tab, &reconnect, &reset, &s2, &next, &prev, &s3,
    ];
    session_items.extend(tab_items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<R>));
    let session = Submenu::with_items(app, "세션", true, &session_items)?;

    let view = Submenu::with_items(
        app,
        "보기",
        true,
        &[
            &item("page.servers", "서버", None)?,
            &item("page.sessions", "세션", None)?,
            &item("page.history", "접속 이력", None)?,
            &item("page.hostkeys", "호스트 키", None)?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, Some("전체 화면"))?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        "윈도우",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("최소화"))?,
            &PredefinedMenuItem::maximize(app, Some("확대/축소"))?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &edit, &session, &view, &window])
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit("menu", id);
}
