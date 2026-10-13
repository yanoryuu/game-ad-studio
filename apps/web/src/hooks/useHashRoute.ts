import { useEffect, useState } from "react";

export type Route = { page: "list" } | { page: "editor"; projectId: string };

function parse(hash: string): Route {
  const m = /^#\/p\/([A-Za-z0-9_-]+)/.exec(hash);
  if (m) return { page: "editor", projectId: m[1]! };
  return { page: "list" };
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(route: Route) {
  window.location.hash = route.page === "editor" ? `#/p/${route.projectId}` : "#/";
}
