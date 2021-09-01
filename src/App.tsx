import React from "react";
import GraphiQL from "graphiql";
import "graphiql/graphiql.css";
import { useEffect } from "react";
import "./App.css";

import { invoke } from "@tauri-apps/api";
import { getCurrent } from "@tauri-apps/api/window";

let _observableId = 0;
let _observables: any[] = [];

function fetchQuery(params: any) {
  const query = params.query;

  if (query === undefined) {
    return Promise.reject("undefined query!");
  }

  const operationName = params.operationName || "";
  const variables = params.variables ? JSON.stringify(params.variables) : "";

  console.log(`Query: ${query}`);
  console.log(`Operation: ${operationName}`);
  console.log(`Variables: ${variables}`);

  const observable = {
    queryId: null,
    unsubscribed: false,
    observableId: _observableId++,
    observerId: 0,
    subscriptions: [] as any[],

    subscribe: (observer: any) => {
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
      };

      observable.subscriptions.push(subscription);
      return subscription;
    },

    onUnsubscribe: () => {
      if (observable.subscriptions.length === 0) {
        observable.unsubscribed = true;
        _observables = _observables.filter(
          (observableId) => observable.observableId !== observableId
        );
        // const queryId = observable.queryId;
        // if (queryId !== null) {
        //   window.gqlmapi
        //     .unsubscribe(queryId)
        //     .then(() => window.gqlmapi.discardQuery(queryId));
        // }
      }
    },

    onNext: (response: any) => {
      observable.subscriptions.forEach((subscription) => {
        if (typeof subscription.observer === "function") {
          subscription.observer(response);
          subscription.unsubscribe();
        } else {
          subscription.observer.next(response);
        }
      });
    },

    onComplete: () => {
      observable.subscriptions.forEach((subscription) => {
        if (typeof subscription.observer === "object") {
          subscription.observer.complete();
        }
      });
      observable.subscriptions = [];
      observable.onUnsubscribe();
    },
  };
  _observables[observable.observableId] = observable;

  invoke("fetch_query", { query, operationName, variables }).then(
    (payload: any) => {
      if (payload) {
        const data = JSON.parse(payload);

        if (data.results) {
          observable.onNext(data.results);
          observable.onComplete();
        }
      }
    }
  );
  // window.gqlmapi.parseQuery(query).then((queryId) => {
  //   if (observable.unsubscribed) {
  //     return window.gqlmapi.discardQuery(queryId);
  //   }

  //   observable.queryId = queryId;
  //   return window.gqlmapi.fetchQuery(
  //     queryId,
  //     operationName,
  //     variables,
  //     (payload) => observable.onNext(payload),
  //     () => observable.onComplete()
  //   );
  // });

  return observable;
}

function App() {
  useEffect(() => {
    const unlisten = getCurrent().listen("fetch_query", (event) => {
      console.log(event.payload);
    });

    invoke("fetch_query", {
      query: `query DefaultStore {
      stores @orderBy(sorts: [
          {
            property: {id: 13312},
            type: BOOL,
            descending: true
          }
      ]) @take(count: 1) {
        name
        id
      }
    }
    `,
      operationName: "",
      variables: "",
    }).then(console.log);

    return () => {
      unlisten.then((callback) => {
        callback();
        console.log("finished listening");
      });
    };
  });

  return <GraphiQL fetcher={fetchQuery} />;
}

export default App;
