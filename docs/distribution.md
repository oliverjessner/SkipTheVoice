# Distribution

SkipTheVoice ships as the public npm package `skipthevoice` and as the Homebrew formula `skipthevoice` in `oliverjessner/homebrew-tap`. Both distributions include the production web UI and CLI and do not require Docker or a source checkout.

## npm release

Log in once with the npm account that publishes the unscoped `skipthevoice` package:

```bash
npm login
```

Run the release check. This executes tests, lint, type checks, builds the package, and inspects the tarball without publishing it:

```bash
npm run publish:npm
```

Publish after the check succeeds:

```bash
npm run publish:npm -- --publish
```

For npm accounts using one-time passwords:

```bash
npm run publish:npm -- --publish --otp 123456
```

After publication, the script downloads the registry tarball, calculates its SHA-256, and updates the registered `oliverjessner/tap` checkout reported by `brew --repo oliverjessner/tap`. It then runs Homebrew style and audit checks, reinstalls and tests the formula, commits the formula update, and pushes the tap. The tap must be clean and pushable before the npm package is published.

Use `--skip-brew-install` only when the formula has already been installed and tested on another release machine:

```bash
npm run publish:npm -- --publish --skip-brew-install
```

## Homebrew release

To update the formula independently after an npm publication:

```bash
npm run release:brew
brew style "$(brew --repo oliverjessner/tap)/Formula/skipthevoice.rb"
brew audit --strict oliverjessner/tap/skipthevoice
```

The formula installs Node.js, FFmpeg, OpenAI Whisper, the small HTTP worker dependencies, and the CLI. Its wrapper points SkipTheVoice at Homebrew-managed binaries, so it does not create another user-managed Python environment.

## Local package test

```bash
npm run pack:cli
npm install --global ./skipthevoice-0.1.3.tgz
skipthevoice
skipthevoice --help
```

Do not commit generated `.tgz` archives.
