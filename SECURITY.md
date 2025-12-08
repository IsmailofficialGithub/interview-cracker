# Security Documentation

## Threat Model

### Security Goals
1. **Confidentiality**: Chat logs and API keys encrypted at rest
2. **Privacy**: Screen sharing protection, no telemetry
3. **Integrity**: HMAC verification, atomic writes
4. **Availability**: Crash recovery, atomic operations

### Threats Mitigated
- **Screen Capture**: Content protection prevents Zoom/Teams/OBS capture
- **Memory Dumps**: Sensitive data zeroed from memory
- **IPC Attacks**: Context isolation, whitelisted IPC channels
- **File System**: Atomic writes prevent corruption
- **Network**: HTTPS-only for remote APIs, certificate validation

## Encryption Architecture

### Key Derivation
- **Algorithm**: PBKDF2-HMAC-SHA256
- **Iterations**: 100,000+
- **Salt**: 32 bytes, random per installation
- **Key Length**: 32 bytes (256 bits)

### Encryption
- **Algorithm**: AES-256-GCM
- **IV**: 12 bytes, random per encryption
- **Authentication**: Built-in GCM authentication tag
- **HMAC**: SHA-256 for additional integrity (optional)

### Storage
- Salt stored in `.salt.dat` (separate from encrypted data)
- Encrypted files: `.enc` extension
- Atomic writes: temp file → rename
- Secure deletion: overwrite → delete

## Security Practices

### Code Security
- Context isolation enabled
- Node integration disabled in renderer
- Sandbox enabled
- CSP headers configured
- No eval or dynamic code execution

### Memory Security
- Sensitive buffers zeroed after use
- Session keys cleared on lock/close
- No password storage (derive each time)
- Secure password input (masked, no autocomplete)

### IPC Security
- Whitelisted IPC channels only
- Request/response pattern (`ipcRenderer.invoke()`)
- Input validation on all handlers
- Rate limiting on sensitive operations

### Network Security
- HTTPS-only for remote APIs
- Certificate validation enforced
- API keys encrypted at rest
- No requests except to configured providers

## Audit Logging

Security events logged to encrypted audit log:
- Failed login attempts
- Encryption/decryption errors
- Unusual access patterns
- All events include timestamp, no sensitive data

## Testing

### Security Testing Checklist
- [ ] Screen capture protection (Zoom/Teams/OBS)
- [ ] Memory dump analysis (no plaintext keys)
- [ ] IPC security audit
- [ ] Encryption/decryption verification
- [ ] Password strength validation
- [ ] Session key cleanup verification

### Windows-Specific Testing
- [ ] UAC compatibility
- [ ] SmartScreen behavior
- [ ] Multi-monitor support
- [ ] Hotkey conflicts
- [ ] High DPI scaling

## Vulnerability Reporting

If you discover a security vulnerability, please report it responsibly.

## Best Practices

1. **Password Management**: Use a strong, unique master password
2. **Backup**: Regularly export encrypted backups
3. **Updates**: Keep the application updated
4. **API Keys**: Rotate API keys periodically
5. **Network**: Use VPN if accessing remote APIs on untrusted networks

