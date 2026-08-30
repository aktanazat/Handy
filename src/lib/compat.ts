/* The polyfill's own contract. It cannot be spelled as `ObjectConstructor`'s:
 * `Object.hasOwn` is ES2022 and this project compiles against ES2020 (see
 * tsconfig.json "lib"), which is the same reason the shim is needed at all.
 * Keeping the owner generic means a caller's object type survives the call
 * instead of being flattened on the way in. */
type HasOwn = <Owner extends object>(owner: Owner, key: PropertyKey) => boolean;

const hasOwn: HasOwn = (owner, key) =>
  Object.prototype.hasOwnProperty.call(owner, key);

/** Install compatibility shims required by frontend dependencies. */
export const installCompatShims = (): void => {
  // react-markdown uses Object.hasOwn, which WebKit lacks before Safari 15.4
  // (macOS 12.3); Sona still ships down to macOS 10.15.
  if ("hasOwn" in Object) return;
  Object.defineProperty(Object, "hasOwn", {
    value: hasOwn,
    configurable: true,
    writable: true,
  });
};
