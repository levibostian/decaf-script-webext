# decaf-script-webext

A script specifically designed for the [decaf](https://github.com/levibostian/decaf) deployment automation tool. This script deploys a Firefox web extension to [addons.mozilla.org](https://addons.mozilla.org) (AMO) using the [`web-ext`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/) CLI.

## What does this script do?

This is a decaf deploy step script that handles Firefox extension deployment. When decaf has determined a new version should be released, this script will:

1. **Update the manifest.json version** to match the release version determined by decaf
2. **Lint the extension** when running in decaf test mode (`web-ext lint`)
3. **Sign the extension** when running a real deployment (`web-ext sign`)

Signing submits the extension to AMO, which is how Firefox extensions get the signed package required for distribution.

# Getting Started

Run using decaf's `shebang` command in your deployment workflow.

**GitHub Actions Example**

```yaml
- uses: levibostian/decaf
  with:
    deploy: |
      # your deployment scripts here...
      # at some point run the web extension deploy script
      decaf shebang https://github.com/levibostian/decaf-script-webext.git/shebang.sh@<version-here> --channel unlisted
    # Other decaf arguments...
```

Replace `<version-here>` with a [release](https://github.com/levibostian/decaf-script-webext/releases). Latest: ![GitHub Release](https://img.shields.io/github/v/release/levibostian/decaf-script-webext)

**Command Line Example**

```bash
decaf \
  --deploy "decaf shebang https://github.com/levibostian/decaf-script-webext.git/shebang.sh@<version-here> --channel unlisted"
```

# Configuration

### Command Line Options

See [all args that 'sign' accepts](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/) and pass in the arguments that you would like to use. 

**Example:**

```bash
decaf shebang https://github.com/levibostian/decaf-script-webext.git/shebang.sh@<version-here> \
  --channel listed
```

### AMO Credentials

Signing requires API credentials from addons.mozilla.org. The script runs `web-ext sign`, and `web-ext` reads credentials from the `WEB_EXT_API_KEY` (JWT issuer) and `WEB_EXT_API_SECRET` (JWT secret) environment variables. Set them in your CI/CD environment.

To generate credentials, visit your [AMO API keys](https://addons.mozilla.org/developers/addon/api/key/) page.
