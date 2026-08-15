# Change Log

All notable changes to the "echolang-vscode" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.4.0]

Catching up with eight feature commits in the compiler. The 0.3.0 grammar was correct for the language as
it stood then; since then enums, `match`, string interpolation, `static`, `test` blocks and binary literals
all landed, and several of them left the grammar not merely silent but wrong — valid code was being
highlighted as an error.

Derived from the compiler as before, and this time from `src/Parser/EnumDeclParser.cpp`,
`src/Parser/MatchParser.cpp` and `src/AST/ASTAttributes.cpp` as well.

### Added

- **Enums.** `enum` declarations with lowercase or PascalCase names, `case` and its name, integer and string
  backings (`enum Status : int32`, `case ok = 200;`), payload cases (`case timeout(int32 $after);`), generic
  enums, and enum bodies holding statics, methods and operators.
- **`match`.** All three pattern spellings — `Unit::meter($v)`, `.ok($v)` and a generic subject written out
  as `Slot<int32>::filled($v)` — plus `else` as the catch-all, multi-binding arms and block arms.
- **The leading-dot shorthand.** `.kilometer`, `.ok($n)` and `.filled("hi")` now scope as enum members in
  all three destinations the shorthand accepts, whether or not a payload list follows.
- **String interpolation.** `{$...}` holes inside double-quoted strings, with the hole's contents lexed as
  ordinary Echo — so `{$p->x + $p->y}`, `{$xs[1]}` and `{$name->sub(0, 2)->size()}` highlight throughout.
  Format specs (`{$n:>8}`, `{$pi:.2f}`) get their own scope, and `{$std::io::x}` and `{$p:$}` are correctly
  not treated as specs. Single-quoted strings stay verbatim, which is the language's own escape hatch.
- **Escape sequences** are now validated against the closed set. `\n`, `\t`, `\r`, `\0`, `\\`, `\"`, `\'`,
  `\{`, `\xNN` and `\u{...}` are escapes; `\a`, `\v` and an unbraced `\uXXXX` are flagged as the errors they
  are.
- **`static`**, as a storage modifier alongside the visibility keywords.
- **`test` blocks** — `test adds_up { ... }` — and the `#[group:]` attribute that filters them.
- **Binary literals.** `0b1011` and `0B01`.
- `#[target:]`, including its `exe` and `test` tags and the `{ }` scope it may carry.

### Fixed

- `0b1011` was flagged `invalid.illegal`. Binary literals have been implemented in the lexer since
  `d3831c4`; they are now highlighted as the literals they are, and only a digitless `0b` is flagged.
- `#[group:]` and `#[target:]` were flagged as unknown attributes. The vocabulary is now the same fifteen
  names `AST::is_known_attribute` accepts.
- `1.` and `1.f` were not recognised as floats. The trailing dot is legal — the reader appends the zero.
- `3f` was highlighted as a float. `f` is the only suffix in the language and it is only legal on a float,
  so that is the integer `3` followed by an identifier.
- `1kg` now highlights, which is what a declared suffix operator looks like at a call site.
- `0b1011_0000` and `0xFF_00` lost their literal entirely. Echo has no digit separators, so each stops at
  the underscore and an identifier follows.
- **An unterminated string no longer recolours the rest of the file.** Opening a quote used to turn every
  line below it into string content until the next quote turned up — which is what every string looks like
  while you are still typing it. Both string forms are now bounded to the line they open on, as is an
  unclosed `{$` hole. This diverges from the lexer, which does not stop a string at a newline; the
  compiler's own corpus was checked first, and across 914 files not one literal actually spans a line.
- `?->` was scoped as an ordinary `->` whenever a member name followed it, which is everywhere it appears.
  It now keeps `keyword.operator.accessor.optional` throughout, so the null-safe accessor is
  distinguishable from the plain one.
- The reserved-word count in the grammar's own notes: thirty-five, not thirty-one.

### Removed

- `syntaxes/eco.markdown.json` and its `text.html.markdown.echo` contribution. It declared
  `fileTypes: ["emd"]`, but no language contributed `.emd`, so the scope could never activate — dead since
  the first commit. Fenced echo blocks in ordinary Markdown are unaffected; those come from the
  `markdown.echo.codeblock` injection, which is untouched.

### Changed

- Added a grammar regression suite. `npm test` runs `vscode-tmgrammar-test` over `tests/*.eco`, which carry
  inline scope assertions covering enums, `match`, interpolation, literals, attributes and keywords —
  including a pin for every regression listed above. `resources/test.eco` stays as the human fixture for
  *Developer: Inspect Editor Tokens and Scopes*; the two serve different purposes.
- `npm run package` wraps `vsce package`, which was previously invoked by hand.

## [0.3.0]

The grammar had not been touched since the first highlighting commit and had drifted a long way from the
language. It is now derived from the compiler's own token list (`include/Token.h`, `src/Lexer.cpp`) and the
reference documentation rather than written by hand.

### Added

- **Attributes.** `#[inline]`, `#[implicit]`, `#[unique]`, `#[core:]`, `#[builtin:]`, `#[intrinsic:]` and the
  seven `module.eco` manifest attributes, with the full value grammar: strings, numbers, bools, bare names,
  tagged values, lists and records. The name vocabulary is closed, so an unknown attribute name is
  highlighted as an error.
- **Conditional compilation.** `#[if:]`, `#[elif:]`, `#[else]` and `#[end]`, including the closed axis
  vocabularies (`os`, `arch`) and their values. These fold as regions now, too.
- Keywords added since the last grammar: `foreach`, `guard`, `break`, `continue`, `interface`, `enum`,
  `unsafe`, `mv`, `strong`, `weak`, `instanceof`, `internal`, `namespace`.
- Tokens added since the last grammar: `?->`, `??`, `:$`, `=>`, `..`, `..=`, `**`, `<<`, `>>`, `::`.
- `usize` and `isize`.
- Single-quoted strings, which the lexer has always accepted.
- `$this`, `self::`, property access versus method calls, the nineteen call-site builtins, function and type
  declaration names, `operator` precedence clauses, and `extern` symbol renames (`function abs as c_abs`).
- Distinct scope for `/** */` blocks, matching how `stdlib/core/` is written.

### Removed

- `double`, `int128` and `uint128`, which are not types. There is no `double`; `float64` is spelled
  `float64`, and the primitive set stops at 64 bits.
- `protected` and `static`, which are not keywords. Visibility is `private` / `internal` / `public`, and
  leaving it off means `internal` rather than public.
- `constructor` as a reserved word. It is a contextual identifier — a struct may have a property called
  `constructor` — so it is now only recognised in front of a parameter list. `destructor` is genuinely
  reserved and stays.
- The `debug` and `fatal` built-ins, which no longer exist.

### Fixed

- `0 .. 3` was tokenised as a float. The numeric rule now declines to eat a dot that is followed by another
  dot, the same way the compiler's numeric reader does, so ranges read correctly with or without spaces.
- `0b1010` was highlighted as a valid binary literal. Binary literals are not implemented — the lexer has no
  rule for them, so it reads `0` followed by an identifier `b1010` — and they are now marked invalid rather
  than coloured as something that works.
- `;` carried a `.php` scope suffix left over from the original grammar.
- The Markdown code-fence injection only matched ` ```echo `. It now also matches ` ```eco `, which the
  language documentation uses interchangeably.
- Dead capture references in the code-fence injection.

### Changed

- **New logo.** The extension icon is Echo's current mark — the dot with three radiating ripples — replacing
  the older swirl on a white disc. It is `#008EFC` on transparency, which is how the language's own docs and
  favicon use it, so it reads on a light and a dark background alike rather than carrying its own backdrop.

  `resources/logo_echo.png` is generated from `resources/logo_echo.svg`, which is copied from
  `echo-logo.svg` in the compiler repository. To regenerate it after the mark changes again:

  ```bash
  rsvg-convert -w 1024 -h 1024 resources/logo_echo.svg -o /tmp/logo-1024.png
  magick /tmp/logo-1024.png -trim +repage -resize 205x205 \
      -background none -gravity center -extent 256x256 resources/logo_echo.png
  ```

  The trim-and-recentre is the point of those two steps: the mark is left-weighted inside its own viewBox,
  because it is drawn to sit beside a wordmark. Rasterised as-is it lands off-centre in a square icon and
  fills about half the width. The result is 256×256, up from the previous 128×128.
- `language-configuration.json` gained a `wordPattern` that includes the `$` sigil, `/** */` continuation on
  Enter, indentation rules, and folding markers for `#[if:]` regions.
- `module.eco` is registered by filename as well as by extension.
- `.vscodeignore` now excludes `*.vsix`, so a build no longer embeds every earlier package inside itself.

## [0.2.0] - [0.1.0]

Not recorded at the time.

## [0.0.1]

- Initial release
