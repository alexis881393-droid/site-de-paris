/**
 * Compléments (polyfills) pour les navigateurs intégrés anciens, par exemple le navigateur
 * Chromium d'un script FiveM. Chargé avant l'application. Chaque ajout ne s'active que si la
 * fonction manque : aucun effet sur un navigateur récent.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const def = (target: any, name: string, value: unknown) => {
  if (target && !(name in target)) {
    Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
  }
};

function at(this: any, i: number) {
  const n = Math.trunc(i) || 0;
  const k = n < 0 ? this.length + n : n;
  return k < 0 || k >= this.length ? undefined : this[k];
}
def(Array.prototype, "at", at);
def(String.prototype, "at", at);
def(Object, "hasOwn", (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k));
def(Array.prototype, "findLast", function (this: any[], f: (v: any, i: number, a: any[]) => boolean, t?: unknown) {
  for (let i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return this[i];
  return undefined;
});
def(Array.prototype, "findLastIndex", function (this: any[], f: (v: any, i: number, a: any[]) => boolean, t?: unknown) {
  for (let i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return i;
  return -1;
});
def(Array.prototype, "toSorted", function (this: any[], c?: (a: any, b: any) => number) {
  return this.slice().sort(c);
});
def(Array.prototype, "toReversed", function (this: any[]) {
  return this.slice().reverse();
});
def(String.prototype, "replaceAll", function (this: string, a: string | RegExp, b: any) {
  return typeof a === "string" ? this.split(a).join(b) : this.replace(a, b);
});
def(globalThis, "structuredClone", (v: unknown) => (v === undefined ? v : JSON.parse(JSON.stringify(v))));
def(Promise, "withResolvers", function () {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
});
if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
  def(crypto, "randomUUID", () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  });
}
