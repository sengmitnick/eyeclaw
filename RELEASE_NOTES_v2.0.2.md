# Release Notes - v2.0.2

## 📦 Package Information
- **Package**: `@eyeclaw/eyeclaw`
- **Version**: `2.0.2`
- **Release Date**: 2025-02-23

## ✨ Changes in this Version

### New Features
- Added OpenClaw Agent integration support
- Implemented chat command handling with Agent callback
- Enhanced command execution system (ping, status, echo, help, chat)

### Improvements
- Better error handling for unknown commands
- Improved logging for chat message processing
- Added fallback echo mode when Agent is not available

### Bug Fixes
- Fixed command parameter handling
- Improved WebSocket connection stability

## 📋 Pre-Release Checklist

✅ Version updated in `sdk/package.json` (2.0.1 → 2.0.2)
✅ NPM_TOKEN configured in `.env`
✅ Source files updated and committed
✅ README documentation up to date
✅ All dependencies properly defined

## 🚀 How to Publish

### Option 1: Using the publish script (Recommended)
```bash
cd sdk
chmod +x publish.sh
./publish.sh
```

### Option 2: Manual publish
```bash
cd sdk
npm publish --access public
```

### Option 3: With 2FA (if using Classic Token)
```bash
cd sdk
# Get 2FA code from your authenticator app
npm publish --access public --otp=YOUR_6_DIGIT_CODE
```

## 📝 Post-Publish Steps

1. **Verify Publication**
   ```bash
   npm view @eyeclaw/eyeclaw version
   # Should output: 2.0.2
   ```

2. **Test Installation**
   ```bash
   openclaw plugins install @eyeclaw/eyeclaw
   # or
   openclaw plugins update eyeclaw
   ```

3. **Update GitHub Release**
   - Create a new release on GitHub
   - Tag: `v2.0.2`
   - Title: `Release v2.0.2`
   - Copy this release notes content

4. **Announce Release**
   - Update documentation on https://eyeclaw.io/docs
   - Notify users about the update
   - Post in Discord/community channels

## 🔗 Links
- NPM Package: https://www.npmjs.com/package/@eyeclaw/eyeclaw
- GitHub Repo: https://github.com/eyeclaw/eyeclaw
- Documentation: https://eyeclaw.io/docs

## 🐛 Known Issues
None reported for this version.

## 🙏 Contributors
- EyeClaw Team
