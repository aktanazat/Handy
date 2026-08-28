# Rust anti-slop: native layer and family mapping

The ast-grep pack in `rules/` is syntax-only and works on any Rust source
tree, with or without Cargo. Where a Cargo project is available, `clippy` is
**stronger** than the ast-grep pack for most of these rules because it is
type-aware: it can tell `Value` the `serde_json` type from `Value` a local
enum, and it understands `unsafe` blocks that ast-grep can only pattern-match
syntactically. Prefer clippy when you have Cargo; keep the ast-grep pack as
the baseline for non-Cargo contexts (scripts, `rustc` snippets, monorepos
that vendor Rust without a workspace) and as a fast pre-commit / CI gate that
doesn't need a full `cargo check`.

**Clippy is not currently installed for the stable toolchain on this
machine.** `rustup component add clippy` installs it — this file documents
the configuration to add *if and when that is done*; it does not install
anything itself.

## `clippy.toml` (repo root)

```toml
# Types that must never appear in fully type-checked code. Unlike the
# ast-grep pack, clippy's `disallowed-types` resolves the actual type through
# imports, aliases, and generics, so it also catches `use serde_json::Value
# as V` or a re-exported alias that a syntactic pattern would miss.
disallowed-types = [
    { path = "std::any::Any", reason = "type-erases the value; give it a real enum or trait instead (see anti-slop-rust-no-dyn-any)" },
    { path = "serde_json::Value", reason = "untyped JSON at a boundary; parse into a concrete struct (see anti-slop-rust-no-json-value-in-signatures)" },
]

# Specific methods that are escape hatches even though their *types* are
# fine. `disallowed-methods` is what makes clippy strictly stronger than the
# ast-grep `no-transmute` rule: it resolves the fully qualified path even
# when the call goes through a `use` alias or a generic function.
disallowed-methods = [
    { path = "std::mem::transmute", reason = "reinterprets bytes with no layout or validity check (see anti-slop-rust-no-transmute)" },
    { path = "std::mem::transmute_copy", reason = "same as transmute, plus it silently reads past a too-small source (see anti-slop-rust-no-transmute)" },
]
```

## `Cargo.toml` (`[lints.clippy]`)

```toml
[lints.clippy]
unwrap_used = "warn"
expect_used = "warn"
undocumented_unsafe_blocks = "warn"
as_conversions = "warn"
dbg_macro = "warn"
todo = "warn"
unimplemented = "warn"
missing_transmute_annotations = "warn"
```

Start these at `"warn"` and raise to `"deny"` once an existing codebase is
clean; `unwrap_used`/`expect_used`/`as_conversions` are usually the noisiest
on a first pass.

## Which ast-grep rule each clippy lint supersedes

| ast-grep rule | clippy lint | why clippy wins |
| --- | --- | --- |
| `anti-slop-rust-no-dyn-any` | `disallowed-types` (`std::any::Any`) | Resolves `Any` through re-exports/aliases; also catches `TypeId::of::<T>()` comparisons the ast-grep pack doesn't pattern for. |
| `anti-slop-rust-no-json-value-in-signatures` | `disallowed-types` (`serde_json::Value`) | Same resolution advantage; also catches a local `type Json = serde_json::Value;` alias used in a signature, which the ast-grep rule's text-based `regex` cannot follow. |
| `anti-slop-rust-no-unsafe-dictionary-type` | `disallowed-types` (transitively, via the `Value`/`Any` entries above) | `HashMap<String, Value>` is disallowed because `Value` itself is disallowed everywhere, not just inside a map — strictly broader coverage than the ast-grep rule's `HashMap`/`BTreeMap`-specific pattern. |
| `anti-slop-rust-require-safety-comment-for-unsafe` | `undocumented_unsafe_blocks` | Clippy's version understands the safety-comment convention precisely (including `SAFETY:` above the enclosing `impl`/`fn` for a whole unsafe function, and multi-line comment blocks); the ast-grep rule only checks the immediate previous sibling for a single-line comment. |
| `anti-slop-rust-no-transmute` | `disallowed-methods` (`std::mem::transmute`, `transmute_copy`) + `missing_transmute_annotations` | `disallowed-methods` resolves the call through aliases the way `disallowed-types` does; `missing_transmute_annotations` additionally catches transmutes that *are* kept but have inferred (rather than explicit) generic parameters, which is a real-type-level check the ast-grep rule cannot do at all. |
| `anti-slop-rust-no-unchecked-unwrap` | `unwrap_used` + `expect_used` | Clippy flags every `.unwrap()`/`.expect()` unconditionally (no comment-based escape hatch), which is stricter. The ast-grep rule's `// SAFETY:`/`// PANIC:` exemption is a deliberate compromise for contexts without clippy: it forces a written justification instead of banning the call outright. Keep the ast-grep rule's test-code exemption behavior in mind — `unwrap_used`/`expect_used` apply to test code too unless scoped with `#[cfg_attr(not(test), warn(clippy::unwrap_used))]` or an `#[allow]` on the test module. |
| `anti-slop-rust-no-numeric-as-cast` | `as_conversions` | Clippy's lint bans *every* `as` cast (numeric, pointer, enum-to-int, trait-object), not just the nine numeric primitives the ast-grep pattern enumerates; it is a strict superset. |
| `anti-slop-rust-no-leftover-panic-markers` | `dbg_macro` + `todo` + `unimplemented` | Equivalent coverage; clippy's versions are type-checker-integrated so they also fire inside macro-generated code the ast-grep syntax pass never sees. |
| `anti-slop-rust-no-shape-in-symbol-names` | none | This is a naming convention, not a type or method identity — clippy has no lint for it and isn't the right tool. The ast-grep rule is the only layer; keep it. |

## Dropped TypeScript families and why they don't port to Rust

- **F4 — runtime type dispatch instead of a typed contract (`typeof` switching).**
  Dropped. Rust has no `typeof`/runtime type-string operator to escape
  through; `match` over an `enum` *is* the typed contract, not a workaround
  for missing one. The only "guess the type at runtime" primitive Rust has
  is `Any::downcast`, which is already covered by `anti-slop-rust-no-dyn-any`.

- **F5 — reflection instead of a declared field access (`Reflect.get`,
  `Reflect.apply`).** Dropped. `std` has no reflection API: there is no way
  to look up a struct field or call a method by a runtime string name without
  a proc-macro or a reflection crate the project would have to opt into
  explicitly. There is nothing built into the language to ban.

- **F6 — module mocking in tests.** Dropped. Rust has no runtime module
  system to monkey-patch (no `jest.mock`, no prototype swapping). Rust test
  doubles are built by injecting a trait implementation (`impl Storage for
  FakeStorage`) or `#[cfg(test)]`-gating a real dependency — that's the
  *correct* pattern here, not an escape hatch to flag.

- **F8 — inline object-literal parameter types (`{ foo: string }` as a
  parameter type).** Dropped. Rust's type system is nominal: there is no
  anonymous/structural record type you can write inline as a parameter, so
  the anti-pattern has no Rust spelling to catch. (A function that takes a
  loosely-typed `HashMap<String, Value>` "bag of params" is the closest
  Rust equivalent, and that's already `anti-slop-rust-no-unsafe-dictionary-type`.)

- **F9 — conditional empty-object spread (`{ ...(cond ? obj : {}) }`).**
  Dropped. Rust has no object-spread literal syntax at all. Struct update
  syntax (`Foo { field: 1, ..base }`) requires `base` to already be a real,
  fully-typed instance of `Foo` — there is no way to conditionally spread
  "nothing," so the TypeScript anti-pattern isn't expressible.

- **F3 (partial) — `no-chained-type-assertions` and `no-widen-then-assert`
  specifically.** Dropped as *distinct* rules, though the family is not
  dropped overall (see `anti-slop-rust-no-numeric-as-cast`,
  `anti-slop-rust-no-transmute`, and
  `anti-slop-rust-require-safety-comment-for-unsafe`, all F3 ports). The
  TypeScript versions exploit `unknown` as a universal escape hatch
  (`x as unknown as Foo`); Rust has no `unknown` to widen through, and `as`
  only compiles between a fixed set of related types (numeric-to-numeric,
  pointer-to-pointer, enum-to-integer, etc.), so there is no "chain of
  assertions through an untyped hole" to construct. `transmute` is the
  actual bottom of that hole in Rust, which is why it gets its own rule
  instead of being folded into the cast rule.
