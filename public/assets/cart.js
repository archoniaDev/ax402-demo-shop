/**
 * Ax402 Demo Shop cart — localStorage lines { kind: 'track'|'album', id }.
 */
(() => {
  const KEY = "axshop-cart";

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (x) => x && (x.kind === "track" || x.kind === "album") && typeof x.id === "string",
      );
    } catch {
      return [];
    }
  }

  function write(items) {
    localStorage.setItem(KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent("axshop-cart", { detail: items }));
  }

  function keyOf(item) {
    return `${item.kind}:${item.id}`;
  }

  function add(item) {
    const items = read();
    if (items.some((x) => keyOf(x) === keyOf(item))) return items;
    items.push({ kind: item.kind, id: item.id });
    write(items);
    return items;
  }

  function remove(item) {
    const items = read().filter((x) => keyOf(x) !== keyOf(item));
    write(items);
    return items;
  }

  function clear() {
    write([]);
  }

  function count() {
    return read().length;
  }

  function updateBadges() {
    const n = count();
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      el.textContent = String(n);
      el.hidden = n === 0;
    });
  }

  window.addEventListener("axshop-cart", updateBadges);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateBadges);
  } else {
    updateBadges();
  }

  window.AxShopCart = { read, write, add, remove, clear, count, keyOf, updateBadges };
})();
