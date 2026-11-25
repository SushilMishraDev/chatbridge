(() => {
  // Hook window.fetch synchronously in page context (world: MAIN) to capture the live ChatGPT Bearer token
  const originalFetch = window.fetch;
  if (typeof originalFetch !== "function") return;

  window.fetch = function (...args) {
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (typeof url === "string" && url.includes("/backend-api/")) {
        const init = args[1] || {};
        let authHeader = null;
        if (init.headers) {
          if (typeof init.headers.get === "function") {
            authHeader = init.headers.get("authorization") || init.headers.get("Authorization");
          } else if (init.headers.Authorization) {
            authHeader = init.headers.Authorization;
          } else if (init.headers.authorization) {
            authHeader = init.headers.authorization;
          }
        }
        if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
          window.postMessage({ type: "CHATBRIDGE_CAPTURED_BEARER", token: authHeader }, "*");
        }
      }
    } catch {}
    return originalFetch.apply(this, args);
  };
})();
