// Router minúsculo (sem Express). Suporta parâmetros de rota tipo "/team/:id".

function compilePath(pattern) {
  const paramNames = [];
  const regexStr = pattern
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        paramNames.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

function createRouter() {
  const routes = [];

  function add(method, pattern, ...handlers) {
    routes.push({ method, ...compilePath(pattern), handlers });
  }

  function match(method, pathname) {
    for (const route of routes) {
      if (route.method !== method) continue;
      const m = route.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1]);
      });
      return { handlers: route.handlers, params };
    }
    return null;
  }

  return {
    get: (pattern, ...h) => add("GET", pattern, ...h),
    post: (pattern, ...h) => add("POST", pattern, ...h),
    delete: (pattern, ...h) => add("DELETE", pattern, ...h),
    match,
  };
}

module.exports = { createRouter };
