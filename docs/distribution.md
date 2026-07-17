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

After publication, the script downloads the registry tarball, calculates its SHA-256, and updates `../homebrew-tap/Formula/skipthevoice.rb`. The tap change remains local so it can be reviewed, committed, and pushed separately.

## Homebrew release

To update the formula independently after an npm publication:

```bash
npm run release:brew
brew style ../homebrew-tap/Formula/skipthevoice.rb
brew audit --strict ../homebrew-tap/Formula/skipthevoice.rb
```

The formula installs Node.js, FFmpeg, OpenAI Whisper, the small HTTP worker dependencies, and the CLI. Its wrapper points SkipTheVoice at Homebrew-managed binaries, so it does not create another user-managed Python environment.

## Local package test

```bash
npm run pack:cli
npm install --global ./skipthevoice-0.1.2.tgz
skipthevoice
skipthevoice --help
```

Do not commit generated `.tgz` archives.
