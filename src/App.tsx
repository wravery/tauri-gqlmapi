import React from "react";
import { ExecutionResult } from "graphql";
import GraphiQL from "graphiql";
import {
  Fetcher,
  FetcherResult,
  Observable,
  Unsubscribable,
} from "@graphiql/toolkit";
import "graphiql/graphiql.css";
import { useEffect } from "react";
import "./App.css";

import { invoke, window as tauriWindow } from "@tauri-apps/api";

const App: React.FC<any> = () => {
  let _observableId = 0;

  interface FetchQueryObserver {
    next: (value: ExecutionResult) => void;
    error?: (error: any) => void;
    complete?: () => void;
  }

  interface Subscription extends Unsubscribable {
    observer: FetchQueryObserver | ((value: FetcherResult) => void);
    observerId: number;
  }

  interface FetchQueryObservable extends Observable<ExecutionResult> {
    unsubscribed: boolean;
    subscriptionKey: number;
    observableId: number;
    observerId: number;
    subscriptions: Subscription[];

    onUnsubscribe: () => void;
    onNext: (response: ExecutionResult) => void;
    onError: (error: string) => void;
    onComplete: () => void;
  }

  let _observables: FetchQueryObservable[] = [];

  useEffect(() => {
    const unlisten = tauriWindow.getCurrent().listen<any>("next", (event) => {
      const payload = event.payload && JSON.parse(event.payload);
      if (payload.next) {
        _observables
          .filter(
            (observable) => observable.subscriptionKey === payload.subscription
          )
          .forEach((observable) => observable.onNext(payload.next));
      }
    });

    return () => {
      unlisten.then((callback) => {
        callback();
      });
    };
  });

  const fetchQuery: Fetcher = ({ query, operationName, variables }) => {
    if (query === undefined) {
      return Promise.reject("undefined query!");
    }

    operationName = operationName || "";
    variables = variables ? JSON.stringify(variables) : "";

    // console.log(`Query: ${query}`);
    // console.log(`Operation: ${operationName}`);
    // console.log(`Variables: ${variables}`);

    const observable: FetchQueryObservable = {
      unsubscribed: false,
      subscriptionKey: 0,
      observableId: _observableId++,
      observerId: 0,
      subscriptions: [],

      subscribe: (observer) => {
        const observerId = observable.observerId++;
        const subscription = {
          observer,
          observerId,

          unsubscribe: () => {
            observable.subscriptions = observable.subscriptions.filter(
              (subscription) => subscription.observerId !== observerId
            );
            observable.onUnsubscribe();
          },
        } as Subscription;

        observable.subscriptions.push(subscription);
        return subscription;
      },

      onUnsubscribe: () => {
        if (observable.subscriptions.length === 0) {
          observable.unsubscribed = true;
          _observables = _observables.filter(
            (entry) => observable.observableId !== entry.observableId
          );
          invoke("unsubscribe", { subscription: observable.subscriptionKey });
        }
      },

      onNext: (response: ExecutionResult) => {
        observable.subscriptions.forEach((subscription) => {
          if (
            typeof subscription.observer === "object" &&
            subscription.observer.next
          ) {
            subscription.observer.next(response);
          }
        });
      },

      onError: (error: string) => {
        observable.subscriptions.forEach((subscription) => {
          if (
            typeof subscription.observer === "object" &&
            subscription.observer.error
          ) {
            subscription.observer.error(error);
          }
        });
      },

      onComplete: () => {
        observable.subscriptions.forEach((subscription) => {
          if (
            typeof subscription.observer === "object" &&
            subscription.observer.complete
          ) {
            subscription.observer.complete();
          }
        });
        observable.subscriptions = [];
        observable.onUnsubscribe();
      },
    } as FetchQueryObservable;
    _observables[observable.observableId] = observable;

    invoke("fetch_query", { query, operationName, variables }).then(
      (payload: any) => {
        if (payload) {
          const data = JSON.parse(payload);

          if (data.results) {
            observable.onNext(data.results);
            observable.onComplete();
          } else if (data.pending) {
            observable.subscriptionKey = data.pending;
          }
        }
      }
    );

    return observable;
  };

  return <GraphiQL fetcher={fetchQuery} />;
};

export default App;
