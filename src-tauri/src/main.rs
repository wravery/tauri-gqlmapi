#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

use gqlmapi_rs::MAPIGraphQL;
use std::{sync::mpsc, thread};
use tauri::{State, Window};

#[tauri::command]
fn fetch_query(
  window: Window,
  state: State<MAPIGraphQL>,
  query: String,
  operation_name: String,
  variables: String,
) -> Result<String, String> {
  let (tx_next, rx_next) = mpsc::channel();
  let (tx_complete, rx_complete) = mpsc::channel();
  let query = state.parse_query(&query)?;
  let mut subscription = state.subscribe(&query, &operation_name, &variables);
  subscription.listen(tx_next, tx_complete)?;

  match rx_complete.try_recv() {
    Ok(()) => {
      Ok(format_results(Some(rx_next.recv().map_err(|err| {
        format!("Error receiving payload: {}", err)
      })?)))
    }
    Err(_) => {
      thread::spawn::<_, Result<(), String>>(move || loop {
        match rx_next
          .recv()
          .map_err(|err| format!("Error receiving payload: {}", err))
        {
          Ok(next) => window
            .emit("subscription", format_results(Some(next)))
            .map_err(|err| format!("Tauri error: {}", err))?,
          Err(_) => break Ok(()),
        }
      });
      Ok(format_results(None))
    }
  }
}

fn format_results(results: Option<String>) -> String {
  match results {
    Some(next) => {
      let mut payload = String::from(r#"{"results":"#);
      payload += &next;
      payload += r#"}"#;
      payload
    }
    None => String::from(r#"{"pending":true}"#),
  }
}

fn main() {
  tauri::Builder::default()
    .manage(MAPIGraphQL::new(true))
    .invoke_handler(tauri::generate_handler![fetch_query])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
