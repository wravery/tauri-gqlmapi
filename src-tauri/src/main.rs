#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

use gqlmapi_rs::*;
use std::{
  collections::BTreeMap,
  sync::{
    atomic::{AtomicI32, Ordering},
    mpsc, Arc, Mutex,
  },
  thread,
};
use tauri::{State, Window};

extern crate serde;
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
struct ResultPayload {
  results: Value,
}

#[derive(Serialize)]
struct PendingPayload {
  pending: i32,
}

#[derive(Serialize)]
struct NextPayload {
  next: Value,
  subscription: i32,
}

struct AppState {
  gqlmapi: MAPIGraphQL,
  next_subscription: AtomicI32,
  subscriptions: Arc<Mutex<BTreeMap<i32, Mutex<Subscription>>>>,
}

#[tauri::command]
fn fetch_query(
  window: Window,
  state: State<Mutex<AppState>>,
  query: String,
  operation_name: String,
  variables: String,
) -> Result<String, String> {
  let (tx_next, rx_next) = mpsc::channel();
  let (tx_complete, rx_complete) = mpsc::channel();

  let (key, subscriptions) = {
    let locked_state = state
      .lock()
      .map_err(|err| format!("Error locking mutex: {}", err))?;
    let parsed_query = locked_state.gqlmapi.parse_query(&query)?;
    let subscription =
      locked_state
        .gqlmapi
        .subscribe(parsed_query.clone(), &operation_name, &variables);

    {
      let mut locked_subscription = subscription
        .lock()
        .map_err(|err| format!("Error locking mutex: {}", err))?;
      locked_subscription.listen(tx_next, tx_complete)?;
    }

    let key = locked_state
      .next_subscription
      .fetch_add(1, Ordering::Relaxed);

    locked_state
      .subscriptions
      .lock()
      .map_err(|err| format!("Error locking mutex: {}", err))?
      .insert(key, subscription);

    (key, locked_state.subscriptions.clone())
  };

  match rx_complete.try_recv() {
    Ok(()) => {
      let result = rx_next.recv().map_or_else(
        |err| Err(format!("Error receiving payload: {}", err)),
        |results| {
          let payload = ResultPayload {
            results: serde_json::from_str(&results)
              .map_err(|err| format!("JSON error: {}", err))?,
          };
          serde_json::to_string(&payload).map_err(|err| format!("JSON error: {}", err))
        },
      );
      drop_subscription(key, &subscriptions)?;
      result
    }
    Err(_) => {
      thread::spawn::<_, Result<(), String>>(move || {
        loop {
          match rx_next
            .recv()
            .map_err(|err| format!("Error receiving payload: {}", err))
          {
            Ok(next) => {
              let payload = NextPayload {
                next: serde_json::from_str(&next).map_err(|err| format!("JSON error: {}", err))?,
                subscription: key,
              };
              window
                .emit(
                  "next",
                  serde_json::to_string(&payload)
                    .map_err(|err| format!("JSON error: {}", err))?
                    .as_str(),
                )
                .map_err(|err| format!("Tauri error: {}", err))?;
            }
            Err(_) => {
              break;
            }
          }
        }
        drop_subscription(key, &subscriptions)?;
        Ok(())
      });

      let payload = PendingPayload { pending: key };
      serde_json::to_string(&payload).map_err(|err| format!("JSON error: {}", err))
    }
  }
}

#[tauri::command]
fn unsubscribe(state: State<Mutex<AppState>>, subscription: i32) -> Result<(), String> {
  let locked_state = state
    .lock()
    .map_err(|err| format!("Error locking mutex: {}", err))?;
  drop_subscription(subscription, &locked_state.subscriptions)
}

fn drop_subscription(
  key: i32,
  subscriptions: &Mutex<BTreeMap<i32, Mutex<Subscription>>>,
) -> Result<(), String> {
  subscriptions
    .lock()
    .map_err(|err| format!("Error locking mutex: {}", err))?
    .remove(&key);
  Ok(())
}

fn main() {
  tauri::Builder::default()
    .manage(Mutex::new(AppState {
      gqlmapi: MAPIGraphQL::new(true),
      next_subscription: AtomicI32::new(1),
      subscriptions: Arc::new(Mutex::new(BTreeMap::new())),
    }))
    .invoke_handler(tauri::generate_handler![fetch_query, unsubscribe])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
